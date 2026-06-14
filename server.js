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
const matchmakingQueue = [];

// Generate a unique 4-digit numeric room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// Get timer duration based on gameMode and difficulty (PvP matches are always 4.0s)
function getTurnDuration(difficulty) {
    return 4.0;
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
        
        if (winner === 'player') {
            room.hostWins = (room.hostWins || 0) + 1;
        } else {
            room.challengerWins = (room.challengerWins || 0) + 1;
        }

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
            difficulty: room.difficulty,
            hostWins: room.hostWins || 0,
            challengerWins: room.challengerWins || 0
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

    broadcastOnlinePlayerCount();

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
                        lastActiveTime: Date.now(),
                        hostWins: 0,
                        challengerWins: 0,
                        isQuickMatch: false
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

                    if (!room || ws !== room.hostSocket) {
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
                    const isHostConnection = (ws === room.hostSocket);
                    if (isHostConnection !== isHostTurn) {
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

                    const activePlayerName = (ws === room.hostSocket) ? room.hostName : room.challengerName;
                    const logText = `${activePlayerName} selected: ${selectedValue} (+${addition})`;
                    room.history.push(logText);

                    // Check game over
                    if (room.currentTotal >= room.deadNumber) {
                        room.isGameOver = true;
                        const loser = room.currentTurn; // player or opponent
                        const winner = loser === 'player' ? 'opponent' : 'player'; // opponent of loser wins
                        
                        if (winner === 'player') {
                            room.hostWins = (room.hostWins || 0) + 1;
                        } else {
                            room.challengerWins = (room.challengerWins || 0) + 1;
                        }

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
                    if (room) {
                        const isHostTurn = room.selectionTurn === 'host';
                        const isHostConnection = (ws === room.hostSocket);
                        if (isHostConnection === isHostTurn) {
                            room.deadNumber = parseInt(data.deadNumber) || 25;
                            if (room.isDraftActive) {
                                broadcastDraftState(room);
                            } else {
                                broadcastState(room, 'update-config');
                            }
                        }
                    }
                    break;
                }

                case 'CONFIRM_CONFIG': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);

                    if (!room || !room.isDraftActive) {
                        return;
                    }

                    // Only the active selector can confirm
                    const isHostTurn = room.selectionTurn === 'host';
                    const isHostConnection = (ws === room.hostSocket);
                    if (isHostConnection !== isHostTurn) {
                        sendError(ws, 'It is not your turn to confirm.');
                        return;
                    }

                    const deadNum = parseInt(data.deadNumber);
                    if (isNaN(deadNum) || deadNum < 20 || deadNum > 100) {
                        sendError(ws, 'Invalid Dead Number selection.');
                        return;
                    }

                    room.deadNumber = deadNum;
                    console.log(`[Server] Room ${code} parameters confirmed. Starting match with Dead Number ${deadNum}.`);
                    
                    startGamePvP(room);
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

                case 'JOIN_QUICK_MATCH': {
                    const playerName = data.playerName || 'Challenger';
                    
                    // Prevent duplicate queue entries
                    if (matchmakingQueue.includes(ws)) {
                        return;
                    }

                    console.log(`[Server] Player ${playerName} joined matchmaking queue.`);
                    
                    if (matchmakingQueue.length > 0) {
                        // Match found! Pair them
                        const hostSocket = matchmakingQueue.shift();
                        
                        // Verify the host is still active
                        if (hostSocket.readyState !== 1) {
                            matchmakingQueue.push(ws);
                            ws.send(JSON.stringify({ type: 'WAITING_FOR_OPPONENT' }));
                            return;
                        }

                        const code = generateRoomCode();
                        const hostName = hostSocket.playerName || 'Host';
                        
                        const newRoom = {
                            id: code,
                            hostSocket: hostSocket,
                            challengerSocket: ws,
                            hostName: hostName,
                            challengerName: playerName,
                            deadNumber: 25,
                            currentTotal: 0,
                            currentTurn: 'player', // The player who searched first gets first turn
                            isGameOver: false,
                            history: [],
                            difficulty: 'hard', // Default to hard for Quick Match (5s timers)
                            firstTurn: 'player',
                            turnTimer: getTurnDuration('hard'),
                            timerInterval: null,
                            lastActiveTime: Date.now(),
                            selectionTurn: 'host', // Host gets first draft turn
                            draftTimer: 10.0,
                            isDraftActive: true,
                            draftInterval: null,
                            hostWins: 0,
                            challengerWins: 0,
                            isQuickMatch: true
                        };

                        rooms.set(code, newRoom);
                        
                        hostSocket.currentRoomId = code;
                        hostSocket.isHostConnection = true;
                        
                        ws.currentRoomId = code;
                        ws.isHostConnection = false;

                        // Send explicit role assignments to prevent first-turn desync
                        hostSocket.send(JSON.stringify({
                            type: 'ROLE_ASSIGNMENT',
                            isHost: true,
                            roomId: code
                        }));
                        ws.send(JSON.stringify({
                            type: 'ROLE_ASSIGNMENT',
                            isHost: false,
                            roomId: code
                        }));

                        broadcastDraftState(newRoom);
                        console.log(`[Server] Quick Match paired. Starting 10s draft in Room ${code}: ${hostName} vs ${playerName}.`);
                        
                        startDraftTimer(newRoom);
                    } else {
                        ws.playerName = playerName;
                        matchmakingQueue.push(ws);
                        ws.send(JSON.stringify({ type: 'WAITING_FOR_OPPONENT' }));
                    }
                    break;
                }

                case 'LEAVE_QUICK_MATCH': {
                    const idx = matchmakingQueue.indexOf(ws);
                    if (idx !== -1) {
                        matchmakingQueue.splice(idx, 1);
                        console.log('[Server] Player left matchmaking queue.');
                    }
                    break;
                }

                case 'PLAY_AGAIN_REQUEST': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);
                    if (!room) {
                        sendError(ws, 'Room not found.');
                        return;
                    }

                    const isHost = (ws === room.hostSocket);
                    const opponent = isHost ? room.challengerSocket : room.hostSocket;
                    if (!opponent || opponent.readyState !== 1) {
                        sendError(ws, 'Opponent is no longer connected.');
                        return;
                    }

                    room.playAgainRequester = ws;
                    opponent.send(JSON.stringify({ type: 'PLAY_AGAIN_OFFERED' }));
                    console.log(`[Server] Rematch requested in Room ${code} by ${isHost ? 'Host' : 'Challenger'}.`);
                    break;
                }

                case 'PLAY_AGAIN_RESPONSE': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);
                    if (!room) {
                        sendError(ws, 'Room not found.');
                        return;
                    }

                    const requester = room.playAgainRequester;
                    const accept = !!data.accept;

                    if (!requester || requester.readyState !== 1) {
                        sendError(ws, 'Rematch requester is no longer connected.');
                        room.playAgainRequester = null;
                        return;
                    }

                    if (accept) {
                        console.log(`[Server] Rematch accepted in Room ${code}. Swapping roles...`);
                        
                        // 1. Swap roles/sockets, names, and win counts
                        const tempSocket = room.hostSocket;
                        room.hostSocket = room.challengerSocket;
                        room.challengerSocket = tempSocket;

                        const tempName = room.hostName;
                        room.hostName = room.challengerName;
                        room.challengerName = tempName;

                        const tempWins = room.hostWins || 0;
                        room.hostWins = room.challengerWins || 0;
                        room.challengerWins = tempWins;

                        // 2. Update socket role properties
                        room.hostSocket.isHostConnection = true;
                        room.challengerSocket.isHostConnection = false;

                        // 3. Send explicit ROLE_ASSIGNMENT packets
                        room.hostSocket.send(JSON.stringify({
                            type: 'ROLE_ASSIGNMENT',
                            isHost: true,
                            roomId: code
                        }));
                        room.challengerSocket.send(JSON.stringify({
                            type: 'ROLE_ASSIGNMENT',
                            isHost: false,
                            roomId: code
                        }));

                        // 4. Reset room state
                        room.currentTotal = 0;
                        room.isGameOver = false;
                        room.history = [];
                        room.turnTimer = getTurnDuration(room.difficulty);
                        stopRoomTimer(room);
                        stopDraftTimer(room);

                        room.playAgainRequester = null;

                        // 5. Start game or draft depending on match type
                        if (room.isQuickMatch) {
                            room.selectionTurn = 'host'; // New host selects first
                            room.draftTimer = 10.0;
                            room.isDraftActive = true;
                            broadcastDraftState(room);
                            startDraftTimer(room);
                        } else {
                            broadcastState(room, 'lobby-ready');
                        }
                    } else {
                        console.log(`[Server] Rematch declined in Room ${code}.`);
                        requester.send(JSON.stringify({ type: 'PLAY_AGAIN_REJECTED' }));
                        room.playAgainRequester = null;
                    }
                    break;
                }

                case 'PLAY_AGAIN_CANCEL': {
                    const code = ws.currentRoomId;
                    const room = rooms.get(code);
                    if (room && room.playAgainRequester === ws) {
                        const isHost = (ws === room.hostSocket);
                        const opponent = isHost ? room.challengerSocket : room.hostSocket;
                        if (opponent && opponent.readyState === 1) {
                            opponent.send(JSON.stringify({ type: 'PLAY_AGAIN_CANCELLED' }));
                        }
                        room.playAgainRequester = null;
                        console.log(`[Server] Rematch request cancelled in Room ${code}.`);
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
        // Remove from matchmaking queue if present
        const qIdx = matchmakingQueue.indexOf(ws);
        if (qIdx !== -1) {
            matchmakingQueue.splice(qIdx, 1);
            console.log('[Server] Removed disconnected player from matchmaking queue.');
        }

        const code = ws.currentRoomId;
        if (code) {
            const room = rooms.get(code);
            if (room) {
                stopRoomTimer(room);
                stopDraftTimer(room);
                console.log(`[Server] Player disconnected from Room ${code}. Cleaning up...`);
                
                // Notify the remaining player
                const isHost = (ws === room.hostSocket);
                const remainderSocket = isHost ? room.challengerSocket : room.hostSocket;
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
        broadcastOnlinePlayerCount();
    });
});

function startDraftTimer(room) {
    stopDraftTimer(room);
    room.draftInterval = setInterval(() => {
        if (!room.isDraftActive) {
            stopDraftTimer(room);
            return;
        }

        room.draftTimer = Math.max(0, room.draftTimer - 0.1);
        
        broadcastDraftState(room);

        if (room.draftTimer <= 0) {
            stopDraftTimer(room);
            handleDraftTimeout(room);
        }
    }, 100);
}

function stopDraftTimer(room) {
    if (room.draftInterval) {
        clearInterval(room.draftInterval);
        room.draftInterval = null;
    }
}

function handleDraftTimeout(room) {
    if (room.selectionTurn === 'host') {
        // Switch turn to Challenger
        room.selectionTurn = 'challenger';
        room.draftTimer = 10.0;
        console.log(`[Server] Room ${room.id} draft timeout for Host. Switching to Challenger.`);
        broadcastDraftState(room);
        startDraftTimer(room);
    } else {
        // Challenger also timed out. Force start with default 25
        room.isDraftActive = false;
        console.log(`[Server] Room ${room.id} draft timeout for Challenger. Force starting game with ${room.deadNumber}.`);
        startGamePvP(room);
    }
}

function startGamePvP(room) {
    room.isDraftActive = false;
    stopDraftTimer(room);
    
    room.currentTotal = 0;
    room.isGameOver = false;
    room.history = [];
    room.currentTurn = 'player'; // The Host gets first turn (the one who clicked search first)
    room.turnTimer = getTurnDuration(room.difficulty);
    room.lastActiveTime = Date.now();

    broadcastState(room, 'start-game');
    console.log(`[Server] PvP game started in Room ${room.id}. Dead Number: ${room.deadNumber}. First turn: Host.`);
    
    setTimeout(() => {
        startRoomTimer(room);
    }, 1200);
}

function broadcastDraftState(room) {
    const payload = JSON.stringify({
        type: 'DRAFT_UPDATE',
        room: {
            roomId: room.id,
            deadNumber: room.deadNumber,
            selectionTurn: room.selectionTurn,
            draftTimer: room.draftTimer,
            isDraftActive: room.isDraftActive,
            hostName: room.hostName,
            challengerName: room.challengerName,
            hostWins: room.hostWins || 0,
            challengerWins: room.challengerWins || 0
        }
    });

    if (room.hostSocket && room.hostSocket.readyState === 1) {
        room.hostSocket.send(payload);
    }
    if (room.challengerSocket && room.challengerSocket.readyState === 1) {
        room.challengerSocket.send(payload);
    }
}

function broadcastOnlinePlayerCount() {
    const count = wss.clients.size;
    const payload = JSON.stringify({
        type: 'ONLINE_COUNT',
        count: count
    });
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Authoritative Dead Number server running on port ${PORT}`);
    console.log(`=======================================================`);
});
