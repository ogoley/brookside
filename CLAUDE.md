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
/overlay                           — activeScene + statOverlay + timer + sponsor + ticker + scoreboardBorder + scoreboardScale
/overlay/timer                     — TimerState: { durationMs, startedAt, running } — default 60 min
/overlay/sponsor                   — SponsorOverlayState: { active, sponsorId, inning, triggeredAt, durationMs, autoShow }
/overlay/ticker                    — TickerState: { visible, speed, accentColor, sections{...}, messages{pushKey: text} }
/config/sponsors/{sponsorId}       — Sponsor: name, tagline, logoUrl, website, accentColor, lightPlate, innings{"N":true}, enabled, order
/config/schedule/{siteGameId}      — remaining games: date, time, homeTeamId, awayTeamId, status (scheduled|postponed|cancelled), venue, source
/config/scheduleMeta               — { syncedAt, source, season, scheduled, postponed } written by scripts/syncSchedule.mjs
/players/{id}                      — Player: name, teamId, position, stats: { hitting?: HittingStats, pitching?: PitchingStats }
/games/{gameId}                    — GameRecord: teams, date, inning, outs, scores, finalized, lineups, lineupPosition, matchup, forfeit? (see Forfeits)
/games/{gameId}/matchup            — { pitcherId, batterId, lastPitcherHome, lastPitcherAway } — persists pitcher across refresh
/games/{gameId}/lineups/{teamId}   — GameLineup (ordered LineupEntry[])
/games/{gameId}/lineupPosition/{teamId} — current batting order index (int)
/gameStats/{gameId}/{atBatId}      — AtBatRecord: full at-bat log entry
/liveRunners/{gameId}              — RunnersState: { first, second, third } — current base state
/voting/meta                       — { open, title } — season-awards poll status
/voting/awards/{awardId}           — Award: name, kind (player|team), order, description?, candidates?{id:true}
/voting/voters/{token}             — Voter: { playerId, createdAt, votedAt? } — token = the /vote/<token> link
/voting/ballots/{playerId}         — Ballot: { token, picks{awardId: id}, submittedAt, editedAt? }
/voting/excluded/{playerId}        — true = kept out of voting (no link, not on ballot, not in turnout); stats untouched
/postseason/meta                   — { active, season } — global playoff switch (see Postseason)
/postseason/brackets/{season}      — BracketConfig: seeds[6], slots{qf36,qf45,sf1,sf2,final}{date,time,venue,winnerOverride}
/postseason/games|gameStats|gameSummaries|liveRunners/{po_gameId} — playoff games, same shapes as the regular roots
/postseason/players/{playerId}     — lifetime playoff stats {name, stats{hitting,pitching}, seasons{YYYY:{teamId,hitting,pitching}}}
/postseason/subPlayers/{playerId}  — same, for one-game subs
```
Full type definitions in `src/types.ts`.

## Key architectural decisions (do not reverse without discussion)
- **Overlay is purely reactive** — `OverlayRoute` never writes to Firebase. Only `ControllerRoute` writes.
- **Firebase listeners only** — no Redux, Zustand, or other state lib. Hooks in `src/hooks/` each own one Firebase path.
- **Team colors via CSS custom properties** — `TeamColorInjector` sets `--team-home-primary` etc. on `:root`. All components reference these vars. Do not hardcode team colors in components.
- **Scene system is a flat map** — adding a scene means: new file in `src/scenes/`, export in `src/scenes/index.ts`, render case in `OverlayRoute.tsx`, button in `SCENES[]` in `ControllerRoute.tsx`, type added to `SceneName` in `types.ts`.
- **Auto-dismiss lives in the controller, overlay is read-only** — `/overlay` never writes to Firebase (rules enforce this — only `scorer`/`admin` can write). When the controller writes `overlay/statOverlay.visible = true` or `overlay/homerun.active = true`, it also schedules a `setTimeout` (`scheduleStatDismiss` / `scheduleHomerunDismiss` in `ControllerRoute.tsx`) that writes the flag back to `false` after the intended duration. Stat dismiss uses `dismissDelay` state (20s default, controller-configurable); homerun dismiss is fixed at 10s. Regression: if the controller tab reloads mid-display, the pending timer is lost and the graphic stays up until manually dismissed. Do NOT add Firebase writes to any `/overlay`-rendered component — they will be rejected at the rules layer.
- **`dismissAfterMs` is stored in Firebase** so it's live-adjustable from the controller without a redeploy.
- **Scoreboard is a pill layout** — `Scoreboard.tsx` builds the layout directly (does not use `TeamBug`). Away team: left pill `[NAME | SCORE]` rounded-left, home team: right pill `[SCORE | NAME]` rounded-right, scores facing the center. `TeamBug` still exists for potential future use and accepts a `mirrored` prop, but is not used in the overlay scoreboard.
- **Broadcast scoreboard is centered at 36% width** — `GameScene` wraps `Scoreboard` in a centered container (`width: 36%`). Do not make it full-width or reduce below ~30% or the pills will clip.
- **Scoreboard center section uses fixed-width cells** — inning, bases, and outs each use `width: 150, flexShrink: 0`. Do not use `flex-1` or `justify-center` with gaps — auto-sizing produces unequal cells and off-centers the timer notch.
- **Timer is a notch below the center pill** — the countdown renders in an absolutely-positioned element below the center strip (`top: '100%'`), same dark background, rounded bottom corners (displays `0:00` when expired). It only shows when `overlay/timer.visible` is true (default false — the controller's Countdown Timer section has a show/hide toggle and only shows the timer controls while shown). When the timer is hidden, the same notch slot shows the playoff round tag ("2026 PLAYOFFS · QUARTERFINALS") if `overlay/roundTag` is on. Keep that copy short: it must fit under the black strip, clear of the batter/pitcher notches. The controller timer control is a single row: `[min input] [Set] [countdown display] [Start/Pause] [Reset]`.
- **Inning control is two half-inning step buttons** — `InteractiveScoreboard` exposes `onAdvanceHalfInning` and `onRewindHalfInning`. Both clear outs and bases. There are no separate +1/-1 inning or top/bottom toggle buttons.
- **Tailwind v4 cascade layers** — do not add unlayered CSS rules (e.g. `* { padding: 0 }`) after `@import "tailwindcss"` in `index.css`. Unlayered styles outrank Tailwind's `@layer utilities`, silently breaking utility classes. Tailwind's Preflight already handles box-model resets.
- **Controller game-state controls are in `InteractiveScoreboard`** — score, inning, bases, and outs are all controlled via the visual `InteractiveScoreboard` component, not separate button sections. Inning ▲/▼ uses the same symbol as the broadcast overlay.
- **Player stats are nested** — `Player.stats` has two optional buckets: `stats.hitting` (`HittingStats`) and `stats.pitching` (`PitchingStats`). A player can have one or both. Never read flat `stats.avg` etc. — always go through the bucket.
- **Matchup state lives at `/game/matchup`** — `{ batterId, pitcherId, lastPitcherHome, lastPitcherAway }`. `useMatchup` hook owns this path. The controller writes it; the overlay reads it. `lastPitcherHome/Away` are used by `advanceHalfInning` to restore the correct pitcher when the half-inning flips.
- **Batter/pitcher notches on the scorebug** — `Scoreboard.tsx` renders a `PlayerNotch` (Framer Motion spring-bounce) below each team pill. Batter notch shows under the batting team, pitcher notch under the fielding team. Batter notch is hidden while `statOverlayVisible` is true. Both show last name only.
- **Batter auto-clears on play result** — `ControllerRoute` has a `useEffect` that writes `batterId: null` to `/game/matchup` whenever `game.outs` or any base changes. A `mountedRef` guard prevents firing on initial load.
- **Controller "At Bat" section is the single source of truth for who is up** — one unified section handles: batter dropdown (auto-triggers 20s stat overlay on select), HOME RUN button (uses selected batter, auto-scores bases), pitcher dropdown, delay picker, Batter Stats / Pitcher Stats / Dismiss buttons. There are no separate Matchup / Home Run / Stat Overlay sections.
- **Booth ID card (announcers)** — `/overlay/announcers = { visible, people[3]{name, role} }`. `AnnouncerCard` renders bottom-right above every scene, names stacked top-to-bottom ON PURPOSE (booth seating changes, so nothing may imply left/right); blank-name slots are skipped; the league watermark fades while it's up and it lifts above the stat strip/ticker. Controller: one Scene-grid tile (`AnnouncersControl`) with one-tap Show/Hide + Edit (modal, 3 rows, ✕ clears a field).
- **Awards night (`awards` scene)** — `/overlay/awardsReveal = { title, board{awardId: name/order/description/icon}, results{awardId: {top[], counted}}, spotlight }`. The controller's "🏅 Awards" button puts the board on air and opens `AwardsRevealControl` (per award: Spotlight / Reveal / Hide; Board; Hide all). The overlay can't read `/voting`, so the controller (must be logged in as admin) tallies ballots itself and writes an award's top 3 (`revealTopRows`, ranks ≤3, ties share a place) into `results` ONLY when it's revealed — unrevealed winners never sit in public overlay data. Board keeps clear of the bottom-right for the booth ID card.
- **`scoreboardBorder` and `scoreboardScale`** live in `/overlay` and are exposed as dev controls in the controller (border toggle, size slider). `showBorder` prop on `Scoreboard` gates the `-webkit-text-stroke`.

## Inning sponsors + bottom-line ticker
- **Sponsors are data, not code** — `/config/sponsors/{id}` (admin-writable, managed in `/config` → "Inning Sponsors" via `SponsorsSection.tsx`). A sponsor can own several innings (`innings` is a `{"N": true}` map — RTDB turns small integer keys into sparse arrays, `inningsFromMap` tolerates both). Two starters (Pintu's → inning 1, Pafumi's → inning 2) ship as same-origin art in `public/sponsors/` and can be (re)seeded with `node scripts/seedSponsors.mjs` or the admin panel's "Add starter sponsors" button; `src/sponsors/starter.ts` and the script must stay in sync.
- **All sponsor rules live in `src/sponsors/logic.ts`** (pure, tested): `pickSponsorForInning` = enabled sponsors claiming the inning, first by `order` wins (the admin panel shows a conflict warning when an inning has several). Never re-derive "who presents inning N" elsewhere.
- **The interstitial fires from the controller, not the overlay** — `ControllerRoute` watches `game.inning` (works whether this panel's ▶½ or the scorekeeper's mirror write advanced it); on an *increase* with `overlay/sponsor.autoShow` on it writes `overlay/sponsor = { active: true, sponsorId, inning, triggeredAt, durationMs }` and schedules the dismiss, with the same triggeredAt-based self-heal as the homerun banner. Rewinds and the initial load never fire; inning 1 is manual (per-sponsor "Show" buttons / inning strip). `SponsorInterstitial` additionally hides itself once `triggeredAt + durationMs` passes (`sponsorStillActive`) so a dead controller can never freeze a card on air — still zero overlay writes.
- **The interstitial renders above every scene** (paid placement wins), slides in from the left and exits right; `lightPlate: true` puts the logo on a white card for light-background logos (Pintu's), otherwise the logo sits straight on the dark panel (Pafumi's white wordmark SVG).
- **Ticker content is computed on the overlay** from `/players`, `/games`, `/teams`, `/config/sponsors` + `overlay/ticker` by `buildTickerSections` in `src/ticker/items.ts` (pure, tested). Fixed on-air order: standings → batting → HR → pitching → recent results → sponsors → producer messages; empty sections are dropped. Qualification thresholds are shared with the Leaders scene via `src/stats/leaders.ts` — change them in one place.
- **Ticker crawl = one section at a time**, ESPN BottomLine style: `Ticker.tsx` measures the track once per crawl, animates it right→left with framer's imperative `animate`, then advances. Live data updates re-render items in place but never restart a crawl (the measurement effect deliberately ignores the items). Only shown on the `game` scene; the StatOverlay strip and league logo bug lift by `TICKER_HEIGHT` while it's on air, and the logo bug fades while the stat strip is up.
- **Ticker theme is producer-adjustable** from the controller (`overlay/ticker`): accent colour (presets + home/away team colours + custom picker; cap text auto-contrasts via `readableOn`), crawl speed, section toggles, and free-text "League Wire" messages (push keys → chronological order).

## Playoff picture (src/playoffs/)
- **Format (2026)**: 6 of 8 qualify, seeds 1–2 get a bye, QF = 3v6 / 4v5, then a FIXED bracket — NO reseeding: 1 seed plays the 4/5 winner, 2 seed plays the 3/6 winner (live bracket: `src/postseason/bracket.ts`). `DEFAULT_PLAYOFF_CONFIG` in `engine.ts`; tiebreakers head-to-head → run differential → runs allowed (→ flagged coin flip). Ranking is by win **pct** (ties = ½) because the postponed game leaves teams with unequal games played.
- **Clinch / elimination is exact, not heuristic** — `buildPlayoffPicture` enumerates every win/loss outcome of the remaining scheduled games (≤ 2^16; above that it falls back to max-wins bounds and says so via `exact: false`) and re-ranks each with the full tiebreak procedure. Per team: best/worst seed, `playoffOdds` (share of outcomes), and "own destiny" numbers `winsToClinch` / `winsToBye` / `winsToTop` / `lossesToElimination`. There is deliberately NO classic magic number — it assumes equal games played and was wrong here. `src/playoffs/__tests__/fixtures/season-2026-09-10.json` is the real season snapshot; the tests assert the real answers with the May 9 makeup counted (Whalers clinched, Gamecocks 95% and clinch with one win, Yetis alive at 3% via the run-differential tiebreak, Moose Knucklers 1.6%) and the cancelled-makeup counterfactual (Yetis out, Nuke Squad bye locked).
- **Schedule lives at `/config/schedule/{siteGameId}`** — synced from the public site's JSON API by `npm run schedule:sync` (`scripts/syncSchedule.mjs`; the API has no CORS so the browser can't read it). Verified 2026-09-10 game-for-game against Spond. `/config/scheduleMeta` records the sync. **Policy: postponed games WILL be made up** (`countPostponed: true` in `DEFAULT_PLAYOFF_CONFIG`), so a postponed game counts as a remaining game in the enumeration and shows in "Still to play" as "Makeup · date TBD" — a team can never clinch for free by not playing it. The schedule node keeps the honest status (`postponed`); only flip `countPostponed` to false if the league formally cancels a game. `dedupeSchedule` drops any scheduled game that already has a finalized result so a game is never counted twice between syncs. To add a makeup game by hand, write a node under `/config/schedule` with the same shape.
- **`usePlayoffPicture()`** = finalized non-exhibition `/games` + `/config/schedule` → picture (memoized). Consumers: `PlayoffScene` (overlay `playoffs` scene, "Playoff Picture" button), `StandingsScene` (row tags now say the truth — "Clinched bye" / "Eliminated" — instead of position labels), ticker segments `playoffs` and `upcoming`, and the public `/stats` "Playoffs" tab (`PlayoffPicturePanel`). Display strings come from `src/playoffs/format.ts` so all four agree.

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

## Home Run Derby page (DerbyRoute.tsx)
- **`/derby` is a public web page** (like `/stats`), not an overlay — annual 50/50 charity event ($10/entry, half the pot to the winner, half to the Valley Impact Project). A derby *overlay* scene is a separate future project.
- **Entries are submitted via Venmo** (`@emvee311` — `VENMO_HANDLE` constant) — a bold CTA banner at the top tells people to send $10 with note "First Last <HR guess>" (e.g. "Mike Verteramo 25"); admins then record the entry via admin mode. There is no public entry form.
- **The page renders stand-alone** — no `AppNav` header on the page itself and no links out to other routes, but it IS listed in `AppNav`'s links (public "Derby" item) so it's reachable from the main/stats page.
- **`totalHr` means the derby WINNER's personal HR total across all 3 rounds** — not a derby-wide total. Both the entry guess and the posted result use this meaning.
- **Data lives at `/derby`** — `entries/{entryId}` (`DerbyEntry`: name, playerId, totalHr, paid, createdAt) and `result` (`DerbyResult`: winnerPlayerId, totalHr, finalized). `useDerby` hook owns the path.
- **`/derby` is publicly writable at the rules layer** — intentional. Admin mode is a front-end plain-text gate only: a small "Admin" link in the footer (next to the Home Run Derby text) opens a plain password prompt (`ADMIN_PASSWORD` constant at the top of `DerbyRoute.tsx`), state kept in sessionStorage. It is NOT the real `AuthGate` login. Accepted risk: worst case someone edits derby entries.
- **Winner logic** — eligible entries are paid + picked `result.winnerPlayerId`; among those, minimum `|totalHr - result.totalHr|` wins (ties all highlighted). If no eligible entry, banner says the full pot goes to charity.
- **Admin writes are server-confirmed, not trusted from local echo** — the RTDB SDK applies writes to the local cache instantly (latency compensation), so offline admins used to see entries "appear" that never reached the server. `AddEntryForm` now awaits the push ack: "Saving…" → "✓ saved" on ack, an amber "not confirmed — keep tab open, don't refresh" warning if no ack within 8s (offline writes queue in-tab and flush on reconnect; the promise never settles until then), red error on rejection. A `useConnectionStatus` hook (`src/hooks/useConnectionStatus.ts`, watches `.info/connected` with a 2.5s grace period) drives a sticky red offline banner shown in admin mode.
- **Player presence toggle** — `derby/disabledPlayers/{playerId}: true` marks a player as not at the derby. Admin mode shows every player with a HR in the leaders grid with tap-to-toggle IN/OUT badges; public mode hides disabled players entirely; all player dropdowns (add entry, edit entry, result) offer enabled players only. Entries referencing a since-disabled player still display via `fallbackLabel` on `PlayerCombobox`.
- **"Eligible Players" grid** shows ONLY players with ≥1 season HR (a homer is the ticket into the derby — 0-HR players never appear even if bet on). A "Sort by: Home Runs | Bets" chip toggle re-sorts the grid; the tile's big number is the active sort metric and the other metric shows as a small pill (`🔥 N BETS` in HR mode, `N HR` in bets mode). HR totals merge season `stats.hitting.hr` with live non-finalized games' `gameStats` (same pattern as StatsRoute), skip `isSub` players/at-bats, and filter out player records with no `name` (stale nodes exist in `/players` — sorting on `p.name` without the guard crashes the page).
- **Mobile-first** — most bettors open the page on a phone: CTA text uses `clamp()`, pot tiles use `auto-fit` grid, the public entries table has no forced min-width (admin table scrolls horizontally instead).

## Derby broadcast overlay (DerbyOverlayRoute.tsx + DerbyControllerRoute.tsx)
- **`/derby-overlay`** is an OBS browser source (1920×1080, transparent, read-only) for the derby broadcast; **`/derby-controller`** is the producer panel that drives it. This is separate from the `/derby` 50/50 public page, but shares its data root.
- **State lives at `/derby/broadcast`** (`DerbyBroadcastState`) — under `/derby` so it inherits that path's open write rule. The controller is gated by the same front-end password + `derbyAdmin` sessionStorage key as the /derby admin (constant duplicated in `DerbyControllerRoute.tsx`). Same accepted risk.
- **Shape**: `view` (`hidden | player | leaderboard | upNext`), `activeRound` (1|2|3, the round being hit), `leaderboardRound` (which round the leaderboard view shows — lets round 1 stay on screen while round 2 is underway), `featuredPlayerId`, `battingOrder` (playerId[]), `currentBatterIndex`, `scores/{playerId}` (`{r1?, r2?, r3?}`).
- **A missing round score means "hasn't hit yet"; 0 is a real result** — never conflate them. Controller's "Done — next batter" converts a blank to a real 0 for the outgoing hitter.
- **Bracket rules in `src/derby/logic.ts`** (pure, no Firebase/React): round 1 = all eligible; top 8 advance out of round 1, top 3 out of round 2; **ties for the last spot all advance** (`advancersFromRound` takes everyone ≥ the Nth score). Only players with a recorded score can advance, so mid-round the cut line is a live preview. `leaderboardForRound` returns scored rows ranked (competition ranking, ties share rank) with yet-to-hit rows dimmed at the bottom; advancing rows are always a sorted prefix, so the overlay draws the cut line after them.
- **Eligible pool = `useDerbyContestants`** — same rule as the 50/50 page: non-sub players with ≥1 season HR (finalized stats + live non-finalized games) minus `derby/disabledPlayers`. Both derby broadcast pages and any future consumer should use this hook, not re-derive it.
- **Batting order auto-fills** — when the controller loads and `battingOrder` is empty, it seeds itself with ALL hitters of the active round (no hand-adding); the producer only dismisses (✕) or drags. Guarded by a per-session ref so deliberately emptying the list doesn't refill it. "Load order" re-seeds explicitly (with confirm).
- **Seeding order** — greatest → least: round 1 seeds by season HR descending, rounds 2/3 by previous-round score descending. Producer then **drags rows to reorder** (framer-motion `Reorder`, whole-row drag, commit to Firebase on drop with `currentBatterIndex` following the current batter's id). Because drag owns the row click gesture, selecting the current batter is double-click or the per-row ▶ button — do not reattach tap-to-select to the row.
- **Home run burst** — `DerbyPlayerScene` watches the active round's score and fires a "HOME RUN!" slam + shockwave + particle burst whenever it increases (`activeScore > (prev ?? 0)`: no burst on mount, on −1 corrections, or when "next batter" locks a blank in as 0). Overlay stays read-only — the animation is derived purely from score changes.
- **The winner's `Total` column in the controller's All-scores table is the number the 50/50 `/derby` result pays out on** (winner's HR across all 3 rounds) — the admin still posts it manually on `/derby`.

## All-Star Game (2026 Brookside All-Star Weekend)
**Full product doc: `ALLSTAR.md` — read it before touching all-star code. The hard rule: all-star at-bats NEVER reach `players/{id}/stats`.**
- Exhibition detection is data-driven: `isExhibitionGame(g, teams)` checks the game record's `isExhibition` flag (stamped at creation), then either team's `isExhibition` flag, then the legacy 2026 ids. Annual rollover is a documented runbook in ALLSTAR.md (one config edit + logo regen for the game; one admin button — derby "Season tools → Archive & reset" — for the derby, which snapshots to `derby/archive/{year}`).
- The All-Star Weekend lockup (`/logos/allstar-weekend.svg`, yearless filename) watermarks the derby overlay always and the game overlay automatically whenever an exhibition matchup is on the scorebug.
- **Team Risty (red, `team_rist`) vs Team Hiller (blue, `team_hiller`)** — exhibition teams of players drafted from across the league. NOT separate routes: the regular `/controller`, `/overlay`, and `/scorekeeper` run the all-star game once the teams are seeded and picked as home/away, exactly like a normal matchup.
- **Seeding is an admin button** — `/config` has an "All-Star Game" section: one click writes `teams/team_rist` + `teams/team_hiller` and `config/allstar/rosters/{teamId}` (playerId[]) from the constants in `src/allstar.ts` (`ALLSTAR_SEED_TEAMS` / `ALLSTAR_SEED_ROSTERS`). Roster changes = edit `src/allstar.ts`, redeploy, hit "Re-seed from code". "Remove" deletes both teams and `config/allstar`. Rosters live under `/config` (admin-writable) specifically so no database-rules change was needed.
- **Players keep their league `teamId`** — membership comes from the roster mapping. ALL player-by-team filtering must go through `src/allstar.ts` helpers: `playerOnTeam(id, player, teamId, rosters)` (replaces `p.teamId === teamId`), `effectiveGameTeamId` (which side of this game a player is on — used for stat-overlay/matchup accent colors), `buildPlayerTeamMap` (roster-aware map for `computeLineupPosition`). `useAllstarRosters()` (hook, `config/allstar/rosters`) returns null until seeded, making every helper fall back to plain league-team matching — zero regular-season impact.
- **Roster-aware call sites** — ControllerRoute (batter/pitcher dropdowns, `selectPitcher` home/away detection), Scoreboard (notch visibility), StatCardScene, MatchupScene + StatOverlay (accent team resolution), ScorekeeperRoute (LineupBuilder, batter/pitcher options, sub-pitcher roster list, live-stats side split, AtBatEditModal options, both `computeLineupPosition` team maps), SummaryRoute (box-score side split). GameEditorRoute was NOT made roster-aware (admin edit tool; known limitation).
- **Exhibition games never touch season stats** — `isExhibitionGame(g)` (either team is an all-star team) guards: Finalize is replaced with an "exhibition" notice in ControllerRoute and hard-blocked in ScorekeeperRoute's `finalizeGame`; live season-stat merges skip exhibition games in StatsRoute, DerbyRoute, and `useDerbyContestants`. Standings/results only count finalized games, so exhibitions never appear there.
- **`allstarLineups` scene** (`⭐ Lineups` button) — full-screen board: All-Star Weekend lockup on top, both batting orders side by side with season AVG/HR/RBI and each player's league-team logo. Order preference: scorekeeper lineup (if a game is linked) → drafted roster order → team filter.
- **Logos are static SVGs in `public/logos/`** — `team-rist.svg`, `team-hiller.svg`, `allstar-2026.svg` (`ALLSTAR_LOGO_URL`). Served same-origin (no Firebase Storage upload); `logoUrl` uses absolute paths like `/logos/team-rist.svg`.
- **Known mapping caveats** — "Macker" was mapped to `brendan_mcdonald` (only Brendan in the league); "Mike LaFleur" is the push-key id `-OtHHZTZG-3lDFkt196W`.

## Postseason (src/postseason/)
- **Playoff games live in their own database section, `/postseason`, never in `/games`.** brooksidewiffle.com's server imports our `/games`, `/gameStats`, `/gameSummaries` and `/players` (verified 2026-10-14 from its API: per-game stats keyed by our player ids, standings ids `firebase-…`), so anything written there shows up on the public site as regular season. A playoff game is identified purely by its id prefix `po_`; EVERY game-path read/write goes through `gameRoot(gameId)` (`postseason/paths.ts`) — `` `${gameRoot(id)}games/${id}` ``. New code that touches a game path must do the same.
- **`useGames()` stays regular-season only** (standings, stats, ticker, derby, playoff picture all build on it). Screens that must list playoff games (scorekeeper game list, controller live-game picker) merge in `usePostseasonGames()`.
- **The playoff switch (`/postseason/meta.active`) routes nothing by itself.** It (a) makes the scorekeeper's New Game screen default a game to "Playoff game" when the two teams are an open bracket slot — that choice mints the `po_` id and stamps `postseason: {season, round, slot}` on the record, and the scorer can untoggle it; (b) adds the playoff row to the at-bat stat strip; (c) shows the 🏆 Bracket scene button. Turning it off later never moves a game: the id decides, forever.
- **Finalize**: `po_` games go through `finalizePostseasonGame` (both ControllerRoute and ScorekeeperRoute branch on `isPostseasonGameId`). `computePostseasonFinalization` reuses the regular `computeFinalization` engine and re-points its output: lifetime totals (every playoff game, all seasons) → `postseason/players/{id}/stats`, this season → `…/seasons/{YYYY}`, box score → `postseason/gameSummaries`. It throws on any non-`postseason/` path. Idempotent like the regular finalize. Admin-only (rules).
- **Bracket** (`bracket.ts`, pure, tested): fixed, single game per round, higher seed hosts. A slot's winner = producer `winnerOverride` (controller dropdown) else the finalized playoff game between the pair. `BRACKET_2026` holds the seeds/schedule; the controller's "Load 2026 bracket" writes it. Next year: add a `BRACKET_2027`-style config and point the button at it.
- **Overlay**: `bracket` scene (`BracketScene.tsx`), the scorebug round tag via `overlay/roundTag` (`off | auto | qf | sf | final`; auto follows `bracket.currentRound`; rendered in the timer notch slot by `Scoreboard`, hidden while the timer is shown — the bottom-right league watermark is NOT playoff-aware), and `StatOverlay` shows two rows (season / playoffs) while the switch is on or a playoff game is live — a playoff game's live at-bats merge into the playoff row only.
- **Rules**: `postseason/{meta,brackets,games,gameStats,liveRunners}` scorer/admin; `postseason/{players,subPlayers,gameSummaries}` admin. Emulator tests in `src/postseason/__tests__/rules.test.ts` (`npm run test:rules`, needs Java).
- **Season archive**: `node scripts/exportSeason.mjs <label>` writes a read-only full dump + hitting/pitching/standings/games CSVs to `backups/season-<label>/` (gitignored — the dump includes voting tokens). The 2026 regular-season archive was taken 2026-10-14.
- **Local end-to-end testing**: `firebase emulators:start --only database,auth --project brookside-14b4b` + `VITE_USE_EMULATORS=1 npm run dev` points the app at the emulators (dev builds only).

## Forfeits
- **A forfeit is a finalized game scored 1-0 to the winner with no at-bats**, tagged `games/{gameId}/forfeit = { winnerTeamId, forfeitingTeamId }`. It counts in standings, results, and the playoff picture like any other final; it adds nothing to season stats, box scores, or pitcher W/L (all of those are rebuilt from `gameStats`, and a forfeit has none).
- **The stored score is authoritative for forfeits** — finalization and the GameEditor box-score Save normally re-derive `homeScore`/`awayScore` from runs, which would turn a forfeit into 0-0. `computeFinalization` and `GameEditorRoute`'s Save both skip the score write when `game.forfeit` is set (tested in `finalization.test.ts`). Any new code that re-derives a game's score must honour the same check.
- **There is no UI for recording a forfeit** — do it as a direct admin write (firebase-admin + `service-account.json`), after `npm run backup`:
  1. Confirm the game has no `gameStats/{gameId}` or `gameSummaries/{gameId}`. If at-bats were logged, delete them first, or they WILL be rolled into season stats by the next finalize anywhere.
  2. Make `date`, `homeTeamId`, `awayTeamId` match the `/config/schedule` entry exactly. `dedupeSchedule` matches on `date|away@home`, so a mismatch leaves the game counted as both played and still-to-play.
  3. In one multi-path `update`: winner's score `1`, loser's `0`, `forfeit`, `finalized: true`, `finalizedAt`, and `matchup: null`.
- **History** — 2026-09-20 Swing Mafia @ Wiffle Whalers (record id `2026-09-21_swing_mafia_wiffle_whalers`; the scorekeeper created it the next morning with home/away flipped, and the record was corrected to match the schedule): Swing Mafia forfeited, Whalers win 1-0.

## Season awards voting (VoteRoute.tsx + VoteAdminRoute.tsx)
**Full product doc + current status + runbooks: `VOTING.md` — read it before touching voting code or data.**
- **Each player gets a personal link** `https://www.ogoley.com/vote/<uuid>` (`VOTE_LINK_BASE`). The token goes in the PATH, never a query string: the bare `ogoley.com` redirect drops query strings (verified 2026-10-06); `www.ogoley.com` 302s to `brookside-14b4b.web.app` with path intact. ogoly.com (no "e") is a parked domain, not ours.
- **The token is the credential, enforced by `database.rules.json` → `voting`.** Anonymous users get exactly one write: `voting/ballots/{playerId}` + `voting/voters/{token}/votedAt` in one multi-path update (`buildBallotUpdates`), only if the token maps to that playerId, the ballot doesn't exist yet (write-once — no edit/delete), polls are open, `submittedAt` is server time, and every pick is valid (real player / non-exhibition team, not yourself / your own team, inside `candidates` when set). Everything else under `/voting` is admin-only; nothing outside `/voting` changed. Admin writes are still held to the pick validation.
- **The ballot page is a dead end on purpose** — no `AppNav`, no `HomeButton`, no links anywhere (the league logo is a plain image), on every state: ballot, review, done, already-voted, closed, invalid link. Players arrive from their Spond DM, vote, and leave. Never add navigation to `VoteRoute` (verified 2026-10-06: zero `<a href>` on the live page).
- **No silent skips** — the ballot never offers skipping up front. "Review & submit" with blank awards opens a "You didn't pick for…" sheet: per award, **Pick someone** (scrolls to and opens that picker) or **No vote**; only when every blank is answered does it become the review sheet. "No vote" is page-only state — the stored ballot simply omits that award (rules require ≥1 pick).
- **Ballots are keyed by player, not token** — one ballot per person even if a link is reissued. Reissue carries `votedAt` to the new token when a ballot exists; admin "Reset" deletes the ballot + `votedAt` so the same link can vote again.
- **Rules tests**: `npm run test:rules` boots the RTDB emulator (demo project, never touches prod) and runs `src/voting/__tests__/rules.test.ts` — includes "anonymous can't write game/players/teams/config/overlay". Run it after ANY rules change. Plain `npm test` skips that file.
- **Known exposure (accepted, harden later)**: root `".read": true` means `/voting/voters` (every link) and `/voting/ballots` are publicly readable to anyone who looks at the raw database. Fix = move `.read: true` from the root onto each public top-level path and leave `voting` admin-read (plus `.read: true` on `voting/meta`, `voting/awards`, `voting/voters/$token`). The ballot page (`useBallotSetup`) already only reads those three, so it keeps working.
- **Voter pool** = named, non-sub `/players` minus `/voting/excluded` (`rosterPlayerIds(players, excluded)`); team ballot = non-exhibition teams. Exclusion is enforced in the rules too (an excluded player can't vote even with a link, and can't be picked). 2026: `mark_gee` is excluded (left the league after one game). All "who can pick whom" rules live in `src/voting/logic.ts` (pure, tested) and mirror the database rules — change both together.
- **Admin screen `/vote-admin`** (admin login, also in AppNav): open/close polls, ballot title, turnout by team ("waiting on…"), awards editor (player/team, optional finalists shortlist, starter set via `STARTER_AWARDS`), links (create / copy / copy invite / reissue / revoke / CSV with invite text), ballots (edit, enter on behalf, reset), live results. `/vote/preview?as=<playerId>` renders the real ballot with submit disabled, even while closed.
- **Links + Spond mapping**: `node scripts/voteLinks.mjs [--create] [--exclude <playerId>]` mints missing links (admin SDK) and writes `vote-links/vote-links.csv` (gitignored — rows are live credentials) with team, name, playerId, Spond subgroup, Spond display name, link, voted, invite message. Spond is one group "Brookside Athletics Wiffle Ball" with a subgroup per team; subgroup "Big Ol' Hitties" = `base_invaders`, "Whalers" = `wiffle_whalers`; four Spond names differ only in case (`SPOND_NAME` in the script). Mike Verteramo is an admin in every subgroup (he plays for the Whalers).
- **Sending invites** is manual / browser-driven through Spond (one DM per player) — there is no Spond API integration. The CSV's `message` column is the invite text (`inviteMessage`; the script duplicates it — keep in sync).

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
    useDerbyBroadcast.ts    — /derby/broadcast listener (DerbyBroadcastState, merged over defaults)
    useDerbyContestants.ts  — derby-eligible player pool: ≥1 season HR (incl. live games), minus derby/disabledPlayers
    useSponsors.ts          — /config/sponsors listener (SponsorsMap)
    useSchedule.ts          — /config/schedule listener (remaining games, date-ordered) + scheduleMeta
    usePlayoffPicture.ts    — finalized games + schedule → exact PlayoffPicture (memoized)
    useVoting.ts            — /voting listener (admin) + useBallotSetup(token): meta, awards, own voter record only
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
    SponsorInterstitial.tsx — between-innings sponsor card (reads overlay/sponsor; time-guarded, never writes)
    Ticker.tsx              — bottom-line crawl, one section at a time; content from ticker/items.ts
    SponsorsSection.tsx     — /config admin UI for sponsors (add/edit/order/innings, starter seed)
    PlayoffPicturePanel.tsx — light-theme playoff picture for the public /stats Playoffs tab
    LogoUpload.tsx          — Firebase Storage image uploader (teams, league logo, sponsors)
    SearchSelect.tsx        — generic type-ahead dropdown (light/dark), used by the voting pages
  scenes/
    GameScene.tsx           — scoreboard over transparent bg + stat overlay
    StatCardScene.tsx       — full-screen between-innings team stat table
    PlayoffScene.tsx        — full-screen playoff picture: clinch tags, seed ranges, odds, projected bracket, remaining games
    IdleScene.tsx           — league logo / waiting screen
    MatchupScene.tsx        — pitcher vs batter card (stub, stretch goal)
    index.ts                — barrel export (main overlay scenes only)
    derby/                  — derby broadcast scenes (imported directly, not in the barrel)
      DerbyPlayerScene.tsx      — lower-third hitter card: name, season HR, per-round boxes + derby total
      DerbyLeaderboardScene.tsx — round leaderboard with advancement cut line / champion crown
      DerbyUpNextScene.tsx      — batting order panel: now batting / on deck / in the hole + completed scores
  scoring/
    engine.ts               — pure scoring functions: applyAtBat, replayHalfInning, computeGameStats, mergeHittingStats, mergePitchingStats, formatResult
    gameId.ts               — generateGameId, getEasternDateString helpers
  derby/
    logic.ts                — pure derby bracket logic: advancement (top 8 / top 3, ties advance), round participants, leaderboard ranking
  sponsors/
    logic.ts                — pure sponsor rules: innings map ⇄ list, pickSponsorForInning, ordinal, sponsorStillActive
    starter.ts              — Pintu's / Pafumi's starter records (mirrors scripts/seedSponsors.mjs)
  ticker/
    items.ts                — pure ticker content builders (standings, leaders, results, sponsors, messages) + crawl timing
  playoffs/
    engine.ts               — pure: standings lines, tiebreak ranking, exact outcome enumeration, bracket projection
  postseason/
    paths.ts                — po_ prefix + gameRoot(): routes every game path to /postseason for playoff games
    bracket.ts              — pure fixed-bracket logic: resolveBracket, slotForMatchup, BRACKET_2026, logo round
    finalize.ts             — pure playoff finalization (wraps computeFinalization, re-points to /postseason)
    finalizeGame.ts         — Firebase side of playoff finalize
    format.ts               — shared display strings (pct, diff, odds label, game date/time, seed range)
  voting/
    logic.ts                — pure awards-voting rules: links, eligible options, pick cleaning, turnout, tallies, starter awards
  stats/
    leaders.ts              — shared season leader queries + qualification thresholds (Leaders scene + ticker)
  storageUtils.ts           — deleteStorageLogo helper
  routes/
    OverlayRoute.tsx        — 1920×1080 canvas, AnimatePresence scene switcher
    ControllerRoute.tsx     — all game controls; only file that writes game state
    ScorekeeperRoute.tsx    — at-bat log entry wizard; writes /games, /gameStats, /liveRunners
    DerbyOverlayRoute.tsx   — 1920×1080 derby broadcast overlay (read-only, OBS source)
    DerbyControllerRoute.tsx — derby producer panel; only writer of /derby/broadcast
    VoteRoute.tsx           — public ballot page /vote/:token (and /vote/preview)
    VoteAdminRoute.tsx      — /vote-admin: polls, awards, links, ballots, results
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
| `scripts/syncSchedule.mjs` | Pulls remaining games from brooksidewiffle.com/api into `/config/schedule` (`npm run schedule:sync`) | The season is over, or the schedule gets a first-party source |
| `scripts/voteLinks.mjs` | Creates/exports season-awards vote links with the Spond mapping into gitignored `vote-links/` | Awards voting is over |
| `scripts/seedSponsors.mjs` | Seeds the two starter inning sponsors into `/config/sponsors` (idempotent; `--force` overwrites) | Sponsors are managed purely from the admin panel |
| `firebase-snapshot.json` | Clean-state Firebase snapshot used by `npm run reset` | Development is done |
| ~~`firebase-seed.json`~~ | ~~Old placeholder seed data — superseded~~ | ✅ Deleted |
| ~~`brookside-11361-default-rtdb-pitchingStats-export.json`~~ | ~~Raw pitching stats export — inlined in `seedPlayers.js`~~ | ✅ Deleted |
| `OBS_SETUP.md` | OBS browser source setup instructions | Project is fully documented elsewhere |
