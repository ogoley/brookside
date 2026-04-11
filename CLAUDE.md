# Wiffle Ball Broadcast Overlay — Claude Context

## What this is
A live broadcast overlay system for a small wiffle ball league. Runs as a single Vite + React + TypeScript app with three routes served to different devices simultaneously. Firebase Realtime Database is the **only** communication channel between routes — there are no direct API calls between views.

## Stack
- **Vite + React + TypeScript** — build tool and framework
- **Firebase Realtime Database** (SDK v10) — sole source of truth; all state lives here
- **Tailwind CSS v4** with `@tailwindcss/vite` plugin — utility classes
- **Framer Motion** — overlay animations
- **React Router v6** — three routes
- **Google Fonts** — Barlow Condensed (scoreboard numbers/labels) + DM Sans (UI text)

## Routes

| Route | Device | Purpose |
|---|---|---|
| `/overlay` | OBS browser source (1920×1080) | On-screen graphics — read-only, never writes Firebase |
| `/controller` | Tablet or desktop browser | Producer control panel — the only writer; responsive layout |
| `/scorekeeper` | Phone or tablet | Per at-bat logging (stretch goal, writes `/gameStats`); responsive layout |

## Firebase data shape
```
/game/meta                         — GameMeta: scores, inning, outs, bases, team IDs
/game/matchup                      — MatchupState: { batterId, pitcherId, lastPitcherHome, lastPitcherAway }
/teams/{teamId}                    — Team: name, shortName, primaryColor, secondaryColor, logoUrl
/overlay                           — activeScene + statOverlay + timer + scoreboardBorder + scoreboardScale
/overlay/timer                     — TimerState: { durationMs, startedAt, running } — default 60 min
/players/{id}                      — Player: name, teamId, position, stats: { hitting?: HittingStats, pitching?: PitchingStats }
/games/{gameId}                    — GameRecord: teams, date, inning, outs, scores, finalized, lineups, lineupPosition, matchup
/games/{gameId}/matchup            — { pitcherId, batterId, lastPitcherHome, lastPitcherAway } — persists pitcher across refresh
/games/{gameId}/lineups/{teamId}   — GameLineup (ordered LineupEntry[])
/games/{gameId}/lineupPosition/{teamId} — current batting order index (int)
/gameStats/{gameId}/{atBatId}      — AtBatRecord: full at-bat log entry
/liveRunners/{gameId}              — RunnersState: { first, second, third } — current base state
```
Full type definitions in `src/types.ts`.

## Key architectural decisions (do not reverse without discussion)
- **Overlay is purely reactive** — `OverlayRoute` never writes to Firebase. Only `ControllerRoute` writes.
- **Firebase listeners only** — no Redux, Zustand, or other state lib. Hooks in `src/hooks/` each own one Firebase path.
- **Team colors via CSS custom properties** — `TeamColorInjector` sets `--team-home-primary` etc. on `:root`. All components reference these vars. Do not hardcode team colors in components.
- **Scene system is a flat map** — adding a scene means: new file in `src/scenes/`, export in `src/scenes/index.ts`, render case in `OverlayRoute.tsx`, button in `SCENES[]` in `ControllerRoute.tsx`, type added to `SceneName` in `types.ts`.
- **Auto-dismiss lives in the overlay, not the controller** — `StatOverlay.tsx` runs the dismiss timer and writes `visible: false` back to Firebase itself. The controller just sets `visible: true`.
- **`dismissAfterMs` is stored in Firebase** so it's live-adjustable from the controller without a redeploy.
- **Scoreboard is a pill layout** — `Scoreboard.tsx` builds the layout directly (does not use `TeamBug`). Away team: left pill `[NAME | SCORE]` rounded-left, home team: right pill `[SCORE | NAME]` rounded-right, scores facing the center. `TeamBug` still exists for potential future use and accepts a `mirrored` prop, but is not used in the overlay scoreboard.
- **Broadcast scoreboard is centered at 36% width** — `GameScene` wraps `Scoreboard` in a centered container (`width: 36%`). Do not make it full-width or reduce below ~30% or the pills will clip.
- **Scoreboard center section uses fixed-width cells** — inning, bases, and outs each use `width: 150, flexShrink: 0`. Do not use `flex-1` or `justify-center` with gaps — auto-sizing produces unequal cells and off-centers the timer notch.
- **Timer is a notch below the center pill** — the countdown renders in an absolutely-positioned element below the center strip (`top: '100%'`), same `rgba(0,0,0,0.82)` background, rounded bottom corners. It is always visible (displays `0:00` when expired). The controller timer control is a single row: `[min input] [Set] [countdown display] [Start/Pause] [Reset]`.
- **Inning control is two half-inning step buttons** — `InteractiveScoreboard` exposes `onAdvanceHalfInning` and `onRewindHalfInning`. Both clear outs and bases. There are no separate +1/-1 inning or top/bottom toggle buttons.
- **Tailwind v4 cascade layers** — do not add unlayered CSS rules (e.g. `* { padding: 0 }`) after `@import "tailwindcss"` in `index.css`. Unlayered styles outrank Tailwind's `@layer utilities`, silently breaking utility classes. Tailwind's Preflight already handles box-model resets.
- **Controller game-state controls are in `InteractiveScoreboard`** — score, inning, bases, and outs are all controlled via the visual `InteractiveScoreboard` component, not separate button sections. Inning ▲/▼ uses the same symbol as the broadcast overlay.
- **Player stats are nested** — `Player.stats` has two optional buckets: `stats.hitting` (`HittingStats`) and `stats.pitching` (`PitchingStats`). A player can have one or both. Never read flat `stats.avg` etc. — always go through the bucket.
- **Matchup state lives at `/game/matchup`** — `{ batterId, pitcherId, lastPitcherHome, lastPitcherAway }`. `useMatchup` hook owns this path. The controller writes it; the overlay reads it. `lastPitcherHome/Away` are used by `advanceHalfInning` to restore the correct pitcher when the half-inning flips.
- **Batter/pitcher notches on the scorebug** — `Scoreboard.tsx` renders a `PlayerNotch` (Framer Motion spring-bounce) below each team pill. Batter notch shows under the batting team, pitcher notch under the fielding team. Batter notch is hidden while `statOverlayVisible` is true. Both show last name only.
- **Batter auto-clears on play result** — `ControllerRoute` has a `useEffect` that writes `batterId: null` to `/game/matchup` whenever `game.outs` or any base changes. A `mountedRef` guard prevents firing on initial load.
- **Controller "At Bat" section is the single source of truth for who is up** — one unified section handles: batter dropdown (auto-triggers 20s stat overlay on select), HOME RUN button (uses selected batter, auto-scores bases), pitcher dropdown, delay picker, Batter Stats / Pitcher Stats / Dismiss buttons. There are no separate Matchup / Home Run / Stat Overlay sections.
- **`scoreboardBorder` and `scoreboardScale`** live in `/overlay` and are exposed as dev controls in the controller (border toggle, size slider). `showBorder` prop on `Scoreboard` gates the `-webkit-text-stroke`.

## Scorekeeper architecture (ScorekeeperRoute.tsx)
- **Event-sourced scoring** — all game state is derivable by replaying `gameStats/{gameId}`. `liveRunners` and score totals in `games/{gameId}` are derived/cached values, not the source of truth.
- **Active `AtBatResult` types** — the only selectable options are: `single | double | triple | home_run | walk | strikeout | strikeout_looking | groundout | popout`. Legacy values (`flyout | hbp | sacrifice_fly | sacrifice_bunt | fielders_choice | pitchers_poison`) are kept in the type union only so historical records still deserialize correctly — they are not selectable.
- **`groundout` = "Ground / Tag Out"** — any out where the ball was fielded (grounder, tag play). `popout` = ball caught in the air. These are the only two out types.
- **Connected chain rule (groundout only)** — on a `groundout`, if runners occupy consecutive bases starting from 1st (no gap), the lead runner of that chain leaves the basepath (`'sits'`), and the batter stays on 1st. 1 out total. `popout` is explicitly exempt — runners may tag up freely. The rule does NOT apply to `popout`.
- **`'sits'` runner outcome** — distinct from `'out'`. Means the runner leaves the bases as a chain rule consequence (not a genuine out on them). Counts toward `outsOnPlay` the same as `'out'`, but the batter is recorded as the out and the runner is just displaced. Displayed in yellow in the UI.
- **`outsOnPlay`** — `(batterAdvancedTo === 'out' ? 1 : 0) + runners.filter(o => o === 'out' || o === 'sits').length`. Can be 0 for hits/walks, 1 for normal outs, 2+ for double plays.
- **Outs are NOT reset to 0 in `submit()`** — `games/{gameId}/outs` can reach 3+ after the third out. `advanceHalfInning()` is the only function that resets outs to 0. On page refresh with `outs >= 3`, a `useEffect` detects this and restores the `inning_end` interstitial.
- **Pitcher state persistence** — three layers: (1) `advanceHalfInning` calls `setPitcherId(nextPitcherId)` before clearing it; (2) on load a `useEffect` re-hydrates `pitcherId` from `game.matchup.pitcherId` if local state is empty; (3) `inning_end` step pre-fills `nextPitcherId` from `lastPitcherHome`/`lastPitcherAway` based on which side just finished.
- **`lastPitcherHome` / `lastPitcherAway`** in `games/{gameId}/matchup` — store the most recent pitcher selected for each side. Written by `advanceHalfInning` using the INCOMING pitcher: top just ended → away pitches next → `lastPitcherAway`; bottom just ended → home pitches next → `lastPitcherHome`. Pre-fill at `inning_end` uses: `isTopInning ? lastPitcherAway : lastPitcherHome`.
- **Undo** — visible when at batter step with prior at-bat. Calls `undoLastAtBat()` which pre-fills wizard with the last at-bat, then deletes it.
- **Any at-bat is editable or deletable** — the play-by-play log shows every at-bat (current or past innings) as a clickable row. Tapping opens `AtBatEditModal`, which shows a cascade preview (home/away delta + current half outs delta + warnings) before committing. `deleteAtBat` and `applyRecompute` both funnel through `recomputeGameState` (in `scoring/engine.ts`), which replays every half-inning from scratch — migrating runner outcomes by runner ID so that runner intent survives upstream edits — and returns new scores, current-half runners/outs, and warnings. `applyRecompute` writes the recomputed at-bats, score, outs, runners, and both teams' `lineupPosition` in one atomic update, and flips the wizard step between `batter` and `inning_end` if outs crossed the 3-out threshold in either direction.
- **`isSub` is a stat-exclusion tag only** — a sub is a body filling a roster slot for the day; they bat in the batting order exactly like a regular, advance the lineup pointer like a regular, and their at-bats are stored in `gameStats/{gameId}` forever. The only effect of `isSub: true` is at finalization: `computeFinalization` skips sub at-bats when rolling up season totals, but `computeGameSummaries` includes them in the per-game box score. `isSub` is denormalized onto each `AtBatRecord` at submit time from the `LineupEntry.isSub` flag. Custom subs (people not on the roster) are stored in the lineup with a fabricated `sub_<timestamp>` playerId and a `subName` — on the scorebug notch, custom subs' batter preview clears to `null` rather than showing a bogus ID.
- **`lineupPosition` is derived, not counted** — `computeLineupPosition` walks backward through the at-bat log for a team, finds the most-recent batter still present in the current lineup (regulars and subs alike), and returns the slot after them. This self-heals scorer overrides (picked out-of-order batter), mid-game removals, and reorders. Called from `applyRecompute` (on any edit/delete) and `LineupEditScreen.save()` (on lineup edit); `submit()` also advances the pointer directly from the actual batter's slot so the pre-fill is correct on the very next at-bat.
- **Live game stats** — collapsible "Game Stats" panel shows AB/H/RBI/HR/O per batter in a two-column away|home table. "O" (outs) uses result-based check: `['strikeout', 'strikeout_looking', 'groundout', 'popout', 'flyout', 'sacrifice_fly', 'sacrifice_bunt'].includes(result)`.
- **`scoring/engine.ts`** — pure functions, no Firebase/React. `applyAtBat` → narrated log + next runner state. `replayHalfInning` → replays ordered at-bat list. `computeGameStats` → per-player hitting/pitching stats from a list of at-bats. `mergeHittingStats` → merges season totals with a game's stats; OBP uses PA as denominator (`(h + bb) / pa`) since HBP/SF aren't separately tracked in stored season stats.

## File map
```
src/
  types.ts                  — all shared TypeScript interfaces
  firebase.ts               — Firebase app init (reads from .env.local)
  hooks/
    useGameData.ts          — /game/meta listener
    useTeams.ts             — /teams listener
    useOverlayState.ts      — /overlay listener (includes scoreboardBorder, scoreboardScale defaults)
    usePlayers.ts           — /players listener
    useMatchup.ts           — /game/matchup listener; default { batterId: null, pitcherId: null, lastPitcherHome: null, lastPitcherAway: null }
    useGameRecord.ts        — /games/{gameId} listener (GameRecord)
    useGameStats.ts         — /gameStats/{gameId} listener (AtBatRecord map)
    useGames.ts             — /games listener (all games list)
    useGameLineup.ts        — /games/{gameId}/lineups/{teamId} listener
    useLiveRunners.ts       — /liveRunners/{gameId} listener (RunnersState)
  components/
    Scoreboard.tsx          — broadcast overlay scoreboard; pill layout built inline (not via TeamBug); always shows countdown timer; centered at 36% width in GameScene
    TeamBug.tsx             — logo + short name + score block (not used in Scoreboard); accepts mirrored prop; available for other scenes
    BaseDiamond.tsx         — read-only base runners diamond (used in Scoreboard overlay)
    OutIndicator.tsx        — read-only out dots (exists but Scoreboard inlines its own scaled version)
    InteractiveScoreboard.tsx — controller-only; tappable scoreboard controlling score, inning (◀½ / ▶½ buttons), bases, outs
    StatOverlay.tsx         — Framer Motion slide-up strip with auto-dismiss timer
    PlayerCard.tsx          — reusable stat display block (used in StatCardScene)
    TeamColorInjector.tsx   — injects CSS vars on mount; renders nothing
    RunnerDiamond.tsx       — scorekeeper-only; shows live base runners with player names
  scenes/
    GameScene.tsx           — scoreboard over transparent bg + stat overlay
    StatCardScene.tsx       — full-screen between-innings team stat table
    IdleScene.tsx           — league logo / waiting screen
    MatchupScene.tsx        — pitcher vs batter card (stub, stretch goal)
    index.ts                — barrel export
  scoring/
    engine.ts               — pure scoring functions: applyAtBat, replayHalfInning, computeGameStats, mergeHittingStats, mergePitchingStats, formatResult
    gameId.ts               — generateGameId, getEasternDateString helpers
  routes/
    OverlayRoute.tsx        — 1920×1080 canvas, AnimatePresence scene switcher
    ControllerRoute.tsx     — all game controls; only file that writes game state
    ScorekeeperRoute.tsx    — at-bat log entry wizard; writes /games, /gameStats, /liveRunners
```

## Dev setup
```bash
npm run dev   # starts on localhost:5173
```
Requires `.env.local` with Firebase config. See `.env.example` for keys. See `OBS_SETUP.md` for OBS browser source config and Firebase database seeding.

## Fonts
Always use `fontFamily: 'var(--font-score)'` for scoreboard/stat numbers and `var(--font-ui)` for prose/labels. Do not use Tailwind's `font-sans` — it won't load the right font.

## Dev-only files
These files are needed for development/setup but do not ship to production. Track them here so they can be cleaned up when the project is done.

| File | Purpose | Safe to delete when |
|---|---|---|
| `scripts/seedPlayers.js` | One-time player import — seeds `/players` in Firebase | Season data is finalized and won't be re-seeded |
| `scripts/exportSnapshot.js` | Captures current Firebase state to `firebase-snapshot.json` | No longer need to reset Firebase during development |
| `scripts/resetDb.js` | Wipes Firebase and restores from snapshot | Development is done, no more test resets needed |
| `scripts/migrateTeamIds.js` | One-time migration: GUID team IDs → slug IDs | Already ran — can delete now |
| `firebase-snapshot.json` | Clean-state Firebase snapshot used by `npm run reset` | Development is done |
| ~~`firebase-seed.json`~~ | ~~Old placeholder seed data — superseded~~ | ✅ Deleted |
| ~~`brookside-11361-default-rtdb-pitchingStats-export.json`~~ | ~~Raw pitching stats export — inlined in `seedPlayers.js`~~ | ✅ Deleted |
| `OBS_SETUP.md` | OBS browser source setup instructions | Project is fully documented elsewhere |
