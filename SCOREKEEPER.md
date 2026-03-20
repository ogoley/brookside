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
For doubleheaders (same teams, same day), append `_g2`, `_g3` etc. — check if ID already exists at creation time and increment the suffix until it's unique.
**Date is always Eastern Time (EST/EDT)** — use `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })` to derive the date string, never `toISOString()` which returns UTC.
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

### `/games/{gameId}/lineups/{teamId}`
```
[
  { playerId: string, isSub: boolean },
  ...
]
```
Ordered array — index order is the batting order. Subs are appended at the end with `isSub: true`. Set at game creation, editable mid-game. Both hitting and pitching subs are tracked here.

### `/games/{gameId}/lineupPosition/{teamId}`
```
number  // index into the lineups array for the current batter
```
Persisted in Firebase so a phone reload never loses the current position in the order. Only advances on non-sub at-bats (subs don't consume a lineup slot).

### `/gameStats/{gameId}/{atBatId}`
```
{
  batterId: string,
  pitcherId: string,
  isSub: boolean,                           // denormalized from lineup at write time; excludes from season stats on finalization
  inning: number,
  isTopInning: boolean,
  timestamp: number,
  result: AtBatResult,
  runnersOnBase: { first, second, third },  // snapshot BEFORE this at-bat
  runnerOutcomes: {                         // what happened to each runner during this play
    first?:  'scored' | 'second' | 'third' | 'stayed' | 'out',
    second?: 'scored' | 'third'  | 'stayed' | 'out',
    third?:  'scored' | 'stayed' | 'out',
  },
  // Rule: if runnersOnBase.X is non-null, runnerOutcomes.X MUST be present.
  // Omitting a key means no runner was there — never use omission to mean 'stayed'.
  runnersScored: string[],                  // playerIds who scored (derived from runnerOutcomes + HR batter)
  outsOnPlay: number,                       // total outs recorded on this play (1 for normal out, 2 for DP, 3 for TP)
  rbiCount: number,
  batterAdvancedTo: 'first'|'second'|'third'|'home'|'out'|null,
  notes?: string,
}
```

`isSub` is denormalized onto the at-bat record at write time so finalization never needs to re-fetch lineup data — it just reads the flag off each record directly.

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
- "New Game" button → opens New Game modal (see below)

### New Game modal

A multi-step modal sheet that walks through game creation before the scoring wizard begins:

**Step A — Teams**
- Home team picker (dropdown of all teams)
- Away team picker (dropdown, excludes home team selection)
- "Streamed game?" toggle
- Next →

**Step B — Home lineup**
- List of all home team players, each with a checkbox
- Tap players in the order they will bat — selection order = batting order
- Selected players appear in a numbered list at the bottom (drag to reorder)
- "Add sub" button appends a player with `isSub: true` (shown at bottom, greyed out)
- Next →

**Step C — Away lineup**
- Same interface as Step B for the away team
- Next →

**Step D — Confirm**
- Summary: Home team vs Away team, Inning 1 Top, each lineup listed in order
- "Create Game" button → writes `/games/{gameId}`, `/games/{gameId}/lineups/{teamId}`, `/games/{gameId}/lineupPosition/{teamId}` (both start at 0)
- If `isStreamed: true`, also writes `currentGameId` to `/game/meta`

Modal can be dismissed before Step D without writing anything. After Step D, the scoring wizard opens immediately for the new game.

### Per-game wizard (one at-bat at a time)

**Step 1 — Who's Up?**
- Batter pre-filled from lineup order (overridable). Subs shown at bottom of list marked "(sub)".
- Pitcher dropdown (fielding team only, full roster)
- Current inning / outs / live base diamond shown as context

**Step 2 — What Happened?**
- Large tap grid: Single, Double, Triple, Home Run, Walk, Strikeout (K), Strikeout Looking (ꓘ), Ground Out, Fly Out, Hit By Pitch, Sac Fly, Sac Bunt, Fielder's Choice, Pitcher's Poison
- Selecting Pitcher's Poison auto-detects chain from current `liveRunners` and pre-fills runner outcomes in Step 3; scorer can override before confirming
- `error` is removed — scorer calls the play as whatever the batter achieved
- K (swinging) and ꓘ (looking/backwards K) are separate result types for display purposes but identical for stat computation — both count as strikeout

**Step 3 — Runner outcomes** *(only shown if runners are on base)*
- One row per runner currently on base (e.g. "Jones — 2nd base")
- Each row has tap options: **Scored** | **Advanced** (sub-options: which base) | **Stayed** | **Out**
- Home run auto-sets all runners to Scored
- `outsOnPlay` is computed as: (1 if batter is out) + (count of runners marked Out)
- This step handles double and triple plays naturally — if 2+ runners are marked Out, outsOnPlay = 2 or 3

**Step 4 — Confirm & Submit**
- Summary: "Smith — Single — 2 RBI — Jones OUT (DP)"
- Shows total outs this play, which bases are now occupied
- "Log At-Bat" button
- On submit: writes at-bat record (with `isSub` flag), updates `/liveRunners` from runner outcomes, increments outs by `outsOnPlay`, updates score cache, mirrors to `/game/meta` if streamed

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

| Result | AB? | RBI credited? | Notes |
|---|---|---|---|
| Single, Double, Triple | Yes | Yes (if runner scores) | |
| Home Run | Yes | Yes — runnersScored.length + 1 | Batter drives themselves in |
| Ground Out, Fly Out | Yes | Yes (if runner scores) | |
| Strikeout (K) | Yes | No | Swinging |
| Strikeout Looking (ꓘ) | Yes | No | Called — same stats as K, different display |
| Fielder's Choice | Yes | Yes (if runner scores) | Batter safe, runner(s) out |
| Walk, HBP | No | Yes (if runner forced in) | |
| Sac Fly | No | Yes (if runner scores) | Batter out, runner tags and scores — RBI credited |
| Sac Bunt | No | Yes (if runner scores) | |
| Pitcher's Poison | Yes | No | League-specific; batter out at 1st or mound; see Pitcher's Poison rule |

"Error" is removed — scorer calls the play as whatever the batter achieved.

**Sac Fly clarification:** Sac flys are rare in this league but the rule stands — batter does not get an AB, but DOES get RBI credit if a runner scores on the fly out. This is standard baseball and is correct.

### RBI credit
- ✅ Credited: any result where a runner scores, walk/HBP that forces in a run, sac fly with a runner scoring
- ❌ Not credited: double play ground out where no run scores, strikeout
- Home runs: rbiCount = runnersScored.length + 1 (batter drives themselves in)

### Out counting
- `outsOnPlay` = (1 if batter result is an out) + (count of runners marked "Out" in runner outcomes)
- Normal out: outsOnPlay = 1
- Double play: outsOnPlay = 2 (e.g. batter out on FC + one runner out, or ground out + runner out)
- Triple play: outsOnPlay = 3 (extremely rare but supported)
- After submit, game outs += outsOnPlay. If outs reach 3, trigger half-inning advance prompt.

### At-bat vs. plate appearance
| Result | Counts as AB? |
|---|---|
| Hit, out, FC | Yes |
| Walk, HBP, sac fly, sac bunt | No (PA only) |

### Score derivation
On each at-bat submit, the scorekeeper recomputes the running score for the current game from the current game's stats and writes it to `/games/{gameId}/homeScore` and `awayScore`. This is a cache — the raw logs always remain the source of truth.

---

## League-Specific Rules

### Pitcher's Poison

**Definition:** When the batter is put out at 1st base (tagged out running through the bag) or on the pitcher's mound (tagged out mid-run), a special substitution rule applies: *someone always sits down for the out, but it might not be the batter.*

**Trigger condition:** Batter is tagged out at 1st base or on the pitcher's mound. Does NOT apply to force-out ground balls to first or any other standard out.

---

#### The Core Principle

When Pitcher's Poison triggers, the scorekeeper must check whether a **connected chain** of runners exists starting from 1st base:

- **Connected chain:** runners occupy bases continuously from 1st outward, with no gap.
  - Example: runners on 1st and 2nd → connected (continuous from 1st)
  - Example: runners on 1st, 2nd, and 3rd → connected
  - Example: runner on 2nd only → NOT a chain from 1st (no one on 1st)
  - Example: runners on 1st and 3rd → NOT connected (gap at 2nd)

**If connected chain exists:** The lead runner (furthest ahead in the chain) is out. The batter is safe at 1st. All other runners in the chain stay where they are. **1 out recorded.**

**If no connected chain:** The batter is out normally. All existing runners stay. **1 out recorded.**

Pitcher's Poison never records more than 1 out.

---

#### Scenarios

**Scenario 1 — Runner on 2nd only (no chain from 1st)**
- Before: runner on 2nd, no one on 1st
- Pitcher's Poison triggers (batter tagged at 1st or mound)
- No connected chain — batter sits down normally
- After: runner stays on 2nd, batter is out
- `batterAdvancedTo: 'out'`, `outsOnPlay: 1`, runner on 2nd outcome: *(no change)*

**Scenario 2 — Runner on 1st and 3rd (gap at 2nd — no chain)**
- Before: runners on 1st and 3rd, 2nd is empty
- Pitcher's Poison triggers
- No connected chain (gap at 2nd breaks it) — batter sits down normally
- After: runners stay on 1st and 3rd, batter is out
- `batterAdvancedTo: 'out'`, `outsOnPlay: 1`, both runners: *(no change)*

**Scenario 3 — Runner on 1st only (chain of 1)**
- Before: runner on 1st, 2nd and 3rd empty
- Pitcher's Poison triggers
- Connected chain exists (just the runner on 1st) — lead runner (on 1st) sits down, batter stays on 1st
- After: batter is now on 1st, original runner is out
- `batterAdvancedTo: 'first'`, `outsOnPlay: 1`, runner on 1st outcome: `'out'`

**Scenario 4 — Runners on 1st and 2nd (connected chain)**
- Before: runners on 1st and 2nd
- Pitcher's Poison triggers
- Connected chain: 1st → 2nd → lead runner is at 2nd. Runner at 2nd sits down, batter stays on 1st, runner on 1st stays.
- After: batter on 1st, runner at 2nd is out
- `batterAdvancedTo: 'first'`, `outsOnPlay: 1`, runner on 2nd: `'out'`, runner on 1st: *(no change)*

**Scenario 5 — Bases loaded (connected chain, lead runner at 3rd)**
- Before: runners on 1st, 2nd, and 3rd
- Pitcher's Poison triggers
- Connected chain: 1st → 2nd → 3rd. Lead runner (3rd) sits down, batter stays on 1st, runners on 2nd and 1st stay.
- After: batter on 1st, runner on 2nd, runner on 3rd is out
- `batterAdvancedTo: 'first'`, `outsOnPlay: 1`, runner on 3rd: `'out'`, runners on 1st + 2nd: *(no change)*

---

#### Implementation Notes

- **Result type:** Use `'pitchers_poison'` as the `AtBatResult` value. Counts as an AB. No RBI. Stats identical to a ground out.
- **`batterAdvancedTo`:** `'first'` when a chain exists (batter stays safe), `'out'` when no chain (batter sits down).
- **`outsOnPlay`:** Always `1`. Pitcher's Poison cannot produce more than one out.
- **Runner outcomes:** The lead connected runner (if chain exists) gets `'out'`; all other runners get no outcome change (omit from `runnerOutcomes`).
- **`liveRunners` after play:** If chain exists — remove the lead runner, keep all others, add batter to 1st. If no chain — remove batter (out), keep all runners unchanged.
- **Scorekeeper wizard:** Step 2 should include a "Pitcher's Poison" button. This auto-detects whether a chain exists from current `liveRunners` and pre-fills runner outcomes accordingly. Scorer can override before confirming.

#### Open Question

- **Chain definition edge case:** If the batter themselves becomes part of the chain (e.g., batter is on their way to 1st and a runner was already on 1st who just advanced to 2nd on the same play), does the chain count the *current* base state (before this at-bat) or the *post-advance* state? Current assumption: chain is evaluated from the pre-play `runnersOnBase` snapshot (before the batter's at-bat begins), and the batter is always considered to be arriving at 1st.

---

### Overthrow Rule

**Definition:** When a fielder attempts to tag a runner (Indian tag) and the throw goes far out of play, every runner — including the batter — advances one extra base beyond what the play would have otherwise been.

**This does not require a new result type.** It is handled at scoring time by adjusting the result and runner outcomes:

- If the batter hit a single and the overthrow occurs: upgrade `result` to `'double'`
- Advance every runner on base one additional base beyond where they would have ended up
- Award RBI wherever a runner scores as a result of the advancement

**Example:** Batter hits a single, runner on 2nd. On the throw to 1st, the ball is overthrown and rolls far. Scorer records this as a `'double'` (batter ends on 2nd) and marks the runner who was on 2nd as `'scored'` in runner outcomes. RBI is credited.

**Assumption:** The scorekeeper manually applies this upgrade during result entry — there is no automatic detection. The scorer simply picks the upgraded result (e.g., Double instead of Single) and adjusts runner outcomes in Step 3 to reflect the extra base advancement. No special handling is needed in the app.

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

Triggered by producer via "Finalize Game" in controller. See the **Stats Pipeline** section below for the full data flow.

Reads all tier-1 at-bat records from all finalized games + current game → squashes to tier-2 game summary → recomputes tier-3 season totals.

**Hitting stats computed:** `gp`, `pa`, `ab`, `h`, `doubles`, `triples`, `hr`, `r`, `rbi`, `bb`, `k`, `avg`, `obp`, `slg`, `ops`
**Pitching stats computed:** `gp`, `k`, `bb`, `inningsPitched` (outs ÷ 3), `era`, `w`, `l`

**Pitcher W/L rule:** Pitcher must have thrown at least 9 outs (3 full innings) in the game to qualify. The qualifying pitcher with the most outs for the winning team gets the W; same logic for L. If no pitcher on either side meets the threshold, no W/L is awarded. Saves are not tracked.

**`isSub` rule:** At-bats with `isSub: true` are excluded from season stats (tier 3) but included in game summaries (tier 2). A substitute's performance appears in the box score but does not count toward their season line.

Finalization is idempotent — re-running it overwrites stats cleanly from source records.

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

The **Lineup management** section is the authority on batting order and substitutions. The following rules apply:

- Batting order is set in the lineup at game creation and enforced by the scorekeeper — the next batter is pre-filled from the lineup order
- A player cannot bat unless they are in the lineup or added as a substitute
- Substitutes (`isSub: true`) can bat or pitch freely but their at-bats are excluded from season stat finalization
- Pitchers can change at any point mid-game — pitcher dropdown always shows full fielding team roster (lineup + subs)
- The lineup position pointer advances only on non-sub at-bats; subs don't consume a lineup slot and do not advance the order

## Stats Pipeline

The stats system has three tiers. Data always flows downward — never up.

```
/gameStats/{gameId}/{atBatId}     ← raw at-bat records (append-only, never deleted)
         │
         │  finalization squash (per-player, per-game)
         ▼
/gameSummaries/{gameId}/{playerId} ← game box score (AB, H, RBI, K, IP, etc.)
         │
         │  cumulative sum across all finalized games
         ▼
/players/{id}/stats                ← season totals (overwritten on each finalization)
```

**Tier 1 — At-bat records** (`/gameStats/{gameId}`)
- Every plate appearance is a separate record, written in real time by the scorekeeper
- Raw, granular, always recomputable
- Never deleted, even after finalization
- `isSub: true` records are included here but excluded when computing season stats (tier 3)

**Tier 2 — Game summaries** (`/gameSummaries/{gameId}/{playerId}`)
- Written on finalization — one document per player per game
- Includes sub at-bats (full game box score, not filtered)
- Useful for displaying a post-game box score without scanning hundreds of records
- Not currently used for season stat computation (tier 1 is the source for that), but could be in a future optimization

**Tier 3 — Season stats** (`/players/{id}/stats`)
- Computed from all finalized tier-1 logs (non-sub at-bats only)
- Overwritten completely on each finalization — not delta-updated
- This is what the overlay reads for stat cards and the stat overlay
- W/L is the exception: derived at game level (not at-bat level), so prior W/L is read from the existing tier-3 value and incremented by the current game result

**Live stats (in-game overlay)**
During an in-progress game, the overlay merges tier-3 (season totals) with a live read of tier-1 (current game at-bats) using `computeGameStats()` + `mergeHittingStats/mergePitchingStats`. No Firebase write is needed — this happens in memory via `useLivePlayerStats`. The moment a game is finalized, tier-3 is updated and the merge is no longer needed.

## Authentication

**Deferred to late-stage development.** Auth will not block any scorekeeper or controller work. Until auth is added, all routes are accessible without login. This is acceptable for development and internal use with a known group.

Planned scope (when ready):
- Scorekeeper route: requires login (any authenticated user)
- Controller route: requires login
- Overlay route: remains public (OBS browser source)
- Role model TBD (e.g. admin vs. scorekeeper-only)

## Open Questions

1. ~~**Pitcher W/L**~~ — **Resolved.** A pitcher must pitch a minimum of 3 complete innings to qualify for a win. Win is awarded to the pitcher of record for the winning team when the game ends. (See Stats Computation section.)

2. ~~**Runner advancement — batter placement on FC**~~ — **Resolved.** On a Fielder's Choice, `batterAdvancedTo` is NOT locked to 1st. The scorer selects where the batter actually ended up (1st, 2nd, 3rd) in Step 3 of the wizard. The fielder chose to retire another runner, but the batter may advance further depending on the throw.

3. ~~**Editing at-bats mid-game**~~ — **Resolved.** The half-inning is the natural recalc unit:
   - **`liveRunners` is fully isolated within a half-inning** — runners always reset to empty at the 3rd out, so editing an at-bat in inning 3 never affects runner state in inning 4+.
   - **Score** is a global sum of all `runnersScored` across the whole game — trivially recomputable after any edit, no ordering dependency.
   - **Lineup position** carries across innings but is also cheap to recompute: `(count of all non-sub at-bats for that team across the entire game) % lineupSize`. Recompute this after any edit.
   - **Recalc on edit = replay the current half-inning only.** Walk the at-bats for the current half-inning in timestamp order, recompute `liveRunners` and out count step by step. This is bounded and fast.
   - **Any at-bat in the current half-inning is editable.** Completed (past) half-innings are locked — scorer cannot edit them after the half-inning has been advanced. If a past half-inning has an error, scorer notes it; a "recalculate from history" admin tool is a post-launch concern.
   - **Delete within current half-inning** is also allowed and triggers the same half-inning replay to restore correct state.

---

## TODO

### 🔴 Preliminary (do first — blocks everything else)
- [x] Seed reset — `npm run seed` (players + pitching stats), `npm run snapshot` (capture clean state), `npm run reset` (restore from snapshot); Firebase reset button also in controller Dev Tools panel
- [x] Fix current game-stuck bug — always-visible "Start Over" button in scorekeeper header resets local wizard state
- [x] Add dev-only "Dev Tools" collapsible panel to controller and scorekeeper (guarded by `import.meta.env.DEV`)
  - [x] Cancel game (no stats written, confirmation required)
  - [x] Clear at-bat log only
  - [x] Reset live runners
  - [x] Force set inning
  - [x] Abandon game without finalizing
  - [x] Reset Firebase to snapshot (full wipe + restore, button in controller Dev Tools)

### Architecture / data model
- [x] Add `inning`, `isTopInning`, `outs`, `homeScore`, `awayScore`, `isStreamed`, `startedAt` to `/games/{gameId}` schema and `GameRecord` type
- [x] Add `/games/{gameId}/lineups/{teamId}` — ordered array of `{ playerId, isSub }` objects
- [x] Add `/games/{gameId}/lineupPosition/{teamId}` — current index in lineup order; persisted in Firebase so phone reloads don't lose position
- [x] Add `runnerOutcomes`, `outsOnPlay`, `isSub` fields to `AtBatRecord` type; remove `isEarnedRun` (not tracked)
- [ ] Add `/games/{gameId}/matchup` as the canonical matchup path (scorekeeper owns it); replace current `/game/matchup` writes in controller
- [x] Scorekeeper mirrors state to `/game/meta` and `/game/matchup` only when `isStreamed: true`
- [x] Remove `error` from `AtBatResult` type and from result buttons
- [x] Add `strikeout_looking` to `AtBatResult` — same stats as `strikeout`, displayed as ꓘ
- [x] Add `pitchers_poison` to `AtBatResult` — league-specific; AB counted, no RBI; `batterAdvancedTo` and runner outcomes depend on connected-chain detection (see Pitcher's Poison rule)
- [x] Game ID collision: check if ID exists at creation, append `_g2`/`_g3` etc. if so (`src/scoring/gameId.ts`)
- [x] Game ID date: use Eastern Time (`America/New_York`) not UTC (`src/scoring/gameId.ts`)
- [x] Add `gameSummaries/{gameId}/{playerId}` write to finalization logic
- [x] Decide on live game pointer path — using `/game/meta.currentGameId` (already in use, no new path needed)
- [x] New hooks: `useGameRecord`, `useGames`, `useGameLineup` (`src/hooks/`)
- [x] Scoring engine: `src/scoring/engine.ts` — `applyAtBat()`, `replayHalfInning()`, Pitcher's Poison chain detection, narrated log entries

### Lineup management
- [x] Per-game ordered batting lineup for each team — set in New Game modal, written to Firebase on create
- [x] Lineup stored at `/games/{gameId}/lineups/{teamId}` as ordered array of `{ playerId, isSub }`
- [x] Lineup position stored at `/games/{gameId}/lineupPosition/{teamId}` — persisted in Firebase, survives phone reloads
- [x] Scorekeeper auto-advances lineup position after each non-sub at-bat; wraps back to 0 after last batter
- [x] `isSub` denormalized onto each `AtBatRecord` at write time
- [x] Subs shown in batter dropdown with "(sub)" label in separate optgroup
- [ ] Lineup screen accessible from scorekeeper during a game — edit batting order mid-game
- [x] Batter pre-filled from lineup position in wizard Step 1 (still overridable)

### Scorekeeper UI
- [x] Game selector screen — lists today's games + in-progress, "New Game" button
- [x] New Game modal — 4-step: teams → home lineup → away lineup → confirm & create
- [x] Pitcher dropdown in Step 1 — writable, all fielding team players
- [x] Step 3 "Runner Outcomes" — per-runner row with Scored / Advanced (to base) / Stayed / Out
- [x] `outsOnPlay` computed from runner outcomes + batter result
- [x] 3+ outs auto-triggers half-inning end interstitial (no manual button needed)
- [x] Inning-end interstitial: shows score, next half-inning label, pitcher picker for incoming defense, "Start ▼N →" button
- [x] `advanceHalfInning()`: clears `liveRunners`, resets outs, flips `isTopInning`, increments inning after bottom half, writes next pitcher to matchup, mirrors to `/game/meta` if streamed
- [x] Score display at top of wizard (derived from `game.homeScore`/`awayScore`, updated on each submit)
- [x] Game complete prompt when 7 innings reached or 90 min elapsed since `startedAt`
- [x] Mirror writes to `/game/meta` when `isStreamed: true` (outs, bases, score, matchup)
- [x] Visual base diamond (`RunnerDiamond`) — shows runner initials on rotated base squares with out dots

### Controller
- [ ] Remove score +/− buttons (score is now derived) — in InteractiveScoreboard
- [ ] Remove inning advance/rewind buttons (scorekeeper owns inning state) — in InteractiveScoreboard
- [x] Add "Live Game" selector — picks which active game feeds the scorebug (writes `/game/meta.currentGameId`)
- [ ] Keep: scene switcher, stat overlay triggers, timer, scorebug dev controls, Finalize Game

### Stats & finalization
- [x] Write `/gameSummaries/{gameId}/{playerId}` on finalization (per-game box score)
- [x] Remove `error` from all RBI/AB computation branches
- [x] Pitcher W/L — implement; rule confirmed: minimum 3 complete innings pitched to qualify for win/loss
- [ ] Season reset: add an "Admin: Wipe Season Stats" action (auth-gated) that clears `/players/{id}/stats` for all players
- [ ] Verify finalization handles two simultaneous same-day games correctly (both can be finalized independently)

### Auth *(late-stage — do not start until everything else is complete)*
- [ ] Add Firebase Auth (email/password or Google)
- [ ] Gate `/controller` and `/scorekeeper` routes behind auth check
- [ ] `/overlay` stays public
- [ ] Admin role for season reset and finalization (vs. scorekeeper-only role)

### Dev log (DEV only)
- [x] In-memory play log (`PlayLogEntry[]` in React state) — resets on page reload
- [x] Each entry narrated step-by-step by engine: runner outcomes, Pitcher's Poison check, outsOnPlay, score delta, liveRunners after
- [x] Warnings in amber for contradictions (missing outcomes, base collisions, outsOnPlay > 3)
- [x] Collapsible "Play Log" panel in scorekeeper — purple, monospace, newest first, gated behind `import.meta.env.DEV`
- [ ] Also narrate half-inning replay recalc steps (when edit/delete triggers replay)

### Bugs / cleanup from initial implementation
- [x] Scorekeeper now reads game state from `/games/{gameId}` via `useGameRecord` — no longer depends on `/game/meta` for game logic
- [x] `AtBatResult` — `'error'` removed from type and UI
- [x] Game ID uses Eastern Time
- [x] `computeRbi` respects result type — no RBI on strikeout, strikeout_looking, pitchers_poison
- [x] At-bat log — only last entry editable/deletable (locked indicator on older entries)
- [ ] `finalizeGame` root `update(ref(db), updates)` — verify mixed-depth paths work or switch to batched `update` calls per subtree
- [x] Half-inning advance — auto-triggers at 3 outs, interstitial with pitcher prompt
- [x] `RunnerDiamond` component — shows runner initials on rotated base squares, replaces text runner badges
- [x] Half-inning recalc on edit/delete — wired to `replayHalfInning()`, rewrites liveRunners + outs + score
- [ ] Score on scorebug still manually controlled from controller — remove +/- from InteractiveScoreboard
- [x] Finalization must skip at-bats where `isSub: true` for season stats, include in `gameSummaries`
- [x] Visual base diamond built (`RunnerDiamond`)
- [ ] Lineup edit screen mid-game not yet built
- [x] Game complete prompt (7 innings / 90 min) — modal in scorekeeper, directs user to controller to finalize
- [ ] Post-launch: full half-inning replay recalc for editing completed (past) half-innings
