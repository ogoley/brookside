# Wiffle Ball Broadcast Overlay — Architecture Reference

> Last updated: 2026-04-10
> See `docs/diagrams.md` for visual Mermaid diagrams of all flows described here.

---

## System Overview

A live broadcast overlay system for the Brookside Athletics wiffle ball league. A single Vite + React + TypeScript app serves three routes simultaneously to different devices. **Firebase Realtime Database is the only communication channel between routes** — there are no direct API calls between views.

---

## Routes

| Route | Device | Reads Firebase | Writes Firebase |
|---|---|---|---|
| `/overlay` | OBS browser source (1920×1080) | Yes | Never |
| `/controller` | Producer tablet/desktop | Yes | Yes — game state |
| `/scorekeeper` | Scorekeeper phone/tablet | Yes | Yes — at-bats, runners, scores |
| `/stats` | Public / any browser | Yes | Never |
| `/game-editor` | Admin browser | Yes | Yes — summaries, season stats, game records |

---

## Firebase Schema

```
/config
  leagueLogo                    string — URL

/game/meta                      GameMeta — live scorebug state (mirrors active game)
  homeTeamId, awayTeamId
  inning, isTopInning, outs
  bases: { first, second, third }
  homeScore, awayScore
  isActive, currentGameId

/game/matchup                   MatchupState
  batterId, pitcherId
  lastPitcherHome, lastPitcherAway

/teams/{teamId}                 Team
  name, shortName
  primaryColor, secondaryColor
  logoUrl

/players/{playerId}             Player
  name, teamId, jerseyNumber
  stats/hitting                 HittingStats  — season totals (recomputed on finalization)
  stats/pitching                PitchingStats — season totals (recomputed on finalization)

/overlay                        OverlayState
  activeScene
  statOverlay: { visible, type, playerId, dismissAfterMs }
  timer: { durationMs, startedAt, running }
  homerun: { active, teamSide, playerId, logoUrl, runsScored, triggeredAt }
  insights: { title, point1–4, visibleCount }
  scoreboardBorder, scoreboardScale

/games/{gameId}                 GameRecord
  homeTeamId, awayTeamId, date
  isStreamed, finalized, finalizedAt, startedAt
  inning, isTopInning, outs
  homeScore, awayScore          ← cached totals; source of truth is /gameStats
  wPitcherId, lPitcherId        ← set on finalization or manual entry in Game Editor
  matchup: { pitcherId, batterId, lastPitcherHome, lastPitcherAway }

/games/{gameId}/lineups/{teamId}   GameLineup — ordered LineupEntry[]
/games/{gameId}/lineupPosition/{teamId}  int — current batting order index

/gameStats/{gameId}/{atBatId}   AtBatRecord — full event log (source of truth)
  batterId, pitcherId, isSub
  inning, isTopInning, timestamp
  result                        AtBatResult
  runnersOnBase                 RunnersState — snapshot BEFORE play
                                ⚠ Firebase drops this key when all bases null (empty bases)
                                  Always read as: runnersOnBase ?? { first:null, second:null, third:null }
  runnerOutcomes                RunnerOutcomes
  runnersScored                 string[] — playerIds
  outsOnPlay, rbiCount
  batterAdvancedTo

/liveRunners/{gameId}           RunnersState — current base state (derived/cached)
  first, second, third          string | null — playerId or null

/gameSummaries/{gameId}/{playerId}  GameSummary — per-game box score
  playerId, teamId
  ab, pa, h, doubles, triples, hr, r, rbi, bb, k
  inningsPitched                ← stored as true decimal: 6+2/3 = 6.6̄, displayed as "6.2"
  pitchingK, pitchingBb, runsAllowed

/standings                      StandingsData — ordered TeamStanding[]
```

---

## Data Flow

### Live Game (Scorekeeper → Firebase → Overlay)

```
ScorekeeperRoute
  └─ submit()
       ├─ push  → /gameStats/{gameId}/{atBatId}     (source of truth)
       ├─ set   → /liveRunners/{gameId}              (derived runner state)
       └─ update → /games/{gameId}  { outs, homeScore, awayScore, inning, ... }
                   /game/meta       (if isStreamed)
                   /game/matchup    (pitcherId, batterId)

Firebase
  └─ onValue listeners in hooks → React state → UI re-render
       useGameRecord   → /games/{gameId}
       useLiveRunners  → /liveRunners/{gameId}
       useGameStats    → /gameStats/{gameId}
       useMatchup      → /game/matchup

OverlayRoute  (read-only, never writes)
  └─ reads: useGameData, useTeams, useOverlayState, useMatchup, usePlayers
```

### Game Finalization (Controller → Firebase)

```
ControllerRoute
  └─ "Finalize Game" confirmed
       └─ computeFinalization(input)     ← pure function, src/scoring/finalization.ts
            ├─ replays ALL at-bats from all finalized games
            ├─ computes season hitting stats per player
            ├─ computes season pitching stats per player (IP, K, BB, RA, ERA)
            ├─ derives W/L from most-outs pitcher (min 9 outs to qualify)
            └─ returns multi-path update object

       └─ update(ref(db), updates) writes:
            ├─ /players/{id}/stats/hitting    ← season totals (overwritten)
            ├─ /players/{id}/stats/pitching   ← season totals (overwritten)
            ├─ /gameSummaries/{gameId}/{id}   ← per-game box score
            └─ /games/{gameId}/finalized = true
```

### Game Editor (admin corrections + paper stats)

```
GameEditorRoute
  ├─ Loads:  /gameSummaries/{gameId}  (per-game summaries)
  │           /gameStats/{gameId}      (at-bats for trace panel)
  │           /games                   (all game records)
  │
  ├─ Edit:   User modifies cells → local `edits` state (not yet in Firebase)
  │
  └─ Save:
       ├─ Merges edits into game summaries
       ├─ Auto-computes PA = AB + BB if PA = 0
       ├─ Derives homeScore/awayScore from sum of R per team
       ├─ Writes /gameSummaries/{gameId}/{playerId}  for each player
       ├─ Writes /games/{gameId}/homeScore, awayScore, wPitcherId, lPitcherId
       ├─ recalcSeasonStats() — sums all gameSummaries → new season totals
       │    Writes /players/{id}/stats/hitting
       │    Writes /players/{id}/stats/pitching  (preserves W/L via spread, then applies delta)
       └─ Applies W/L delta: if wPitcherId changed, subtracts old W and adds new W
```

### Paper Game Entry (no play-by-play)

```
GameEditorRoute
  └─ "+ New Paper Game"
       ├─ User picks away team, home team, date
       ├─ generateGameId() → collision-checked ID: {date}_{homeId}_{awayId}
       └─ set /games/{gameId}  { finalized: true, isStreamed: false, scores: 0/0, ... }

  └─ User fills box score manually (batters + pitchers)
  └─ Selects W pitcher / L pitcher from dropdowns
  └─ Save → same path as above
       Score derived from R totals, W/L written to game record + season stats
```

---

## Innings Pitched — Storage Format

IP is stored as a **true decimal**, not "baseball notation":

| Baseball display | Stored value | Outs |
|---|---|---|
| `5` | `5.0` | 15 |
| `5.1` | `5.333...` | 16 |
| `5.2` | `5.666...` | 17 |
| `6` | `6.0` | 18 |

**Round-trip**: `outs → ip`: `Math.floor(outs/3) + (outs%3)/3`
**Display**: `formatIp(ip)` → `Math.floor(ip)` + `.` + `Math.round((ip - full) * 3)`
**Parse user input** (`"5.2"`): split on `.`, full=5, partial=2, outs=17, ip=17/3

**Known gotcha**: Firebase drops `null` values on write. If all bases are empty, `runnersOnBase: { first:null, second:null, third:null }` becomes an empty object which Firebase deletes entirely. Always read `runnersOnBase` with a `?? { first:null, second:null, third:null }` fallback.

---

## Season Stats Recalculation

Two paths exist — they must stay consistent:

| Path | Trigger | Source of truth |
|---|---|---|
| `computeFinalization()` | "Finalize Game" in Controller | Replays all `/gameStats` at-bats |
| `recalcSeasonStats()` | Save in Game Editor | Sums all `/gameSummaries` |

Both write to `/players/{id}/stats`. The Game Editor path is used for corrections and paper games. **`recalcSeasonStats` preserves existing W/L** via `{ ...existing, ...newStats }` — W/L is then adjusted separately via delta logic.

If a game was finalized through the Controller and later corrected in the Editor, the Editor's recalc takes precedence. Re-finalizing through the Controller would overwrite again.

---

## Scoring Engine (`src/scoring/engine.ts`)

Pure functions — no Firebase, no React:

| Function | Purpose |
|---|---|
| `applyAtBat(record, runners)` | Applies one at-bat to runner state, returns next state + narration |
| `replayHalfInning(atBats)` | Replays ordered at-bat list, returns final runner state + outs |
| `computeGameStats(atBats, playerId)` | Per-player stats for one game |
| `mergeHittingStats(season, game)` | Merges season totals with in-progress game stats |
| `mergePitchingStats(season, game)` | Same for pitching; handles legacy ERA-only records |
| `formatResult(result)` | Human-readable at-bat result label |

---

## Scorekeeper — Connected Chain Rule

On a `groundout`:
- If runners occupy consecutive bases starting from 1st (no gap), the **lead runner of that chain** is marked `'sits'` (leaves basepath, not a genuine out on them) and the **batter stays on 1st**
- `outsOnPlay` counts `'sits'` the same as `'out'`
- `popout` is explicitly exempt — runners may tag and advance freely

---

## Key Hooks

| Hook | Firebase path | Notes |
|---|---|---|
| `useGameData` | `/game/meta` | Live scorebug state |
| `useTeams` | `/teams` | All teams |
| `useOverlayState` | `/overlay` | Scene + timer + stat overlay |
| `usePlayers` | `/players` | Normalizes missing `stats: {}` |
| `useMatchup` | `/game/matchup` | Batter/pitcher; default all null |
| `useGameRecord` | `/games/{gameId}` | Single game record |
| `useGameStats` | `/gameStats/{gameId}` | At-bat map for one game |
| `useGames` | `/games` | All games, sorted by startedAt desc |
| `useGameLineup` | `/games/{gameId}/lineups/{teamId}` | Ordered lineup |
| `useLiveRunners` | `/liveRunners/{gameId}` | Current base state; defaults to all null |
| `useLeagueConfig` | `/config` | Logo URL |

---

## Adding a New Scene (Overlay)

1. New file in `src/scenes/`
2. Export from `src/scenes/index.ts`
3. Add render case in `OverlayRoute.tsx`
4. Add button to `SCENES[]` in `ControllerRoute.tsx`
5. Add type to `SceneName` in `types.ts`

---

## Team Colors

`TeamColorInjector` sets CSS custom properties on `:root`:
- `--team-home-primary`, `--team-home-secondary`
- `--team-away-primary`, `--team-away-secondary`

Never hardcode team colors in components. Always use these vars.

---

## Fonts

| Variable | Use |
|---|---|
| `var(--font-score)` | Scoreboard numbers, stats, labels |
| `var(--font-ui)` | Prose, form controls, buttons |

Never use Tailwind's `font-sans` — it won't load the correct font.
