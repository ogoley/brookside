# Brookside Athletics — Data API Reference

All data lives in a Firebase Realtime Database. Every path is readable as JSON by appending `.json` to the URL. No authentication required for reads.

**Base URL:** `https://brookside-14b4b-default-rtdb.firebaseio.com`

**Example:** `GET https://brookside-14b4b-default-rtdb.firebaseio.com/teams.json`

---

## Endpoints

### `GET /teams.json`

All teams in the league.

**Response:** `Record<teamId, Team>`

| Field | Type | Description |
|---|---|---|
| `name` | string | Full team name (e.g. "Nuke Squad") |
| `shortName` | string | Abbreviation for scoreboards (e.g. "NUKE") |
| `primaryColor` | string | Hex color (e.g. "#FF5733") |
| `secondaryColor` | string | Accent hex color |
| `logoUrl` | string | URL to team logo image |

```json
{
  "nuke_squad": {
    "name": "Nuke Squad",
    "shortName": "NUKE",
    "primaryColor": "#c0392b",
    "secondaryColor": "#ffffff",
    "logoUrl": "https://firebasestorage.googleapis.com/..."
  }
}
```

---

### `GET /players.json`

All players in the league with cumulative season stats.

**Response:** `Record<playerId, Player>`

| Field | Type | Description |
|---|---|---|
| `name` | string | Player's full name |
| `teamId` | string | Team ID this player belongs to |
| `jerseyNumber` | string? | Jersey number (optional) |
| `stats.hitting` | HittingStats? | Season hitting stats (optional — absent if player has never batted) |
| `stats.pitching` | PitchingStats? | Season pitching stats (optional — absent if player has never pitched) |

#### HittingStats

| Field | Type | Description |
|---|---|---|
| `gp` | number | Games played |
| `pa` | number | Plate appearances (AB + BB) |
| `ab` | number | At bats (PA excluding walks) |
| `h` | number | Hits (1B + 2B + 3B + HR) |
| `doubles` | number | Doubles (2B) |
| `triples` | number | Triples (3B) |
| `hr` | number | Home runs |
| `r` | number | Runs scored |
| `rbi` | number | Runs batted in |
| `bb` | number | Base on balls (walks) |
| `k` | number | Strikeouts |
| `avg` | number | Batting average — `H / AB` |
| `obp` | number | On-base percentage — `(H + BB) / PA` |
| `slg` | number | Slugging percentage — `(1B + 2×2B + 3×3B + 4×HR) / AB` |
| `ops` | number | On-base plus slugging — `OBP + SLG` |

#### PitchingStats

| Field | Type | Description |
|---|---|---|
| `gp` | number | Games pitched |
| `inningsPitched` | number | Innings pitched as decimal (e.g. `4.0`, `5.33` = 5⅓) |
| `k` | number | Strikeouts thrown |
| `bb` | number | Walks allowed |
| `runsAllowed` | number | Total runs allowed |
| `era` | number | Earned run average — `(runsAllowed / IP) × 7` (projected over 7-inning game) |
| `w` | number | Wins |
| `l` | number | Losses |

---

### `GET /games.json`

All games (active and finalized).

**Response:** `Record<gameId, GameRecord>`

| Field | Type | Description |
|---|---|---|
| `homeTeamId` | string | Home team ID |
| `awayTeamId` | string | Away team ID |
| `date` | string | Game date as `"YYYY-MM-DD"` (Eastern Time) |
| `finalized` | boolean | `true` = game is complete, stats are final |
| `finalizedAt` | number? | Epoch ms when game was finalized |
| `startedAt` | number | Epoch ms when game started |
| `inning` | number | Final (or current) inning |
| `isTopInning` | boolean | `true` = top of inning |
| `outs` | number | Outs in the current/final half-inning |
| `homeScore` | number | Home team score |
| `awayScore` | number | Away team score |
| `isStreamed` | boolean | Whether this game was broadcast on the overlay |

**Game ID format:** `"YYYY-MM-DD_home-team_away-team"` (e.g. `"2026-04-09_nuke_squad_base_invaders"`)

**Deriving standings:** Filter for `finalized: true`, then compare `homeScore` vs `awayScore` to determine W/L/T per team.

---

### `GET /games/{gameId}.json`

Single game record (same shape as above).

---

### `GET /gameSummaries/{gameId}.json`

Per-player box score for a finalized game. Written once at finalization.

**Response:** `Record<playerId, GameSummary>`

| Field | Type | Description |
|---|---|---|
| `playerId` | string | Player ID |
| `teamId` | string | Team ID at time of game |
| `ab` | number | At bats |
| `pa` | number | Plate appearances |
| `h` | number | Hits |
| `doubles` | number | Doubles |
| `triples` | number | Triples |
| `hr` | number | Home runs |
| `r` | number | Runs scored |
| `rbi` | number | Runs batted in |
| `bb` | number | Walks |
| `k` | number | Strikeouts (batting) |
| `inningsPitched` | number | Innings pitched (0 if player didn't pitch) |
| `pitchingK` | number? | Strikeouts thrown (pitching) |
| `pitchingBb` | number? | Walks allowed (pitching) |
| `runsAllowed` | number? | Runs allowed (pitching) |

**Use case:** Aggregate across all finalized games to build season leaderboards. Each game's summary is independent — sum the counting stats, then recompute rate stats (AVG, OBP, SLG, ERA) from the totals.

---

### `GET /gameSummaries.json`

All game summaries at once. Structure: `Record<gameId, Record<playerId, GameSummary>>`.

This is the most efficient single call for building season-wide stats.

---

### `GET /gameStats/{gameId}.json`

Raw play-by-play at-bat log for a game (event-sourced). This is the source of truth — all other stats are derived from this.

**Response:** `Record<atBatId, AtBatRecord>`

| Field | Type | Description |
|---|---|---|
| `batterId` | string | Player ID of batter |
| `pitcherId` | string | Player ID of pitcher |
| `inning` | number | Inning the play occurred |
| `isTopInning` | boolean | Top or bottom of inning |
| `timestamp` | number | Epoch ms when recorded |
| `result` | string | Play outcome (see below) |
| `batterAdvancedTo` | string/null | `"first"`, `"second"`, `"third"`, `"home"`, `"out"`, or `null` |
| `outsOnPlay` | number | Total outs on this play |
| `rbiCount` | number | RBIs credited to batter |
| `runnersScored` | string[]? | Player IDs who scored |
| `runnersOnBase` | object? | Base state before the play: `{ first?, second?, third? }` (player IDs) |
| `runnerOutcomes` | object? | What happened to each runner: `"scored"`, `"second"`, `"third"`, `"stayed"`, `"out"`, `"sits"` |
| `isSub` | boolean | Whether batter was a substitute |

#### Result types

**Active (current season):**
`single`, `double`, `triple`, `home_run`, `walk`, `strikeout`, `strikeout_looking`, `groundout`, `popout`

**Legacy (historical records only):**
`flyout`, `hbp`, `sacrifice_fly`, `sacrifice_bunt`, `fielders_choice`, `pitchers_poison`

---

### `GET /games/{gameId}/lineups/{teamId}.json`

Batting lineup for a team in a specific game.

**Response:** `LineupEntry[]` (ordered array)

| Field | Type | Description |
|---|---|---|
| `playerId` | string | Player ID |
| `isSub` | boolean | `true` = substitute (not in regular batting order) |
| `subName` | string? | Display name if substitute isn't on the roster |

Array index = batting order position (0 = leadoff).

---

### `GET /config.json`

League configuration.

| Field | Type | Description |
|---|---|---|
| `leagueLogo` | string | URL to the league logo image |

---

## Recommended approach for the official site

### Season standings
1. `GET /games.json` → filter where `finalized === true`
2. For each game, compare `homeScore` vs `awayScore` to tally W/L/T per `homeTeamId` and `awayTeamId`
3. Win percentage: `(W + T × 0.5) / (W + L + T)`

### Season hitting leaderboard
1. `GET /gameSummaries.json` → one call gets all game box scores
2. Group by `playerId`, sum counting stats (`pa`, `ab`, `h`, `doubles`, `triples`, `hr`, `r`, `rbi`, `bb`, `k`)
3. Compute: `AVG = h / ab`, `OBP = (h + bb) / pa`, `SLG = (1B + 2×2B + 3×3B + 4×HR) / ab`, `OPS = OBP + SLG`
4. `GET /players.json` and `GET /teams.json` to resolve names, jersey numbers, team info

### Season pitching leaderboard
1. Same `GET /gameSummaries.json`
2. Filter entries where `inningsPitched > 0`, group by `playerId`
3. Convert each game's `inningsPitched` to outs: `Math.round(ip × 3)`, sum raw outs across games
4. Final IP: `Math.floor(totalOuts / 3) + (totalOuts % 3) / 3`
5. `ERA = (totalRunsAllowed / (totalOuts / 3)) × 7`

### Game results
1. `GET /games.json` → filter `finalized === true`, sort by `startedAt` descending
2. Join with `GET /teams.json` for team names and logos
3. Filter client-side by `homeTeamId` or `awayTeamId` for team-specific views

### Team roster
1. `GET /players.json` → filter by `teamId`
2. Each player has `name`, `jerseyNumber`, and `stats.hitting` / `stats.pitching` for pre-computed season totals

---

## Notes

- **No auth required** — all paths are publicly readable via REST
- **All timestamps** are epoch milliseconds (not seconds)
- **Firebase omits empty objects** — if a player has never batted, `stats.hitting` won't exist (check before accessing)
- **Data volume is small** — fetching `/gameSummaries.json` or `/players.json` in a single call is fine; no need for pagination
- **Real-time updates** — Firebase supports `EventSource` streaming via `GET /path.json?orderBy="$key"&limitToLast=10` etc., but for a static site, simple fetches on page load are sufficient
