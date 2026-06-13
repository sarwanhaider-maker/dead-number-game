/**
 * Bigg Boss UI Controller, Particles & Sound Manager
 */

const BiggBossUI = {
    activeSubView: null,
    canvasCtx: null,
    canvasDots: [],
    lastVoiceText: '',
    bgAnimationId: null,

    init() {
        // Create audio manager instance globally
        window.audioManager = new AudioManager();
        
        // Initialize network and multiplayer state engines
        BiggBossMultiplayer.init();
        
        // Setup canvas background
        this.setupBackground();

        // Bind DOM elements
        this.bindEvents();

        // Sync initial state
        this.syncStateToUI(BiggBossMultiplayer.gameState);
    },

    bindEvents() {
        const playSound = () => {
            if (window.audioManager) window.audioManager.playClick();
        };

        // Host room
        document.getElementById('btn-create-room').onclick = () => {
            playSound();
            const originalText = document.getElementById('btn-create-room').textContent;
            document.getElementById('btn-create-room').textContent = 'Starting...';
            document.getElementById('btn-create-room').disabled = true;

            BiggBossMultiplayer.hostGame((success) => {
                document.getElementById('btn-create-room').textContent = originalText;
                document.getElementById('btn-create-room').disabled = false;
                if (!success) {
                    alert('Could not establish network room. Please check your internet connection.');
                }
            });
        };

        // Local Practice Play (Offline vs Bots)
        document.getElementById('btn-local-play').onclick = () => {
            playSound();
            BiggBossMultiplayer.startLocalGame();
        };

        // Join room
        document.getElementById('btn-join-room').onclick = () => {
            playSound();
            const name = document.getElementById('input-player-name').value.trim();
            const code = document.getElementById('input-room-code').value.trim();

            if (!name) {
                alert('Please enter your name.');
                return;
            }
            if (!code || code.length !== 4) {
                alert('Please enter a valid 4-digit Room Code.');
                return;
            }

            document.getElementById('btn-join-room').textContent = 'Joining...';
            document.getElementById('btn-join-room').disabled = true;

            BiggBossMultiplayer.joinGame(code, name, (success, err) => {
                document.getElementById('btn-join-room').textContent = 'Join Lobby';
                document.getElementById('btn-join-room').disabled = false;
                if (!success) {
                    alert('Lobby not found. Double check the 4-digit room code or internet connection.');
                }
            });
        };

        // Fill bots
        document.getElementById('btn-add-bots').onclick = () => {
            playSound();
            BiggBossMultiplayer.fillLobbyWithBots();
        };

        // Start tournament
        document.getElementById('btn-start-game').onclick = () => {
            playSound();
            BiggBossMultiplayer.startTournament();
        };

        // Mini-game action: Hit reaction gauge
        document.getElementById('btn-reaction-action').onclick = () => {
            BiggBossPuzzles.reaction.hit();
        };

        // Proceed to eviction ceremony (host results page)
        document.getElementById('btn-next-round').onclick = () => {
            playSound();
            // Host transitions everyone to eviction ceremony screen
            BiggBossMultiplayer.startStageTransition('eviction', 'Bigg Boss calls all housemates to the living area. The eviction ceremony is about to begin.');
        };

        // Confirm eviction (host eviction page)
        document.getElementById('btn-confirm-eviction').onclick = () => {
            playSound();
            BiggBossMultiplayer.confirmEviction();
        };

        // Restart victory
        document.getElementById('btn-victory-restart').onclick = () => {
            playSound();
            BiggBossMultiplayer.resetToSetup();
        };

        // Toggles
        document.getElementById('voice-tts-toggle').onclick = () => {
            BiggBossMultiplayer.voiceEnabled = !BiggBossMultiplayer.voiceEnabled;
            document.getElementById('voice-status').textContent = BiggBossMultiplayer.voiceEnabled ? 'ON' : 'OFF';
            document.querySelector('#voice-tts-toggle .indicator-dot').className = 
                'indicator-dot ' + (BiggBossMultiplayer.voiceEnabled ? 'green' : '');
            playSound();
            if (BiggBossMultiplayer.voiceEnabled) {
                this.speakVoice('Bigg Boss voice narration enabled.');
            }
        };

        document.getElementById('audio-music-toggle').onclick = () => {
            if (window.audioManager) {
                const muted = window.audioManager.toggleMute();
                BiggBossMultiplayer.soundEnabled = !muted;
                document.getElementById('music-status').textContent = !muted ? 'ON' : 'OFF';
                document.querySelector('#audio-music-toggle .indicator-dot').className = 
                    'indicator-dot ' + (!muted ? 'green' : '');
            }
        };

        // Bind Enter key globally as a fallback to start and advance the game
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                const lobbyScreen = document.getElementById('lobby-screen');
                const arenaScreen = document.getElementById('arena-screen');
                const evictionScreen = document.getElementById('eviction-screen');
                
                if (lobbyScreen && lobbyScreen.classList.contains('active') && BiggBossMultiplayer.isHost) {
                    playSound();
                    BiggBossMultiplayer.startTournament();
                } else if (arenaScreen && arenaScreen.classList.contains('active') && BiggBossMultiplayer.isHost && BiggBossMultiplayer.gameState.gameStage === 'results') {
                    playSound();
                    BiggBossMultiplayer.startStageTransition('eviction', 'Bigg Boss calls all housemates to the living area. The eviction ceremony is about to begin.');
                } else if (evictionScreen && evictionScreen.classList.contains('active') && BiggBossMultiplayer.isHost) {
                    playSound();
                    BiggBossMultiplayer.confirmEviction();
                }
            }
        });
    },

    /**
     * Syncs the entire multiplayer game state received from host into DOM elements
     */
    syncStateToUI(state) {
        // 1. Manage visible screen classes
        const screens = ['setup', 'lobby', 'arena', 'eviction', 'victory'];
        screens.forEach(s => {
            const el = document.getElementById(s + '-screen');
            if (!el) return;
            
            // Map stages to screen templates
            let active = false;
            if (s === 'setup' && state.gameStage === 'setup') active = true;
            else if (s === 'lobby' && state.gameStage === 'lobby') active = true;
            else if (s === 'arena' && ['countdown', 'game1', 'game2', 'game3', 'game4', 'results'].includes(state.gameStage)) active = true;
            else if (s === 'eviction' && state.gameStage === 'eviction') active = true;
            else if (s === 'victory' && state.gameStage === 'victory') active = true;
            
            if (active) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        // 2. Room Code & Connection Displays
        const roomCode = document.getElementById('display-room-code');
        if (roomCode) roomCode.textContent = state.roomId || '----';

        const me = state.players.find(p => p.clientId === BiggBossMultiplayer.myClientId);
        const myName = me ? me.name : '';
        const amIHost = BiggBossMultiplayer.isHost;

        // 3. Lobby Screen Renders
        if (state.gameStage === 'lobby') {
            const competitors = state.players.filter(p => !p.isHost);
            const grid = document.getElementById('lobby-player-grid');
            if (grid) {
                grid.innerHTML = '';
                // Render 16 player slots
                document.getElementById('connected-count').textContent = competitors.length;

                for (let i = 0; i < 16; i++) {
                    const slot = document.createElement('div');
                    const player = competitors[i];

                    if (player) {
                        slot.className = 'player-slot filled';
                        if (player.clientId === BiggBossMultiplayer.myClientId) {
                            slot.classList.add('self-slot');
                        }
                        slot.style.setProperty('--avatar-color', player.color);
                        
                        slot.innerHTML = `
                            <span class="slot-index">${(i + 1).toString().padStart(2, '0')}</span>
                            <div class="slot-avatar"></div>
                            <span class="slot-name">${player.name}</span>
                            <span class="slot-badge">${player.isBot ? 'BOT' : (player.clientId === BiggBossMultiplayer.myClientId ? 'YOU' : 'PLAYER')}</span>
                        `;
                    } else {
                        slot.className = 'player-slot empty';
                        slot.innerHTML = `
                            <span class="slot-index">${(i + 1).toString().padStart(2, '0')}</span>
                            <div class="slot-avatar"></div>
                            <span class="slot-name">Awaiting Player...</span>
                        `;
                    }
                    grid.appendChild(slot);
                }
            }

            // Show appropriate lobby action cards
            const hostControls = document.getElementById('host-lobby-controls');
            const clientControls = document.getElementById('client-lobby-waiting');
            
            if (amIHost) {
                if (hostControls) hostControls.style.display = 'block';
                if (clientControls) clientControls.style.display = 'none';

                const startBtn = document.getElementById('btn-start-game');
                if (startBtn) {
                    // Start button only enabled when lobby has exactly 16 players (bypassed in offline local mode)
                    startBtn.disabled = (state.roomId !== 'LOCAL' && competitors.length < 16);
                }
            } else {
                if (hostControls) hostControls.style.display = 'none';
                if (clientControls) clientControls.style.display = 'block';
            }
        }

        // 4. Arena Screen Renders
        if (['countdown', 'game1', 'game2', 'game3', 'game4', 'results'].includes(state.gameStage)) {
            // Roster list sidebar
            const roster = document.getElementById('arena-player-roster');
            if (roster) {
                roster.innerHTML = '';
                // Sort competitors so active is at the top
                const competitors = state.players.filter(p => !p.isHost);
                competitors.forEach(p => {
                    const card = document.createElement('div');
                    card.className = `roster-player ${p.status}`;
                    
                    let statusLabel = 'ACTIVE';
                    if (p.status === 'nominated') statusLabel = 'NOMINATED';
                    if (p.status === 'evicted') statusLabel = 'EVICTED';

                    card.innerHTML = `
                        <div class="roster-name-wrap">
                            <span class="roster-dot" style="background:${p.color}; box-shadow: 0 0 6px ${p.color};"></span>
                            <span class="roster-name">${p.name}</span>
                        </div>
                        <span class="roster-status-badge">${statusLabel}</span>
                    `;
                    roster.appendChild(card);
                });
            }

            // HUD details
            const timerContainer = document.getElementById('arena-timer-container');
            const clock = document.getElementById('arena-clock');
            const stageBadge = document.getElementById('arena-stage-badge');
            const stageTitle = document.getElementById('arena-stage-title');

            if (clock) clock.textContent = state.roundTimer;

            if (state.gameStage === 'countdown') {
                if (timerContainer) timerContainer.style.opacity = '0';
                stageBadge.textContent = 'STANDBY';
                stageTitle.textContent = 'PREPARING TASK';
            } else if (state.gameStage === 'results') {
                if (timerContainer) timerContainer.style.opacity = '0';
                stageBadge.textContent = 'RESULTS';
                stageTitle.textContent = 'STANDINGS';
            } else {
                if (timerContainer) timerContainer.style.opacity = '1';
                
                // Red flashing overlay when timer is below 10 seconds
                const alarm = document.getElementById('alarm-overlay');
                if (state.roundTimer <= 10 && state.roundTimer > 0) {
                    if (alarm) alarm.classList.add('active');
                } else {
                    if (alarm) alarm.classList.remove('active');
                }

                if (state.gameStage === 'game1') {
                    stageBadge.textContent = 'GAME 1';
                    stageTitle.textContent = 'REACTION ARENA';
                } else if (state.gameStage === 'game2') {
                    stageBadge.textContent = 'GAME 2';
                    stageTitle.textContent = 'TIC-CROSS DUEL';
                } else if (state.gameStage === 'game3') {
                    stageBadge.textContent = 'GAME 3';
                    stageTitle.textContent = 'MEMORY CORE';
                } else if (state.gameStage === 'game4') {
                    stageBadge.textContent = 'GAME 4';
                    stageTitle.textContent = 'THE FINAL GRID';
                }
            }

            // Sync Narrative Banner text
            const narratorText = document.getElementById('arena-narrator-text');
            if (narratorText) narratorText.textContent = state.currentNarrative;
            
            // Play TTS announcement
            this.speakVoice(state.currentNarrative);

            // Switch subviews
            this.switchSubView(state.gameStage, state);
        }

        // 5. Eviction Page Renders
        if (state.gameStage === 'eviction') {
            const evictedName = document.getElementById('evicted-player-name');
            const hostEvict = document.getElementById('host-eviction-controls');
            const clientEvict = document.getElementById('client-eviction-waiting');
            
            // Collect nominated players that are getting evicted
            const nominatedNames = state.players.filter(p => p.status === 'nominated').map(p => p.name);
            
            if (evictedName) {
                evictedName.textContent = nominatedNames.join(', ') || 'NONE';
            }

            if (amIHost) {
                if (hostEvict) hostEvict.style.display = 'block';
                if (clientEvict) clientEvict.style.display = 'none';
            } else {
                if (hostEvict) hostEvict.style.display = 'none';
                if (clientEvict) clientEvict.style.display = 'block';
            }

            this.speakVoice(state.currentNarrative);
        }

        // 6. Victory Page Renders
        if (state.gameStage === 'victory') {
            const champName = document.getElementById('champion-player-name');
            const winner = state.players.find(p => !p.isHost && p.status === 'active');
            
            if (champName && winner) {
                champName.textContent = winner.name;
                champName.style.setProperty('text-shadow', `0 0 25px ${winner.color}`);
                champName.style.borderColor = winner.color;
            }

            const recap = document.getElementById('victory-season-summary');
            if (recap) {
                recap.innerHTML = `
                    <h4 style="font-family:var(--font-header); color:var(--color-gold); margin-bottom:0.8rem;">TOURNAMENT BRACKET SUMMARY</h4>
                    <p style="margin-bottom:0.4rem; color: var(--color-text-dark);">Game 1 (Reaction Arena): 16 competitors scaled. 8 players evicted.</p>
                    <p style="margin-bottom:0.4rem; color: var(--color-text-dark);">Game 2 (Tic-Cross Duel): 4 paired match duels resolved. 4 players evicted.</p>
                    <p style="margin-bottom:0.4rem; color: var(--color-text-dark);">Game 3 (Memory Core): 4 players competed. 2 lowest scores evicted.</p>
                    <p style="color:var(--color-blue); font-weight:700;">Game 4 (The Final Grid): ${winner ? winner.name : 'Champion'} cleared the grid quickest to win the crown!</p>
                `;
            }

            this.speakVoice(state.currentNarrative);
        }
    },

    /**
     * Toggle active sub-game views inside the Arena Playfield
     */
    switchSubView(stage, state) {
        let targetId = 'game-countdown-view'; // Default fallback
        
        if (stage === 'countdown') {
            targetId = 'game-countdown-view';
            const countNum = document.getElementById('countdown-number');
            if (countNum) countNum.textContent = state.countdownVal;
            
            // Adapt subtext based on countdown stage
            const subtext = document.getElementById('countdown-desc');
            if (subtext) {
                if (state.currentNarrative.includes('Reaction')) subtext.textContent = 'GET READY FOR REACTION GAUGE...';
                else if (state.currentNarrative.includes('Tic-Cross')) subtext.textContent = 'MATCHMAKING DUELS LOADED...';
                else if (state.currentNarrative.includes('Memory')) subtext.textContent = 'ENERGY MATRIX FLASHING INCOMING...';
                else if (state.currentNarrative.includes('Final Grid')) subtext.textContent = 'FINAL SPEED CLICK GRID FORMING...';
                else subtext.textContent = 'PREPARING TASK...';
            }
            
            // Clean up any old running mini-game engines
            BiggBossPuzzles.reaction.cleanup();
            BiggBossPuzzles.ticcross.cleanup();
            BiggBossPuzzles.memory.cleanup();
            BiggBossPuzzles.finalgrid.cleanup();

        } else if (stage === 'game1') {
            targetId = 'game-reaction-view';
            // Start reaction game on client if we are an active player
            const me = state.players.find(p => p.clientId === BiggBossMultiplayer.myClientId);
            if (me && me.status === 'active' && !BiggBossPuzzles.reaction.active && !BiggBossPuzzles.reaction.submitted) {
                BiggBossPuzzles.reaction.init();
            }

        } else if (stage === 'game2') {
            targetId = 'game-ticcross-view';
            
            // Setup names in board X and O
            const tc = state.ticCrossState;
            const pX = state.players.find(p => p.clientId === tc.playerX);
            const pO = state.players.find(p => p.clientId === tc.playerO);
            
            document.getElementById('tc-player-x').textContent = pX ? pX.name : 'PLAYER X';
            document.getElementById('tc-player-o').textContent = pO ? pO.name : 'PLAYER O';

            // Sync grid cell markers
            BiggBossPuzzles.ticcross.init();
            BiggBossPuzzles.ticcross.sync(tc);

        } else if (stage === 'game3') {
            targetId = 'game-memory-view';
            const me = state.players.find(p => p.clientId === BiggBossMultiplayer.myClientId);
            if (me && me.status === 'active' && !BiggBossPuzzles.memory.active && !BiggBossPuzzles.memory.submitted) {
                BiggBossPuzzles.memory.init();
            }

        } else if (stage === 'game4') {
            targetId = 'game-finalgrid-view';
            const me = state.players.find(p => p.clientId === BiggBossMultiplayer.myClientId);
            if (me && me.status === 'active' && !BiggBossPuzzles.finalgrid.active && !BiggBossPuzzles.finalgrid.submitted) {
                BiggBossPuzzles.finalgrid.init();
            }

        } else if (stage === 'results') {
            targetId = 'game-results-view';
            const resultList = document.getElementById('results-players-list');
            const verdict = document.getElementById('results-verdict-text');
            const nextRoundContainer = document.getElementById('host-results-controls');

            // Show next button only to Host
            if (BiggBossMultiplayer.isHost) {
                if (nextRoundContainer) nextRoundContainer.style.display = 'block';
            } else {
                if (nextRoundContainer) nextRoundContainer.style.display = 'none';
            }

            if (resultList) {
                resultList.innerHTML = '';
                
                // Show participants list and scores
                // Matchups are evaluated and nominated list is present in eliminatedThisRound
                const competitors = [...state.players].filter(p => !p.isHost && p.status !== 'evicted');
                
                // Sort by status (active/survived first, nominated/loser second)
                competitors.sort((a, b) => {
                    if (a.status === b.status) return 0;
                    return a.status === 'active' ? -1 : 1;
                });

                competitors.forEach(p => {
                    const row = document.createElement('div');
                    row.className = `result-row ${p.status === 'active' ? 'survived' : 'evicted-risk'}`;
                    
                    let scoreDisplay = 'Pending';
                    if (p.score !== null && p.score !== undefined) {
                        if (p.score === 9999 || p.score === 99999) {
                            scoreDisplay = 'DNF (Timeout)';
                        } else {
                            // Format based on stage
                            if (state.currentNarrative.toLowerCase().includes('reaction') || state.currentNarrative.toLowerCase().includes('grid') || state.currentNarrative.toLowerCase().includes('final')) {
                                scoreDisplay = p.score + 'ms';
                            } else {
                                scoreDisplay = 'Round ' + p.score;
                            }
                        }
                    }
                    
                    let statusLabel = p.status === 'active' ? 'SURVIVED' : 'NOMINATED';

                    row.innerHTML = `
                        <span>${p.name}</span>
                        <div>
                            <span class="score" style="margin-right:1rem;">${scoreDisplay}</span>
                            <span class="roster-status-badge">${statusLabel}</span>
                        </div>
                    `;
                    resultList.appendChild(row);
                });
            }

            if (verdict) {
                const countNominated = state.players.filter(p => p.status === 'nominated').length;
                verdict.textContent = `Evaluation complete. ${countNominated} players are nominated for eviction.`;
            }
        }

        // Toggle subview classes
        const subviews = ['game-countdown-view', 'game-reaction-view', 'game-ticcross-view', 'game-memory-view', 'game-finalgrid-view', 'game-results-view'];
        subviews.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === targetId) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    },

    /**
     * Browser speech synthesis announcer voice (TTS)
     */
    speakVoice(text) {
        if (!BiggBossMultiplayer.voiceEnabled || !text || text === this.lastVoiceText) return;
        this.lastVoiceText = text;

        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech
            window.speechSynthesis.cancel();
            
            // Clean up name brackets or entities in narration for cleaner speech
            const cleanText = text.replace(/[\(\)]/g, '').replace(/&rarr;/g, 'to');

            const utterance = new SpeechSynthesisUtterance(cleanText);
            
            // Try to find a low-pitch robotic voice or deep male voice
            const voices = window.speechSynthesis.getVoices();
            let selectedVoice = null;
            
            // Prefer Google UK English Male, Microsoft David, or standard deep voices
            selectedVoice = voices.find(voice => voice.name.toLowerCase().includes('male')) ||
                            voices.find(voice => voice.name.toLowerCase().includes('david')) ||
                            voices.find(voice => voice.lang.startsWith('en'));

            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }

            utterance.pitch = 0.6; // lower pitch for authoritative "Bigg Boss" signature voice
            utterance.rate = 0.95;  // slightly slower pace
            utterance.volume = 0.8;

            window.speechSynthesis.speak(utterance);
        }
    },

    /**
     * Futuristic Background Particles on Canvas
     */
    setupBackground() {
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;

        this.canvasCtx = canvas.getContext('2d');
        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            this.generateDots(canvas.width, canvas.height);
        };

        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        const animateBg = () => {
            this.drawBackground(canvas.width, canvas.height);
            this.bgAnimationId = requestAnimationFrame(animateBg);
        };
        animateBg();
    },

    generateDots(width, height) {
        this.canvasDots = [];
        const dotCount = Math.floor((width * height) / 18000); // density
        
        for (let i = 0; i < dotCount; i++) {
            this.canvasDots.push({
                x: Math.random() * width,
                y: Math.random() * height,
                r: Math.random() * 2 + 1,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                alpha: Math.random() * 0.4 + 0.1
            });
        }
    },

    drawBackground(width, height) {
        const ctx = this.canvasCtx;
        if (!ctx) return;

        // Clear with slight dark fade
        ctx.fillStyle = '#030408';
        ctx.fillRect(0, 0, width, height);

        // Draw dynamic grid lines
        ctx.strokeStyle = 'rgba(0, 180, 255, 0.02)';
        ctx.lineWidth = 1;
        const gridSize = 80;
        
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw glowing particles
        this.canvasDots.forEach(dot => {
            dot.x += dot.vx;
            dot.y += dot.vy;

            // Bounce off borders
            if (dot.x < 0 || dot.x > width) dot.vx *= -1;
            if (dot.y < 0 || dot.y > height) dot.vy *= -1;

            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 180, 255, ${dot.alpha})`;
            ctx.fill();
        });
    }
};

// Start the UI once the page loads
window.onload = () => {
    BiggBossUI.init();
};

window.BiggBossUI = BiggBossUI;
