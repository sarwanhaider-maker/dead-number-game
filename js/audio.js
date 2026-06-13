/**
 * Aetheria procedural audio manager using Web Audio API.
 * Provides relaxing ambient drone music and gameplay sound effects.
 */
class AudioManager {
    constructor() {
        this.ctx = null;
        this.isMuted = true;
        
        // Audio Node references
        this.ambientGain = null;
        this.droneOsc1 = null;
        this.droneOsc2 = null;
        this.filterNode = null;
        this.lfoNode = null;
    }

    /**
     * Initialize the Web Audio Context.
     * Must be triggered by a user gesture.
     */
    init() {
        if (this.ctx) return;
        
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            
            // Build the ambient synthesizer
            this.setupAmbientSynth();
            
            console.log("Web Audio Context initialized.");
        } catch (e) {
            console.warn("Web Audio API is not supported in this browser.", e);
        }
    }

    /**
     * Build the background procedural ambient synth.
     * Uses a low-passed detuned double oscillator and LFO filter sweep.
     */
    setupAmbientSynth() {
        if (!this.ctx) return;

        // 1. Create a filter to keep it warm and low-frequency (relaxing)
        this.filterNode = this.ctx.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.setValueAtTime(260, this.ctx.currentTime); // Low pass filter
        this.filterNode.Q.setValueAtTime(2.0, this.ctx.currentTime);

        // 2. LFO to modulate filter cutoff slowly (simulating breath/wind)
        this.lfoNode = this.ctx.createOscillator();
        this.lfoNode.frequency.setValueAtTime(0.08, this.ctx.currentTime); // 0.08 Hz (very slow)
        
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(80, this.ctx.currentTime); // sweep amplitude (cutoff +/- 80Hz)

        this.lfoNode.connect(lfoGain);
        lfoGain.connect(this.filterNode.frequency);

        // 3. Two detuned saw oscillators for a rich, warm chorused drone
        // A2 = 110Hz
        this.droneOsc1 = this.ctx.createOscillator();
        this.droneOsc1.type = 'sawtooth';
        this.droneOsc1.frequency.setValueAtTime(110, this.ctx.currentTime);
        this.droneOsc1.detune.setValueAtTime(-6, this.ctx.currentTime);

        this.droneOsc2 = this.ctx.createOscillator();
        this.droneOsc2.type = 'sawtooth';
        this.droneOsc2.frequency.setValueAtTime(110.3, this.ctx.currentTime);
        this.droneOsc2.detune.setValueAtTime(6, this.ctx.currentTime);

        // 4. Volume controller
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.setValueAtTime(0, this.ctx.currentTime); // Start silent

        // 5. Connect the chain
        this.droneOsc1.connect(this.filterNode);
        this.droneOsc2.connect(this.filterNode);
        this.filterNode.connect(this.ambientGain);
        this.ambientGain.connect(this.ctx.destination);

        // 6. Start the generators
        this.droneOsc1.start(0);
        this.droneOsc2.start(0);
        this.lfoNode.start(0);
    }

    /**
     * Start/Stop the ambient drone.
     */
    toggleMute() {
        this.init();
        
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.isMuted = !this.isMuted;
        
        if (this.ambientGain) {
            const targetGain = this.isMuted ? 0 : 0.15; // Soft ambient volume
            this.ambientGain.gain.linearRampToValueAtTime(targetGain, this.ctx.currentTime + 1.2);
        }

        return this.isMuted;
    }

    /**
     * Play a clean, modern click sound.
     */
    playClick() {
        if (!this.ctx || this.isMuted) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1000, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);
    }

    /**
     * Play an inventory pickup swoop sound.
     */
    playPickup() {
        if (!this.ctx || this.isMuted) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(780, this.ctx.currentTime + 0.22);

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.23);
    }

    /**
     * Play an error buzzer sound.
     */
    playError() {
        if (!this.ctx || this.isMuted) return;

        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(130, this.ctx.currentTime);
        
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(134, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(this.ctx.currentTime + 0.26);
        osc2.stop(this.ctx.currentTime + 0.26);
    }

    /**
     * Play a crystal sequence tone for Simon Says memory game.
     * @param {number} pitchIndex - 0, 1, 2, or 3
     */
    playCrystalTone(pitchIndex) {
        if (!this.ctx || this.isMuted) return;

        // Pentatonic Scale: C4(261.63), Eb4(311.13), F4(349.23), G4(392.00)
        const pitches = [261.63, 311.13, 349.23, 392.00];
        const pitch = pitches[pitchIndex] || 261.63;

        const osc = this.ctx.createOscillator();
        const subOsc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitch, this.ctx.currentTime);
        
        // Add a gentle sub-harmonic
        subOsc.type = 'triangle';
        subOsc.frequency.setValueAtTime(pitch / 2, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.65);

        osc.connect(gain);
        subOsc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        subOsc.start();
        osc.stop(this.ctx.currentTime + 0.7);
        subOsc.stop(this.ctx.currentTime + 0.7);
    }

    /**
     * Play an unlock / door opens mech sound.
     */
    playUnlock() {
        if (!this.ctx || this.isMuted) return;

        const now = this.ctx.currentTime;
        
        // Play mechanical click sequence
        for (let i = 0; i < 3; i++) {
            const time = now + (i * 0.1);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'square';
            osc.frequency.setValueAtTime(300 - (i * 60), time);
            
            gain.gain.setValueAtTime(0.08, time);
            gain.gain.exponentialRampToValueAtTime(0.005, time + 0.05);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(time);
            osc.stop(time + 0.06);
        }

        // Play positive tone release
        setTimeout(() => {
            if (this.isMuted) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
            osc.frequency.exponentialRampToValueAtTime(1046.5, this.ctx.currentTime + 0.35); // C6
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.45);
        }, 300);
    }

    /**
     * Play the final victory arpeggio cascade.
     */
    playVictory() {
        if (!this.ctx || this.isMuted) return;

        const now = this.ctx.currentTime;
        // Pentatonic sweep: C4, Eb4, F4, G4, Bb4, C5, Eb5, G5...
        const chord = [261.63, 311.13, 349.23, 392.00, 466.16, 523.25, 622.25, 783.99, 1046.50];

        chord.forEach((freq, index) => {
            const time = now + (index * 0.08);
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, time);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2000, time);
            filter.frequency.exponentialRampToValueAtTime(500, time + 0.5);

            gain.gain.setValueAtTime(0.15, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(time);
            osc.stop(time + 0.7);
        });
    }

    /**
     * Plays a brief transition pulse when entering a new chamber.
     */
    playChamberTransition() {
        if (!this.ctx || this.isMuted) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(220, this.ctx.currentTime + 0.6);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.7);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.8);
    }
}

// Instantiate global audio manager
const audioManager = new AudioManager();
window.audioManager = audioManager; // Make globally accessible
