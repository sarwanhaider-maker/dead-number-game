import asyncio
import json
import random
import time
import websockets
from websockets.protocol import State

PORT = 8765

# Map of room_id -> roomState dictionary
rooms = {}

# Global matchmaking queue
matchmaking_queue = []

def get_turn_duration(difficulty):
    return 4.0  # PvP matches always have a 4.0s turn timer

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
            'difficulty': room['difficulty'],
            'hostWins': room.get('hostWins', 0),
            'challengerWins': room.get('challengerWins', 0)
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

async def broadcast_draft_state(room):
    payload = json.dumps({
        'type': 'DRAFT_UPDATE',
        'room': {
            'roomId': room['id'],
            'deadNumber': room['deadNumber'],
            'selectionTurn': room['selectionTurn'],
            'draftTimer': room['draftTimer'],
            'isDraftActive': room['isDraftActive'],
            'hostName': room['hostName'],
            'challengerName': room['challengerName'],
            'hostWins': room.get('hostWins', 0),
            'challengerWins': room.get('challengerWins', 0)
        }
    })
    
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
        
        if winner == 'player':
            room['hostWins'] = room.get('hostWins', 0) + 1
        else:
            room['challengerWins'] = room.get('challengerWins', 0) + 1
            
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

async def run_draft_timer(room):
    if room.get('draftTask') and not room['draftTask'].done():
        room['draftTask'].cancel()
        
    room['draftTask'] = asyncio.current_task()
    tick_rate = 0.1
    
    try:
        while room.get('isDraftActive') and room.get('draftTimer', 0) > 0:
            await asyncio.sleep(tick_rate)
            room['draftTimer'] = max(0.0, room['draftTimer'] - tick_rate)
            await broadcast_draft_state(room)
            
        if room.get('draftTimer', 0) <= 0 and room.get('isDraftActive'):
            await handle_draft_timeout(room)
    except asyncio.CancelledError:
        pass

async def handle_draft_timeout(room):
    if room.get('selectionTurn') == 'host':
        room['selectionTurn'] = 'challenger'
        room['draftTimer'] = 10.0
        print(f"[Server] Room {room['id']} draft timeout for Host. Switching to Challenger.")
        await broadcast_draft_state(room)
        asyncio.create_task(run_draft_timer(room))
    else:
        room['isDraftActive'] = False
        print(f"[Server] Room {room['id']} draft timeout for Challenger. Force starting game with {room['deadNumber']}.")
        await start_game_pvp(room)

async def start_game_pvp(room):
    room['isDraftActive'] = False
    if room.get('draftTask') and not room['draftTask'].done():
        room['draftTask'].cancel()
        
    room['currentTotal'] = 0
    room['isGameOver'] = False
    room['history'] = []
    room['currentTurn'] = 'player' # Host starts
    room['turnTimer'] = get_turn_duration(room['difficulty'])
    room['lastActiveTime'] = time.time()
    
    await broadcast_state(room, 'start-game')
    print(f"[Server] PvP game started in Room {room['id']}. Dead Number: {room['deadNumber']}. First turn: Host.")
    
    async def delayed_start(r):
        await asyncio.sleep(1.2)
        asyncio.create_task(run_room_timer(r))
    asyncio.create_task(delayed_start(room))

async def handler(websocket):
    global matchmaking_queue
    print("[Server] Client connected.")
    
    websocket.current_room_id = None
    websocket.is_host_connection = False

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
                    'lastActiveTime': time.time(),
                    'hostWins': 0,
                    'challengerWins': 0,
                    'isQuickMatch': False
                }

                rooms[code] = room
                websocket.current_room_id = code
                websocket.is_host_connection = True

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
                websocket.current_room_id = code
                websocket.is_host_connection = False
                room['lastActiveTime'] = time.time()

                await broadcast_state(room, 'lobby-ready')
                print(f"[Server] Challenger {player_name} joined Room {code}.")

            elif action_type == 'START_GAME':
                code = getattr(websocket, 'current_room_id', None)
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                is_host = (websocket == room['hostSocket'])
                if not is_host:
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

                # Start authoritative countdown task after 1.2s delay
                async def delayed_start(r):
                    await asyncio.sleep(1.2)
                    asyncio.create_task(run_room_timer(r))
                asyncio.create_task(delayed_start(room))

            elif action_type == 'PLAY_MOVE':
                code = getattr(websocket, 'current_room_id', None)
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                if room['isGameOver']:
                    await send_error(websocket, 'Game is already over.')
                    continue

                # Authoritative turn validation
                is_host_turn = room['currentTurn'] == 'player'
                is_host = (websocket == room['hostSocket'])
                if is_host != is_host_turn:
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

                active_name = room['hostName'] if is_host else room['challengerName']
                log_text = f"{active_name} selected: {selected_val} (+{addition})"
                room['history'].append(log_text)

                if room['currentTotal'] >= room['deadNumber']:
                    room['isGameOver'] = True
                    loser = room['currentTurn']
                    winner = 'opponent' if loser == 'player' else 'player'
                    
                    if winner == 'player':
                        room['hostWins'] = room.get('hostWins', 0) + 1
                    else:
                        room['challengerWins'] = room.get('challengerWins', 0) + 1
                        
                    await broadcast_state(room, 'game-over', {'winner': winner})
                    print(f"[Server] Game over in Room {code}. Winner: {winner}.")
                    continue

                # Swap turn and reset timer
                room['currentTurn'] = 'opponent' if room['currentTurn'] == 'player' else 'player'
                room['turnTimer'] = get_turn_duration(room['difficulty'])

                await broadcast_state(room, 'update-turn')
                asyncio.create_task(run_room_timer(room))

            elif action_type == 'UPDATE_CONFIG':
                code = getattr(websocket, 'current_room_id', None)
                if code in rooms:
                    room = rooms[code]
                    is_host_turn = room.get('selectionTurn') == 'host' if room.get('isDraftActive') else True
                    is_host = (websocket == room['hostSocket'])
                    if is_host == is_host_turn:
                        room['deadNumber'] = int(data.get('deadNumber', 25))
                        if room.get('isDraftActive'):
                            await broadcast_draft_state(room)
                        else:
                            await broadcast_state(room, 'update-config')

            elif action_type == 'CONFIRM_CONFIG':
                code = getattr(websocket, 'current_room_id', None)
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                if not room.get('isDraftActive'):
                    continue

                # Only active selector can confirm
                is_host_turn = room.get('selectionTurn') == 'host'
                is_host = (websocket == room['hostSocket'])
                if is_host != is_host_turn:
                    await send_error(websocket, 'It is not your turn to confirm.')
                    continue

                dead_num = int(data.get('deadNumber', 25))
                if dead_num < 20 or dead_num > 100:
                    await send_error(websocket, 'Invalid Dead Number selection.')
                    continue

                room['deadNumber'] = dead_num
                print(f"[Server] Room {code} parameters confirmed. Starting match with Dead Number {dead_num}.")
                await start_game_pvp(room)

            elif action_type == 'RESET_LOBBY':
                code = getattr(websocket, 'current_room_id', None)
                if code in rooms:
                    room = rooms[code]
                    room['currentTotal'] = 0
                    room['isGameOver'] = False
                    room['history'] = []
                    room['turnTimer'] = get_turn_duration(room['difficulty'])
                    if room['timerTask'] and not room['timerTask'].done():
                        room['timerTask'].cancel()
                    await broadcast_state(room, 'lobby-ready')

            elif action_type == 'JOIN_QUICK_MATCH':
                player_name = data.get('playerName', 'Challenger')
                if websocket in matchmaking_queue:
                    continue

                print(f"[Server] Player {player_name} joined matchmaking queue.")

                if len(matchmaking_queue) > 0:
                    host_socket = matchmaking_queue.pop(0)

                    if host_socket.state != State.OPEN:
                        matchmaking_queue.append(websocket)
                        await websocket.send(json.dumps({'type': 'WAITING_FOR_OPPONENT'}))
                        continue

                    code = str(random.randint(1000, 9999))
                    while code in rooms:
                        code = str(random.randint(1000, 9999))

                    host_name = getattr(host_socket, 'playerName', 'Host')

                    room = {
                        'id': code,
                        'hostSocket': host_socket,
                        'challengerSocket': websocket,
                        'hostName': host_name,
                        'challengerName': player_name,
                        'deadNumber': 25,
                        'currentTotal': 0,
                        'currentTurn': 'player',
                        'isGameOver': False,
                        'history': [],
                        'difficulty': 'hard',
                        'firstTurn': 'player',
                        'turnTimer': get_turn_duration('hard'),
                        'timerTask': None,
                        'lastActiveTime': time.time(),
                        'selectionTurn': 'host',
                        'draftTimer': 10.0,
                        'isDraftActive': True,
                        'draftTask': None,
                        'hostWins': 0,
                        'challengerWins': 0,
                        'isQuickMatch': True
                    }

                    rooms[code] = room
                    websocket.current_room_id = code
                    websocket.is_host_connection = False

                    host_socket.current_room_id = code
                    host_socket.is_host_connection = True

                    await host_socket.send(json.dumps({
                        'type': 'ROLE_ASSIGNMENT',
                        'isHost': True,
                        'roomId': code
                    }))
                    await websocket.send(json.dumps({
                        'type': 'ROLE_ASSIGNMENT',
                        'isHost': False,
                        'roomId': code
                    }))

                    await broadcast_draft_state(room)
                    print(f"[Server] Quick Match paired. Starting 10s draft in Room {code}: {host_name} vs {player_name}.")
                    asyncio.create_task(run_draft_timer(room))
                else:
                    websocket.playerName = player_name
                    matchmaking_queue.append(websocket)
                    await websocket.send(json.dumps({'type': 'WAITING_FOR_OPPONENT'}))

            elif action_type == 'LEAVE_QUICK_MATCH':
                if websocket in matchmaking_queue:
                    matchmaking_queue.remove(websocket)
                    print("[Server] Player left matchmaking queue.")

            elif action_type == 'PLAY_AGAIN_REQUEST':
                code = getattr(websocket, 'current_room_id', None)
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                is_host = (websocket == room['hostSocket'])
                opponent = room['challengerSocket'] if is_host else room['hostSocket']
                if not opponent or opponent.state != State.OPEN:
                    await send_error(websocket, 'Opponent is no longer connected.')
                    continue

                room['playAgainRequester'] = websocket
                await opponent.send(json.dumps({'type': 'PLAY_AGAIN_OFFERED'}))
                print(f"[Server] Rematch requested in Room {code} by {'Host' if is_host else 'Challenger'}.")

            elif action_type == 'PLAY_AGAIN_RESPONSE':
                code = getattr(websocket, 'current_room_id', None)
                if code not in rooms:
                    await send_error(websocket, 'Room not found.')
                    continue

                room = rooms[code]
                requester = room.get('playAgainRequester')
                accept = bool(data.get('accept', False))

                if not requester or requester.state != State.OPEN:
                    await send_error(websocket, 'Rematch requester is no longer connected.')
                    room['playAgainRequester'] = None
                    continue

                if accept:
                    print(f"[Server] Rematch accepted in Room {code}. Swapping roles...")

                    # Swap sockets, names, wins
                    temp_socket = room['hostSocket']
                    room['hostSocket'] = room['challengerSocket']
                    room['challengerSocket'] = temp_socket

                    temp_name = room['hostName']
                    room['hostName'] = room['challengerName']
                    room['challengerName'] = temp_name

                    temp_wins = room.get('hostWins', 0)
                    room['hostWins'] = room.get('challengerWins', 0)
                    room['challengerWins'] = temp_wins

                    # Update role properties
                    room['hostSocket'].is_host_connection = True
                    room['challengerSocket'].is_host_connection = False

                    # Symmetrical ROLE_ASSIGNMENTS
                    await room['hostSocket'].send(json.dumps({
                        'type': 'ROLE_ASSIGNMENT',
                        'isHost': True,
                        'roomId': code
                    }))
                    await room['challengerSocket'].send(json.dumps({
                        'type': 'ROLE_ASSIGNMENT',
                        'isHost': False,
                        'roomId': code
                    }))

                    # Reset states
                    room['currentTotal'] = 0
                    room['isGameOver'] = False
                    room['history'] = []
                    room['turnTimer'] = get_turn_duration(room['difficulty'])

                    if room['timerTask'] and not room['timerTask'].done():
                        room['timerTask'].cancel()
                    if room.get('draftTask') and not room['draftTask'].done():
                        room['draftTask'].cancel()

                    room['playAgainRequester'] = None

                    if room.get('isQuickMatch'):
                        room['selectionTurn'] = 'host'
                        room['draftTimer'] = 10.0
                        room['isDraftActive'] = True
                        await broadcast_draft_state(room)
                        asyncio.create_task(run_draft_timer(room))
                    else:
                        await broadcast_state(room, 'lobby-ready')
                else:
                    print(f"[Server] Rematch declined in Room {code}.")
                    await requester.send(json.dumps({'type': 'PLAY_AGAIN_REJECTED'}))
                    room['playAgainRequester'] = None

            elif action_type == 'PLAY_AGAIN_CANCEL':
                code = getattr(websocket, 'current_room_id', None)
                if code in rooms:
                    room = rooms[code]
                    if room.get('playAgainRequester') == websocket:
                        is_host = (websocket == room['hostSocket'])
                        opponent = room['challengerSocket'] if is_host else room['hostSocket']
                        if opponent and opponent.state == State.OPEN:
                            await opponent.send(json.dumps({'type': 'PLAY_AGAIN_CANCELLED'}))
                        room['playAgainRequester'] = None
                        print(f"[Server] Rematch request cancelled in Room {code}.")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print("[Server] Client disconnected.")
        if websocket in matchmaking_queue:
            matchmaking_queue.remove(websocket)

        code = getattr(websocket, 'current_room_id', None)
        if code and code in rooms:
            room = rooms[code]
            if room['timerTask'] and not room['timerTask'].done():
                room['timerTask'].cancel()
            if room.get('draftTask') and not room['draftTask'].done():
                room['draftTask'].cancel()

            is_host = (websocket == room['hostSocket'])
            remainder = room['challengerSocket'] if is_host else room['hostSocket']
            if remainder and remainder.state == State.OPEN:
                try:
                    await remainder.send(json.dumps({
                        'type': 'OPPONENT_DISCONNECTED',
                        'message': 'Opponent disconnected. Connection severed.'
                    }))
                except Exception:
                    pass
            rooms.pop(code, None)
            print(f"[Server] Room {code} cleaned up due to player disconnection.")

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
