# Direction Quest: The Lost Traveler

An HTML5 educational RPG teaching **English Giving Directions**, built with vanilla HTML5/CSS3/JS and the Canvas API only. Just open `index.html` — no build step, no server, no dependencies (the game itself; see below for the optional backend).

## What's in this build

- **A real street grid**: 5 columns x 3 rows of city blocks with actual perpendicular streets (not spoke paths) — so "go straight 2 blocks, turn left" lines up with what's literally on screen. A single bridge crosses the river south to the Riverside Overlook.
- **5 named NPCs**, each tied to one quest in a chain that loops around the whole grid
- **5 comprehension quests** + **1 capstone navigation quest**: after the 5th quest, the player is automatically sent on a final journey "From the Auditorium to the Library" — no NPC, no minigame, just real navigation. Arriving at the Library reveals a final real-world instruction pointing the player toward an actual physical scavenger-hunt task at JIU.
- **Click/tap-to-move**: click (or tap) anywhere on the ground and the player walks there — works alongside keyboard, the virtual joystick, and the touch Talk button, on both laptop and phone. Manual input (keys or joystick) always overrides a pending click destination.
- **All 6 mini-game types**: Multiple Choice, Typing Challenge (Levenshtein-based similarity, accuracy %, WPM, error count), Arrange Directions (drag-and-drop, with up/down buttons as a touch-friendly fallback), Fill in the Blank (fuzzy-matched, tolerates minor typos), True/False, and Interactive Map (click the correct destination among a few landmarks). Quest 5 chains True/False then Map back-to-back as a two-stage "boss" challenge.
- Full RPG-feel UI: HUD (level/XP/coins/clock), quest tracker, mini-map, quest journal, pause menu, typed-dialogue with portraits and branching choices, toast notifications, particle bursts, camera shake on big moments
- **Save/Load** via `localStorage`, with auto-save on quest completion
- **Live Google Sheets logging** via a deployed Apps Script Web App — session starts, every quest completion (with score/accuracy/attempts), and final game-completion summaries, each in their own auto-created sheet tab. Fully offline-safe: if the network drops or no URL is configured yet, events queue in `localStorage` and flush automatically once connectivity/config is available.
- All art is drawn live on `<canvas>` (no image files) and all sound is synthesized with the Web Audio API (no audio files) — styled as a "storybook travel journal" rather than attempting pixel art
- **Playable on phones/tablets**: a virtual joystick (drag to move, push further to run), a "Talk" button, and click/tap-to-move all appear automatically on touch devices, sized for thumbs, with safe-area padding for notched phones, a landscape suggestion on narrow portrait screens, and an optional fullscreen toggle. Desktop keyboard/mouse controls are unaffected.

## Locations (real JIU building names)

| In-game ID | Displayed name |
|---|---|
| `pharmacy` | Manna Hall |
| `bank` | Dormitory |
| `busstop` | Cafeteria |
| `museum` | Bliss Cafe |
| `cinema` | Auditorium |
| `coffeeshop` | EL Lecturers Office |
| `library` | Library (unchanged) |
| `overlook` | Riverside Overlook (unchanged) |

(Internal IDs were kept as-is so quest/save data stays compatible — only the on-screen names changed.)

## Deploying the Apps Script backend

1. Create a new Google Sheet (any name — this becomes your class's analytics workbook).
2. In the Sheet, go to **Extensions > Apps Script**.
3. Delete the placeholder code and paste in the contents of `google-apps-script/Code.gs`.
4. Click **Deploy > New deployment**, choose type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize the requested permissions, then copy the `/exec` URL it gives you.
6. Open `script.js` and paste that URL into the `GAS_WEB_APP_URL` constant near the top of the file:
   ```js
   const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
7. Reopen `index.html` — no other setup needed. Three tabs (`Sessions`, `QuestLog`, `GameComplete`) appear in your Sheet automatically the first time each event fires.

**Note:** `GAS_WEB_APP_URL` is left blank by default so the game runs standalone. Until you set it, every event just queues in the browser's `localStorage` (`directionQuest_pendingLogs_v1`) — nothing is lost, it simply won't reach a spreadsheet yet.

## Roadmap for expanding this further

- **More content** — the `BUILDINGS`, NPC list, and `buildQuestChain()` are all small, readable arrays in `script.js`. A second district, more NPCs, or more quests is additive, not a rewrite.
- **Inventory, skill tree, achievements panel, daily rewards** — `profile.achievements` already exists as an array; these are UI additions on top of existing state.
- **Teacher dashboard** — once quests are logging to your Sheet, a second tab with `QUERY()`/`AVERAGEIF()` formulas (or a small Apps Script-driven dashboard sheet) can summarize `QuestLog` by student, challenge type, or accuracy without touching the game client.
- **Custom art/voice** — this build intentionally uses procedural Canvas art and synthesized SFX since no image/audio generation tool was available; swapping in real sprite sheets and audio files is a drop-in change to `Player.draw()` / `NPC.draw()` / `AudioManager` once assets exist.

## File structure

```
index.html                    UI shell: menus, HUD, dialogue box, modals
style.css                     Design system (palette, type, layout, animation)
script.js                     Game engine: Game, Player, NPC, Quest, Camera, Dialogue,
                               ChallengeManager (all 6 mini-games), TypingEngine,
                               DirectionGenerator, AudioManager, SaveManager,
                               GoogleSheetManager (live backend, offline-queued)
google-apps-script/Code.gs    Apps Script Web App: receives events, auto-creates
                               sheet tabs + headers, appends rows
```

## Controls

- **Move**: WASD, Arrow Keys, the on-screen joystick (touch), or click/tap the ground to walk there / **Run**: hold Shift, or push the joystick further out
- **Talk**: walk up to a glowing NPC and press **E**, tap the Talk button, or click/tap them directly
- **Quest Journal**: **J** / **Pause**: **Esc**
