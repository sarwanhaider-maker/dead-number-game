/**
 * Bigg Boss Multiplayer Network Layer
 * Implements a client-server architecture over public WebSockets via MQTT.
 */

const BiggBossNetwork = {
    client: null,
    roomId: null,
    isHost: false,
    clientId: 'p_' + Math.random().toString(36).substr(2, 9),
    playerName: '',
    connected: false,
    
    // Callbacks to be hooked by other modules (e.g., ui.js, multiplayer.js)
    onConnectionChange: null, // (connected, message)
    onStateReceived: null,    // (gameState) - Called on clients when Host sends state
    onClientEvent: null,      // (clientId, eventType, data) - Called on Host when Client sends action
    
    /**
     * Connect to the public MQTT broker
     */
    connect(callback) {
        if (this.client && this.connected) {
            if (callback) callback(true);
            return;
        }
        
        // We use HiveMQ public secure websocket broker
        const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
        
        console.log(`Connecting to MQTT broker: ${brokerUrl}`);
        if (this.onConnectionChange) this.onConnectionChange(false, 'Connecting...');
        
        try {
            this.client = mqtt.connect(brokerUrl, {
                keepalive: 60,
                clientId: 'bb_game_' + this.clientId,
                protocolId: 'MQTT',
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 1000,
                connectTimeout: 30 * 1000,
            });
            
            this.client.on('connect', () => {
                console.log('Connected to MQTT Broker.');
                this.connected = true;
                if (this.onConnectionChange) this.onConnectionChange(true, 'Connected');
                if (callback) callback(true);
            });
            
            this.client.on('close', () => {
                console.log('MQTT Connection closed.');
                this.connected = false;
                if (this.onConnectionChange) this.onConnectionChange(false, 'Disconnected');
            });
            
            this.client.on('error', (err) => {
                console.error('MQTT Error: ', err);
                this.connected = false;
                if (this.onConnectionChange) this.onConnectionChange(false, 'Error: ' + err.message);
                if (callback) callback(false, err);
            });
            
            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message.toString());
            });
            
        } catch (e) {
            console.error('Connection failed: ', e);
            this.connected = false;
            if (this.onConnectionChange) this.onConnectionChange(false, 'Error: ' + e.message);
            if (callback) callback(false, e);
        }
    },
    
    /**
     * Create a room (Host behavior)
     */
    createRoom(callback) {
        this.connect((success) => {
            if (!success) {
                if (callback) callback(false, 'Failed to connect to network broker');
                return;
            }
            
            // Generate 4-digit code
            this.roomId = Math.floor(1000 + Math.random() * 9000).toString();
            this.isHost = true;
            this.playerName = 'Bigg Boss Host';
            
            // Host subscribes to client actions
            const clientActionsTopic = `biggboss/room/${this.roomId}/client/+`;
            this.client.subscribe(clientActionsTopic, (err) => {
                if (err) {
                    console.error('Subscription error: ', err);
                    if (callback) callback(false, 'Subscription failed');
                } else {
                    console.log(`Room created: ${this.roomId}. Subscribed to ${clientActionsTopic}`);
                    if (callback) callback(true, this.roomId);
                }
            });
        });
    },
    
    /**
     * Join a room (Client behavior)
     */
    joinRoom(roomId, playerName, callback) {
        this.connect((success) => {
            if (!success) {
                if (callback) callback(false, 'Failed to connect to network broker');
                return;
            }
            
            this.roomId = roomId;
            this.isHost = false;
            this.playerName = playerName;
            
            // Client subscribes to the host's room state
            const stateTopic = `biggboss/room/${this.roomId}/state`;
            this.client.subscribe(stateTopic, (err) => {
                if (err) {
                    console.error('Subscription error: ', err);
                    if (callback) callback(false, 'Failed to subscribe to room updates');
                } else {
                    console.log(`Joined Room: ${this.roomId}. Subscribed to ${stateTopic}`);
                    
                    // Immediately send a join request to host
                    this.sendAction('JOIN', {
                        clientId: this.clientId,
                        name: this.playerName
                    });
                    
                    if (callback) callback(true);
                }
            });
        });
    },
    
    /**
     * Host broadcasts the global game state to all players
     */
    broadcastState(state) {
        if (!this.isHost || !this.client || !this.connected) return;
        const topic = `biggboss/room/${this.roomId}/state`;
        const payload = JSON.stringify(state);
        this.client.publish(topic, payload, { qos: 0, retain: false });
    },
    
    /**
     * Client sends an action to the host
     */
    sendAction(actionType, data = {}) {
        if (!this.client || !this.connected) return;
        const topic = `biggboss/room/${this.roomId}/client/${this.clientId}`;
        const payload = JSON.stringify({
            clientId: this.clientId,
            action: actionType,
            data: data,
            timestamp: Date.now()
        });
        this.client.publish(topic, payload, { qos: 0 });
    },
    
    /**
     * Handle incoming MQTT message
     */
    handleMessage(topic, payloadString) {
        try {
            const data = JSON.parse(payloadString);
            
            if (this.isHost) {
                // Host processes client events
                // Topic format: biggboss/room/{RoomId}/client/{clientId}
                const parts = topic.split('/');
                const senderClientId = parts[parts.length - 1];
                
                // Do not process messages sent by ourselves if we happen to subscribe to them
                if (senderClientId === this.clientId) return;
                
                if (this.onClientEvent) {
                    this.onClientEvent(senderClientId, data.action, data.data);
                }
            } else {
                // Client processes host state updates
                // Topic format: biggboss/room/{RoomId}/state
                if (topic.endsWith('/state')) {
                    if (this.onStateReceived) {
                        this.onStateReceived(data);
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing MQTT message: ', e, 'Payload:', payloadString);
        }
    },
    
    /**
     * Disconnect and clean up
     */
    disconnect() {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
        this.connected = false;
        this.roomId = null;
        this.isHost = false;
    }
};
window.BiggBossNetwork = BiggBossNetwork;
