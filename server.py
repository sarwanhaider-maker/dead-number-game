import asyncio
import json
import random
import time
import websockets
from websockets.protocol import State

PORT = 8765

# Map of room_id -> roomState dictionary
rooms = {}

def get_turn_duration(difficulty):
    if difficulty == 'easy':
        return 7.0
    if difficulty == 'medium':
        return 5.0
    if difficulty == 'hard':
        return 3.0
    return 5.0  # Default for PvP

async def broadcast_state(room, event_stage='update', extra_data=None):
    if extra_data is None:
        extra_data = {}
        
    payload = json.dumps({
        'type': 'STATE_UPDATE',
        'eventStage': event_stage,
        'room': {
            'roomId': room['id'],
            'deadNumber': room['deadNumber'],
            'currentTotal': room['currentTotal'],
            'currentTurn': room['currentTurn'],
            'isGameOver': room['isGameOver'],
            'history': room['history'],
            'turnTimer': room['turnTimer'],
            'hostName': room['hostName'],
            'challengerName': room['challengerName'],
            'difficulty': room['difficulty']
        },
        **extra_data
    })

    # Broadcast to both players
    sockets_to_send = []
    if room['hostSocket'] and room['hostSocket'].state == State.OPEN:
        sockets_to_send.append(room['hostSocket'])
    if room['challengerSocket'] and room['challengerSocket'].state == State.OPEN:
        sockets_to_send.append(room['challengerSocket'])
        
    if sockets_to_send:
        await asyncio.gather(*(ws.send(payload) for ws in sockets_to_send), return_exceptions=True)

async def send_error(ws, message):
    if ws and ws.state == State.OPEN:
        await ws.send(json.dumps({'type': 'ERROR', 'message': message}))

async def handle_timeout(room):
    if room['isGameOver']:
        return

    # Force +1 move penalty
    min_val = room['currentTotal'] + 1
    target_val = min(min_val, room['deadNumber'])
    addition = target_val - room['currentTotal']

    active_name = room['hostName'] if room['currentTurn'] == 'player' else room['challengerName']
    log_text = f"[TIMEOUT] {active_name} selected: {target_val} (+{addition})"
    
    room['currentTotal'] = target_val
    room['history'].append(log_text)

    if room['currentTotal'] >= room['deadNumber']:
        room['isGameOver'] = True
        loser = room['currentTurn']
        winner = 'opponent' if loser == 'player' else 'player'
        await broadcast_state(room, 'game-over', {'winner': winner})
        return

    # Swap turn and reset timer
    room['currentTurn'] = 'opponent' if room['currentTurn'] == 'player' else 'player'
    room['turnTimer'] = get_turn_duration(room['difficulty'])
    
    await broadcast_state(room, 'update-turn')
    # Start timer loop again
    asyncio.create_task(run_room_timer(room))

async def run_room_timer(room):
    # Cancel any existing timer task
    if room['timerTask'] and not room['timerTask'].done():
        room['timerTask'].cancel()

    room['timerTask'] = asyncio.current_task()
    tick_rate = 0.1  # 100ms ticks

    try:
        while not room['isGameOver'] and room['turnTimer'] > 0:
            await asyncio.sleep(tick_rate)
            room['turnTimer'] = max(0.0, room['turnTimer'] - tick_rate)
            
            # Broadcast tick once per second to correct client sync drift
            if round(room['turnTimer'] * 10) % 10 == 0:
                await broadcast_state(room, 'timer-tick')
                
        if room['turnTimer'] <= 0 and not room['isGameOver']:
            await handle_timeout(room)
            
    except asyncio.CancelledError:
        # Task was cancelled due to a valid player move
        pass

async def handler(websocket):
    print("[Server] Client connected.")
    current_room_id = None
    is_host_connection = False

    try:
        async for message in websocket:
            data = json.loads(message)
            action_type = data.get('type')

            if action_type == 'CREATE_ROOM':
                host_name = data.get('hostName', 'Host')
                dead_number = int(data.get('deadNumber', 25))
                difficulty = data.get('difficulty', 'hard')
                first_turn = data.get('firstTurn', 'player')

                # Generate unique 4-digit code
                code = str(random.randint(1000, 9999))
                while code in rooms:
                    code = str(random.randint(1000, 9999))

                room = {
                    'id': code,
                    'hostSocket': websocket,
                    'challengerSocket': None,
                    'hostName': host_name,
                    'challengerName': 'Challenger',
                    'deadNumber': dead_number,
                    'currentTotal': 0,
                    'currentTurn': 'player' if first_turn == 'player' else 'opponent',
                    'isGameOver': False,
                    'history': [],
                    'difficulty': difficulty,
                    'firstTurn': first_turn,
                    'turnTimer': get_turn_duration(difficulty),
                    'timerTask': None,
                    'lastActiveTime': time.time()
                }

                rooms[code] = room
                current_room_id = code
                is_host_connection = True

                await websocket.send(json.dumps({
                    'type': 'ROOM_CREATED',
                    'roomId': code
                }))
                print(f"[Server] Room {code} created by {host_name}. Difficulty: {difficulty}.")

            elif action_type == 'JOIN_ROOM':
                code = data.get('roomId')
                player_name = data.get('playerName', 'Challenger')

                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                if room['challengerSocket'] is not None:
                    await send_error(websocket, 'Room is already full.')
                    continue

                room['challengerSocket'] = websocket
                room['challengerName'] = player_name
                current_room_id = code
                is_host_connection = False
                room['lastActiveTime'] = time.time()

                await broadcast_state(room, 'lobby-ready')
                print(f"[Server] Challenger {player_name} joined Room {code}.")

            elif action_type == 'START_GAME':
                code = current_room_id
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                if not is_host_connection:
                    await send_error(websocket, 'Only the host can start the game.')
                    continue

                room['currentTotal'] = 0
                room['isGameOver'] = False
                room['history'] = []
                room['currentTurn'] = 'player' if room['firstTurn'] == 'player' else 'opponent'
                room['turnTimer'] = get_turn_duration(room['difficulty'])
                room['lastActiveTime'] = time.time()

                await broadcast_state(room, 'start-game')
                print(f"[Server] Game started in Room {code}.")

                # Cancel previous timer loop if any
                if room['timerTask'] and not room['timerTask'].done():
                    room['timerTask'].cancel()

                # Start authoritative countdown task after 1.2s delay (allows loading state rendering)
                async def delayed_start(r):
                    await asyncio.sleep(1.2)
                    asyncio.create_task(run_room_timer(r))
                asyncio.create_task(delayed_start(room))

            elif action_type == 'PLAY_MOVE':
                code = current_room_id
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                if room['isGameOver']:
                    await send_error(websocket, 'Game is already over.')
                    continue

                # Authoritative turn validation
                is_host_turn = room['currentTurn'] == 'player'
                if is_host_connection != is_host_turn:
                    await send_error(websocket, 'It is not your turn.')
                    continue

                selected_val = int(data.get('value', 0))
                addition = selected_val - room['currentTotal']

                # Authoritative selection bounds checking
                if addition < 1 or addition > 4 or selected_val > room['deadNumber']:
                    await send_error(websocket, 'Invalid move selection.')
                    continue

                # Cancel timer task
                if room['timerTask'] and not room['timerTask'].done():
                    room['timerTask'].cancel()

                # Update states
                room['currentTotal'] = selected_val
                room['lastActiveTime'] = time.time()

                active_name = room['hostName'] if is_host_connection else room['challengerName']
                log_text = f"{active_name} selected: {selected_val} (+{addition})"
                room['history'].append(log_text)

                if room['currentTotal'] >= room['deadNumber']:
                    room['isGameOver'] = True
                    loser = room['currentTurn']
                    winner = 'opponent' if loser == 'player' else 'player'
                    await broadcast_state(room, 'game-over', {'winner': winner})
                    print(f"[Server] Game over in Room {code}. Winner: {winner}.")
                    continue

                # Swap turn and reset timer
                room['currentTurn'] = 'opponent' if room['currentTurn'] == 'player' else 'player'
                room['turnTimer'] = get_turn_duration(room['difficulty'])

                await broadcast_state(room, 'update-turn')
                asyncio.create_task(run_room_timer(room))

            elif action_type == 'UPDATE_CONFIG':
                code = current_room_id
                if code in rooms:
                    room = rooms[code]
                    if is_host_connection:
                        room['deadNumber'] = int(data.get('deadNumber', 25))
                        await broadcast_state(room, 'update-config')

            elif action_type == 'RESET_LOBBY':
                code = current_room_id
                if code in rooms:
                    room = rooms[code]
                    room['currentTotal'] = 0
                    room['isGameOver'] = False
                    room['history'] = []
                    room['turnTimer'] = get_turn_duration(room['difficulty'])
                    if room['timerTask'] and not room['timerTask'].done():
                        room['timerTask'].cancel()
                    await broadcast_state(room, 'lobby-ready')

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print("[Server] Client disconnected.")
        if current_room_id in rooms:
            room = rooms[current_room_id]
            # Cancel timer
            if room['timerTask'] and not room['timerTask'].done():
                room['timerTask'].cancel()

            remainder = room['challengerSocket'] if is_host_connection else room['hostSocket']
            if remainder and remainder.state == State.OPEN:
                try:
                    await remainder.send(json.dumps({
                        'type': 'OPPONENT_DISCONNECTED',
                        'message': 'Opponent disconnected. Connection severed.'
                    }))
                except Exception:
                    pass
            # Remove room
            rooms.pop(current_room_id, None)
            print(f"[Server] Room {current_room_id} cleaned up due to player disconnection.")

async def main():
    async with websockets.serve(handler, "0.0.0.0", PORT):
        print("=======================================================")
        print(f" Authoritative Python WebSocket Server running on port {PORT}")
        print("=======================================================")
        await asyncio.Future()  # keep server running

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Server] Shutdown complete.")
