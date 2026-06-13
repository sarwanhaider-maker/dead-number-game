/**
 * Bigg Boss Tournament Engine & State Machine
 */

const BiggBossMultiplayer = {
    // Current local state (Host maintains source of truth; Clients sync to this)
    gameState: {
        roomId: null,
        gameStage: 'setup', // 'setup', 'lobby', 'countdown', 'game1', 'game2', 'game3', 'game4', 'results', 'eviction', 'victory'
        players: [],        // Array of { clientId, name, color, status: 'active'|'nominated'|'evicted', score, isBot }
        activeMatchups: [], // Pairings for Game 2 (Tic-Cross): [[p1, p2], [p3, p4], ...]
        activeMatchIndex: 0,// Which matchup is currently active or shown
        ticCrossState: {    // State of the current Tic-Cross match
            board: Array(9).fill(null), // 'X', 'O', or null
            turn: null,       // clientId of player whose turn it is
            winner: null,     // clientId of winner, 'draw', or null
            playerX: null,    // clientId for X
            playerO: null     // clientId for O
        },
        countdownVal: 3,
        roundTimer: 0,
        eliminatedThisRound: [], // clientIds of players eliminated in current phase
        currentNarrative: 'Bigg Boss welcomes you to the Arena. Set up the game to begin.'
    },

    // Client-side local variables
    myClientId: null,
    myPlayerName: '',
    isHost: false,
    
    // Toggles
    soundEnabled: true,
    voiceEnabled: true,

    // Bot names list inspired by popular Bigg Boss contestants
    botNames: [
        'Sid Shukla', 'Shehnaaz', 'Asim Riaz', 'Rubina Dilaik', 'Tejasswi', 
        'Manveer Gurjar', 'Gautam Gulati', 'Shweta Tiwari', 'Munawar', 'Pratik Sehajpal',
        'Jasmin Bhasin', 'Aly Goni', 'Karan Kundrra', 'Shamita Shetty', 'MC Stan'
    ],

    playerColors: [
        '#38bdf8', '#f43f5e', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#38d399', 
        '#f59e0b', '#06b6d4', '#6366f1', '#ec4899', '#14b8a6', '#f97316', '#84cc16', 
        '#e11d48', '#0284c7'
    ],

    init() {
        this.myClientId = BiggBossNetwork.clientId;
        
        // Bind network callbacks
        BiggBossNetwork.onConnectionChange = (connected, statusMsg) => {
            this.handleConnectionChange(connected, statusMsg);
        };
        
        BiggBossNetwork.onStateReceived = (newState) => {
            this.handleStateUpdate(newState);
        };
        
        BiggBossNetwork.onClientEvent = (senderId, action, data) => {
            this.handleClientEvent(senderId, action, data);
        };
    },

    /**
     * Start game as Host
     */
    hostGame(callback) {
        BiggBossNetwork.createRoom((success, roomId) => {
            if (success) {
                this.isHost = true;
                this.gameState.roomId = roomId;
                this.gameState.gameStage = 'lobby';
                this.gameState.players = [
                    {
                        clientId: this.myClientId,
                        name: 'Host (Spectator)',
                        color: '#fbbf24',
                        status: 'active',
                        score: null,
                        isBot: false,
                        isHost: true
                    }
                ];
                this.gameState.currentNarrative = 'Bigg Boss House is open. Waiting for 16 housemates to join.';
                this.broadcastState();
                if (callback) callback(true, roomId);
            } else {
                if (callback) callback(false, roomId);
            }
        });
    },

    /**
     * Join game as Client
     */
    joinGame(roomId, playerName, callback) {
        this.myPlayerName = playerName || 'Player_' + Math.floor(Math.random() * 1000);
        BiggBossNetwork.joinRoom(roomId, this.myPlayerName, (success, err) => {
            if (success) {
                this.isHost = false;
                this.gameState.roomId = roomId;
                if (callback) callback(true);
            } else {
                if (callback) callback(false, err);
            }
        });
    },

    /**
     * Starts a local offline practice session with 15 bots
     */
    startLocalGame() {
        this.isHost = true;
        this.myClientId = this.myClientId || 'p_' + Math.random().toString(36).substr(2, 9);
        this.gameState.roomId = 'LOCAL';
        this.gameState.gameStage = 'lobby';
        this.gameState.players = [
            {
                clientId: this.myClientId,
                name: 'You (Player)',
                color: '#38bdf8',
                status: 'active',
                score: null,
                isBot: false,
                isHost: false // in local game you are a player, not a pure spectator
            }
        ];
        this.gameState.currentNarrative = 'Local practice session started. All slots filled with bots. Bigg Boss is ready.';
        
        // Visual indicator that we are offline and local
        this.handleConnectionChange(true, 'Local Session (Offline)');
        
        this.fillLobbyWithBots();
    },

    /**
     * Fills the remaining lobby slots with bots to make up exactly 16 players
     */
    fillLobbyWithBots() {
        if (!this.isHost) return;
        
        // Remove Host spectator from the active participant pool for the 16 players count, 
        // OR let's treat Host as a pure spectator and we need exactly 16 active players.
        // Let's structure the player pool: 
        // The Host is a pure spectator, and we have 16 competitors.
        // If a real player joins, they are a competitor. If we have N real players, we add 16-N bots.
        const competitors = this.gameState.players.filter(p => !p.isHost);
        const slotsNeeded = 16 - competitors.length;
        
        if (slotsNeeded <= 0) return;
        
        // Shuffle bot names
        const shuffledBots = [...this.botNames].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < slotsNeeded; i++) {
            const name = shuffledBots[i % shuffledBots.length] + ' (Bot)';
            const color = this.playerColors[competitors.length % this.playerColors.length];
            const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
            
            const botPlayer = {
                clientId: botId,
                name: name,
                color: color,
                status: 'active',
                score: null,
                isBot: true,
                isHost: false
            };
            
            this.gameState.players.push(botPlayer);
            competitors.push(botPlayer); // keep track of length
        }
        
        this.gameState.currentNarrative = 'Bigg Boss House is full with 16 housemates. Host, you may start the season.';
        this.broadcastState();
    },

    /**
     * Host starts the tournament
     */
    startTournament() {
        if (!this.isHost) return;
        
        // Ensure we have exactly 16 competitors (excluding the host spectator if they are spectator only)
        const competitors = this.gameState.players.filter(p => !p.isHost);
        if (competitors.length < 16) {
            console.warn('Cannot start without 16 competitors');
            return;
        }

        // Reset all player statuses to active, clear previous scores
        this.gameState.players.forEach(p => {
            p.status = 'active';
            p.score = null;
        });
        
        this.gameState.eliminatedThisRound = [];
        this.startStageTransition('game1', 'Game 1: Reaction Arena. Test your response stability. Slowest 8 players will be evicted immediately.');
    },

    /**
     * Start stage transition with a countdown
     */
    startStageTransition(targetStage, narrativeText) {
        this.gameState.gameStage = 'countdown';
        this.gameState.countdownVal = 3;
        this.gameState.currentNarrative = narrativeText;
        this.broadcastState();
        
        // Countdown timer loop
        let count = 3;
        const interval = setInterval(() => {
            count--;
            this.gameState.countdownVal = count;
            
            if (count <= 0) {
                clearInterval(interval);
                this.gameState.gameStage = targetStage;
                
                // Initialize the specific game round
                this.initGameRound(targetStage);
            } else {
                this.broadcastState();
            }
        }, 1000);
    },

    /**
     * Initialize specific game variables and timers (Host-only)
     */
    initGameRound(stage) {
        if (!this.isHost) return;
        
        // Reset scores
        this.gameState.players.forEach(p => { p.score = null; });
        
        if (stage === 'game1') {
            // Game 1: Reaction Arena
            this.gameState.roundTimer = 30; // 30 seconds limit
            this.startRoundTimer(() => this.evaluateGame1());
            this.simulateBotReactionTimes();
            
        } else if (stage === 'game2') {
            // Game 2: Tic-Cross Duel (8 players left -> paired into 4 duels)
            const activeCompetitors = this.gameState.players.filter(p => !p.isHost && p.status === 'active');
            
            // Randomly pair them up
            const shuffled = [...activeCompetitors].sort(() => Math.random() - 0.5);
            this.gameState.activeMatchups = [];
            for (let i = 0; i < shuffled.length; i += 2) {
                if (i + 1 < shuffled.length) {
                    this.gameState.activeMatchups.push([shuffled[i], shuffled[i+1]]);
                } else {
                    // Odd player gets a "bye" and automatically survives
                    const luckyPlayer = shuffled[i];
                    luckyPlayer.status = 'active';
                    this.gameState.currentNarrative = `${luckyPlayer.name} gets a BYE this round and automatically survives!`;
                    console.log(`${luckyPlayer.name} got a bye`);
                }
            }
            
            this.gameState.activeMatchIndex = 0;
            this.initTicCrossMatch();
            
        } else if (stage === 'game3') {
            // Game 3: Memory Core (4 players left -> repeat sequences. Bottom 2 eliminated)
            this.gameState.roundTimer = 40; // 40 seconds
            this.startRoundTimer(() => this.evaluateGame3());
            this.simulateBotMemoryScores();
            
        } else if (stage === 'game4') {
            // Game 4: The Final Grid (2 players left -> race to solve 1-16. Winner takes all)
            this.gameState.roundTimer = 50; // 50 seconds
            this.startRoundTimer(() => this.evaluateGame4());
            this.simulateBotFinalGridTime();
        }
        
        this.broadcastState();
    },

    /**
     * Start the countdown clock for active rounds
     */
    startRoundTimer(onTimeout) {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        this.timerInterval = setInterval(() => {
            this.gameState.roundTimer--;
            
            // If all active players have submitted, we can skip the timer
            const activeCompetitors = this.gameState.players.filter(p => !p.isHost && p.status === 'active');
            const allSubmitted = activeCompetitors.every(p => p.score !== null);
            
            if (this.gameState.roundTimer <= 0 || allSubmitted) {
                clearInterval(this.timerInterval);
                this.gameState.roundTimer = 0;
                onTimeout();
            } else {
                this.broadcastState();
            }
        }, 1000);
    },

    /**
     * Game 1 Evaluation: Slowest 8 players out of 16 are nominated for eviction
     */
    evaluateGame1() {
        if (!this.isHost) return;
        
        const competitors = this.gameState.players.filter(p => !p.isHost);
        
        // Give failing scores (9999ms) to anyone who didn't submit
        competitors.forEach(p => {
            if (p.score === null) p.score = 9999;
            p.reactionScore = p.score; // preserve Game 1 score for draw tie-breakers
        });
        
        // Sort by score ascending (lowest time/closest to center is best)
        competitors.sort((a, b) => a.score - b.score);
        
        // The bottom 8 (indices 8 to 15) are evicted
        const survivors = competitors.slice(0, 8);
        const losers = competitors.slice(8);
        
        this.gameState.eliminatedThisRound = losers.map(p => p.clientId);
        
        // Mark status
        losers.forEach(p => { p.status = 'nominated'; });
        survivors.forEach(p => { p.status = 'active'; });
        
        this.gameState.gameStage = 'results';
        this.gameState.currentNarrative = 'Reaction Arena finished. 8 housemates are nominated for immediate eviction.';
        this.broadcastState();
    },

    /**
     * Game 3 Evaluation: Memory Core. Bottom 2 of 4 players are evicted.
     */
    evaluateGame3() {
        if (!this.isHost) return;
        
        const activeCompetitors = this.gameState.players.filter(p => !p.isHost && p.status === 'active');
        
        // Anyone who didn't submit gets 0 score
        activeCompetitors.forEach(p => {
            if (p.score === null) p.score = 0;
        });
        
        // Sort descending by score (higher rounds completed is better)
        activeCompetitors.sort((a, b) => b.score - a.score);
        
        // Bottom 2 are eliminated
        const survivors = activeCompetitors.slice(0, 2);
        const losers = activeCompetitors.slice(2);
        
        this.gameState.eliminatedThisRound = losers.map(p => p.clientId);
        losers.forEach(p => { p.status = 'nominated'; });
        survivors.forEach(p => { p.status = 'active'; });
        
        this.gameState.gameStage = 'results';
        this.gameState.currentNarrative = 'Memory Core finished. 2 players with the lowest scores are nominated for eviction.';
        this.broadcastState();
    },

    /**
     * Game 4 Evaluation: The Final Grid. First to finish wins the game.
     */
    evaluateGame4() {
        if (!this.isHost) return;
        
        const activeCompetitors = this.gameState.players.filter(p => !p.isHost && p.status === 'active');
        
        // Sort by completion time ascending (lower time is better). Anyone who didn't submit gets 99999ms
        activeCompetitors.forEach(p => {
            if (p.score === null) p.score = 99999;
        });
        
        activeCompetitors.sort((a, b) => a.score - b.score);
        
        const winner = activeCompetitors[0];
        const loser = activeCompetitors[1];
        
        this.gameState.eliminatedThisRound = [loser.clientId];
        loser.status = 'nominated';
        winner.status = 'active';
        
        this.gameState.gameStage = 'results';
        this.gameState.currentNarrative = 'The Final Grid is completed. Bigg Boss has the final results of the season.';
        this.broadcastState();
    },

    /**
     * CONFIRM EVICTION: Evicts all nominated players from the active roster (Host-only)
     */
    confirmEviction() {
        if (!this.isHost) return;
        
        // Collect nominated players
        const nominated = this.gameState.players.filter(p => p.status === 'nominated');
        if (nominated.length === 0) return;
        
        // Evict them in the state
        nominated.forEach(p => {
            p.status = 'evicted';
        });
        
        // Determine what is the next step
        const activeCompetitors = this.gameState.players.filter(p => !p.isHost && p.status === 'active');
        const count = activeCompetitors.length;
        
        console.log(`confirmEviction: Nominated players evicted. Remaining active competitors: ${count}`);
        
        if (count > 4 && count <= 8) {
            // Go to Game 2 (Tic-Cross)
            this.startStageTransition('game2', `Game 2: Tic-Cross Duel. The ${count} remaining players will be paired in a 1v1 battle. Loser of each duel is evicted.`);
        } else if (count > 2 && count <= 4) {
            // Go to Game 3 (Memory)
            this.startStageTransition('game3', `Game 3: Memory Core. ${count} players remaining. Repeat the flashing light sequences. Bottom 2 scores are evicted.`);
        } else if (count === 2) {
            // Go to Game 4 (Final Grid)
            this.startStageTransition('game4', 'Game 4: The Final Grid. The ultimate showdown. Race to clear the grid in ascending order. First to clear wins the season.');
        } else if (count === 1) {
            // We have a winner!
            this.gameState.gameStage = 'victory';
            this.gameState.currentNarrative = `Bigg Boss crowns ${activeCompetitors[0].name} as the Winner of the season! Congratulations!`;
            this.broadcastState();
        } else {
            console.error('Unexpected active player count: ', count);
            // Robust fallback: if count is greater than 8, go to game2. If count is 3, go to game3. Otherwise reset.
            if (count > 8) {
                this.startStageTransition('game2', `Game 2: Tic-Cross Duel. The ${count} remaining players will be paired in a 1v1 battle. Loser of each duel is evicted.`);
            } else if (count === 3) {
                this.startStageTransition('game3', 'Game 3: Memory Core. Repeat the flashing light sequences. Bottom scores are evicted.');
            } else {
                this.resetToSetup();
            }
        }
    },

    /**
     * Initialize Tic-Cross match for the current activeMatchIndex (Host-only)
     */
    initTicCrossMatch() {
        if (!this.isHost) return;
        
        const matchup = this.gameState.activeMatchups[this.gameState.activeMatchIndex];
        if (!matchup) {
            // No more matchups. We have finished Game 2 duels!
            this.evaluateGame2Duels();
            return;
        }
        
        const [p1, p2] = matchup;
        console.log(`Starting Tic-Cross Match: ${p1.name} vs ${p2.name}`);
        
        this.gameState.ticCrossState = {
            board: Array(9).fill(null),
            turn: p1.clientId, // Player X goes first
            winner: null,
            playerX: p1.clientId,
            playerO: p2.clientId
        };
        
        this.gameState.currentNarrative = `Game 2, Match ${this.gameState.activeMatchIndex + 1}: ${p1.name} (X) vs ${p2.name} (O). Play to survive.`;
        this.broadcastState();
        
        // Trigger bot move if player X is a bot
        if (p1.isBot) {
            this.triggerBotTicCrossMove(p1.clientId);
        }
    },

    /**
     * Client makes a move in Tic-Cross
     */
    makeTicCrossMove(cellIndex, clientId) {
        if (this.isHost) {
            this.processTicCrossMove(cellIndex, clientId);
        } else {
            // Send action to host
            BiggBossNetwork.sendAction('TIC_MOVE', { cellIndex: cellIndex });
        }
    },

    /**
     * Process Tic-Cross move on Host
     */
    processTicCrossMove(cellIndex, clientId) {
        if (!this.isHost) return;
        const tc = this.gameState.ticCrossState;
        
        // Validate turn
        if (tc.turn !== clientId || tc.board[cellIndex] !== null || tc.winner !== null) {
            return;
        }
        
        // Apply move
        const marker = (clientId === tc.playerX) ? 'X' : 'O';
        tc.board[cellIndex] = marker;
        
        // Check win/draw
        if (this.checkTicCrossWin(marker)) {
            tc.winner = clientId;
            this.handleTicCrossEnd();
        } else if (tc.board.every(cell => cell !== null)) {
            tc.winner = 'draw';
            this.handleTicCrossEnd();
        } else {
            // Switch turn
            tc.turn = (clientId === tc.playerX) ? tc.playerO : tc.playerX;
            
            // Broadcast update
            const activePlayer = this.gameState.players.find(p => p.clientId === tc.turn);
            this.gameState.currentNarrative = `${activePlayer.name}'s turn in the duel.`;
            this.broadcastState();
            
            // If new turn is a bot, trigger it
            if (activePlayer && activePlayer.isBot) {
                this.triggerBotTicCrossMove(tc.turn);
            }
        }
    },

    /**
     * Check if a marker won
     */
    checkTicCrossWin(marker) {
        const board = this.gameState.ticCrossState.board;
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
            [0, 4, 8], [2, 4, 6]             // diagonals
        ];
        return winPatterns.some(pattern => {
            return pattern.every(index => board[index] === marker);
        });
    },

    /**
     * Match finished. Update round index, nominate loser. (Host-only)
     */
    handleTicCrossEnd() {
        if (!this.isHost) return;
        const tc = this.gameState.ticCrossState;
        
        let pX = this.gameState.players.find(p => p.clientId === tc.playerX);
        let pO = this.gameState.players.find(p => p.clientId === tc.playerO);
        
        if (tc.winner === tc.playerX) {
            // Player X wins, Player O nominated
            pO.status = 'nominated';
            pX.status = 'active';
            this.gameState.eliminatedThisRound.push(pO.clientId);
            this.gameState.currentNarrative = `Match Winner: ${pX.name}! ${pO.name} is nominated for eviction.`;
        } else if (tc.winner === tc.playerO) {
            // Player O wins, Player X nominated
            pX.status = 'nominated';
            pO.status = 'active';
            this.gameState.eliminatedThisRound.push(pX.clientId);
            this.gameState.currentNarrative = `Match Winner: ${pO.name}! ${pX.name} is nominated for eviction.`;
        } else {
            // Draw. Compare reaction scores from Game 1 (lowest score is best)
            const scoreX = pX.reactionScore !== undefined ? pX.reactionScore : 9999;
            const scoreO = pO.reactionScore !== undefined ? pO.reactionScore : 9999;
            
            let survivor, nominated;
            let reason = "";
            
            if (scoreX < scoreO) {
                survivor = pX;
                nominated = pO;
                reason = `(Reaction: ${scoreX}ms vs ${scoreO}ms)`;
            } else if (scoreO < scoreX) {
                survivor = pO;
                nominated = pX;
                reason = `(Reaction: ${scoreO}ms vs ${scoreX}ms)`;
            } else {
                // Perfect tie in Game 1 as well, fall back to coin toss
                const coin = Math.random() < 0.5;
                survivor = coin ? pX : pO;
                nominated = coin ? pO : pX;
                reason = "(Tied Reaction; resolved by coin toss)";
            }
            
            nominated.status = 'nominated';
            survivor.status = 'active';
            this.gameState.eliminatedThisRound.push(nominated.clientId);
            this.gameState.currentNarrative = `It's a DRAW! Bigg Boss evaluates Game 1 reaction times: ${survivor.name} survives, ${nominated.name} is nominated. ${reason}`;
        }
        
        this.broadcastState();
        
        // Wait 3 seconds, then advance to next matchup or evaluate duels
        setTimeout(() => {
            this.gameState.activeMatchIndex++;
            this.initTicCrossMatch();
        }, 4000);
    },

    /**
     * Finish Game 2: transition to results stage (Host-only)
     */
    evaluateGame2Duels() {
        if (!this.isHost) return;
        
        this.gameState.gameStage = 'results';
        this.gameState.currentNarrative = 'All Tic-Cross duels have finished. The losers are nominated for immediate eviction.';
        this.broadcastState();
    },

    /**
     * Submit score from Client to Host
     */
    submitScore(scoreVal) {
        if (this.isHost || this.gameState.roomId === 'LOCAL') {
            // Host playing directly or local game
            this.recordPlayerScore(this.myClientId, scoreVal);
        } else {
            BiggBossNetwork.sendAction('SUBMIT_SCORE', { score: scoreVal });
        }
    },

    /**
     * Record score in Host state
     */
    recordPlayerScore(clientId, score) {
        if (!this.isHost) return;
        const player = this.gameState.players.find(p => p.clientId === clientId);
        if (player && player.status === 'active') {
            player.score = score;
            console.log(`Recorded score for ${player.name}: ${score}`);
            this.broadcastState();
        }
    },

    /**
     * Reset back to setup screen (Lobby refresh)
     */
    resetToSetup() {
        BiggBossNetwork.disconnect();
        this.isHost = false;
        this.gameState = {
            roomId: null,
            gameStage: 'setup',
            players: [],
            activeMatchups: [],
            activeMatchIndex: 0,
            ticCrossState: {
                board: Array(9).fill(null),
                turn: null,
                winner: null,
                playerX: null,
                playerO: null
            },
            countdownVal: 3,
            roundTimer: 0,
            eliminatedThisRound: [],
            currentNarrative: 'Bigg Boss welcomes you to the Arena. Set up the game to begin.'
        };
        if (this.timerInterval) clearInterval(this.timerInterval);
    },

    /* ==========================================
       BOT SIMULATORS (HOST ONLY LOGIC)
       ========================================== */

    /**
     * Bot reaction simulation (Game 1)
     */
    simulateBotReactionTimes() {
        if (!this.isHost) return;
        
        const bots = this.gameState.players.filter(p => p.isBot && p.status === 'active');
        bots.forEach(bot => {
            // Bots submit score after a random delay (1 to 10 seconds)
            const delay = 1000 + Math.random() * 9000;
            setTimeout(() => {
                // If stage changed already, do nothing
                if (this.gameState.gameStage !== 'game1') return;
                
                // Perfect hit is 0. Bot score range: 5ms (good) to 250ms (average) or 9999ms (fail)
                const isFail = Math.random() < 0.15; // 15% chance to fail
                const botScore = isFail ? 9999 : Math.floor(5 + Math.random() * 250);
                
                this.recordPlayerScore(bot.clientId, botScore);
            }, delay);
        });
    },

    /**
     * Bot Memory simulation (Game 3)
     */
    simulateBotMemoryScores() {
        if (!this.isHost) return;
        
        const bots = this.gameState.players.filter(p => p.isBot && p.status === 'active');
        bots.forEach(bot => {
            const delay = 5000 + Math.random() * 15000;
            setTimeout(() => {
                if (this.gameState.gameStage !== 'game3') return;
                
                // Simon Says score (rounds completed). Typically 3 to 10 rounds.
                const botScore = Math.floor(3 + Math.random() * 8);
                this.recordPlayerScore(bot.clientId, botScore);
            }, delay);
        });
    },

    /**
     * Bot Final Grid click speed simulation (Game 4)
     */
    simulateBotFinalGridTime() {
        if (!this.isHost) return;
        
        const bots = this.gameState.players.filter(p => p.isBot && p.status === 'active');
        bots.forEach(bot => {
            // Race to click 16 buttons. Time in ms: 6000ms to 20000ms.
            const delay = 6000 + Math.random() * 14000;
            setTimeout(() => {
                if (this.gameState.gameStage !== 'game4') return;
                
                const botTime = Math.floor(delay);
                this.recordPlayerScore(bot.clientId, botTime);
            }, delay);
        });
    },

    /**
     * Bot Tic-Cross Move Logic (Minimax-like or simple random-with-block)
     */
    triggerBotTicCrossMove(botClientId) {
        if (!this.isHost) return;
        const tc = this.gameState.ticCrossState;
        
        // Random move delay (1 to 2.5 seconds)
        const delay = 1000 + Math.random() * 1500;
        setTimeout(() => {
            if (this.gameState.gameStage !== 'game2' || tc.turn !== botClientId || tc.winner !== null) {
                return;
            }
            
            // Find empty cells
            const emptyCells = [];
            tc.board.forEach((cell, index) => {
                if (cell === null) emptyCells.push(index);
            });
            
            if (emptyCells.length === 0) return;
            
            // AI logic:
            // 1. Can bot win on this move?
            // 2. Can bot block opponent from winning?
            // 3. Otherwise, pick random.
            let chosenCell = emptyCells[0];
            const botMarker = (botClientId === tc.playerX) ? 'X' : 'O';
            const oppMarker = (botMarker === 'X') ? 'O' : 'X';
            
            // Helper to check winning indexes
            const winPatterns = [
                [0, 1, 2], [3, 4, 5], [6, 7, 8],
                [0, 3, 6], [1, 4, 7], [2, 5, 8],
                [0, 4, 8], [2, 4, 6]
            ];
            
            // 1. Try to win
            let foundWin = false;
            for (let cell of emptyCells) {
                tc.board[cell] = botMarker;
                if (this.checkTicCrossWin(botMarker)) {
                    chosenCell = cell;
                    foundWin = true;
                }
                tc.board[cell] = null; // revert
                if (foundWin) break;
            }
            
            // 2. Try to block opponent
            if (!foundWin) {
                let foundBlock = false;
                for (let cell of emptyCells) {
                    tc.board[cell] = oppMarker;
                    if (this.checkTicCrossWin(oppMarker)) {
                        chosenCell = cell;
                        foundBlock = true;
                    }
                    tc.board[cell] = null; // revert
                    if (foundBlock) break;
                }
            }
            
            // 3. Center tile preference
            if (!foundWin && tc.board[4] === null) {
                chosenCell = 4;
            } else if (!foundWin && emptyCells.length > 0) {
                // Pick random
                chosenCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            }
            
            this.processTicCrossMove(chosenCell, botClientId);
        }, delay);
    },

    /* ==========================================
       EVENT HANDLERS
       ========================================== */

    handleConnectionChange(connected, statusMsg) {
        console.log(`Network status changed: ${statusMsg} (${connected})`);
        const statusEl = document.getElementById('lobby-connection-status');
        if (statusEl) {
            statusEl.textContent = statusMsg;
            if (connected) {
                statusEl.style.color = '#34d399';
            } else {
                statusEl.style.color = '#f43f5e';
            }
        }
    },

    /**
     * When Client receives state from Host
     */
    handleStateUpdate(newState) {
        this.gameState = newState;
        
        // Sync local active status
        const me = this.gameState.players.find(p => p.clientId === this.myClientId);
        if (me) {
            // Hook UI changes based on my active state
            const rosterSidebar = document.getElementById('spectator-banner');
            if (rosterSidebar) {
                if (me.status === 'evicted') {
                    rosterSidebar.style.display = 'flex';
                } else {
                    rosterSidebar.style.display = 'none';
                }
            }
        }
        
        // Fire UI sync callback
        if (window.BiggBossUI && typeof window.BiggBossUI.syncStateToUI === 'function') {
            window.BiggBossUI.syncStateToUI(this.gameState);
        }
    },

    /**
     * When Host receives events from Clients
     */
    handleClientEvent(senderClientId, action, data) {
        if (!this.isHost) return;
        
        console.log(`Host received client action [${action}] from ${senderClientId}:`, data);
        
        if (action === 'JOIN') {
            // Client requests to join lobby
            const count = this.gameState.players.filter(p => !p.isHost).length;
            if (count >= 16) {
                // Room is full. Ignore or reject
                console.log('Room full. Client join rejected: ', data.name);
                return;
            }
            
            // Check if client is already in
            const exists = this.gameState.players.some(p => p.clientId === senderClientId);
            if (!exists) {
                // Assign a color
                const color = this.playerColors[count % this.playerColors.length];
                this.gameState.players.push({
                    clientId: senderClientId,
                    name: data.name,
                    color: color,
                    status: 'active',
                    score: null,
                    isBot: false,
                    isHost: false
                });
                
                this.gameState.currentNarrative = `${data.name} joined the Bigg Boss house.`;
                this.broadcastState();
            }
            
        } else if (action === 'SUBMIT_SCORE') {
            // Client submits score for active game
            this.recordPlayerScore(senderClientId, data.score);
            
        } else if (action === 'TIC_MOVE') {
            // Client makes a move in Tic-Cross duel
            this.processTicCrossMove(data.cellIndex, senderClientId);
        }
    },

    /**
     * Helper to broadcast state to clients
     */
    broadcastState() {
        if (this.isHost) {
            if (this.gameState.roomId !== 'LOCAL' && BiggBossNetwork.client && BiggBossNetwork.connected) {
                BiggBossNetwork.broadcastState(this.gameState);
            }
            
            // Also invoke local UI sync on Host's screen since Host does not receive its own broadcasts
            if (window.BiggBossUI && typeof window.BiggBossUI.syncStateToUI === 'function') {
                window.BiggBossUI.syncStateToUI(this.gameState);
            }
        }
    }
};

window.BiggBossMultiplayer = BiggBossMultiplayer;
