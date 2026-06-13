/**
 * Bigg Boss Mini-Games Engines
 * Implements client-side logic for the 4 tournament games.
 */

const BiggBossPuzzles = {
    // ----------------------------------------------------
    // GAME 1: REACTION ARENA
    // ----------------------------------------------------
    reaction: {
        active: false,
        pos: 0,
        direction: 1,
        speed: 4,
        targetLeft: 220, // matching CSS target zone center
        targetWidth: 60,
        trackWidth: 500,
        animationFrameId: null,
        submitted: false,

        init() {
            this.active = true;
            this.pos = 0;
            this.direction = 1;
            this.speed = 5 + Math.random() * 3; // randomized speed per client for fairness/variety
            this.submitted = false;

            const indicator = document.getElementById('reaction-indicator');
            const target = document.getElementById('reaction-target');
            const feedback = document.getElementById('reaction-feedback-text');
            const btn = document.getElementById('btn-reaction-action');

            if (feedback) {
                feedback.textContent = "PRESS SPACEBAR / CLICK TO HIT!";
                feedback.style.color = "var(--color-text)";
            }
            
            if (btn) btn.disabled = false;

            // Randomize target position slightly for each game
            this.targetLeft = Math.floor(100 + Math.random() * 280); // between 100px and 380px
            if (target) {
                target.style.left = this.targetLeft + 'px';
            }

            // Bind Spacebar
            this.spaceHandler = (e) => {
                if (e.code === 'Space') {
                    e.preventDefault();
                    this.hit();
                }
            };
            window.addEventListener('keydown', this.spaceHandler);

            this.animate();
        },

        animate() {
            if (!this.active) return;

            const indicator = document.getElementById('reaction-indicator');
            if (indicator) {
                this.pos += this.speed * this.direction;
                if (this.pos >= (this.trackWidth - 10)) {
                    this.pos = this.trackWidth - 10;
                    this.direction = -1;
                } else if (this.pos <= 0) {
                    this.pos = 0;
                    this.direction = 1;
                }
                indicator.style.left = this.pos + 'px';
            }

            this.animationFrameId = requestAnimationFrame(() => this.animate());
        },

        hit() {
            if (!this.active || this.submitted) return;
            this.submitted = true;
            this.active = false;
            cancelAnimationFrame(this.animationFrameId);
            window.removeEventListener('keydown', this.spaceHandler);

            const btn = document.getElementById('btn-reaction-action');
            if (btn) btn.disabled = true;

            // Calculate timing offset from target center
            const targetCenter = this.targetLeft + (this.targetWidth / 2);
            const indicatorCenter = this.pos + 3;
            const diff = Math.abs(indicatorCenter - targetCenter);

            const feedback = document.getElementById('reaction-feedback-text');
            const stats = document.getElementById('reaction-val-score');

            let timingScore = Math.round(diff * 2); // Map pixel offset to a simulated ms score

            if (diff < 12) {
                feedback.textContent = "PERFECT SHOT!";
                feedback.style.color = "var(--color-green)";
                if (window.audioManager) window.audioManager.playUnlock();
            } else if (diff < 30) {
                feedback.textContent = "GOOD TIMING";
                feedback.style.color = "var(--color-blue)";
                if (window.audioManager) window.audioManager.playUnlock();
            } else {
                feedback.textContent = "TOO LATE / TOO EARLY!";
                feedback.style.color = "var(--color-crimson)";
                if (window.audioManager) window.audioManager.playError();
            }

            if (stats) stats.textContent = timingScore + "ms";

            // Play impact flash
            const alarm = document.getElementById('alarm-overlay');
            if (alarm) {
                alarm.classList.add('active');
                setTimeout(() => alarm.classList.remove('active'), 200);
            }

            // Submit score to host
            setTimeout(() => {
                BiggBossMultiplayer.submitScore(timingScore);
            }, 1000);
        },

        cleanup() {
            this.active = false;
            this.submitted = false;
            cancelAnimationFrame(this.animationFrameId);
            window.removeEventListener('keydown', this.spaceHandler);
        }
    },

    // ----------------------------------------------------
    // GAME 2: TIC-CROSS DUEL
    // ----------------------------------------------------
    ticcross: {
        init() {
            const cells = document.querySelectorAll('.tc-cell');
            cells.forEach(cell => {
                // Clear any markers
                cell.className = 'tc-cell';
                cell.textContent = '';
                
                // Add click handler
                cell.onclick = (e) => {
                    const idx = parseInt(cell.getAttribute('data-index'));
                    const tc = BiggBossMultiplayer.gameState.ticCrossState;
                    
                    // Only allow clicking if it is our turn
                    if (tc.turn === BiggBossMultiplayer.myClientId) {
                        if (window.audioManager) window.audioManager.playClick();
                        BiggBossMultiplayer.makeTicCrossMove(idx, BiggBossMultiplayer.myClientId);
                    }
                };
            });
        },

        sync(tcState) {
            const cells = document.querySelectorAll('.tc-cell');
            tcState.board.forEach((val, idx) => {
                const cell = cells[idx];
                if (!cell) return;

                if (val === 'X') {
                    cell.textContent = 'X';
                    cell.classList.add('cell-x');
                } else if (val === 'O') {
                    cell.textContent = 'O';
                    cell.classList.add('cell-o');
                } else {
                    cell.textContent = '';
                    cell.className = 'tc-cell';
                }
            });

            // Highlight whose turn it is
            const statusEl = document.getElementById('tc-turn-status');
            const playerXName = BiggBossMultiplayer.gameState.players.find(p => p.clientId === tcState.playerX)?.name || 'X';
            const playerOName = BiggBossMultiplayer.gameState.players.find(p => p.clientId === tcState.playerO)?.name || 'O';
            
            if (tcState.winner) {
                if (tcState.winner === 'draw') {
                    statusEl.textContent = "MATCH ENDED: DRAW GAME!";
                    statusEl.style.color = "var(--color-gold)";
                } else {
                    const winnerName = BiggBossMultiplayer.gameState.players.find(p => p.clientId === tcState.winner)?.name || 'Winner';
                    statusEl.textContent = `MATCH ENDED: ${winnerName} WINS!`;
                    statusEl.style.color = "var(--color-green)";
                }
            } else {
                if (tcState.turn === BiggBossMultiplayer.myClientId) {
                    statusEl.textContent = "YOUR TURN! Place your marker.";
                    statusEl.style.color = "var(--color-blue)";
                } else {
                    const currentTurnName = BiggBossMultiplayer.gameState.players.find(p => p.clientId === tcState.turn)?.name || 'Opponent';
                    statusEl.textContent = `Waiting for ${currentTurnName} to make a move...`;
                    statusEl.style.color = "var(--color-text-dark)";
                }
            }
        },

        cleanup() {
            const cells = document.querySelectorAll('.tc-cell');
            cells.forEach(cell => {
                cell.onclick = null;
            });
        }
    },

    // ----------------------------------------------------
    // GAME 3: MEMORY CORE (SIMON SAYS)
    // ----------------------------------------------------
    memory: {
        sequence: [],
        playerIndex: 0,
        level: 1,
        active: false,
        acceptInput: false,
        submitted: false,

        init() {
            this.sequence = [];
            this.playerIndex = 0;
            this.level = 1;
            this.active = true;
            this.acceptInput = false;
            this.submitted = false;

            const display = document.getElementById('memory-level-display');
            if (display) {
                display.textContent = `Round: 1 | Score: 0`;
                display.style.color = "#ffffff";
            }

            // Bind click handlers to color pads
            for (let i = 0; i < 4; i++) {
                const pad = document.getElementById('mem-pad-' + i);
                if (pad) {
                    pad.onclick = () => {
                        this.handlePadClick(i);
                    };
                }
            }

            setTimeout(() => {
                this.nextLevel();
            }, 1000);
        },

        nextLevel() {
            if (!this.active) return;
            this.acceptInput = false;
            this.playerIndex = 0;
            
            // Add a random pad (0-3) to sequence
            this.sequence.push(Math.floor(Math.random() * 4));
            
            const display = document.getElementById('memory-level-display');
            if (display) {
                display.textContent = `Sequence Round: ${this.level} | Playing Pattern...`;
                display.style.color = "var(--color-gold)";
            }

            // Play pattern
            this.playSequence();
        },

        playSequence() {
            let i = 0;
            const timer = setInterval(() => {
                if (!this.active) {
                    clearInterval(timer);
                    return;
                }

                const padIndex = this.sequence[i];
                this.flashPad(padIndex);

                i++;
                if (i >= this.sequence.length) {
                    clearInterval(timer);
                    setTimeout(() => {
                        this.acceptInput = true;
                        const display = document.getElementById('memory-level-display');
                        if (display) {
                            display.textContent = `Your Turn! Repeat: ${this.sequence.length} keys`;
                            display.style.color = "var(--color-blue)";
                        }
                    }, 600);
                }
            }, 600);
        },

        flashPad(index) {
            const pad = document.getElementById('mem-pad-' + index);
            if (!pad) return;

            pad.classList.add('active');
            
            // Play corresponding synth tick sound
            if (window.audioManager) {
                window.audioManager.playCrystalTone(index);
            }

            setTimeout(() => {
                pad.classList.remove('active');
            }, 300);
        },

        handlePadClick(index) {
            if (!this.active || !this.acceptInput) return;

            this.flashPad(index);

            // Verify input
            if (index === this.sequence[this.playerIndex]) {
                this.playerIndex++;
                
                // Completed the full sequence
                if (this.playerIndex >= this.sequence.length) {
                    this.level++;
                    this.acceptInput = false;
                    
                    const display = document.getElementById('memory-level-display');
                    if (display) {
                        display.textContent = `CORRECT! Completed Round ${this.level - 1}`;
                        display.style.color = "var(--color-green)";
                    }

                    setTimeout(() => {
                        this.nextLevel();
                    }, 1000);
                }
            } else {
                // Mistake made
                this.gameOver();
            }
        },

        gameOver() {
            this.active = false;
            this.acceptInput = false;
            
            if (window.audioManager) window.audioManager.playError();

            const display = document.getElementById('memory-level-display');
            const score = this.level - 1;
            
            if (display) {
                display.textContent = `SEQUENCE BROKEN! Final Score: ${score}`;
                display.style.color = "var(--color-crimson)";
            }

            // Flash screen red
            const alarm = document.getElementById('alarm-overlay');
            if (alarm) {
                alarm.classList.add('active');
                setTimeout(() => alarm.classList.remove('active'), 500);
            }

            if (!this.submitted) {
                this.submitted = true;
                setTimeout(() => {
                    BiggBossMultiplayer.submitScore(score);
                }, 1500);
            }
        },

        cleanup() {
            this.active = false;
            this.acceptInput = false;
            for (let i = 0; i < 4; i++) {
                const pad = document.getElementById('mem-pad-' + i);
                if (pad) pad.onclick = null;
            }
        }
    },

    // ----------------------------------------------------
    // GAME 4: THE FINAL GRID (CLICK ASCENDING 1 TO 16)
    // ----------------------------------------------------
    finalgrid: {
        expectedNum: 1,
        startTime: null,
        active: false,
        submitted: false,
        penaltyCount: 0,

        init() {
            this.expectedNum = 1;
            this.active = true;
            this.submitted = false;
            this.penaltyCount = 0;
            this.startTime = Date.now();

            const board = document.getElementById('fg-board');
            if (!board) return;

            board.innerHTML = '';
            
            // Create list 1 to 16
            let numbers = Array.from({ length: 16 }, (_, i) => i + 1);
            
            // Scramble
            numbers.sort(() => Math.random() - 0.5);

            numbers.forEach(num => {
                const tile = document.createElement('div');
                tile.className = 'fg-tile';
                tile.textContent = num;
                tile.setAttribute('data-num', num);
                
                tile.onclick = () => {
                    this.handleTileClick(tile, num);
                };
                
                board.appendChild(tile);
            });

            const countText = document.getElementById('fg-cleared-count');
            if (countText) countText.textContent = '0';
        },

        handleTileClick(tile, num) {
            if (!this.active || this.submitted) return;

            if (num === this.expectedNum) {
                // Correct click
                tile.classList.add('cleared');
                tile.onclick = null; // disable further clicks
                
                if (window.audioManager) window.audioManager.playClick();

                this.expectedNum++;
                
                const countText = document.getElementById('fg-cleared-count');
                if (countText) countText.textContent = (this.expectedNum - 1).toString();

                if (this.expectedNum > 16) {
                    // Win! Game finished
                    this.active = false;
                    const elapsed = Date.now() - this.startTime + (this.penaltyCount * 1000); // 1s penalty per error
                    
                    if (window.audioManager) window.audioManager.playUnlock();

                    const tileElems = document.querySelectorAll('.fg-tile');
                    tileElems.forEach(el => el.style.borderColor = 'var(--color-green)');
                    
                    if (!this.submitted) {
                        this.submitted = true;
                        setTimeout(() => {
                            BiggBossMultiplayer.submitScore(elapsed);
                        }, 1000);
                    }
                }
            } else {
                // Incorrect click
                this.penaltyCount++;
                if (window.audioManager) window.audioManager.playError();
                
                tile.classList.add('error');
                setTimeout(() => {
                    tile.classList.remove('error');
                }, 300);
            }
        },

        cleanup() {
            this.active = false;
            const tiles = document.querySelectorAll('.fg-tile');
            tiles.forEach(tile => {
                tile.onclick = null;
            });
        }
    }
};

window.BiggBossPuzzles = BiggBossPuzzles;
