# Scorekeeper — Requirements & Architecture

**Last updated:** 2026-03-20
**Status:** In progress — architecture revision after initial implementation

---

## Preliminary Steps

These must be completed before building any scorekeeper features. They are development infrastructure, not features — without them, iterating on the scorekeeper is slow and error-prone.

### 1. Seed reset script

A single script (`scripts/seed.ts` or `scripts/seed.js`) that wipes relevant Firebase paths and re-seeds them with known test data. Run it from the command line whenever a test session leaves the database in a broken or polluted state.

**What it should wipe and re-seed:**
- `/game/meta` — reset to a clean default state (inning 1, top, 0 outs, 0-0, no currentGameId)
- `/game/matchup` — clear batter/pitcher
- `/games` — remove all test games
- `/gameStats` — remove all test at-bat logs
- `/liveRunners` — clear all runner states
- `/gameSummaries` — remove all summaries
- `/overlay` — reset to idle scene, no stat overlay, default timer
- `/players/{id}/stats` — reset all player stats to a known baseline (either zeroed or a hardcoded dev fixture)

**What it should NOT touch:**
- `/teams` — team definitions are stable config, not test data
- `/players` (name/position/teamId fields) — player identity is stable; only `stats` gets reset

**Usage target:** `npm run seed` — one command, no prompts, idempotent.

### 2. Dev controls in the app

A collapsible "Dev Tools" panel, visible only when `import.meta.env.DEV` is true (never ships to production). Lives in the controller route and/or scorekeeper route.

**Controller dev panel — needed actions:**
- **Cancel current game** — removes `/games/{currentGameId}`, clears `/gameStats/{currentGameId}`, clears `/liveRunners/{currentGameId}`, clears `currentGameId` from `/game/meta`. Does NOT write any stats. Confirmation required.
- **Clear at-bat log** — wipes `/gameStats/{currentGameId}` only, leaves the game record intact. Useful when you want to replay scoring from scratch without resetting the whole game.
- **Reset live runners** — sets `/liveRunners/{currentGameId}` to all null. Fixes stuck runner state without cancelling the game.
- **Force set inning** — number input to jump to any inning/half-inning. Bypasses the normal advance flow. Useful for testing late-game scenarios.
- **Reset game meta** — same as "Reset Game" but also clears `currentGameId`.

**Scorekeeper dev panel — needed actions:**
- **Clear at-bat log** (same as above)
- **Reset live runners** (same as above)
- **Abandon game without finalizing** — leaves the `/games/{gameId}` record with `finalized: false` but removes it from `currentGameId` so it's no longer the active game. The raw logs are preserved for inspection but the game is no longer "in progress."

### 3. Fix current game-stuck bug

**Current bug:** the scorekeeper is in a state where no more at-bats can be logged and the only exit is "Finalize Game," which is destructive. Root cause unknown — likely `currentGameId` points to a game that already has unexpected state, or the wizard step state is corrupted.

**Fix required before any further scorekeeper work:**
- Identify what path/state is causing the wizard to block
- Add a "Cancel / Start Over" escape hatch on the scorekeeper that resets local wizard state without touching Firebase (covers the case where UI state gets stuck, not just Firebase state)
- This escape hatch should always be visible in the scorekeeper header, not hidden in dev tools — getting stuck with no way out is a real operator problem, not just a dev problem

---

## Purpose

Digitize per-game at-bat logging for a wiffle ball league. Enables:
- Per-game at-bat records with full play context
- Auto-computed cumulative season stats (derived from logs, never manually entered)
- Live stat overlays on the broadcast scorebug during streamed games
- Fully standalone operation for non-streamed games

---

## Two Operating Modes

The league plays at two venues. The system must support both without changes to workflow.

### Standalone (non-streamed)
- One scorekeeper phone per game, no OBS, no overlay, no controller
- Scorekeeper creates the game, selects teams, tracks innings/outs/score
- Stats accumulate in Firebase and are aggregated into season stats on finalization
- Score is **never manually entered** — it is derived from at-bat logs

### Integrated (streamed, commissioner's field)
- Controller manages broadcast scenes, timers, stat overlays
- Scorekeeper logs at-bats → drives scorebug state automatically (score, inning, bases, matchup)
- Controller becomes a *broadcast control panel only* — not the source of game state
- Two games may run simultaneously; each has its own scorekeeper instance

---

## Key Architectural Decisions

### Scorekeeper is the source of truth for game state
The scorekeeper owns: inning, half-inning, outs, score, and live runner identities. The controller reads and displays this state rather than owning it. This allows standalone operation while also keeping the broadcast accurate during streamed games.

### Score is always derived — never manually entered
Score = sum of all runs scored in `/gameStats/{gameId}`. A run is scored when a player ID appears in `runnersScored` on any at-bat, or when `batterAdvancedTo === 'home'` on their own at-bat (home runs). The scorebug displays this computed total. No +1/−1 score buttons.

### Each game is fully isolated in Firebase
All game state lives under `/games/{gameId}` and `/gameStats/{gameId}`. Two simultaneous games are completely independent paths. The overlay/controller subscribes to whichever game is designated as the "live" streamed game.

### Game creation belongs to the scorekeeper
Either scorekeeper operator can create a new game. A game flagged `isStreamed: true` additionally writes its state to `/game/meta` so the scorebug picks it up. A non-streamed game never touches `/game/meta`.

### Scorekeeper selects both batter and pitcher
The controller matchup dropdowns become a convenience mirror (pre-filled from the active game's state), not the source. Selecting a batter in the scorekeeper updates `/games/{gameId}/matchup`, which the scorebug reads — identical effect, different owner.

---

## Firebase Data Shape

### `/games/{gameId}`
```
{
  homeTeamId: string,
  awayTeamId: string,
  date: string,              // "2026-05-10"
  isStreamed: boolean,       // true = writes state to /game/meta for scorebug
  finalized: boolean,
  finalizedAt?: number,
  inning: number,
  isTopInning: boolean,
  outs: number,              // 0 | 1 | 2
  homeScore: number,         // derived and cached here for quick reads
  awayScore: number,
}
```

**Game ID format:** `{date}_{homeTeamId}_{awayTeamId}` — e.g. `2026-05-10_whalers_yetis`
**Generated by:** scorekeeper on game creation, never manually entered

### `/games/{gameId}/matchup`
```
{
  batterId: string | null,
  pitcherId: string | null,
  lastPitcherHome: string | null,
  lastPitcherAway: string | null,
}
```
Owned by scorekeeper. For streamed games, also mirrored to `/game/matchup` so the scorebug picks it up.

### `/gameStats/{gameId}/{atBatId}`
```
{
  batterId: string,
  pitcherId: string,
  inning: number,
  isTopInning: boolean,
  timestamp: number,
  result: AtBatResult,
  runnersOnBase: { first, second, third },  // snapshot before this at-bat
  runnersScored: string[],                  // playerIds who scored on this play
  rbiCount: number,
  batterAdvancedTo: 'first'|'second'|'third'|'home'|'out'|null,
  isEarnedRun: boolean,
  notes?: string,
}
```

### `/liveRunners/{gameId}`
```
{ first: string|null, second: string|null, third: string|null }
```
Updated after every at-bat. Persisted so page reloads don't lose mid-inning runner identity.

### `/game/meta` (streamed games only)
Unchanged — scorebug still reads from here. For streamed games, the scorekeeper writes inning/outs/score/bases here after each at-bat and half-inning advance. Non-streamed games never touch this path.

---

## Scorekeeper UI

### Game selector (top of screen)
- List of today's games the operator has access to, with status (In progress / Finalized)
- "New Game" button → team picker → creates `/games/{gameId}`, asks if streamed

### Per-game wizard (one at-bat at a time)

**Step 1 — Who's Up?**
- Batter dropdown (batting team only, sorted by name)
- Pitcher dropdown (fielding team only)
- Current inning / outs shown as context

**Step 2 — What Happened?**
- Large tap grid: Single, Double, Triple, Home Run, Walk, Strikeout, Ground Out, Fly Out, Hit By Pitch, Sac Fly, Sac Bunt, Fielder's Choice, Error

**Step 3 — Who Scored?** *(only if runners on base)*
- Runner names as large toggle buttons (e.g. "Jones — 2nd base")
- Home run auto-selects all runners
- RBI count computed automatically (0 on errors; +1 for batter on home runs)

**Step 4 — Confirm & Submit**
- Summary: "Smith — Single — 1 RBI"
- "Log At-Bat" button
- On submit: writes at-bat record, updates `/liveRunners`, updates `/games/{gameId}` score cache, mirrors to `/game/meta` if streamed

### Half-inning advance
- Button below wizard: "End Half-Inning ▶"
- Clears outs and bases, advances inning counter
- Prompts for next pitcher (pre-fills last pitcher for that side)
- If streamed: also writes to `/game/meta`

### At-bat log (bottom, collapsible)
- Most recent at-bats first
- Tap to edit (re-opens wizard pre-filled) or delete
- Editing does NOT update liveRunners — scorer manages that manually if needed

---

## Scoring Rules

### Valid results
Errors are **not tracked** in this league. The result set is:

| Result | AB? | RBI credited? |
|---|---|---|
| Single, Double, Triple, Home Run | Yes | Yes |
| Ground Out, Fly Out, Strikeout | Yes | Yes (if runner scores) |
| Fielder's Choice | Yes | Yes (if runner scores) |
| Walk, HBP | No | Yes (if bases loaded) |
| Sac Fly, Sac Bunt | No | Yes (if runner scores) |
| Home Run | Yes | Yes (+1 for batter + all runners scored) |

"Error" is removed as a result option. Any misplay is just scored as whatever the batter achieved (hit, FC, out, etc.) at the scorer's discretion.

### RBI credit
- ✅ Credited: any result where a runner scores, walks/HBP with bases loaded, sac fly
- ❌ Not credited: double play
- Home runs: rbiCount = runnersScored.length + 1 (batter drives themselves in)

### At-bat vs. plate appearance
| Result | Counts as AB? |
|---|---|
| Hit, out, FC | Yes |
| Walk, HBP, sac fly, sac bunt | No (PA only) |

### Score derivation
On each at-bat submit, the scorekeeper recomputes the running score for the current game from the current game's stats and writes it to `/games/{gameId}/homeScore` and `awayScore`. This is a cache — the raw logs always remain the source of truth.

---

## Controller Changes (integrated mode only)

The controller becomes a **broadcast panel**, not a game state owner. Changes needed:

- **Remove:** manual score +/− buttons, inning advance/rewind buttons, batter/pitcher dropdowns as writers
- **Keep:** scene switcher, stat overlay triggers (Batter Stats / Pitcher Stats / Dismiss), timer, scorebug dev controls
- **Add:** "Live Game" selector — pick which of today's games is being streamed (sets `/game/meta.currentGameId`)
- **Add:** Finalize Game button (unchanged logic, moved here since controller = producer tool)

The controller reads matchup/inning/score from the same Firebase paths as before — it just no longer writes them.

---

## Stats Computation (Finalization)

Triggered by producer via "Finalize Game" in controller. Reads all finalized game logs + current game → aggregates → writes to `/players/{id}/stats`.

**Hitting:** `gp`, `pa`, `ab`, `h`, `doubles`, `triples`, `hr`, `r`, `rbi`, `bb`, `k`, `avg`, `obp`, `slg`, `ops`
**Pitching:** `gp`, `k`, `bb`, `inningsPitched` (outs ÷ 3), `era`

Finalization is idempotent — re-running it overwrites stats cleanly from source logs.

---

## Multi-Game Concurrency

Two scorekeepers can operate simultaneously on separate games. Each writes to its own `/games/{gameId}` and `/gameStats/{gameId}` path — no contention. The overlay only subscribes to the game flagged as the current streamed game via `/game/meta.currentGameId`.

---

## Game Completion Rules

A game is considered complete when either condition is met:
- **7 innings** played (both halves of inning 7), OR
- **90 minutes** elapsed from game start time

Finalization is always manual (producer/scorekeeper taps "Finalize"). The app will surface a prompt when either condition is met but will not auto-finalize. Games can be finalized early at any point.

## Roster & Substitutions

- Pitchers can change at any point mid-game — pitcher dropdown always shows full fielding team roster
- Batting lineup can change (rare, but must be supported) — batter dropdown always shows full batting team roster, not filtered to a pre-set lineup
- No lineup enforcement: if someone walks up and bats, they can be selected even if they weren't in a previous at-bat
- Future consideration: a per-game "active roster" toggle per player could filter the dropdowns if needed, but not required for launch

## Game Summary on Finalization

On finalization, the system writes two things:
1. **`/players/{id}/stats`** — cumulative season totals (existing behavior, overwritten each time)
2. **`/gameSummaries/{gameId}/{playerId}`** — per-game box score stats for that player (hits, AB, RBI, K, BB, IP, etc.)

This gives us both the granular at-bat logs (always recomputable) and a clean per-game summary table (useful for displaying a box score after the game without re-reading hundreds of at-bat records). The raw `/gameStats/{gameId}` logs are never deleted.

## Authentication

Auth is required before this feature ships. Planned scope:
- Scorekeeper route: requires login (any authenticated user)
- Controller route: requires login
- Overlay route: remains public (OBS browser source)
- Role model TBD (e.g. admin vs. scorekeeper-only) — deferred

## Open Questions

1. **Pitcher W/L** — Is win/loss tracked per pitcher? If yes, how is a win defined in a wiffle ball context? *(Awaiting answer from cousin.)*

---

## TODO

### 🔴 Preliminary (do first — blocks everything else)
- [ ] Write `scripts/seed.ts` — wipe and re-seed Firebase test data with `npm run seed`
- [ ] Fix current game-stuck bug — diagnose why scorekeeper wizard is blocked, add always-visible "Start Over" escape hatch in scorekeeper header
- [ ] Add dev-only "Dev Tools" collapsible panel to controller and scorekeeper (guarded by `import.meta.env.DEV`)
  - [ ] Cancel game (no stats written, confirmation required)
  - [ ] Clear at-bat log only
  - [ ] Reset live runners
  - [ ] Force set inning
  - [ ] Abandon game without finalizing

### Architecture / data model
- [ ] Add `inning`, `isTopInning`, `outs`, `homeScore`, `awayScore`, `isStreamed`, `startedAt` to `/games/{gameId}` schema and `GameRecord` type
- [ ] Add `/games/{gameId}/matchup` as the canonical matchup path (scorekeeper owns it); replace current `/game/matchup` writes in controller
- [ ] Scorekeeper mirrors state to `/game/meta` and `/game/matchup` only when `isStreamed: true`
- [ ] Remove `error` from `AtBatResult` type and from result buttons
- [ ] Add `gameSummaries/{gameId}/{playerId}` write to finalization logic
- [ ] Decide on `/game/meta.currentGameId` vs a separate `/streamedGameId` path for the "which game is live" pointer

### Scorekeeper UI
- [ ] Game selector screen — list all non-finalized games, "New Game" button at top
- [ ] New game flow: pick home team → pick away team → toggle "Streamed game?" → create
- [ ] Pitcher dropdown in Step 1 (currently read-only from matchup; must become writable)
- [ ] Half-inning advance button: clears outs/bases, advances inning, prompts for next pitcher
- [ ] Auto-increment outs on out results (strikeout, groundout, flyout, sac fly, sac bunt, FC) — 3 outs triggers half-inning advance prompt
- [ ] Score display at top of wizard derived from at-bat log (live running total, not manual)
- [ ] Game complete prompt when 7 innings reached or 90 min elapsed since `startedAt`
- [ ] Mirror writes to `/game/meta` when `isStreamed: true` (inning, outs, bases, score, matchup)

### Controller
- [ ] Remove score +/− buttons (score is now derived)
- [ ] Remove inning advance/rewind buttons (scorekeeper owns inning state)
- [ ] Remove batter/pitcher dropdowns as writers; make them read-only or remove entirely
- [ ] Add "Live Game" selector — picks which active game feeds the scorebug (writes `/game/meta.currentGameId`)
- [ ] Keep: scene switcher, stat overlay triggers, timer, scorebug dev controls, Finalize Game

### Stats & finalization
- [ ] Write `/gameSummaries/{gameId}/{playerId}` on finalization (per-game box score)
- [ ] Remove `error` from all RBI/AB computation branches
- [ ] Pitcher W/L — implement once league rules confirmed
- [ ] Season reset: add an "Admin: Wipe Season Stats" action (auth-gated) that clears `/players/{id}/stats` for all players
- [ ] Verify finalization handles two simultaneous same-day games correctly (both can be finalized independently)

### Auth
- [ ] Add Firebase Auth (email/password or Google)
- [ ] Gate `/controller` and `/scorekeeper` routes behind auth check
- [ ] `/overlay` stays public
- [ ] Admin role for season reset and finalization (vs. scorekeeper-only role)

### Bugs / cleanup from initial implementation
- [ ] `finalizeGame` root `update(ref(db), updates)` — verify mixed-depth paths work or switch to batched `update` calls per subtree
- [ ] Scorekeeper currently reads `currentGameId` from `/game/meta` — must switch to game selector state
- [ ] Scorekeeper has no half-inning advance; no outs counter
- [ ] Score on scorebug is still manually controlled, not derived from logs
- [ ] `AtBatResult` still includes `'error'` — remove from type, UI, and scoring logic
