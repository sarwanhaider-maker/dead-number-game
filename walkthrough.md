# Walkthrough: desync fixes, Numpuz Convert & Gamification Expansion

We have successfully resolved desynchronization bugs, updated the design system to match **Numpuz**, and integrated a gamification layer (Coin Economy, Daily Rewards, PvP Ranked Badges, Global Leaderboards, and Bot Mode Lifelines).

---

## Part 1: PvP Synchronization & Freeze Bug Fixes

### 1. Fixed Turn Initialization (`js/dead_number.js`)
* **Problem:** When a game started, the Challenger's screen reset `this.currentTurn` to the local default `'player'`, ignoring the turn broadcasted by the Host.
* **Fix:** Modified `startGame()` so that if the mode is `'pvp'`, the Challenger retains the `currentTurn` value set from the Host's broadcast rather than overwriting it.

### 2. Challenger Timer Leaks (`js/dead_number.js`)
* **Problem:** On the Challenger's screen, making a choice sent a network message to the Host, but the Challenger's local 5-second timer was never cleared, triggering desynced timeout turns.
* **Fix:** Added `clearInterval(this.timerInterval)` to the choice click listener for the Challenger, clearing their turn timer immediately upon playing, and disabled buttons on timeout transit.

### 3. Symmetrical Log Entry Names and Styles (`js/dead_number.js`)
* **Problem:** History logs generated `"You selected..."` on the Host's machine and sent the exact string to the Challenger, leading to desynced labels.
* **Fix:** Updated `selectNumber()` to use absolute player names (e.g. `"Host"` or `"Eyshaa"`) instead of `"You"` inside the history array. Modified `syncHistoryLog()` to dynamically style log entries based on player/opponent names.

---

## Part 2: Numpuz Visual Theme Conversion

We updated the visual layout, typography, and interactive feedback in `css/dead_number.css` to emulate the popular slide-puzzle game Numpuz:

* **Warm Cream Canvas:** Replaced dark backdrops with a warm cream background (`#fbf9e6`).
* **Tactile 3D Buttons (`.btn-choice`):** Colored the selection buttons in solid Numpuz teal (`#1ba0aa`) with a deep bottom border (`border-bottom: 4px solid #147a82`). On click, they depress downward by `2px` and flatten.
* **Friendly Typography:** Used the friendly rounded Outfit sans-serif typeface.

---

## Part 3: Gamification Layer & Lifelines

### 1. Coin Economy Integration
* **Dueling Rewards:** Players now earn **+50 Coins** on Bot wins and **+100 Coins** on PvP wins.
* **Persistent Wallet:** Current coin balance is displayed in real-time in both the setup lobby header and the active arena HUD. Coins persist in `localStorage`.

### 2. Daily Claim Countdown
* **Daily Bonus:** Players can claim a **+100 Coins** reward every 24 hours.
* **Cooldown Clock:** Clicking "Claim" shifts the button to a live countdown timer showing the remaining time (`Next: HH:MM:SS`).

### 3. Ranked Badges & Mock Leaderboard
* **Rank Up Badge:** Displays ranked titles based on PvP win thresholds:
  * **0-2 wins:** Bronze Evader
  * **3-5 wins:** Silver Survivor
  * **6-9 wins:** Gold Tactician
  * **10-14 wins:** Platinum Elite
  * **15+ wins:** Nim Grandmaster
* **Global Leaderboard:** Compares player wins against static mock players ("Alex", "Jordan", "Taylor", "Morgan", "Casey") in real-time. If the player falls outside the top 5, they are appended to the bottom separated by an ellipsis (`•••`).

### 4. Bot-Mode Ad-Rewarded Lifelines
* **Emergency Buy-Time:** Displays a glowing `➕ Time (AD)` badge when the turn timer falls below 1.2 seconds. Watching a 3-second sponsor ad resets the turn timer back to 5.00 seconds. Limit: once per turn.
* **Second Chance Shield (Revive):** Captures state before the player makes a move. Hitting the Dead Number launches the Revive overlay. Agreeing to watch a 4-second ad rolls back the turn, restoring the exact previous total. Limit: once per game.

---

## Verification Results
* **Daily Claim Test:** Claiming +100 coins successfully added to the wallet and updated the button text to a ticking cooldown (`Next: 23:59:59`).
* **Buy-Time Test (vs Bot):** Clicked the lifeline button below 1.2s. The glassmorphic ad spinner overlay ran for 3 seconds, paused the game, and then resumed with the timer reset to 5.00.
* **Revive Test (vs Bot):** Hitting the dead number popped up the revive banner. Watching the ad completed a 4-second countdown, restored the score to its pre-loss state, and reset the timer so the player could retry.

---

## Part 4: Frontend Code Protection & Obfuscation

We implemented secure compile-time obfuscation for the client-side game logic:

### 1. Script Configuration Toggles (`dead_number.html`)
* Added clear development and production script tags at the bottom of the HTML file, allowing quick toggling of loaded scripts:
  * **Development Mode:** Runs clean, editable, and debuggable source code in `js/dead_number.js`.
  * **Production Mode:** Runs encrypted, obfuscated, and runtime-evaluated code in `js/dead_number.obfuscated.js`.

### 2. Byte-Level XOR Compilation Utility (`obfuscate.py`)
* Documented the custom Python-based compiler that generates the self-decrypting runtime block.
* Safe byte-level XOR encryption ensures unicode characters (like emojis `🪙`, `🏅`) compile without crashes.
* Minified variable representation (`_0x1b2c`, `_0x3d4e`, etc.) is used to hinder simple static string analysis tools.

### 3. Verification & Correctness
* **Automated Verification:** Simulating browser-level decryption using a python check confirmed that the generated obfuscated output decrypts to the exact original clean source file.
* **Runtime Verification:** Successfully checked browser evaluation and verified no gameplay regressions or runtime execution blocks exist.

### 4. Difficulty Configuration Tuning
* Modified the game engine to dynamically adjust dead number selection ranges and turn timer durations on the lobby setup screen:
  * **Easy Mode:** Restricts selection range to **20 - 50**; sets turn timer to **7.00 seconds**.
  * **Medium Mode:** Restricts selection range to **20 - 75**; sets turn timer to **5.00 seconds**.
  * **Hard Mode:** Restricts selection range to **20 - 100**; sets turn timer to **3.00 seconds**.
* Added dynamic slider range configuration: changing the difficulty immediately scales the slider range maximum and clamps the current selection to the bounds.
* Verified that selecting a difficulty updates the active countdown timer immediately when the Arena HUD initializes.

---

## Part 5: Authoritative WebSocket Multiplayer Server

We migrated the multiplayer network architecture from P2P client-authoritative MQTT to a centralized, authoritative WebSocket server system:

### 1. Authoritative Game State Engine (`server.js` / `server.py`)
* The client no longer calculates or broadcasts states. Instead, both Host and Challenger send actions (like `CREATE_ROOM`, `JOIN_ROOM`, `START_GAME`, `PLAY_MOVE`) to the server.
* The server validates turns, increments numbers, checks the dead number loss condition, and pushes state updates to both clients.
* Added native WebSocket support on port `8765`. A dual server layout is provided:
  * **[server.js](file:///c:/Users/Lenovo/Downloads/Puzzle%20Game/server.js):** Standard Node.js implementation for VPS production environments.
  * **[server.py](file:///c:/Users/Lenovo/Downloads/Puzzle%20Game/server.py):** Python 3 implementation with zero installation requirements for local development and testing.

### 2. Authoritative Timer Countdown & Timeout Enforcement
* The server controls the turn timers entirely. When a turn starts, the server counts down:
  * **Easy:** 7.0 seconds.
  * **Medium/PvP:** 5.0 seconds.
  * **Hard:** 3.0 seconds.
* If a player fails to play a move within their allotted time, the server automatically executes a $+1$ timeout penalty move, swaps turns, and broadcasts the new state, preventing clients from freezing the game.
* The client smoothly interpolates between server tick updates for rendering millisecond-precision countdowns.

### 3. Cleanup & Graceful Disconnections
* The server detects closed sockets and cleans up rooms immediately, sending an `OPPONENT_DISCONNECTED` notification to the remaining player.
* A periodic cleanup daemon removes any rooms inactive for more than 1 hour.

---

## Part 6: Production Preparedness & Remote Configuration

We updated both client and server properties to prepare for global cloud hosting and native mobile app packaging:

### 1. Dynamic Server URL Resolution (Remote Config)
* Added a remote config lookup URL (`remoteConfigUrl`) at the top of the client script.
* During initialization (`init()`), the game triggers an asynchronous background `fetch` to load the active server WebSocket URL from a remote JSON file (like a GitHub Gist).
* If the fetch succeeds, the game updates its active server target. If it fails or takes too long (timeout > 3 seconds), it gracefully falls back to the default hardcoded production URL (`wss://dead-number-server.onrender.com`).
* This allows you to migrate server companies (e.g. from Render to DigitalOcean) at any time by editing a single text file online, without needing to upload a new app update to the Google Play Store.

### 2. Render Free Tier Wake-up UI Warning
* Integrated a connection timer in the client's network layer.
* If a connection to the server takes longer than 3 seconds (which happens on Render's free tier due to inactivity sleep), the lobby status indicator updates to: `"Waking up cloud server (may take 30s)..."`.
* This warning lets players know the app is waiting for the cloud container to boot, rather than showing a generic error or frozen screen.

### 3. Symmetrical Packaged App Detection
* Added detection for Capacitor, Cordova, local `file://` protocols, and mobile user-agents running locally.
* When running inside a packaged Android app, the client automatically defaults to the production cloud URL instead of trying to look for a local dev server on the phone's loopback address (`localhost`).

### 4. Copyright Assertions
* Added a visual copyright notice to the setup screen in `dead_number.html` (`© 2026 Dead Number: The Nim Duel. All rights reserved.`).
* Verified compilation integrity via XOR obfuscation, confirming that the new network layer resolves and compiles correctly.

---

## Part 7: Matchmaking Quick Match Turn-Based Drafting System

We implemented a robust turn-based drafting phase for selecting the Dead Number in online Quick Matches:

### 1. Dynamic Role Assignments (`server.js` & `js/dead_number.js`)
* **Problem:** Host and Challenger role desync when matched automatically (skipping private lobby events).
* **Fix:** Server now sends a direct `ROLE_ASSIGNMENT` packet immediately upon pairing, assigning `isHost = true` to the first-queued player and `isHost = false` to the challenger.

### 2. Turn-Based Draft Phase & Countdown
* Match starts with a **10-second turn-based Draft Phase** to select the Dead Number (20 to 100).
* The Host gets the first draft turn. The slider `#dead-num-slider` and confirmation button `#btn-start-game` are unlocked exclusively for them. The Challenger's controls are locked, showing a status header: `WAITING FOR HOST TO SELECT...`.
* The server counts down from 10 seconds. If the Host confirms, the match starts immediately. If the Host times out, authority switches to the Challenger for 10 seconds.
* If both players time out, the server automatically starts the match at default Dead Number 25.

### 3. Production Release & Compilation
* Ran the compilation compiler `obfuscate.py` to bundle all new draft code into base64-XOR encrypted `js/dead_number.obfuscated.js`.
* Ran the automated verification script `verify_obfuscation.py` to confirm that the encrypted bundle decrypts back into the clean source code exactly, ensuring zero bundle compilation losses.

---

## Part 8: Rematch Rematch Flow & Score Board

We implemented a play-again rematch flow for online PvP matches:

### 1. Rematch Confirmation Flow
* Clicking **Play Again** in PvP mode now launches a Rematch Sent loading overlay, and transmits a `PLAY_AGAIN_REQUEST` to the server.
* The opponent receives a popup prompt asking them to **Accept Rematch** or **Decline**.
* If they accept, both players are automatically reset and sent into the lobby. If they decline, both are returned to the setup screen and disconnected.

### 2. Symmetrical Turn-Swapping
* On rematch acceptance, the server swaps the sockets, names, and win counts of both players. Symmetrical `ROLE_ASSIGNMENT` packets are broadcasted so that the previous Challenger is now the Host (getting the first gameplay and draft turn).

### 3. Rematch Series Scoreboard & TTS Voice Announcements
* Rematch wins are tracked continuously on the server (`hostWins` and `challengerWins`).
* The UI displays the score tally in the lobby and the Results Screen, dynamically labeling the series length (e.g. *Best of 3* if total games is 1-2, *Best of 5* if 3-4, *Best of 7* if 5+).
* When a rematch begins, the Text-to-Speech engine announces the series score:
  * *"Rematch started. Current score: You have X wins, Opponent has Y wins. Avoid the dead number..."*

---

## Part 9: Fix Rematch Overlay Flow Desync

We successfully resolved the bug where the "Play Again" rematch invitation popup appeared on the screen of the player requesting the rematch, but not on the opponent's screen:

### 1. Robust Server-Side Socket Checks (`server.js` & `server.py`)
* **Problem:** Connection roles were previously resolved using a dynamic socket attribute `isHostConnection` (in Node.js) and `is_host_connection` (in Python). If this attribute was unset or became falsy for the Host player, the server evaluated the Host's opponent as the Host itself. This caused the rematch request to be sent back to the Host client, displaying the Accept/Reject popup on the requester's screen, while leaving the Challenger client with nothing.
* **Fix:** Refactored all connection role-check statements to use direct reference comparison against the authoritative room variables: `ws === room.hostSocket` (Node.js) and `websocket == room['hostSocket']` (Python). Direct object identity checks are immune to attribute mutation or desync.

### 2. Client Compilation & Obfuscation
* Recompiled `js/dead_number.obfuscated.js` by running the XOR compilation compiler `obfuscate.py`.
* Ran the automated verification script `verify_obfuscation.py` to confirm that the encrypted bundle matches the clean source code exactly.

---

## Part 10: Exit Button & Expanded Social Sharing

We added an "Exit to Lobby" navigation button to the results panel and expanded the social sharing dashboard:

### 1. Exit to Lobby Button (`dead_number.html` & `js/dead_number.js`)
* Added a secondary `#btn-exit-lobby` button styled with matching translucent borders (`rgba(30, 48, 56, 0.05)`) directly below the "PLAY AGAIN" button on the results screen.
* Connected it to automatically disconnect the active socket connection and return the player to the setup screen, resetting the UI elements back to default.

### 2. Social Sharing Dashboard (Facebook, Twitter/X, WhatsApp, Telegram, Copy, Native)
* Expanded `shareScore(platform)` and click event bindings to support:
  * **Facebook:** Standard link sharing.
  * **Twitter (X):** Direct X tweet generator pre-filled with the match recap message.
  * **WhatsApp:** Message forwarder link containing game details.
  * **Telegram:** Direct Telegram share link.
  * **Copy Caption:** Copy stylized text with series scores, difficulty, and hashtags to the clipboard.
  * **Native Web Share:** Activates native share sheet (on mobile devices) targeting Instagram Stories, TikTok, Snapchat, etc.
* **Branded Glow Animations (`css/dead_number.css`):**
  * Added custom hover glows for Twitter (dark/black shadow) and Telegram (sky-blue shadow `#0088cc`).

---

## Part 11: Middle of the Game Revive Fix

We resolved the issue where the "Watch Ad to Revive" (Second Chance Shield) option placed the player in a forced losing position by immediately rolling back to the exact previous state before their loss.

### 1. Middle-of-Game Revive Point (`js/dead_number.js`)
* **Reset Calculation:** Calculates `Math.floor(this.deadNumber / 2)` (e.g., `12` for a `25` Dead Number) to safely reposition the game total to a playable, balanced midpoint.
* **History Log Integration:** Appends a clean system log entry (`"Revived! Score set back to X"`) to the game history so that it aligns correctly and styles it as a highlighted system event.
* **TTS Audio Updates:** Updates the text-to-speech engine to announce: *"Second chance activated. Score reset to X. Select again."*

### 2. UI Banner Text Sync (`dead_number.html`)
* Updated the description inside the `#revive-modal-overlay` banner to match the new behavior: *"You hit the Dead Number! Watch a quick ad to restart from the middle of the game and get a second chance."*

### 3. Compilation & Verification
* Recompiled `js/dead_number.obfuscated.js` via `obfuscate.py`.
* Successfully verified code consistency and compilation using our custom automated integrity check scripts.

---

## Part 12: CrazyGames SDK v3 Integration

We integrated the official CrazyGames SDK v3 for real ad monetization and gameplay event tracking analytics.

### 1. SDK Script Integration (`dead_number.html`)
* Added the CrazyGames SDK v3 script (`crazygames-sdk-v3.js`) inside the `<head>` block of the HTML interface document.

### 2. Runtime Initialization & Event Hooks (`js/dead_number.js`)
* **SDK Initialization:** Added checks during standard game startup (`init()`) to detect `window.CrazyGames.SDK` and bind it to `this.crazySDK`.
* **Ad Requests & Audio Suspension:** Implemented `showCrazyGamesAd(adUnitType, onComplete)` which connects rewarded and midgame ad triggers to the CrazyGames SDK. The Web Audio API context (`ctx.suspend()` / `ctx.resume()`) is automatically suspended during ads to avoid sounds breaking and is resumed on close.
* **Gameplay Analytics events:**
  * Triggered `gameplayStart()` on game start.
  * Triggered `gameplayStop()` on game over (either naturally or manually returning to the setup screen).
  * Triggered `happytime()` on player victory to boost engagement scoring.

### 3. Compilation & Verification
* Recompiled the encrypted payload into `js/dead_number.obfuscated.js`.
* Verified both XOR encryption and integration code patterns using automated verification checkers.

---

## Part 13: Buy-Time Fix & Interactive Gameplay Tutorial

We resolved the Buy-Time lifeline ad countdown freeze issue and added a separate, premium, guided interactive gameplay tutorial.

### 1. Buy-Time Lifeline Ad Fix (`js/dead_number.js`)
* **Immediate Clock Freeze:** When the "+Time (AD)" lifeline is clicked, the countdown timer `this.timerInterval` is immediately cleared and set to `null` to freeze the clock before launching the ad request. This prevents timeout penalty triggers from firing while the ad is loading.
* **Input Block & Safety Flags:** Disabled all choice buttons and set `this.isAdPlaying = true` immediately on button click, preventing double-clicks or choices during the ad loading/showing phase.
* **Callback Re-enabling:** Re-enables choice buttons and resets `this.isAdPlaying = false` only after the ad closes and the timer resets to the maximum duration, cleanly resuming play.
* **Duplicate Interval Prevention:** Clears any existing interval reference inside the ad-finished callback before starting the new countdown interval to avoid duplicate loops updating the timer.

### 2. Guided Interactive Gameplay Tutorial (`dead_number.html` & `js/dead_number.js`)
* **Play Tutorial Button:** Added a "Play Tutorial" button on the lobby screen. Clicking it enters a specialized, isolated tutorial mode.
* **Guided Tutorial State Machine:**
  * **Dead Number set to 6:** The tutorial duel initializes with a small, manageable Dead Number of 6.
  * **Intro Modal:** Explains the basic rules (avoid reaching 6, choose +1, +2, +3, +4 on your turn).
  * **Step 1 (Player's Turn 1):** The tutorial highlights only the `+1` button and guides the player to choose it.
  * **Step 2 (Bot's Turn 1):** The Bot plays `+3`, bringing the total to 4.
  * **Step 3 (Player's Turn 2):** The total is 4. The tutorial explains that selecting `+2` hits 6 and loses, and guides the player to choose `+1` (total = 5) to trap the Bot.
  * **Step 4 (Bot's Turn 2):** The Bot is forced to play `+1` (total = 6) and loses.
  * **Success Modal:** Celebrates player victory and returns them to the lobby setup screen.
* **Isolated Logic:** Intercepted `startTurn()` and `selectNumber()` when `this.isTutorial` is true, ensuring normal turn timers and bot logic do not run during the tutorial.
* **Guide Banner:** Added a `#tutorial-guide-banner` overlay at the top of the gameplay screen showing step-by-step instructions and an "Exit Tutorial" button to leave the tutorial at any time.

---

## Verification Results
* **Compilation & Obfuscation:** Successfully compiled `js/dead_number.obfuscated.js` via `obfuscate.py` and prepared the upload folder `dead_number_upload`.
* **Guided Tutorial Test:** Verified that playing the tutorial behaves as a completely guided walk, highlighting the correct buttons and concluding with a victory prompt.
* **Exit Button Test:** Verified that clicking "Exit Tutorial" immediately returns the player to the lobby setup screen.
* **Buy-Time Test:** Verified that the countdown timer is stopped instantly and choices are locked when the ad is requested.

---

## Part 15: PvP Rematch Configuration & Symmetrical Role Swap Fixes

We resolved a series of critical issues that prevented custom PvP lobby matches from correctly managing rematches and dead number configuration updates:

### 1. Authoritative Lobby Configuration Updates (`server.js` & `server.py`)
* **Problem:** The server checked `isHostConnection === isHostTurn` where `isHostTurn = (room.selectionTurn === 'host')` inside the `UPDATE_CONFIG` handler. Because `selectionTurn` is only used in draft/quick matches and is `undefined` in custom lobbies, this validation failed for custom lobby hosts, preventing them from updating the Dead Number.
* **Fix:** Updated the server `UPDATE_CONFIG` handler in both Node.js and Python servers to only enforce draft turn checks when `isDraftActive` is true. In standard custom lobbies, any config update sent by the host socket is automatically allowed.
* **First Turn Sync:** Added server support for updating `room.firstTurn` dynamically. Toggling the first turn buttons on the Host client now transmits the choice to the server, ensuring it starts with the correct turn.

### 2. Symmetrical Client-Side Rematch UI Sync (`js/dead_number.js`)
* **Spelled ID Correction:** Fixed the room code element lookup inside `updatePvpRematchRoleUI()` from the non-existent `room-code-input` to the correct HTML ID `pvp-room-input`. This ensures the guest/challenger sees the room code properly and has the input field disabled when they enter the rematch lobby.
* **Visual Role Toggles Sync:** Symmetrically updated the active styling classes (`active`) for `btn-role-host` and `btn-role-join` inside `updatePvpRematchRoleUI()`. This prevents the UI from showing the previous host/join status after a role swap.
* **Turn Choice Styling Sync:** Automatically updates the active crimson styles for `btn-turn` inside `updatePvpRematchRoleUI()` to align with the host's current first turn choice.
* **`isGameOver` State Sync:** Added `this.isGameOver = room.isGameOver;` inside the `STATE_UPDATE` handler for lobby stages, but kept it conditional so it is not updated during a `game-over` stage event. This prevents `triggerGameOver()` from returning early due to `this.isGameOver` already being set to `true`, fixing the issue where the Victory/Defeat panel did not show and the game remained stuck.
* **Universal Lobby Slider Sync:** Ensured that both Host and Challenger update their setup display value and slider input position when receiving a lobby configuration update.
* **Lobby Stats Theme Customization:** Changed the text color representing "Bot Wins/Played" and "PvP Wins/Played" in the setup statistics panel from white (`#fff`) to theme orange (`var(--color-gold)`) to highlight the wins/played values in orange.

---

## Part 16: Visual Strategy Assist (Helper) for vs Bot Matches

We designed and implemented a visual, adaptive gameplay assistant (Strategy Helper) specifically for vs Bot matches to assist new players in learning the winning mathematical strategies:

### 1. Setup Lobby Integration
* **HTML Toggle (`dead_number.html`):** Added a `#setup-group-helper` button group directly below the Bot difficulty options, letting players toggle Strategy Assist "ON" (default) or "OFF".
* **JS State and Event Listeners (`js/dead_number.js`):** Tracked the helper state via `strategyHelper` (default: `true`) and wired it to active click listeners for `.btn-helper`.
* **Game Mode Isolation:** Hidden entirely during Online PvP modes (`#setup-group-helper` display set to `'none'`) and made visible only during vs Bot matches to prevent cheating.

### 2. Symmetrical Real-Time Highlighting (`js/dead_number.js` & `css/dead_number.css`)
* **Winning Moves:** Highlights optimal choices in glowing green (`.safe-move`). A move is winning if it lands on $X$ such that $(D - 1 - X) \pmod 5 == 0$, where $D$ is the Dead Number.
* **Losing Moves:** Highlights immediate game-over choices in glowing red (`.danger-move`). A move is losing if it lands directly on the Dead Number ($X == D$).
* **Highlight Cleanup:** Resets/removes glow classes when buttons are disabled or when Strategy Assist is turned off.

### 3. Verification & Build Compilation
* **obfuscate.py:** Recompiled clean source code changes into `js/dead_number.obfuscated.js`.
* **prepare_upload_folder.py:** Generated synced upload files in `dead_number_upload` with `index.html`.
* **create_dist_zip.py:** Rebuilt release zip package `dead_number_crazygames.zip` ready for upload.
* **Cache-Busting Update:** Incremented the script tag query parameter version to `?v=1.0.9` in `dead_number.html` and `index.html` to bypass aggressive browser caching.
* **Automated Tests:** Verified code syntax correctness, obfuscation integrity, and CrazyGames SDK integrations using our custom test harness suite.

---

## Part 17: Step-by-Step Wizard & Default Easy Mode Onboarding

To make the game easier to understand and improve player onboarding, we restructured the setup lobby into a 3-step wizard and updated defaults for new players:

### 1. Default Easy Difficulty Configuration
* **Easy Mode Default (`js/dead_number.js`):** Changed the default difficulty state from `'hard'` to `'easy'`. Easy mode restricts the dead number slider range to `20 - 50` and provides a relaxed `7.00s` turn clock (instead of the `3.00s` clock on Hard).
* **HTML UI Alignment (`dead_number.html`):** Swapped the default `active` class indicator in the HTML difficulty buttons grid from "Hard" to "Easy".

### 2. 3-Step Setup Wizard Panels (`dead_number.html`)
Split the cluttered single-page lobby setup into 3 clean, step-by-step wizard panels:
* **Step 1: Profile & Rules (`#setup-step-1`):** Player name registration field, a styled visual **"How to Play" Quick Rules Card** (detailing Nim match mechanics), and the player's core stats/global leaderboards.
* **Step 2: Match Mode (`#setup-step-2`):** Game Mode selector (vs Bot vs PvP), difficulty settings, first turn toggles, Strategy Assist, PvP role inputs, and the "Play Tutorial" button.
* **Step 3: Stakes Selection (`#setup-step-3`):** Bounded Dead Number selection slider and a dynamically generated **Match Setup Recap Card** showing all choices before start.

### 3. Navigation & Validation Controls (`js/dead_number.js`)
* **`showSetupStep(stepNumber)` Controller:** Created a method to toggle visibility of setup step containers. On step 2, it dynamically checks navigation requirements. On step 3, it dynamically renders a setting details summary.
* **Step 1 Next Button Form Validation:** Enforces name validation, preventing users from advancing to Step 2 unless they enter a non-empty player name.
* **Dynamic Step 2 Button Sizing:** `updateStep2Buttons()` hides the "Continue" next button in Step 2 if Online PvP Join or Quick Match roles are selected, allowing players to execute their connections directly from the Step 2 panel.
* **Back Navigation support:** Added click listeners for `Back` buttons on Steps 2 and 3 to let players tweak settings before initializing their duels.
* **PvP Rematch Lobby Routing:** Fixed the rematch navigation so that active PvP room sessions bypass the Step 1 profile screen. The Host is sent directly to Step 3 (Stakes / Dead Number Selection) to instantly configure the next game, while the Guest is routed to Step 2 (waiting for Host's choice), avoiding redundant name registration forms.

---

## Part 18: PvP 7s Clock & Adaptive Difficulty scaling

We implemented symmetrical turn duration updates for PvP matches and a smart player-retention adaptive difficulty helper:

### 1. Symmetrical PvP 7.0-Second Turn Clock
* **PvP Timer Raise:** Symmetrically raised the PvP turn timer to **7.0 seconds** (from 4.0s) in:
  * Client engine: `js/dead_number.js` inside `getTurnDuration()`.
  * Node.js production server: `server.js` inside `getTurnDuration()`.
  * Python local server: `server.py` inside `get_turn_duration()`.
* This prevents timeouts and out-of-sync ticks across clients during PvP matches.

### 2. Adaptive Bot Difficulty scaling
* **Consecutive Losses Track:** Added `botLossStreak` state. On bot defeat, the game increments this counter.
* **Auto-Downgrade:** If a player loses **2 consecutive bot matches**:
  * Automatically lowers the difficulty setting down one tier (Hard -> Medium, or Medium -> Easy).
  * Appends a themed announcement text toast on the results screen: `[ADAPTED] Bot difficulty automatically lowered to X to assist training!`.
  * Triggers Text-to-Speech to support the player: *"Lowering bot difficulty to X to help you practice..."*.
  * Syncs the lobby selectors and slider bounds so they are configured correctly for the next game automatically.
* **Reset on Win:** Resets `botLossStreak` to `0` when the player wins.




