/**
 * Dead Number: The Nim Duel Game Engine
 * Support for Bot matches and Online PvP Duels, with persistent Local Statistics.
 */

const DeadNumberGame = {
    deadNumber: 25,
    currentTotal: 0,
    currentTurn: 'player', // 'player' or 'bot' (or 'opponent' in PvP)
    difficulty: 'hard', // 'easy', 'medium', 'hard'
    firstTurn: 'player', // 'player' or 'bot' (or 'opponent' in PvP)
    
    // Timer properties
    turnTimer: 5.0,
    timerInterval: null,
    isGameOver: false,
    
    // TTS Voice
    voiceEnabled: true,

    // PvP / Networking properties
    gameMode: 'bot', // 'bot' or 'pvp'
    pvpRole: 'host', // 'host' or 'join'
    roomId: null,
    client: null,
    playerName: 'Host',
    opponentName: 'Challenger',
    myClientId: 'p_' + Math.random().toString(36).substr(2, 9),
    isHost: false,
    connected: false,
    opponentConnected: false,
    history: [],
    isDraftActive: false,
    selectionTurn: 'host',
    myWins: 0,
    opponentWins: 0,

    // Remote Configuration for Dynamic Server URL
    remoteConfigUrl: 'https://raw.githubusercontent.com/sarwanhaider-maker/dead-number-game/main/config.json',
    resolvedServerUrl: null, // Fetched dynamically
    defaultProductionWsUrl: 'wss://dead-number-game.onrender.com',
    isSearchingMatch: false,

    // Stats & Shop Object
    stats: {
        botGamesPlayed: 0,
        botWins: 0,
        pvpGamesPlayed: 0,
        pvpWins: 0,
        activeStreak: 0,
        coins: 150, // Starter coins
        unlockedThemes: ['default'],
        activeTheme: 'default',
        lastClaimedDaily: null
    },

    init() {
        this.loadStats();
        this.fetchRemoteConfig();
        this.setupEventListeners();
        this.updateSliderRangeForDifficulty();
        this.showScreen('setup-screen');
        this.startDailyRewardTimer();
        this.speak("Welcome to Dead Number. Set your parameters to begin.");
    },

    fetchRemoteConfig() {
        console.log("[Config] Fetching remote config from: " + this.remoteConfigUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        fetch(this.remoteConfigUrl, { signal: controller.signal })
            .then(res => {
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error("HTTP Status " + res.status);
                return res.json();
            })
            .then(data => {
                if (data && data.serverUrl) {
                    this.resolvedServerUrl = data.serverUrl;
                    console.log("[Config] Dynamically resolved production WebSocket URL: " + this.resolvedServerUrl);
                }
            })
            .catch(err => {
                clearTimeout(timeoutId);
                console.warn("[Config] Failed to fetch remote config (falling back to default):", err);
            });
    },

    getTurnDuration() {
        if (this.gameMode === 'bot') {
            if (this.difficulty === 'easy') return 7.0;
            if (this.difficulty === 'medium') return 5.0;
            return 3.0; // hard
        }
        return 5.0; // default for PvP
    },

    updateSliderRangeForDifficulty() {
        const slider = document.getElementById('dead-num-slider');
        const display = document.getElementById('dead-num-display-val');
        if (!slider) return;

        let maxVal = 100;
        if (this.gameMode === 'bot') {
            if (this.difficulty === 'easy') {
                maxVal = 50;
            } else if (this.difficulty === 'medium') {
                maxVal = 75;
            } else if (this.difficulty === 'hard') {
                maxVal = 100;
            }
        } else {
            maxVal = 100;
        }

        slider.max = maxVal;
        
        let val = parseInt(slider.value);
        if (val > maxVal) {
            val = maxVal;
            slider.value = val;
        }
        this.deadNumber = val;
        if (display) {
            display.textContent = val;
        }
        
        const sliderLabel = document.querySelector('.setup-group .setup-label');
        if (sliderLabel && sliderLabel.textContent.includes("Select Dead Number")) {
            sliderLabel.textContent = `Select Dead Number (20 - ${maxVal})`;
        }
    },

    loadStats() {
        try {
            const saved = localStorage.getItem('DeadNumberStats');
            if (saved) {
                const loaded = JSON.parse(saved);
                // Merge loaded stats with defaults to handle version migrations seamlessly
                this.stats = Object.assign({
                    botGamesPlayed: 0,
                    botWins: 0,
                    pvpGamesPlayed: 0,
                    pvpWins: 0,
                    activeStreak: 0,
                    coins: 150,
                    unlockedThemes: ['default'],
                    activeTheme: 'default',
                    lastClaimedDaily: null
                }, loaded);
            }
        } catch (e) {
            console.warn("Could not load stats:", e);
        }
        // Force reset activeTheme to default to migrate users back
        this.stats.activeTheme = 'default';
        this.stats.unlockedThemes = ['default'];
        this.updateStatsUI();
    },

    saveStats() {
        try {
            localStorage.setItem('DeadNumberStats', JSON.stringify(this.stats));
        } catch (e) {
            console.warn("Could not save stats:", e);
        }
        this.updateStatsUI();
    },

    resetStats() {
        this.stats = {
            botGamesPlayed: 0,
            botWins: 0,
            pvpGamesPlayed: 0,
            pvpWins: 0,
            activeStreak: 0,
            coins: 150,
            unlockedThemes: ['default'],
            activeTheme: 'default',
            lastClaimedDaily: null
        };
        this.saveStats();
        this.speak("Statistics reset successfully.");
    },

    getRankTier(wins) {
        const w = wins || 0;
        if (w >= 15) return { name: "Nim Grandmaster", class: "rank-grandmaster" };
        if (w >= 10) return { name: "Platinum Elite", class: "rank-platinum" };
        if (w >= 6) return { name: "Gold Tactician", class: "rank-gold" };
        if (w >= 3) return { name: "Silver Survivor", class: "rank-silver" };
        return { name: "Bronze Evader", class: "rank-bronze" };
    },

    updateStatsUI() {
        const botVal = document.getElementById('stat-bot-games');
        const pvpVal = document.getElementById('stat-pvp-games');
        const winRatioVal = document.getElementById('stat-win-ratio');
        const streakVal = document.getElementById('stat-streak');
        const coinsDisplay = document.getElementById('display-coins');
        const arenaCoinsDisplay = document.getElementById('display-coins-arena');
        const rankBadgeText = document.getElementById('rank-badge-text');
        const rankBadge = document.getElementById('rank-badge-display');

        if (botVal) botVal.textContent = `${this.stats.botWins} / ${this.stats.botGamesPlayed}`;
        if (pvpVal) pvpVal.textContent = `${this.stats.pvpWins} / ${this.stats.pvpGamesPlayed}`;
        
        const totalPlayed = this.stats.botGamesPlayed + this.stats.pvpGamesPlayed;
        const totalWins = this.stats.botWins + this.stats.pvpWins;
        const ratio = totalPlayed > 0 ? Math.round((totalWins / totalPlayed) * 100) : 0;
        
        if (winRatioVal) winRatioVal.textContent = `${ratio}%`;
        if (streakVal) streakVal.textContent = this.stats.activeStreak;

        // Coin Updates
        const currentCoins = this.stats.coins !== undefined ? this.stats.coins : 150;
        if (coinsDisplay) coinsDisplay.textContent = currentCoins;
        if (arenaCoinsDisplay) arenaCoinsDisplay.textContent = currentCoins;

        // Rank Badge Update
        if (rankBadgeText) {
            const rank = this.getRankTier(this.stats.pvpWins);
            rankBadgeText.textContent = rank.name;
            if (rankBadge) {
                rankBadge.className = `rank-badge ${rank.class}`;
            }
        }
        this.updateLeaderboardUI();
    },

    setupEventListeners() {
        // Slider value update
        const slider = document.getElementById('dead-num-slider');
        const display = document.getElementById('dead-num-display-val');
        if (slider && display) {
            slider.oninput = () => {
                if (!this.isDeadNumberChangeable()) return;
                this.deadNumber = parseInt(slider.value);
                display.textContent = this.deadNumber;
                
                if (this.gameMode === 'pvp') {
                    this.sendAction('UPDATE_CONFIG', { deadNumber: this.deadNumber });
                }
            };
        }

        // Toggles for Bot Difficulty
        const diffButtons = document.querySelectorAll('.btn-diff');
        diffButtons.forEach(btn => {
            btn.onclick = () => {
                diffButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.difficulty = btn.dataset.diff;
                this.playClickSound();
                this.updateSliderRangeForDifficulty();
            };
        });

        // Toggles for First Turn
        const turnButtons = document.querySelectorAll('.btn-turn');
        turnButtons.forEach(btn => {
            btn.onclick = () => {
                turnButtons.forEach(b => b.classList.remove('active-crimson'));
                btn.classList.add('active-crimson');
                this.firstTurn = btn.dataset.first;
                this.playClickSound();
            };
        });

        // Toggles for Game Mode (vs Bot vs Online PvP)
        const btnModeBot = document.getElementById('btn-mode-bot');
        const btnModePvP = document.getElementById('btn-mode-pvp');
        const diffGroup = document.getElementById('setup-group-diff');
        const pvpPanel = document.getElementById('pvp-setup-panel');
        const startBtn = document.getElementById('btn-start-game');

        if (btnModeBot && btnModePvP) {
            btnModeBot.onclick = () => {
                this.playClickSound();
                btnModeBot.classList.add('active');
                btnModePvP.classList.remove('active');
                this.gameMode = 'bot';
                
                if (diffGroup) diffGroup.style.display = 'block';
                if (pvpPanel) pvpPanel.style.display = 'none';
                if (startBtn) {
                    startBtn.style.display = 'block';
                    startBtn.disabled = false;
                    startBtn.textContent = 'Initialize Duel';
                }
                
                const botTurnBtn = document.querySelector('.btn-turn[data-first="bot"]');
                if (botTurnBtn) botTurnBtn.textContent = 'Bot';
                
                this.disconnectNetwork();
                this.updateSliderRangeForDifficulty();
            };

            btnModePvP.onclick = () => {
                this.playClickSound();
                btnModePvP.classList.add('active');
                btnModeBot.classList.remove('active');
                this.gameMode = 'pvp';
                
                if (diffGroup) diffGroup.style.display = 'none';
                if (pvpPanel) pvpPanel.style.display = 'block';
                
                this.updatePvPRoleUI();
                this.updateSliderRangeForDifficulty();
            };
        }

        // Toggles for PvP Roles (Host, Join, Quick Match)
        const btnRoleHost = document.getElementById('btn-role-host');
        const btnRoleJoin = document.getElementById('btn-role-join');
        const btnRoleQuick = document.getElementById('btn-role-quick');

        if (btnRoleHost && btnRoleJoin && btnRoleQuick) {
            btnRoleHost.onclick = () => {
                this.playClickSound();
                btnRoleHost.classList.add('active');
                btnRoleJoin.classList.remove('active');
                btnRoleQuick.classList.remove('active');
                this.pvpRole = 'host';
                this.updatePvPRoleUI();
            };

            btnRoleJoin.onclick = () => {
                this.playClickSound();
                btnRoleJoin.classList.add('active');
                btnRoleHost.classList.remove('active');
                btnRoleQuick.classList.remove('active');
                this.pvpRole = 'join';
                this.updatePvPRoleUI();
            };

            btnRoleQuick.onclick = () => {
                this.playClickSound();
                btnRoleQuick.classList.add('active');
                btnRoleHost.classList.remove('active');
                btnRoleJoin.classList.remove('active');
                this.pvpRole = 'quick';
                this.updatePvPRoleUI();

                // Auto-focus name input for convenience
                setTimeout(() => {
                    const quickNameInput = document.getElementById('pvp-quick-name');
                    if (quickNameInput) {
                        quickNameInput.disabled = false;
                        quickNameInput.focus();
                    }
                }, 100);
            };
        }

        // Quick Match Find/Cancel Button
        const btnQuickMatch = document.getElementById('btn-quick-match');
        if (btnQuickMatch) {
            btnQuickMatch.onclick = () => {
                this.playClickSound();
                if (this.isSearchingMatch) {
                    this.cancelQuickMatchSearch();
                } else {
                    const nameInput = document.getElementById('pvp-quick-name');
                    const name = nameInput ? nameInput.value.trim() : 'Player';
                    this.playerName = name || 'Player';
                    this.startQuickMatchSearch();
                }
            };
        }

        // Connect/Join Duel Button
        const btnJoinDuel = document.getElementById('btn-join-duel');
        if (btnJoinDuel) {
            btnJoinDuel.onclick = () => {
                this.playClickSound();
                const nameInput = document.getElementById('pvp-player-name');
                const codeInput = document.getElementById('pvp-room-input');
                
                const name = nameInput ? nameInput.value.trim() : 'Challenger';
                const code = codeInput ? codeInput.value.trim() : '';

                if (!code || code.length !== 4) {
                    alert('Please enter a valid 4-digit Room Code.');
                    return;
                }

                btnJoinDuel.disabled = true;
                btnJoinDuel.textContent = 'Connecting...';
                this.playerName = name || 'Challenger';
                this.joinRoom(code, this.playerName);
            };
        }

        // Start Game Button
        if (startBtn) {
            startBtn.onclick = () => {
                this.playClickSound();
                if (this.gameMode === 'bot') {
                    this.startGame();
                } else if (this.gameMode === 'pvp') {
                    if (this.isDraftActive) {
                        const isMyTurn = (this.isHost && this.selectionTurn === 'host') || (!this.isHost && this.selectionTurn === 'challenger');
                        if (isMyTurn) {
                            const val = slider ? parseInt(slider.value) : this.deadNumber;
                            this.sendAction('CONFIRM_CONFIG', { deadNumber: val });
                        }
                    } else if (this.isHost) {
                        this.startPvPGame();
                    }
                }
            };
        }

        // Choice Buttons (+1, +2, +3, +4)
        const choiceGrid = document.getElementById('choice-grid');
        if (choiceGrid) {
            choiceGrid.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-choice') && !this.isGameOver) {
                    const value = parseInt(e.target.dataset.val);
                    
                    if (this.gameMode === 'bot' && this.currentTurn === 'player') {
                        this.selectNumber(value);
                    } else if (this.gameMode === 'pvp') {
                        const isMyTurn = (this.isHost && this.currentTurn === 'player') || (!this.isHost && this.currentTurn === 'opponent');
                        if (isMyTurn) {
                            this.sendAction('PLAY_MOVE', { value: value });
                            this.enableChoiceButtons(false); // Disable locally to prevent double clicks
                            clearInterval(this.timerInterval); // Clear local timer immediately
                        }
                    }
                }
            });
        }

        // Restart Button
        const restartBtn = document.getElementById('btn-restart');
        if (restartBtn) {
            restartBtn.onclick = () => {
                this.playClickSound();
                if (this.gameMode === 'bot') {
                    this.disconnectNetwork();
                    this.showScreen('setup-screen');
                    this.speak("Set your parameters to begin.");
                } else {
                    const waitingOverlay = document.getElementById('play-again-waiting-overlay');
                    if (waitingOverlay) waitingOverlay.style.display = 'flex';
                    this.sendAction('PLAY_AGAIN_REQUEST');
                }
            };
        }

        // Play Again Accept / Reject / Cancel Button Event Listeners
        const btnPlayAgainAccept = document.getElementById('btn-play-again-accept');
        if (btnPlayAgainAccept) {
            btnPlayAgainAccept.onclick = () => {
                this.playClickSound();
                const overlay = document.getElementById('play-again-overlay');
                if (overlay) overlay.style.display = 'none';
                this.sendAction('PLAY_AGAIN_RESPONSE', { accept: true });
            };
        }

        const btnPlayAgainReject = document.getElementById('btn-play-again-reject');
        if (btnPlayAgainReject) {
            btnPlayAgainReject.onclick = () => {
                this.playClickSound();
                const overlay = document.getElementById('play-again-overlay');
                if (overlay) overlay.style.display = 'none';
                this.sendAction('PLAY_AGAIN_RESPONSE', { accept: false });
                this.disconnectNetwork();
                this.showScreen('setup-screen');
            };
        }

        const btnPlayAgainCancel = document.getElementById('btn-play-again-cancel');
        if (btnPlayAgainCancel) {
            btnPlayAgainCancel.onclick = () => {
                this.playClickSound();
                const waitingOverlay = document.getElementById('play-again-waiting-overlay');
                if (waitingOverlay) waitingOverlay.style.display = 'none';
                this.sendAction('PLAY_AGAIN_CANCEL');
                this.disconnectNetwork();
                this.showScreen('setup-screen');
            };
        }

        // Reset Stats Button
        const btnResetStats = document.getElementById('btn-reset-stats');
        if (btnResetStats) {
            btnResetStats.onclick = () => {
                if (confirm("Are you sure you want to clear your game core statistics?")) {
                    this.resetStats();
                }
            };
        }



        // Daily Reward Button
        const btnClaimDaily = document.getElementById('btn-claim-daily');
        if (btnClaimDaily) {
            btnClaimDaily.onclick = () => {
                this.playClickSound();
                const lastClaim = this.stats.lastClaimedDaily ? new Date(this.stats.lastClaimedDaily).getTime() : 0;
                const cooldown = 24 * 60 * 60 * 1000;
                if (!this.stats.lastClaimedDaily || (Date.now() - lastClaim >= cooldown)) {
                    this.stats.coins = (this.stats.coins || 0) + 100;
                    this.stats.lastClaimedDaily = new Date().toISOString();
                    this.saveStats();
                    this.playVictorySound();
                    this.speak("Daily reward claimed. One hundred coins added.");
                    this.updateDailyRewardUI();
                }
            };
        }

        // Buy-Time Lifeline Button
        const btnLifelineTime = document.getElementById('btn-lifeline-time');
        if (btnLifelineTime) {
            btnLifelineTime.onclick = () => {
                this.playClickSound();
                if (this.gameMode !== 'bot' || this.currentTurn !== 'player' || this.buyTimeUsedThisTurn || this.isGameOver) return;
                
                btnLifelineTime.style.display = 'none';
                this.buyTimeUsedThisTurn = true;

                this.showAdOverlay(3, () => {
                    const maxDuration = this.getTurnDuration();
                    this.turnTimer = maxDuration;
                    const timerText = document.getElementById('timer-digits');
                    if (timerText) {
                        timerText.textContent = maxDuration.toFixed(2);
                        timerText.classList.remove('warning');
                    }
                    this.speak("Time extended.");
                    
                    const startTime = Date.now();
                    const initialTimer = this.turnTimer;
                    this.timerInterval = setInterval(() => {
                        const elapsed = (Date.now() - startTime) / 1000;
                        this.turnTimer = Math.max(0, initialTimer - elapsed);
                        
                        if (timerText) {
                            timerText.textContent = this.turnTimer.toFixed(2);
                            if (this.turnTimer <= 1.2) {
                                timerText.classList.add('warning');
                            }
                        }
                        
                        if (this.turnTimer <= 0) {
                            clearInterval(this.timerInterval);
                            this.handleTimeout();
                        }
                    }, 50);
                });
            };
        }

        // Revive Buttons
        const btnReviveWatch = document.getElementById('btn-revive-watch');
        const btnReviveEvict = document.getElementById('btn-revive-evict');
        
        if (btnReviveWatch) {
            btnReviveWatch.onclick = () => {
                this.playClickSound();
                const overlay = document.getElementById('revive-modal-overlay');
                if (overlay) overlay.style.display = 'none';
                
                this.showAdOverlay(4, () => {
                    if (this.rollbackState) {
                        this.currentTotal = this.rollbackState.currentTotal;
                        this.history = [...this.rollbackState.history];
                        this.currentTurn = 'player';
                        this.reviveUsedThisGame = true;
                        this.isGameOver = false;
                        
                        this.updateUI();
                        this.syncHistoryLog();
                        this.speak("Second chance activated. Select again.");
                        this.startTurn();
                    }
                });
            };
        }
        
        if (btnReviveEvict) {
            btnReviveEvict.onclick = () => {
                this.playClickSound();
                const overlay = document.getElementById('revive-modal-overlay');
                if (overlay) overlay.style.display = 'none';
                this.isGameOver = false;
                this.triggerGameOver('bot');
            };
        }
    },

    updatePvPRoleUI() {
        const hostView = document.getElementById('pvp-host-view');
        const joinView = document.getElementById('pvp-join-view');
        const quickView = document.getElementById('pvp-quick-view');
        const startBtn = document.getElementById('btn-start-game');
        const turnGroup = document.getElementById('setup-group-turn');
        const slider = document.getElementById('dead-num-slider');

        if (this.pvpRole === 'host') {
            if (hostView) hostView.style.display = 'block';
            if (joinView) joinView.style.display = 'none';
            if (quickView) quickView.style.display = 'none';
            if (startBtn) {
                startBtn.style.display = 'block';
                startBtn.disabled = !this.opponentConnected;
                startBtn.textContent = this.opponentConnected ? 'Start Online Duel' : 'Start Online Duel (Awaiting Challenger...)';
            }
            if (turnGroup) turnGroup.style.display = 'block';
            if (slider) slider.disabled = false;
            
            const botTurnBtn = document.querySelector('.btn-turn[data-first="bot"]');
            if (botTurnBtn) botTurnBtn.textContent = 'Challenger';
            
            this.isHost = true;
            this.playerName = 'Host';
            this.hostRoom();
        } else if (this.pvpRole === 'join') {
            if (hostView) hostView.style.display = 'none';
            if (joinView) joinView.style.display = 'block';
            if (quickView) quickView.style.display = 'none';
            if (startBtn) startBtn.style.display = 'none';
            if (turnGroup) turnGroup.style.display = 'none';
            if (slider) slider.disabled = true; // Challenger waits for Host's dead number
            
            this.isHost = false;
            this.disconnectNetwork();
        } else if (this.pvpRole === 'quick') {
            if (hostView) hostView.style.display = 'none';
            if (joinView) joinView.style.display = 'none';
            if (quickView) quickView.style.display = 'block';
            if (startBtn) startBtn.style.display = 'none';
            if (turnGroup) turnGroup.style.display = 'none';
            if (slider) slider.disabled = true;

            const nameInput = document.getElementById('pvp-quick-name');
            if (nameInput) nameInput.disabled = false;

            this.isHost = false;
            this.disconnectNetwork();
        }
    },

    isDeadNumberChangeable() {
        if (this.gameMode !== 'pvp') return true;
        if (this.isDraftActive) {
            return (this.isHost && this.selectionTurn === 'host') || (!this.isHost && this.selectionTurn === 'challenger');
        }
        return this.isHost;
    },

    updateDraftUI(room) {
        const draftBanner = document.getElementById('pvp-draft-banner');
        const draftStatus = document.getElementById('pvp-draft-status');
        const draftTimer = document.getElementById('pvp-draft-timer');
        const startBtn = document.getElementById('btn-start-game');
        const slider = document.getElementById('dead-num-slider');
        const turnGroup = document.getElementById('setup-group-turn');
        const hostView = document.getElementById('pvp-host-view');
        const joinView = document.getElementById('pvp-join-view');
        const quickView = document.getElementById('pvp-quick-view');

        if (!draftBanner) return;

        if (this.isDraftActive) {
            draftBanner.style.display = 'block';
            if (draftTimer) {
                draftTimer.textContent = room.draftTimer.toFixed(1);
            }

            const isMyTurn = (this.isHost && this.selectionTurn === 'host') || (!this.isHost && this.selectionTurn === 'challenger');

            if (draftStatus) {
                if (isMyTurn) {
                    draftStatus.textContent = "YOUR TURN TO SELECT DEAD NUMBER (20-100)";
                    draftStatus.style.color = "var(--color-gold)";
                } else {
                    const selectorName = this.selectionTurn === 'host' ? (room.hostName || 'Host') : (room.challengerName || 'Opponent');
                    draftStatus.textContent = `WAITING FOR ${selectorName.toUpperCase()} TO SELECT...`;
                    draftStatus.style.color = "var(--color-blue)";
                }
            }

            // Lock / Unlock slider and start/confirm button
            if (slider) {
                slider.disabled = !isMyTurn;
            }

            if (startBtn) {
                startBtn.style.display = 'block';
                startBtn.disabled = !isMyTurn;
                if (isMyTurn) {
                    startBtn.textContent = "Confirm Dead Number";
                } else {
                    const selectorName = this.selectionTurn === 'host' ? (room.hostName || 'Host') : (room.challengerName || 'Opponent');
                    startBtn.textContent = `${selectorName} Selecting...`;
                }
            }

            // Hide other sub-panels in draft mode
            if (turnGroup) turnGroup.style.display = 'none';
            if (hostView) hostView.style.display = 'none';
            if (joinView) joinView.style.display = 'none';
            if (quickView) quickView.style.display = 'none';
        } else {
            draftBanner.style.display = 'none';
            this.updatePvPRoleUI();
        }
    },

    updateSeriesScoreUI() {
        const scoreBoard = document.getElementById('pvp-series-score');
        const scoreDigits = document.getElementById('pvp-series-score-digits');
        const scoreType = document.getElementById('pvp-series-score-type');

        const resultsScoreBoard = document.getElementById('pvp-results-score');
        const resultsScoreDigits = document.getElementById('pvp-results-score-digits');
        const resultsScoreType = document.getElementById('pvp-results-score-type');

        if (this.gameMode === 'pvp' && (this.myWins > 0 || this.opponentWins > 0)) {
            // Determine series type dynamically based on total wins
            const totalGames = this.myWins + this.opponentWins;
            let seriesLabel = "Best of 3";
            if (totalGames >= 2) {
                seriesLabel = "Best of 5";
            }
            if (totalGames >= 4) {
                seriesLabel = "Best of 7";
            }

            // Update setup lobby score display
            if (scoreBoard) scoreBoard.style.display = 'block';
            if (scoreDigits) {
                scoreDigits.textContent = `${this.myWins} - ${this.opponentWins}`;
            }
            if (scoreType) {
                scoreType.textContent = `${seriesLabel} Series`;
            }

            // Update game-over results score display
            if (resultsScoreBoard) resultsScoreBoard.style.display = 'block';
            if (resultsScoreDigits) {
                resultsScoreDigits.textContent = `${this.myWins} - ${this.opponentWins}`;
            }
            if (resultsScoreType) {
                resultsScoreType.textContent = `${seriesLabel} Series`;
            }
        } else {
            if (scoreBoard) scoreBoard.style.display = 'none';
            if (resultsScoreBoard) resultsScoreBoard.style.display = 'none';
        }
    },

    startQuickMatchSearch() {
        this.isSearchingMatch = true;
        const btn = document.getElementById('btn-quick-match');
        const nameInput = document.getElementById('pvp-quick-name');
        
        if (btn) {
            btn.textContent = 'Searching... (Tap to Cancel)';
            btn.style.background = 'linear-gradient(90deg, #64748b, #475569)';
        }
        if (nameInput) nameInput.disabled = true;

        this.connectNetwork((success) => {
            if (success) {
                this.sendAction('JOIN_QUICK_MATCH', { playerName: this.playerName });
                this.speak("Searching for an online opponent.");
            } else {
                this.cancelQuickMatchSearch();
                alert("Could not connect to multiplayer server.");
            }
        });
    },

    cancelQuickMatchSearch() {
        this.isSearchingMatch = false;
        const btn = document.getElementById('btn-quick-match');
        const nameInput = document.getElementById('pvp-quick-name');
        
        if (btn) {
            btn.textContent = 'Find Opponent';
            btn.style.background = 'linear-gradient(90deg, #1ba0aa, #147a82)';
        }
        if (nameInput) nameInput.disabled = false;

        if (this.connected) {
            this.sendAction('LEAVE_QUICK_MATCH');
        }
        this.disconnectNetwork();
        this.speak("Matchmaking canceled.");
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(scr => {
            scr.classList.remove('active');
        });
        const target = document.getElementById(screenId);
        if (target) target.classList.add('active');

        if (screenId === 'setup-screen') {
            const container = document.querySelector('.glass-panel');
            if (container) {
                container.className = 'glass-panel';
            }
            this.loadStats(); // Load stats on return to setup
        }
    },

    startGame() {
        this.currentTotal = 0;
        this.buyTimeUsedThisTurn = false;
        this.reviveUsedThisGame = false;
        
        const btnLifelineTime = document.getElementById('btn-lifeline-time');
        if (btnLifelineTime) btnLifelineTime.style.display = 'none';
        
        if (this.gameMode !== 'pvp') {
            this.currentTurn = this.firstTurn;
        }

        this.isGameOver = false;
        this.history = [];
        
        // Setup initial display
        document.getElementById('display-dead-num').textContent = this.deadNumber;
        
        const modeLabel = document.getElementById('hud-label-mode');
        const diffDisplay = document.getElementById('display-diff');
        
        if (this.gameMode === 'bot') {
            if (modeLabel) modeLabel.textContent = "DIFFICULTY";
            if (diffDisplay) {
                diffDisplay.textContent = this.difficulty.toUpperCase();
                diffDisplay.style.color = "var(--color-gold)";
            }
        } else {
            if (modeLabel) modeLabel.textContent = "DUEL MATCH";
            if (diffDisplay) {
                diffDisplay.textContent = "PVP";
                diffDisplay.style.color = "var(--color-green)";
            }
        }

        document.getElementById('results-panel').style.display = 'none';
        document.getElementById('action-controls').style.display = 'block';
        
        const logBox = document.getElementById('history-log');
        if (logBox) logBox.innerHTML = '<div class="log-entry system">Nim Duel Initialized. Avoid the Dead Number!</div>';

        const timerText = document.getElementById('timer-digits');
        if (timerText) {
            timerText.textContent = this.getTurnDuration().toFixed(2);
            timerText.classList.remove('warning');
        }

        this.showScreen('arena-screen');
        this.updateUI();
        
        let startAnnounce;
        if (this.gameMode === 'bot') {
            startAnnounce = `Game started. Target dead number is ${this.deadNumber}. ${this.currentTurn === 'player' ? 'Your turn first' : 'Bot plays first'}.`;
        } else {
            const isRematch = (this.myWins > 0 || this.opponentWins > 0);
            if (isRematch) {
                const myWinsLabel = this.myWins === 1 ? "1 win" : `${this.myWins} wins`;
                const oppWinsLabel = this.opponentWins === 1 ? "1 win" : `${this.opponentWins} wins`;
                startAnnounce = `Rematch started. Current score: You have ${myWinsLabel}, Opponent has ${oppWinsLabel}. Avoid the dead number ${this.deadNumber}. ${this.currentTurn === 'player' ? 'Host plays first' : 'Challenger plays first'}.`;
            } else {
                startAnnounce = `Online PvP started. Avoid the dead number ${this.deadNumber}. ${this.currentTurn === 'player' ? 'Host turn first' : 'Challenger turn first'}.`;
            }
        }
        this.speak(startAnnounce);
        
        setTimeout(() => {
            if (this.gameMode === 'bot') {
                this.startTurn();
            } else {
                this.syncTurnUI();
            }
        }, 1200);
    },

    startPvPGame() {
        if (!this.isHost) return;
        this.sendAction('START_GAME');
    },

    startTurn() {
        if (this.isGameOver) return;
        
        clearInterval(this.timerInterval);
        const maxDuration = this.getTurnDuration();
        this.turnTimer = maxDuration;
        
        // Reset buy time used for this turn
        this.buyTimeUsedThisTurn = false;
        
        const btnLifelineTime = document.getElementById('btn-lifeline-time');
        if (btnLifelineTime) btnLifelineTime.style.display = 'none';

        const timerText = document.getElementById('timer-digits');
        if (timerText) {
            timerText.textContent = maxDuration.toFixed(2);
            timerText.classList.remove('warning');
        }

        // Highlight Active Turn Header
        const turnIndicator = document.getElementById('display-turn');
        let isMyTurn = false;

        if (this.gameMode === 'bot') {
            isMyTurn = (this.currentTurn === 'player');
        } else {
            isMyTurn = (this.isHost && this.currentTurn === 'player') || (!this.isHost && this.currentTurn === 'opponent');
        }

        if (turnIndicator) {
            if (this.gameMode === 'bot') {
                if (isMyTurn) {
                    turnIndicator.textContent = "YOUR TURN";
                    turnIndicator.style.color = "var(--color-blue)";
                } else {
                    turnIndicator.textContent = "BOT'S TURN";
                    turnIndicator.style.color = "var(--color-gold)";
                }
            } else {
                if (isMyTurn) {
                    turnIndicator.textContent = "YOUR TURN";
                    turnIndicator.style.color = "var(--color-blue)";
                } else {
                    const activeName = this.opponentName;
                    turnIndicator.textContent = `${activeName.toUpperCase()}'S TURN`;
                    turnIndicator.style.color = "var(--color-gold)";
                }
            }
        }

        // Enable/Disable choice buttons
        this.enableChoiceButtons(isMyTurn);

        // Run countdown timer locally for the active player
        const startTime = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            this.turnTimer = Math.max(0, maxDuration - elapsed);
            
            if (timerText) {
                timerText.textContent = this.turnTimer.toFixed(2);
                if (this.turnTimer <= 1.2) {
                    timerText.classList.add('warning');
                }
            }

            // Show lifeline +Time button if conditions are met
            if (this.gameMode === 'bot' && this.currentTurn === 'player' && !this.buyTimeUsedThisTurn && this.turnTimer <= 1.2 && !this.isGameOver) {
                if (btnLifelineTime) btnLifelineTime.style.display = 'block';
            } else {
                if (btnLifelineTime) btnLifelineTime.style.display = 'none';
            }
            
            if (this.turnTimer <= 0) {
                clearInterval(this.timerInterval);
                if (isMyTurn) {
                    this.handleTimeout();
                }
            }
        }, 50);

        // If it's Bot's turn, trigger bot choice
        if (this.gameMode === 'bot' && this.currentTurn === 'bot') {
            this.botPlay();
        }
    },

    enableChoiceButtons(enable) {
        for (let i = 1; i <= 4; i++) {
            const btn = document.getElementById(`btn-choice-${i}`);
            if (btn) {
                const nextVal = this.currentTotal + i;
                btn.dataset.val = nextVal;
                if (enable) {
                    // Disable choice if it exceeds the Dead Number
                    btn.disabled = (nextVal > this.deadNumber);
                } else {
                    btn.disabled = true;
                }
            }
        }
    },

    selectNumber(value) {
        if (this.isGameOver) return;

        // Capture rollback state BEFORE changing any values, if vs Bot, player turn, and revive not used yet
        if (this.gameMode === 'bot' && this.currentTurn === 'player' && !this.reviveUsedThisGame) {
            this.rollbackState = {
                currentTotal: this.currentTotal,
                history: [...this.history]
            };
        }

        clearInterval(this.timerInterval);

        const addition = value - this.currentTotal;
        this.currentTotal = value;
        
        this.playChoiceSound();
        this.updateUI();
        
        // Append history log
        const logBox = document.getElementById('history-log');
        let logText = "";
        
        if (this.gameMode === 'bot') {
            logText = this.currentTurn === 'player' 
                ? `You selected: ${value} (+${addition})`
                : `Bot selected: ${value} (+${addition})`;
        } else {
            // Use absolute player names so the log displays correctly on both screens
            const activeName = (this.currentTurn === 'player') 
                ? (this.isHost ? this.playerName : this.opponentName)
                : (this.isHost ? this.opponentName : this.playerName);
            logText = `${activeName} selected: ${value} (+${addition})`;
        }

        this.history.push(logText);
        this.syncHistoryLog();

        // Check lose condition
        if (this.currentTotal >= this.deadNumber) {
            // If vs Bot, player's turn, and revive is not used yet, trigger revive!
            if (this.gameMode === 'bot' && this.currentTurn === 'player' && !this.reviveUsedThisGame) {
                this.showReviveModal();
                return;
            }

            const loser = this.currentTurn;
            let winner = 'player';
            
            if (this.gameMode === 'bot') {
                winner = (loser === 'player') ? 'bot' : 'player';
            } else {
                winner = (loser === 'player') ? 'opponent' : 'player';
            }
            
            this.triggerGameOver(winner);
            return;
        }

        // Swap turns
        if (this.gameMode === 'bot') {
            this.currentTurn = (this.currentTurn === 'player') ? 'bot' : 'player';
        } else {
            this.currentTurn = (this.currentTurn === 'player') ? 'opponent' : 'player';
        }
        
        if (this.gameMode === 'pvp' && this.isHost) {
            this.broadcastState('update-turn');
        }
        
        setTimeout(() => {
            this.startTurn();
        }, 800);
    },

    syncHistoryLog() {
        const logBox = document.getElementById('history-log');
        if (logBox) {
            logBox.innerHTML = '';
            this.history.forEach(log => {
                const entry = document.createElement('div');
                const myChoiceText = `${this.playerName} selected`;
                const oppChoiceText = `${this.opponentName} selected`;

                if (log.includes('You selected') || log.includes(myChoiceText) || log.includes('You (Player)')) {
                    entry.className = 'log-entry player';
                } else if (log.includes('Bot selected') || log.includes(oppChoiceText) || (this.isHost && log.includes('Challenger selected')) || (!this.isHost && log.includes('Host selected')) || log.includes('selected:')) {
                    entry.className = 'log-entry bot';
                } else {
                    entry.className = 'log-entry system';
                }
                entry.textContent = log;
                logBox.appendChild(entry);
            });
            logBox.scrollTop = logBox.scrollHeight;
        }
    },

    handleTimeout() {
        this.shakeScreen();
        this.speak("Time out penalty!");
        
        const minVal = this.currentTotal + 1;
        const targetVal = Math.min(minVal, this.deadNumber);

        if (this.gameMode === 'bot') {
            this.selectNumber(targetVal);
        } else {
            // Online PvP timeout selection
            if (this.isHost) {
                this.selectNumber(targetVal);
            } else {
                this.sendAction('PLAY', { value: targetVal });
                this.enableChoiceButtons(false); // Disable buttons locally during timeout transit
                clearInterval(this.timerInterval); // Clear Challenger's timer immediately
            }
        }
    },

    botPlay() {
        const delay = 600 + Math.random() * 800;
        
        setTimeout(() => {
            if (this.isGameOver) return;
            
            const selectedVal = this.getBotChoice();
            this.selectNumber(selectedVal);
            
            const addition = selectedVal - this.currentTotal;
            this.speak(`Bot plays ${selectedVal}`);
        }, delay);
    },

    getBotChoice() {
        const C = this.currentTotal;
        const D = this.deadNumber;
        const limit = 4;
        
        const validSelections = [];
        for (let i = 1; i <= limit; i++) {
            if (C + i <= D) {
                validSelections.push(C + i);
            }
        }
        
        if (validSelections.length === 0) return D;

        // Easy Mode: Random choice
        if (this.difficulty === 'easy') {
            return validSelections[Math.floor(Math.random() * validSelections.length)];
        }
        
        // Medium Mode: 50% perfect play, 50% random
        if (this.difficulty === 'medium' && Math.random() < 0.5) {
            return validSelections[Math.floor(Math.random() * validSelections.length)];
        }
        
        // Hard Mode (Perfect Nim strategy):
        // (D - 1 - X) % 5 === 0
        for (let X of validSelections) {
            if ((D - 1 - X) % 5 === 0) {
                if (X === D && validSelections.length > 1) {
                    continue;
                }
                return X;
            }
        }
        
        const safeChoices = validSelections.filter(X => X !== (D - 1));
        if (safeChoices.length > 0) {
            return safeChoices[Math.floor(Math.random() * safeChoices.length)];
        }
        
        return validSelections[Math.floor(Math.random() * validSelections.length)];
    },

    updateUI() {
        document.getElementById('display-total').textContent = this.currentTotal;
        
        const circle = document.getElementById('progress-bar-circle');
        if (circle) {
            const ratio = Math.min(1, this.currentTotal / this.deadNumber);
            const offset = 565.48 * (1 - ratio);
            circle.style.strokeDashoffset = offset;
            
            if (this.deadNumber - this.currentTotal <= 5) {
                circle.classList.add('crimson');
            } else {
                circle.classList.remove('crimson');
            }
        }
    },

    triggerGameOver(winner) {
        if (this.isGameOver) return; // Prevent double logging stats
        this.isGameOver = true;
        clearInterval(this.timerInterval);
        
        this.enableChoiceButtons(false);
        
        const verdictTitle = document.getElementById('verdict-title');
        const verdictText = document.getElementById('verdict-text');
        const panel = document.getElementById('results-panel');
        const controls = document.getElementById('action-controls');
        const container = document.querySelector('.glass-panel');

        if (controls) controls.style.display = 'none';
        if (panel) panel.style.display = 'block';

        let playerWon = false;
        
        if (this.gameMode === 'bot') {
            playerWon = (winner === 'player');
            
            // Record stats
            this.stats.botGamesPlayed++;
            if (playerWon) {
                this.stats.botWins++;
                this.stats.activeStreak++;
                this.stats.coins = (this.stats.coins || 0) + 50; // Add 50 coins for bot win
            } else {
                this.stats.activeStreak = 0;
            }
            this.saveStats();

            if (playerWon) {
                if (verdictTitle) verdictTitle.textContent = "VICTORY ACHIEVED";
                if (verdictText) verdictText.textContent = `Bot selected the Dead Number: ${this.deadNumber}! You survive. (+50 🪙)`;
                if (container) container.className = 'glass-panel blue-glow';
                this.playVictorySound();
                this.speak(`Congratulations! The Bot was forced to select the dead number ${this.deadNumber}. You win.`);
            } else {
                if (verdictTitle) verdictTitle.textContent = "SYSTEM TERMINATED";
                if (verdictText) verdictText.textContent = `You selected the Dead Number: ${this.deadNumber}. You lose.`;
                if (container) container.className = 'glass-panel crimson-glow';
                this.playErrorSound();
                this.speak(`Defeat. You selected the dead number ${this.deadNumber}. Game over.`);
            }
        } else {
            // PvP Game over conditions
            playerWon = (this.isHost && winner === 'player') || (!this.isHost && winner === 'opponent');
            
            // Record stats
            this.stats.pvpGamesPlayed++;
            if (playerWon) {
                this.stats.pvpWins++;
                this.stats.activeStreak++;
                this.stats.coins = (this.stats.coins || 0) + 100; // Add 100 coins for pvp win
            } else {
                this.stats.activeStreak = 0;
            }
            this.saveStats();

            if (playerWon) {
                if (verdictTitle) verdictTitle.textContent = "VICTORY ACHIEVED";
                if (verdictText) verdictText.textContent = `Opponent selected the Dead Number: ${this.deadNumber}! You survive. (+100 🪙)`;
                if (container) container.className = 'glass-panel blue-glow';
                this.playVictorySound();
                this.speak(`Victory! Your opponent selected the dead number ${this.deadNumber}. You survive.`);
            } else {
                if (verdictTitle) verdictTitle.textContent = "SYSTEM TERMINATED";
                if (verdictText) verdictText.textContent = `You selected the Dead Number: ${this.deadNumber}. You lose.`;
                if (container) container.className = 'glass-panel crimson-glow';
                this.playErrorSound();
                this.speak(`Defeat. You picked the dead number ${this.deadNumber}. Connection severed.`);
            }
            
            if (this.isHost) {
                this.broadcastState('game-over');
            }
        }
    },

    // ==========================================
    // AUTHORITATIVE WEBSOCKET NETWORKING LAYER
    // ==========================================
    
    connectNetwork(callback) {
        if (this.client && this.client.readyState === WebSocket.OPEN) {
            if (callback) callback(true);
            return;
        }

        const dot = document.getElementById('net-status-dot');
        const txt = document.getElementById('net-status-text');

        if (dot) {
            dot.className = 'indicator-dot connecting';
            if (txt) txt.textContent = 'Connecting...';
        }

        // Determine server address dynamically
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let serverUrl;
        
        // Detect if we are running inside a packaged mobile app (Capacitor/Cordova)
        const isPackagedApp = window.Capacitor || 
                             window.location.protocol === 'file:' || 
                             window.location.protocol === 'capacitor:' ||
                             (window.location.hostname === 'localhost' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));

        if (isPackagedApp) {
            serverUrl = this.resolvedServerUrl || this.defaultProductionWsUrl;
            console.log("[Network] Packaged App Mode. Connecting to: " + serverUrl);
        } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname) {
            serverUrl = `ws://localhost:8765`;
            console.log("[Network] Local Dev Mode. Connecting to: " + serverUrl);
        } else if (window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            serverUrl = `${protocol}//${window.location.hostname}:8765`;
            console.log("[Network] LAN Test Mode. Connecting to: " + serverUrl);
        } else {
            serverUrl = this.resolvedServerUrl || this.defaultProductionWsUrl;
            console.log("[Network] Production Web Mode. Connecting to: " + serverUrl);
        }

        // Set a timer to check if connection takes time (Render free tier wake-up warning)
        let wakeUpTimer = setTimeout(() => {
            if (this.client && this.client.readyState === WebSocket.CONNECTING) {
                if (txt) {
                    txt.textContent = 'Waking up cloud server (may take 30s)...';
                }
                console.log("[Network] Connection is taking longer than 3 seconds. Server might be waking up from sleep.");
            }
        }, 3000);

        try {
            this.client = new WebSocket(serverUrl);

            this.client.onopen = () => {
                clearTimeout(wakeUpTimer);
                this.connected = true;
                if (dot) {
                    dot.className = 'indicator-dot online';
                    if (txt) txt.textContent = 'Online';
                }
                if (callback) callback(true);
            };

            this.client.onclose = () => {
                clearTimeout(wakeUpTimer);
                this.connected = false;
                this.opponentConnected = false;
                if (dot) {
                    dot.className = 'indicator-dot offline';
                    if (txt) txt.textContent = 'Disconnected';
                }
            };

            this.client.onerror = (err) => {
                clearTimeout(wakeUpTimer);
                console.error("WebSocket error:", err);
                this.connected = false;
                if (dot) {
                    dot.className = 'indicator-dot offline';
                    if (txt) txt.textContent = 'Error';
                }
                if (callback) callback(false);
            };

            this.client.onmessage = (event) => {
                this.handleNetworkMessage(event.data);
            };

        } catch (e) {
            clearTimeout(wakeUpTimer);
            console.error("Connection failed:", e);
            if (callback) callback(false);
        }
    },

    disconnectNetwork() {
        if (this.client) {
            this.client.close();
            this.client = null;
        }
        this.connected = false;
        this.opponentConnected = false;
        this.roomId = null;
        this.isDraftActive = false;
        this.selectionTurn = 'host';
        this.myWins = 0;
        this.opponentWins = 0;

        const draftBanner = document.getElementById('pvp-draft-banner');
        if (draftBanner) draftBanner.style.display = 'none';

        const playAgainOverlay = document.getElementById('play-again-overlay');
        if (playAgainOverlay) playAgainOverlay.style.display = 'none';

        const playAgainWaitingOverlay = document.getElementById('play-again-waiting-overlay');
        if (playAgainWaitingOverlay) playAgainWaitingOverlay.style.display = 'none';

        const pvpSeriesScore = document.getElementById('pvp-series-score');
        if (pvpSeriesScore) pvpSeriesScore.style.display = 'none';

        const pvpResultsScore = document.getElementById('pvp-results-score');
        if (pvpResultsScore) pvpResultsScore.style.display = 'none';
        
        const dot = document.getElementById('net-status-dot');
        const txt = document.getElementById('net-status-text');
        if (dot) {
            dot.className = 'indicator-dot offline';
            if (txt) txt.textContent = 'Offline';
        }
    },

    hostRoom() {
        this.connectNetwork((success) => {
            if (!success) {
                const status = document.getElementById('pvp-host-status');
                if (status) status.textContent = "Failed to reach WebSocket server.";
                return;
            }

            const status = document.getElementById('pvp-host-status');
            if (status) status.textContent = "Initializing room...";

            // Send CREATE_ROOM request
            this.sendAction('CREATE_ROOM', {
                hostName: this.playerName,
                deadNumber: this.deadNumber,
                difficulty: this.difficulty,
                firstTurn: this.firstTurn
            });
        });
    },

    joinRoom(code, name) {
        this.connectNetwork((success) => {
            const btn = document.getElementById('btn-join-duel');
            if (!success) {
                alert('Could not establish network connection.');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Connect to Duel';
                }
                return;
            }

            this.roomId = code;
            
            // Send JOIN_ROOM request
            this.sendAction('JOIN_ROOM', {
                roomId: code,
                playerName: name
            });
            
            const codeDisplay = document.getElementById('pvp-room-input');
            if (codeDisplay) codeDisplay.disabled = true;
            if (btn) btn.textContent = 'Connected. Waiting for host...';
        });
    },

    broadcastState(eventStage = 'setup') {
        // Authoritative server handles all state broadcasts now.
        // Client only receives STATE_UPDATE events.
    },

    sendAction(actionType, data = {}) {
        if (!this.client || this.client.readyState !== WebSocket.OPEN) return;

        const payload = {
            type: actionType,
            ...data
        };

        this.client.send(JSON.stringify(payload));
    },

    handleNetworkMessage(payload) {
        try {
            const message = JSON.parse(payload);
            const type = message.type;

            switch (type) {
                case 'ROLE_ASSIGNMENT': {
                    this.isHost = message.isHost;
                    this.roomId = message.roomId;
                    console.log("[Network] Assigned PvP Role. Is Host: " + this.isHost + ", Room: " + this.roomId);
                    break;
                }

                case 'DRAFT_UPDATE': {
                    const room = message.room;
                    this.isDraftActive = room.isDraftActive;
                    this.selectionTurn = room.selectionTurn;
                    this.deadNumber = room.deadNumber;

                    const display = document.getElementById('dead-num-display-val');
                    const slider = document.getElementById('dead-num-slider');
                    if (display) display.textContent = this.deadNumber;
                    if (slider) slider.value = this.deadNumber;

                    if (this.isHost) {
                        this.opponentName = room.challengerName;
                        this.myWins = room.hostWins || 0;
                        this.opponentWins = room.challengerWins || 0;
                    } else {
                        this.opponentName = room.hostName;
                        this.myWins = room.challengerWins || 0;
                        this.opponentWins = room.hostWins || 0;
                    }
                    this.opponentConnected = true;

                    if (this.isDraftActive) {
                        this.showScreen('setup-screen');
                    }

                    // Hide any active rematch overlays
                    const playAgainOverlay = document.getElementById('play-again-overlay');
                    if (playAgainOverlay) playAgainOverlay.style.display = 'none';

                    const playAgainWaitingOverlay = document.getElementById('play-again-waiting-overlay');
                    if (playAgainWaitingOverlay) playAgainWaitingOverlay.style.display = 'none';

                    this.updateDraftUI(room);
                    this.updateSeriesScoreUI();
                    break;
                }

                case 'ROOM_CREATED': {
                    this.roomId = message.roomId;
                    document.getElementById('pvp-room-code').textContent = this.roomId;
                    document.getElementById('pvp-host-status').textContent = "Awaiting challenger...";
                    break;
                }

                case 'STATE_UPDATE': {
                    const room = message.room;
                    const eventStage = message.eventStage;

                    this.deadNumber = room.deadNumber;
                    this.currentTotal = room.currentTotal;
                    this.currentTurn = room.currentTurn;
                    this.history = room.history;
                    
                    if (this.isHost) {
                        this.opponentName = room.challengerName;
                        this.myWins = room.hostWins || 0;
                        this.opponentWins = room.challengerWins || 0;
                    } else {
                        this.opponentName = room.hostName;
                        this.myWins = room.challengerWins || 0;
                        this.opponentWins = room.hostWins || 0;
                        // Synchronize Setup UI displays for Challenger
                        document.getElementById('dead-num-display-val').textContent = this.deadNumber;
                        document.getElementById('dead-num-slider').value = this.deadNumber;
                    }

                    // Hide any active rematch overlays
                    const playAgainOverlay = document.getElementById('play-again-overlay');
                    if (playAgainOverlay) playAgainOverlay.style.display = 'none';

                    const playAgainWaitingOverlay = document.getElementById('play-again-waiting-overlay');
                    if (playAgainWaitingOverlay) playAgainWaitingOverlay.style.display = 'none';

                    this.updateUI();
                    this.syncHistoryLog();
                    this.updateSeriesScoreUI();

                    // Handle turn timer updates from server
                    this.turnTimer = room.turnTimer;
                    const timerText = document.getElementById('timer-digits');
                    if (timerText) {
                        timerText.textContent = this.turnTimer.toFixed(2);
                        if (this.turnTimer <= 1.2) {
                            timerText.classList.add('warning');
                        } else {
                            timerText.classList.remove('warning');
                        }
                    }

                    if (eventStage === 'lobby-ready') {
                        this.opponentConnected = true;
                        this.showScreen('setup-screen');
                        
                        const status = document.getElementById('pvp-host-status');
                        if (status && this.isHost) {
                            status.textContent = `Challenger connected: ${this.opponentName}`;
                            status.style.color = "var(--color-green)";
                        }

                        const startBtn = document.getElementById('btn-start-game');
                        if (startBtn && this.isHost) {
                            startBtn.disabled = false;
                            startBtn.textContent = 'Launch Online Duel';
                        }

                        this.speak(`Opponent ${this.opponentName} connected. You may begin the duel.`);
                    } else if (eventStage === 'start-game') {
                        clearInterval(this.timerInterval);
                        this.startGame();
                    } else if (eventStage === 'update-turn') {
                        clearInterval(this.timerInterval);
                        this.syncTurnUI();
                    } else if (eventStage === 'game-over') {
                        clearInterval(this.timerInterval);
                        const winner = message.winner; // player or opponent
                        this.triggerGameOver(winner);
                    }
                    break;
                }

                case 'OPPONENT_DISCONNECTED': {
                    clearInterval(this.timerInterval);
                    this.shakeScreen();
                    this.speak("Opponent disconnected. Connection severed.");
                    alert(message.message);
                    this.disconnectNetwork();
                    this.showScreen('setup-screen');
                    break;
                }

                case 'PLAY_AGAIN_OFFERED': {
                    const overlay = document.getElementById('play-again-overlay');
                    if (overlay) overlay.style.display = 'flex';
                    const desc = document.getElementById('play-again-desc');
                    if (desc) {
                        desc.textContent = `${this.opponentName} wants to play again! Roles will be swapped (previous Challenger gets the first turn).`;
                    }
                    this.speak(`${this.opponentName} has requested a rematch. Do you accept?`);
                    break;
                }

                case 'PLAY_AGAIN_REJECTED': {
                    const waitingOverlay = document.getElementById('play-again-waiting-overlay');
                    if (waitingOverlay) waitingOverlay.style.display = 'none';
                    this.speak("Rematch request declined.");
                    alert("Opponent declined the rematch.");
                    this.disconnectNetwork();
                    this.showScreen('setup-screen');
                    break;
                }

                case 'PLAY_AGAIN_CANCELLED': {
                    const overlay = document.getElementById('play-again-overlay');
                    if (overlay) overlay.style.display = 'none';
                    this.speak("Rematch request cancelled.");
                    alert("Opponent cancelled the rematch request.");
                    this.disconnectNetwork();
                    this.showScreen('setup-screen');
                    break;
                }

                case 'WAITING_FOR_OPPONENT': {
                    console.log("[Network] Waiting for opponent in matchmaking queue...");
                    break;
                }

                case 'ERROR': {
                    const silentErrors = ["It is not your turn.", "Invalid move selection.", "Game is already over."];
                    if (silentErrors.includes(message.message)) {
                        console.warn("[Network] Silent gameplay error from server:", message.message);
                    } else {
                        alert(`Network Error: ${message.message}`);
                    }
                    const btn = document.getElementById('btn-join-duel');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Connect to Duel';
                    }
                    const codeDisplay = document.getElementById('pvp-room-input');
                    if (codeDisplay) codeDisplay.disabled = false;
                    break;
                }

                default:
                    console.warn("Unknown message type received from server:", type);
            }
        } catch (e) {
            console.error("Error parsing net message:", e, payload);
        }
    },

    syncTurnUI() {
        if (this.isGameOver) return;
        
        clearInterval(this.timerInterval);
        
        this.buyTimeUsedThisTurn = false;
        
        const btnLifelineTime = document.getElementById('btn-lifeline-time');
        if (btnLifelineTime) btnLifelineTime.style.display = 'none';

        const timerText = document.getElementById('timer-digits');
        if (timerText) {
            timerText.textContent = this.turnTimer.toFixed(2);
        }

        // Highlight Active Turn Header
        const turnIndicator = document.getElementById('display-turn');
        const isMyTurn = (this.isHost && this.currentTurn === 'player') || (!this.isHost && this.currentTurn === 'opponent');

        if (turnIndicator) {
            if (isMyTurn) {
                turnIndicator.textContent = "YOUR TURN";
                turnIndicator.style.color = "var(--color-blue)";
            } else {
                turnIndicator.textContent = `${this.opponentName.toUpperCase()}'S TURN`;
                turnIndicator.style.color = "var(--color-gold)";
            }
        }

        // Enable/Disable choice buttons
        this.enableChoiceButtons(isMyTurn);

        // Run local smooth interpolation countdown
        const startTime = Date.now();
        const initialTimer = this.turnTimer;
        this.timerInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            this.turnTimer = Math.max(0, initialTimer - elapsed);
            
            if (timerText) {
                timerText.textContent = this.turnTimer.toFixed(2);
                if (this.turnTimer <= 1.2) {
                    timerText.classList.add('warning');
                } else {
                    timerText.classList.remove('warning');
                }
            }
            
            if (this.turnTimer <= 0) {
                clearInterval(this.timerInterval);
            }
        }, 50);
    },

    // ==========================================
    // AUDIO GENERATION USING WEB AUDIO API
    // ==========================================
    getAudioCtx() {
        if (!window.audioCtx) {
            window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return window.audioCtx;
    },

    playClickSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) {
            console.warn(e);
        }
    },

    playChoiceSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            const startFreq = this.currentTurn === 'player' ? 300 : 200;
            osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(startFreq * 2, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) {
            console.warn(e);
        }
    },

    playVictorySound() {
        try {
            const ctx = this.getAudioCtx();
            const osc1 = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc1.connect(gain);
            gain.connect(ctx.destination);
            
            osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc1.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
            osc1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
            osc1.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.3); // C6
            
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
            
            osc1.start();
            osc1.stop(ctx.currentTime + 0.6);
        } catch (e) {
            console.warn(e);
        }
    },

    playErrorSound() {
        try {
            const ctx = this.getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.35);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) {
            console.warn(e);
        }
    },

    speak(text) {
        if (!this.voiceEnabled) return;
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.95;
            utterance.pitch = 0.85;
            
            const voices = window.speechSynthesis.getVoices();
            const targetVoice = voices.find(v => v.name.includes('Google') || v.lang.startsWith('en'));
            if (targetVoice) utterance.voice = targetVoice;
            
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn(e);
        }
    },

    shakeScreen() {
        const panel = document.querySelector('.glass-panel');
        if (panel) {
            panel.classList.add('shake');
            setTimeout(() => panel.classList.remove('shake'), 300);
        }
    },



    startDailyRewardTimer() {
        if (this.dailyTimerInterval) clearInterval(this.dailyTimerInterval);
        this.dailyTimerInterval = setInterval(() => {
            this.updateDailyRewardUI();
        }, 1000);
        this.updateDailyRewardUI();
    },

    updateDailyRewardUI() {
        const btn = document.getElementById('btn-claim-daily');
        if (!btn) return;

        if (!this.stats.lastClaimedDaily) {
            btn.textContent = "Claim +100 🪙";
            btn.disabled = false;
            return;
        }

        const lastClaim = new Date(this.stats.lastClaimedDaily).getTime();
        const now = Date.now();
        const diff = now - lastClaim;
        const cooldown = 24 * 60 * 60 * 1000;

        if (diff >= cooldown) {
            btn.textContent = "Claim +100 🪙";
            btn.disabled = false;
        } else {
            const remaining = cooldown - diff;
            const hours = Math.floor(remaining / (3600 * 1000));
            const minutes = Math.floor((remaining % (3600 * 1000)) / (60 * 1000));
            const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
            
            const pad = (n) => String(n).padStart(2, '0');
            btn.textContent = `Next: ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
            btn.disabled = true;
        }
    },

    updateLeaderboardUI() {
        const container = document.getElementById('leaderboard-list');
        if (!container) return;

        const bots = [
            { name: "Alex 👑", wins: 25 },
            { name: "Jordan 🔥", wins: 18 },
            { name: "Taylor", wins: 12 },
            { name: "Morgan", wins: 7 },
            { name: "Casey", wins: 4 }
        ];

        const playerWins = this.stats.pvpWins || 0;
        const playerItem = { name: `${this.playerName || 'You'} (You)`, wins: playerWins, isSelf: true };

        const list = [...bots, playerItem];
        list.sort((a, b) => b.wins - a.wins);

        const rankedList = list.map((item, idx) => ({ ...item, rank: idx + 1 }));
        const playerIndex = rankedList.findIndex(item => item.isSelf);
        
        let displayItems = [];
        if (playerIndex < 5) {
            displayItems = rankedList.slice(0, 5);
        } else {
            displayItems = [...rankedList.slice(0, 5), { separator: true }, rankedList[playerIndex]];
        }

        container.innerHTML = '';
        displayItems.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.style.textAlign = 'center';
                sep.style.color = 'var(--color-text-dim)';
                sep.style.fontSize = '0.75rem';
                sep.style.margin = '0.2rem 0';
                sep.textContent = '•••';
                container.appendChild(sep);
                return;
            }

            const div = document.createElement('div');
            div.className = `leaderboard-item${item.isSelf ? ' self' : ''}`;
            
            let rankBadge = `${item.rank}`;
            if (item.rank === 1) rankBadge = '🥇';
            else if (item.rank === 2) rankBadge = '🥈';
            else if (item.rank === 3) rankBadge = '🥉';

            div.innerHTML = `
                <span class="leaderboard-rank">${rankBadge}</span>
                <span class="leaderboard-name">${item.name}</span>
                <span class="leaderboard-wins">${item.wins} Wins</span>
            `;
            container.appendChild(div);
        });
    },

    showAdOverlay(duration, onComplete) {
        const overlay = document.getElementById('ad-video-overlay');
        const countdownText = document.getElementById('ad-countdown-timer');
        if (!overlay || !countdownText) {
            if (onComplete) onComplete();
            return;
        }

        this.isAdPlaying = true;
        clearInterval(this.timerInterval);

        overlay.style.display = 'flex';
        let remaining = duration;
        countdownText.textContent = remaining;

        const adInterval = setInterval(() => {
            remaining--;
            if (remaining >= 0) {
                countdownText.textContent = remaining;
            }
            if (remaining <= 0) {
                clearInterval(adInterval);
                overlay.style.display = 'none';
                this.isAdPlaying = false;
                if (onComplete) onComplete();
            }
        }, 1000);
    },

    showReviveModal() {
        clearInterval(this.timerInterval);
        this.isGameOver = true;
        this.enableChoiceButtons(false);
        
        const overlay = document.getElementById('revive-modal-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
        this.speak("You hit the dead number. Watch an ad to revive?");
    }
};

window.onload = () => {
    DeadNumberGame.init();
};
