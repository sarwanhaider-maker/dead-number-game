/**
 * Dead Number: Authoritative WebSocket Server
 * Handles room lifecycle, validates gameplay, manages authoritative countdown timers,
 * and broadcasts game state to connected clients.
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8765;

// Create HTTP Server for compatibility and optional health checking
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ server });

// Map of roomId -> roomState
const rooms = new Map();

// Generate a unique 4-digit numeric room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// Get timer duration based on gameMode and difficulty
function getTurnDuration(difficulty) {
    if (difficulty === 'easy') return 7.0;
    if (difficulty === 'medium') return 5.0;
    if (difficulty === 'hard') return 3.0;
    return 5.0; // Default for PvP / unknown modes
}

// Clean up rooms periodically (e.g., inactive for over 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        if (now - room.lastActiveTime > 60 * 60 * 1000) {
            console.log(`[Server] Cleaning up inactive room ${roomId}`);
            stopRoomTimer(room);
            rooms.delete(roomId);
        }
    }
}, 5 * 60 * 1000);

function startRoomTimer(room) {
    stopRoomTimer(room);
    room.lastActiveTime = Date.now();
    
    const tickRate = 100; // 100ms ticks
    room.timerInterval = setInterval(() => {
        if (room.isGameOver) {
            stopRoomTimer(room);
            return;
        }

        room.turnTimer = Math.max(0, room.turnTimer - (tickRate / 1000));
        
        // Broadcast state occasionally or let clients calculate elapsed time locally
        // We broadcast only on major state updates or sync, but we send ticks every 1000ms
        // to correct any local drift, or we let clients run local timers synced to the initial timestamp.
        // Broadcasting every 100ms to all clients would generate too many packets.
        // Instead, we will broadcast a timer update once per second.
        if (Math.round(room.turnTimer * 10) % 10 === 0) {
            broadcastState(room, 'timer-tick');
        }

        if (room.turnTimer <= 0) {
            stopRoomTimer(room);
            handleTimeout(room);
        }
    }, tickRate);
}

function stopRoomTimer(room) {
    if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
    }
}

function handleTimeout(room) {
    if (room.isGameOver) return;

    // Timeout penalty selection (+1 move)
    const minVal = room.currentTotal + 1;
    const targetVal = Math.min(minVal, room.deadNumber);
    const addition = targetVal - room.currentTotal;

    const activePlayerName = room.currentTurn === 'player' ? room.hostName : room.challengerName;
    const logText = `[TIMEOUT] ${activePlayerName} selected: ${targetVal} (+${addition})`;

    room.currentTotal = targetVal;
    room.history.push(logText);

    if (room.currentTotal >= room.deadNumber) {
        // Hitting dead number ends the game
        room.isGameOver = true;
        const loser = room.currentTurn;
        const winner = loser === 'player' ? 'opponent' : 'player'; // opponent of loser wins
        broadcastState(room, 'game-over', { winner });
        return;
    }

    // Swap turns and reset timer
    room.currentTurn = room.currentTurn === 'player' ? 'opponent' : 'player';
    room.turnTimer = getTurnDuration(room.difficulty);
    
    broadcastState(room, 'update-turn');
    startRoomTimer(room);
}

function broadcastState(room, eventStage = 'update', extraData = {}) {
    const payload = JSON.stringify({
        type: 'STATE_UPDATE',
        eventStage,
        room: {
            roomId: room.id,
            deadNumber: room.deadNumber,
            currentTotal: room.currentTotal,
            currentTurn: room.currentTurn,
            isGameOver: room.isGameOver,
            history: room.history,
            turnTimer: room.turnTimer,
            hostName: room.hostName,
            challengerName: room.challengerName,
            difficulty: room.difficulty
        },
        ...extraData
    });

    if (room.hostSocket && room.hostSocket.readyState === 1) {
        room.hostSocket.send(payload);
    }
    if (room.challengerSocket && room.challengerSocket.readyState === 1) {
        room.challengerSocket.send(payload);
    }
}

function sendError(socket, message) {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'ERROR', message }));
    }
}

wss.on('connection', (ws) => {
    console.log('[Server] New client connection opened.');
    ws.currentRoomId = null;
    ws.isHostConnection = false;

    ws.on('message', (messageString) => {
        try {
            const data = JSON.parse(messageString.toString());
            const type = data.type;

            switch (type) {
                case 'CREATE_ROOM': {
                    const hostName = data.hostName || 'Host';
                    const deadNumber = parseInt(data.deadNumber) || 25;
                    const difficulty = data.difficulty || 'hard';
                    const firstTurn = data.firstTurn || 'player';

                    const code = generateRoomCode();
                    const newRoom = {
                        id: code,
                        hostSocket: ws,
                        challengerSocket: null,
                        hostName,
                        challengerName: 'Challenger',
                        deadNumber,
                        currentTotal: 0,
                        currentTurn: firstTurn === 'player' ? 'player' : 'opponent',
                        isGameOver: false,
                        history: [],
                        difficulty,
                        firstTurn,
                        turnTimer: getTurnDuration(difficulty),
                        timerInterval: null,
                        lastActiveTime: Date.now()
                    };

                    rooms.set(code, newRoom);
                    ws.currentRoomId = code;
                    ws.isHostConnection = true;

                    ws.send(JSON.stringify({
                        type: 'ROOM_CREATED',
                        roomId: code
                    }));
                    console.log(`[Server] Room ${code} created by ${hostName}. Difficulty: ${difficulty}.`);
                    break;
                }

                case 'JOIN_ROOM': {
                    const code = data.roomId;
                    const playerName = data.playerName || 'Challenger';

                    const room = rooms.get(code);
                    if (!room) {
                        sendError(ws, 'Room not found.');
                        return;
                    }
                    if (room.challengerSocket) {
                        sendError(ws, 'Room is already full.');
                        return;
                    }

                    room.challengerSocket = ws;
                    room.challengerName = playerName;
                    ws.currentRoomId = code;
                    ws.isHostConnection = false;
                    room.lastActiveTime = Date.now();

                    // Notify both players that lobby is ready
                    broadcastState(room, 'lobby-ready');
                    console.log(`[Server] Challenger ${playerName} joined Room ${code}.`);
                    break;
                }

                case 'START_GAME': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);

                    if (!room || !ws.isHostConnection) {
                        sendError(ws, 'Only the host can start the game.');
                        return;
                    }

                    room.currentTotal = 0;
                    room.isGameOver = false;
                    room.history = [];
                    room.currentTurn = room.firstTurn === 'player' ? 'player' : 'opponent';
                    room.turnTimer = getTurnDuration(room.difficulty);
                    room.lastActiveTime = Date.now();

                    broadcastState(room, 'start-game');
                    console.log(`[Server] Game started in Room ${code}.`);
                    
                    // Delay start of authoritative countdown interval to allow clients to render loading
                    setTimeout(() => {
                        startRoomTimer(room);
                    }, 1200);
                    break;
                }

                case 'PLAY_MOVE': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);

                    if (!room) {
                        sendError(ws, 'Room not found.');
                        return;
                    }

                    if (room.isGameOver) {
                        sendError(ws, 'Game is already over.');
                        return;
                    }

                    // Authoritative validation of turn
                    const isHostTurn = room.currentTurn === 'player';
                    if (ws.isHostConnection !== isHostTurn) {
                        sendError(ws, 'It is not your turn.');
                        return;
                    }

                    const selectedValue = parseInt(data.value);
                    const addition = selectedValue - room.currentTotal;

                    // Authoritative validation of addition bounds
                    if (isNaN(selectedValue) || addition < 1 || addition > 4 || selectedValue > room.deadNumber) {
                        sendError(ws, 'Invalid move selection.');
                        return;
                    }

                    stopRoomTimer(room);

                    // Update room state
                    room.currentTotal = selectedValue;
                    room.lastActiveTime = Date.now();

                    const activePlayerName = ws.isHostConnection ? room.hostName : room.challengerName;
                    const logText = `${activePlayerName} selected: ${selectedValue} (+${addition})`;
                    room.history.push(logText);

                    // Check game over
                    if (room.currentTotal >= room.deadNumber) {
                        room.isGameOver = true;
                        const loser = room.currentTurn; // player or opponent
                        const winner = loser === 'player' ? 'opponent' : 'player'; // opponent of loser wins
                        broadcastState(room, 'game-over', { winner });
                        console.log(`[Server] Game over in Room ${code}. Winner: ${winner}.`);
                        return;
                    }

                    // Swap turn and reset timer
                    room.currentTurn = room.currentTurn === 'player' ? 'opponent' : 'player';
                    room.turnTimer = getTurnDuration(room.difficulty);

                    broadcastState(room, 'update-turn');
                    startRoomTimer(room);
                    break;
                }

                case 'UPDATE_CONFIG': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);
                    if (room && ws.isHostConnection) {
                        room.deadNumber = parseInt(data.deadNumber) || 25;
                        broadcastState(room, 'update-config');
                    }
                    break;
                }

                case 'RESET_LOBBY': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);
                    if (room) {
                        room.currentTotal = 0;
                        room.isGameOver = false;
                        room.history = [];
                        room.turnTimer = getTurnDuration(room.difficulty);
                        stopRoomTimer(room);
                        broadcastState(room, 'lobby-ready');
                    }
                    break;
                }

                default:
                    console.warn(`[Server] Unknown action type received: ${type}`);
            }
        } catch (err) {
            console.error('[Server] Message handling error:', err);
            sendError(ws, 'Server failed to process transaction.');
        }
    });

    ws.on('close', () => {
        const code = ws.currentRoomId;
        if (code) {
            const room = rooms.get(code);
            if (room) {
                stopRoomTimer(room);
                console.log(`[Server] Player disconnected from Room ${code}. Cleaning up...`);
                
                // Notify the remaining player
                const remainderSocket = ws.isHostConnection ? room.challengerSocket : room.hostSocket;
                if (remainderSocket && remainderSocket.readyState === 1) {
                    remainderSocket.send(JSON.stringify({
                        type: 'OPPONENT_DISCONNECTED',
                        message: 'Opponent disconnected. Connection severed.'
                    }));
                }
                
                rooms.delete(code);
            }
        }
        console.log('[Server] Client connection closed.');
    });
});

server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Authoritative Dead Number server running on port ${PORT}`);
    console.log(`=======================================================`);
});
