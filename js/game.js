/**
 * Aetheria main gameplay and state controller.
 * Manages inventory, Focus/Stability survival bars, story dialogues, chamber setups, and game loop timers.
 */

class GameEngine {
    constructor() {
        // Core game state
        this.currentChamber = 1;
        this.focus = 100;
        this.stability = 100;
        this.inventory = []; // Array of item IDs
        this.selectedItemIdx = null;
        
        // Progression flags
        this.solvedPuzzles = {
            chamber1_slider: false,
            chamber1_nodes: false,
            chamber1_batteryPlaced: false,
            chamber1_shardPicked: false,
            
            chamber2_simon: false,
            chamber2_laser: false,
            chamber2_prismPlaced: false,
            chamber2_generatorPowered: false,
            
            chamber3_lensPlaced: false,
            chamber3_laser: false,
            chamber3_keyAcquired: false,
            chamber3_chestUnlocked: false,
            chamber3_nodes: false,

            chamber4_nodes: false,
            chamber4_keyCardPicked: false,
            chamber4_keyPlaced: false,
            chamber4_shardPicked: false,

            chamber5_laser: false,
            chamber5_cellPlaced: false,
            chamber5_simon: false,
            chamber5_toolPicked: false,
            chamber5_nodes: false
        };

        this.startTime = null;
        this.timerInterval = null;
        this.stabilityInterval = null;
        this.isGameOver = false;
        
        // Inventory combinations
        // e.g. combining empty_battery + aether_charge = charged_battery
        this.combinationMap = {
            'empty_battery+aether_charge': 'charged_battery',
            'aether_charge+empty_battery': 'charged_battery',
            'metal_clip+heavy_magnet': 'lockpick',
            'heavy_magnet+metal_clip': 'lockpick',
            'empty_cell+aether_plasma': 'charged_cell',
            'aether_plasma+empty_cell': 'charged_cell'
        };

        // Item database
        this.itemsDb = {
            screwdriver: { name: 'Thermal Screwdriver', desc: 'An engineering tool for opening locked consoles.', icon: 'screwdriver-svg' },
            stabilizer_shard: { name: 'Stabilizer Shard', desc: 'A crystalline fragment emitting chronal energy. Restores +25 Stability on room relays.', icon: 'shard-svg' },
            battery: { name: 'Thermal Battery', desc: 'A charged power source suitable for heavy circuits.', icon: 'battery-svg' },
            empty_battery: { name: 'Depleted Battery', desc: 'A dead cell. Needs a raw energy charge to work.', icon: 'empty-battery-svg' },
            aether_charge: { name: 'Aether Core Charge', desc: 'Concentrated raw chronal energy. Highly unstable.', icon: 'charge-svg' },
            charged_battery: { name: 'Charged Battery', desc: 'A synthesized power cell, ready to restore emergency energy.', icon: 'battery-svg' },
            prism: { name: 'Optic Prism', desc: 'A polished glass crystal that refracts high-energy lasers.', icon: 'prism-svg' },
            lens: { name: 'Optic Lens', desc: 'A magnifying glass lens capable of focusing blurred projection codes.', icon: 'lens-svg' },
            metal_clip: { name: 'Tension Clip', desc: 'A flexible metal clip. Can be bent easily.', icon: 'clip-svg' },
            heavy_magnet: { name: 'Neodymium Magnet', desc: 'A strong magnetic block.', icon: 'magnet-svg' },
            lockpick: { name: 'Magnetic Lockpick', desc: 'A makeshift pick for mechanical keypads.', icon: 'pick-svg' },
            portal_key: { name: 'Aether Portal Key', desc: 'The golden activator node for the chamber portal exit.', icon: 'key-svg' },
            key_card: { name: 'Access Key Card', desc: 'A key card to unlock security terminals.', icon: 'card-svg' },
            empty_cell: { name: 'Depleted Aether Cell', desc: 'An empty storage cell. Needs raw plasma fuel.', icon: 'empty-cell-svg' },
            aether_plasma: { name: 'Aether Plasma Relic', desc: 'Highly reactive liquid energy plasma.', icon: 'plasma-svg' },
            charged_cell: { name: 'Charged Aether Cell', desc: 'A fully loaded power cell for opening portal gates.', icon: 'cell-svg' }
        };
    }

    start() {
        this.focus = 100;
        this.stability = 100;
        this.inventory = [];
        this.selectedItemIdx = null;
        this.currentChamber = 1;
        this.isGameOver = false;
        
        // Reset flags
        for (let key in this.solvedPuzzles) {
            this.solvedPuzzles[key] = false;
        }

        this.startTime = Date.now();
        
        // Setup UI
        window.ui.initHUD();
        window.ui.updateHUD();
        window.ui.clearNarrative();
        window.ui.loadChamber(1);

        // Narrate introduction
        window.ui.addNarrativeEntry("Story Log", "You open your eyes. The air is thick and hums with static. Emergency sirens are pulsing. Your HUD indicates a Temporal Chamber desynchronization. You are trapped.", "story");
        window.ui.addNarrativeEntry("AI Assistant", "Warning: Vault integrity decaying. Access override terminal to establish stabilization parameters.", "system");

        // Start Timers
        this.startTimers();
    }

    startTimers() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.stabilityInterval) clearInterval(this.stabilityInterval);

        // Elapsed time recorder
        this.timerInterval = setInterval(() => {
            if (this.isGameOver) return;
            window.ui.updateTimer(Date.now() - this.startTime);
        }, 1000);

        // Stability decay tick
        this.stabilityInterval = setInterval(() => {
            if (this.isGameOver) return;

            // Decay speed doubles in chamber 5
            const decay = this.currentChamber === 5 ? 2 : 1;
            this.adjustStability(-decay);
        }, 6000); // 6 seconds - half speed decay (much easier!)
    }

    adjustFocus(amount) {
        this.focus = Math.max(0, Math.min(100, this.focus + amount));
        window.ui.updateHUD();

        if (amount < 0 && window.audioManager) {
            window.audioManager.playError();
        }

        if (this.focus <= 0) {
            this.triggerGameOver("Focus collapse. Your mind gave in to the chronological loop pressure.");
        }
    }

    adjustStability(amount) {
        this.stability = Math.max(0, Math.min(100, this.stability + amount));
        window.ui.updateHUD();

        // Handle alarm overlay visual pulsing
        const alarmOverlay = document.getElementById('alarm-overlay');
        if (this.stability <= 25) {
            alarmOverlay.classList.add('active');
        } else {
            alarmOverlay.classList.remove('active');
        }

        if (this.stability <= 0) {
            this.triggerGameOver("Chamber stability reached absolute zero. The room collapsed in a spatial anomaly.");
        }
    }

    pickupItem(itemId) {
        if (this.inventory.length >= 4) {
            window.ui.showNotification("Chronopack full! Combine items or solve relays to free slots.");
            return false;
        }

        this.inventory.push(itemId);
        if (window.audioManager) window.audioManager.playPickup();
        
        const item = this.itemsDb[itemId];
        window.ui.addNarrativeEntry("System", `Acquired: [${item.name}] - ${item.desc}`, "system");
        window.ui.updateInventory();
        return true;
    }

    selectInventorySlot(index) {
        if (index >= this.inventory.length) {
            this.selectedItemIdx = null;
        } else if (this.selectedItemIdx === index) {
            // Deselect
            this.selectedItemIdx = null;
            if (window.audioManager) window.audioManager.playClick();
        } else {
            // Select or Combine
            if (this.selectedItemIdx !== null) {
                // Try combining
                const itemA = this.inventory[this.selectedItemIdx];
                const itemB = this.inventory[index];
                const result = this.combineItems(itemA, itemB);
                
                if (result) {
                    // Remove both items, replace with result
                    const maxIdx = Math.max(this.selectedItemIdx, index);
                    const minIdx = Math.min(this.selectedItemIdx, index);
                    
                    this.inventory.splice(maxIdx, 1);
                    this.inventory.splice(minIdx, 1);
                    this.inventory.push(result);
                    
                    this.selectedItemIdx = null;
                    if (window.audioManager) window.audioManager.playPickup();
                    window.ui.updateInventory();
                    return;
                }
            }
            // Just select
            this.selectedItemIdx = index;
            if (window.audioManager) window.audioManager.playClick();
        }
        window.ui.updateInventory();
    }

    combineItems(itemA, itemB) {
        const comboKey1 = `${itemA}+${itemB}`;
        const comboKey2 = `${itemB}+${itemA}`;
        const result = this.combinationMap[comboKey1] || this.combinationMap[comboKey2];

        if (result) {
            const finalItem = this.itemsDb[result];
            window.ui.addNarrativeEntry("Chronopack Synthesis", `SUCCESS: Combined [${this.itemsDb[itemA].name}] and [${this.itemsDb[itemB].name}] to create [${finalItem.name}].`, "system");
            return result;
        }

        window.ui.showNotification("These items do not combine.");
        return null;
    }

    useSelectedItemOnHotspot(hotspotId) {
        if (this.selectedItemIdx === null) return false;
        
        const itemId = this.inventory[this.selectedItemIdx];
        
        // Chamber 1 Usage
        if (this.currentChamber === 1) {
            if (hotspotId === 'terminal-lock' && itemId === 'screwdriver') {
                // Unlocks glyph slider puzzle
                this.solvedPuzzles.chamber1_slider_unlocked = true;
                window.ui.addNarrativeEntry("Story Log", "You unfasten the screws of the terminal. A glowing glyph security grid is exposed.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(1); // Redraw
                return true;
            }
            if (hotspotId === 'relay-power' && itemId === 'battery') {
                this.solvedPuzzles.chamber1_batteryPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You slot the Thermal Battery into the relay cage. Neon conduits hum to life, energizing the exit portal lock.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(1); // Redraw
                return true;
            }
            if (hotspotId === 'relay-power' && itemId === 'stabilizer_shard') {
                this.adjustStability(25);
                this.consumeSelectedItem();
                window.ui.showNotification("Stabilizer relic discharged: Integrity restored (+25%)");
                return true;
            }
        }

        // Chamber 2 Usage
        if (this.currentChamber === 2) {
            if (hotspotId === 'laser-base' && itemId === 'prism') {
                this.solvedPuzzles.chamber2_prismPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You slide the Optic Prism into the laser emission socket. Refraction relays are now online.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(2); // Redraw
                return true;
            }
            if (hotspotId === 'generator' && itemId === 'charged_battery') {
                this.solvedPuzzles.chamber2_generatorPowered = true;
                this.adjustStability(50);
                window.ui.addNarrativeEntry("Story Log", "The backup generator accepts the Charged Battery. A massive wave of cronal stabilizer pulses refills integrity meters.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(2); // Redraw
                return true;
            }
        }

        // Chamber 3 Usage
        if (this.currentChamber === 3) {
            if (hotspotId === 'laser-generator' && itemId === 'lens') {
                this.solvedPuzzles.chamber3_lensPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You mount the magnifying lens over the calibration projector. Safe frequencies can now be scanned.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(3); // Redraw
                return true;
            }
            if (hotspotId === 'chest' && itemId === 'lockpick') {
                this.solvedPuzzles.chamber3_chestUnlocked = true;
                window.ui.addNarrativeEntry("Story Log", "You slide the magnetic lockpick into the chest locking pins. After a faint mechanical click, the trunk swings open.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(3); // Redraw
                return true;
            }
            if (hotspotId === 'portal-control' && itemId === 'portal_key') {
                this.solvedPuzzles.chamber3_keyPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You insert the golden Aether Portal Key into the terminal console. The final gateway grid activates.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(3); // Redraw
                return true;
            }
        }

        // Chamber 4 Usage
        if (this.currentChamber === 4) {
            if (hotspotId === 'portal-console' && itemId === 'key_card') {
                this.solvedPuzzles.chamber4_keyPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You swipe the Access Key Card. The security door override interface unlocks.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(4); // Redraw
                return true;
            }
        }

        // Chamber 5 Usage
        if (this.currentChamber === 5) {
            if (hotspotId === 'gate-relayer' && itemId === 'charged_cell') {
                this.solvedPuzzles.chamber5_cellPlaced = true;
                window.ui.addNarrativeEntry("Story Log", "You insert the Charged Aether Cell into the gate power core. The final exit portal sparks to life.", "story");
                this.consumeSelectedItem();
                window.ui.loadChamber(5); // Redraw
                return true;
            }
        }

        // Default generic stabilizer shard usage anywhere
        if (itemId === 'stabilizer_shard') {
            this.adjustStability(25);
            this.consumeSelectedItem();
            window.ui.showNotification("Timeline stabilization fragment activated (+25% Stability)");
            return true;
        }

        window.ui.showNotification("Cannot use this item on that node.");
        return false;
    }

    consumeSelectedItem() {
        if (this.selectedItemIdx !== null) {
            this.inventory.splice(this.selectedItemIdx, 1);
            this.selectedItemIdx = null;
            window.ui.updateInventory();
        }
    }

    triggerGameOver(cause) {
        this.isGameOver = true;
        clearInterval(this.timerInterval);
        clearInterval(this.stabilityInterval);
        
        document.getElementById('defeat-cause-text').textContent = cause;
        window.ui.switchScreen('defeat-screen');
    }

    triggerVictory() {
        this.isGameOver = true;
        clearInterval(this.timerInterval);
        clearInterval(this.stabilityInterval);

        if (window.audioManager) window.audioManager.playVictory();

        // Calculate statistics
        const duration = Date.now() - this.startTime;
        const minutes = Math.floor(duration / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((duration % 60000) / 1000).toString().padStart(2, '0');

        document.getElementById('victory-focus').textContent = `${this.focus}%`;
        document.getElementById('victory-stability').textContent = `${this.stability}%`;
        document.getElementById('victory-time').textContent = `${minutes}:${seconds}`;

        window.ui.switchScreen('victory-screen');
    }

    nextChamber() {
        if (this.currentChamber >= 5) {
            this.triggerVictory();
            return;
        }
        if (window.audioManager) window.audioManager.playChamberTransition();
        this.currentChamber++;
        window.ui.loadChamber(this.currentChamber);
        this.adjustFocus(15); // Reward focus for chamber escape
        window.ui.addNarrativeEntry("Navigation", `Chamber Transition complete. Initiating Chamber ${this.currentChamber} override diagnostics.`, "system");
    }
}

// Instantiate global game engine
const game = new GameEngine();
window.game = game; // Make globally accessible
