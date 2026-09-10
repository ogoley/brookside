# 2026 Brookside All-Star Game — Product Doc

Reference for how the all-star broadcast works and, most importantly, **how all-star
play is kept out of real season stats**. Read this before touching anything all-star
related.

## The one rule that matters

> **Nothing that happens in an all-star game is ever written to `players/{id}/stats`.**
> A player can go 7-for-8 with 3 homers in the all-star game and their season line
> does not move by a single at-bat.

All-star at-bats are still logged — they live in `gameStats/{gameId}` like any
scorekept game, so the live box score, play-by-play, undo/edit, and the scorebug all
work normally during the broadcast. They are *ephemeral with respect to season stats*:
the data exists, but no aggregation path ever folds it into a player record.

## How the separation is enforced (defense in depth)

Season stats have exactly one writer: `computeFinalization` (in
`src/scoring/finalization.ts`), which is called from three places. All three are
guarded by `isExhibitionGame(g, teams)` (`src/allstar.ts`), which checks three
layers in order — any one is sufficient:

1. `g.isExhibition === true` — denormalized onto the game record at creation by
   the scorekeeper's New Game flow. Survives team deletion; the primary signal
   for all future years.
2. Either team record has `isExhibition: true` (set by the seed). This is what
   makes the scorebug meta (`/game/meta`, which has no isExhibition field) and
   the controller's mode filtering work.
3. Legacy fallback: the hardcoded 2026 ids (`team_rist`/`team_hiller`), kept so
   2026 history stays protected even though those records predate the flags.

| Writer | Guard |
|---|---|
| `ControllerRoute.finalizeGame` | Finalize button replaced with an "exhibition" notice |
| `ScorekeeperRoute.finalizeGame` | Hard early-return + alert |
| `GameEditorRoute.refinalizeFromAtBats` | Hard early-return + message |

Two structural backstops mean even a missed guard wouldn't leak stats:

1. **Finalization only aggregates *finalized* games.** When any regular game is
   finalized, `computeFinalization` re-derives season totals from the at-bats of
   previously *finalized* games plus the game being finalized. The all-star game is
   never finalized, so its at-bats are invisible to every future finalization.
2. **Live-stat merges skip exhibitions.** The public stats page, derby page, and
   derby contestant pool merge at-bats from *non-finalized* games into displayed
   season stats in real time. Each of those merges filters with
   `!isExhibitionGame(g)`: `StatsRoute`, `DerbyRoute`, `useDerbyContestants`.
   Standings and results tabs only count finalized games, so the exhibition never
   appears there either.

**If you add a new consumer of season stats that merges live games, you must add the
`isExhibitionGame` filter.** If you add a new writer of `players/{id}/stats`, guard it.

## Data shapes & where things live

| Path | What |
|---|---|
| `teams/team_rist`, `teams/team_hiller` | Normal `Team` records (red `#c8102e` / blue `#1e40af`), logos at `/logos/team-rist.svg`, `/logos/team-hiller.svg` |
| `config/allstar/rosters/{teamId}` | `playerId[]` in draft order — the ONLY source of all-star membership |
| `games/{gameId}` + `gameStats/{gameId}` + `liveRunners/{gameId}` | The all-star game itself, scorekept exactly like a season game (stays `finalized: false` forever) |

Players are **not** modified: they keep their league `teamId`, and their all-star
membership exists only in the roster mapping. This was a deliberate decision —
mutating `teamId` would have corrupted every league-stats surface during all-star
weekend.

### Why rosters live under `/config`

Database rules allow admin writes to `/config` and `/teams` already; a new
`/allstar` top-level path would have required a rules deploy. Rosters are admin-set
data, so `config/allstar/rosters` fits and needed zero rules changes.

## Roster-aware team membership

Every place the app asks "is player X on team Y?" was switched from
`player.teamId === teamId` to `playerOnTeam(id, player, teamId, rosters)`:

- Rosters not seeded (or path deleted) → helper falls back to league-team matching,
  so the regular season is 100% unaffected.
- `effectiveGameTeamId` resolves which *side of the current game* a player is on
  (used for stat-overlay and matchup accent colors, box-score splits).
- `buildPlayerTeamMap` feeds the scoring engine's `computeLineupPosition` so the
  batting-order pointer self-heals correctly for all-star lineups.

Call sites: ControllerRoute (dropdowns, pitcher-side detection), Scoreboard
(batter/pitcher notches), StatCardScene, MatchupScene, StatOverlay, ScorekeeperRoute
(lineup builder, batter/pitcher pickers, sub-pitcher roster, live-stats table,
at-bat edit modal, both lineup-position computations), SummaryRoute.
**Not** covered: GameEditorRoute's roster pickers (admin repair tool — accepted gap).

## Setup & run of show

1. **Seed once** (✅ already done 2026-08-13 via `firebase database:update` as admin):
   `/config` → "All-Star Game" → *Create All-Star Teams + Rosters*.
   (Roster wrong? Edit `ALLSTAR_SEED_ROSTERS` in `src/allstar.ts`, deploy, hit
   *Re-seed from code*. In-game lineup tweaks don't need that — the scorekeeper
   lineup editor works as usual.)
2. **Scorekeeper**: New Game → pick Team Risty / Team Hiller → build lineups (the
   player pickers show each all-star roster) → score normally.
3. **Controller**: link the game as Live Game for the scorebug, run scenes as usual.
   The **⭐ Lineups** scene shows both batting orders with season stats and each
   player's league-team logo under the All-Star Weekend lockup.
4. **After the event**: do NOT finalize (the UI won't let you). Then
   `/config` → All-Star Game → *Archive & remove* (see "Archive & resurrect"
   below). The teams leave every picker and the nav; nothing is lost.

## Navigation

All overlays/controllers are reachable from the nav on the public pages — two
dropdowns: **Overlays** (Season `/overlay`, Derby `/derby-overlay`, All-Star
`/allstar-overlay`) and **Controllers** (Season `/controller`, Derby
`/derby-controller`, All-Star `/allstar-controller`).

`/allstar-overlay` renders the same `OverlayRoute` as `/overlay` — there is only one
scorebug state (`/game/meta`), and the overlay reflects whatever the controller puts
on it. `/allstar-controller` is `ControllerRoute` in **allstar mode** (`allstar`
prop): team pickers offer ONLY Team Risty / Team Hiller, the live-game dropdown lists
only exhibition games, the header carries the All-Star lockup, and a one-tap setup
banner ("Rist @ Hiller" / "Hiller @ Rist") appears until the scorebug is on the
all-star matchup (or a red warning if the teams haven't been seeded). The season
`/controller` is the mirror image: all-star teams and exhibition games are hidden
from its pickers so the exhibition can't be run from the season panel by accident.
There is intentionally no separate all-star controller codebase — same component,
mode-scoped pickers.

## Annual runbook (repeat every year — no ad-hoc engineering)

The all-star game + derby are annual. The yearly reset is intentionally two
buttons and one small config edit:

**All-Star Game (new captains each year):**
1. Edit the YEARLY CONFIG block at the top of `scripts/genAllstarLogos.mjs`
   (year, team ids, banner names, colors) and the matching
   `ALLSTAR_SEED_TEAMS` / `ALLSTAR_SEED_ROSTERS` in `src/allstar.ts`
   (include `isExhibition: true` on each team). These are the ONLY two files
   that change year to year.
2. `node scripts/genAllstarLogos.mjs` → regenerates the badges and
   `allstar-weekend.svg` (year-independent filename — nothing else references
   the year).
3. `npm run deploy`, then `/config` → All-Star Game → *Create / Re-seed*.
4. After the event: `/config` → All-Star Game → *Archive & remove* (enter the
   season year). Game records, if a scorekeeper game was used, stay in `/games`
   flagged `isExhibition: true` and never touch season stats.

### Archive & resurrect

The all-star teams are ephemeral on the live app but must survive for history and
for reuse. Everything lives in Firebase; no code changes are involved.

**Archive (after the event) — one button:**
`/config` → All-Star Game → *Archive & remove* → type the season year → *Confirm
archive*. This is a single atomic multi-path write (`buildAllstarArchiveUpdates`
in `src/allstar.ts`, unit-tested):

| Moves | From | To |
|---|---|---|
| Team records (name, colours, logoUrl, `isExhibition`) | `/teams/team_rist`, `/teams/team_hiller` | `/config/allstarArchive/{year}/teams/{id}` |
| Draft rosters (ordered playerId[]) | `/config/allstar/rosters/{id}` | `/config/allstarArchive/{year}/rosters/{id}` |

Effects: the teams vanish from the controller/scorekeeper pickers, `/config`, and
the All-Star nav pages fall back to their empty state. The static logos in
`public/logos/` and the roster constants in `src/allstar.ts` are untouched (they
are the next year's template). A game run off the plain scorebug (2026) leaves
nothing else behind; a game run through the scorekeeper stays in `/games` +
`/gameStats` flagged exhibition — the Game Editor can still open it.

**Resurrect a past season (e.g. to show 2026 lineups again):**
`/config` → All-Star Game → *Archived seasons* → *Restore* next to the year. Puts
the same two teams + rosters back exactly as they were (`buildAllstarRestoreUpdates`).
Restore is disabled while a current all-star pair is live — archive that first so
two seasons never coexist. The archive entry is kept; re-archive under the same
year is refused (pick the real year, or restore then archive again).

**Next year's game (new captains):** do NOT restore — follow steps 1–3 above
(edit the two yearly files, regenerate logos, deploy, *Create All-Star Teams +
Rosters*). Use new team ids (e.g. `team_<captain>`), keep `isExhibition: true`.
Archive it after the event the same way. Each season ends up as its own
`/config/allstarArchive/{year}` entry.

**Manual fallback (no UI):** the archive is plain JSON under `/config` — the
Firebase console or `firebase database:get /config/allstarArchive` shows it,
and copying `teams/*` back to `/teams/*` plus `rosters/*` to
`/config/allstar/rosters/*` is a full restore.

**Derby (same pool paths every year):**
1. After the payout is settled: `/derby` → admin mode → **Season tools** →
   *Archive this derby & reset*. Everything (entries, result, player toggles,
   broadcast scores) moves to `derby/archive/{year}` and the live page is a
   clean slate. That's the entire derby rollover.

## Player-name mapping caveats

- "Macker" → `brendan_mcdonald` (only Brendan in the league — confirm).
- "Mike LaFleur" → `-OtHHZTZG-3lDFkt196W` (added later via push key, not a slug id).
- "Joe Ogoley" → `dragon_ogoley`; "Mike V" → `michael_verteramo`;
  "Jon/Chris Spring(er)" → `jonathan_spring` / `chris_spring`.

## Logos

Static, self-contained SVGs in `public/logos/` (no Firebase Storage): the badge pair
`team-rist.svg` / `team-hiller.svg` and the wide `allstar-2026.svg` lockup
(`ALLSTAR_LOGO_URL`). Barlow Condensed 700 is base64-embedded in the SVG files
themselves so text renders correctly inside `<img>` tags and OBS browser sources,
which never apply the page's external fonts to SVG images. The wiffle ball on the
badges was traced from a user-supplied Noun Project reference (Melissa Schmitt):
a PERSPECTIVE band of 6 oblong slots arcing across the sphere, foreshortened to
slivers at the silhouette edges. Real wiffle balls have NO round holes, and flat
slot-fans read as paw prints — earlier attempts at both were rejected. The logos
are generated by `scripts/genAllstarLogos.mjs` (`node scripts/genAllstarLogos.mjs`
rewrites all three files; the embedded font lives in
`scripts/barlow-condensed-700.b64.txt`). Keep the traced `BALL_SLOTS` geometry.
