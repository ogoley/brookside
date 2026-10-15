# Season Awards Voting — Product Doc & Runbook

Postseason awards voting for the league: every player gets a private link, votes once,
and the commissioners see turnout and results live. Read this before touching anything
voting-related. CLAUDE.md → "Season awards voting" has the condensed engineering rules.

---

## ▶ Resume here — status as of 2026-10-14 (evening): READY TO SEND

**Live in prod (commit 19bf637, deployed 2026-10-14):**
- Final 2026 ballot applied: 8 awards; finalists Rookie 20 / Value Pick 22 / Ump 20.
- **Deadline set: Sun Oct 18, 11:00 AM ET** (`voting/meta/closesAt`), enforced by the rules.
- **Voting is OPEN.** 0 ballots.
- **Hardening done:** root read removed; `/voting/ballots` and the link list are admin-only
  (anonymous → 401, re-probed live); every league path still public; brooksidewiffle.com's
  API still answers. If that site stops importing, re-add `".read": true` at the root.
- **All 57 links reissued** after hardening (old ones verified dead). A real link was opened
  signed-out at phone size: loads, countdown + ballot correct (nothing submitted).
- Send list: `vote-links/vote-links.csv` on the laptop (gitignored — every row is a live
  ballot credential). Columns: team, name, playerId, spondGroup, spondName, link, sent, message.
  On another machine regenerate it: `node scripts/voteLinks.mjs` (needs `service-account.json`),
  or `/vote-admin` → Voters & links → Download CSV / per-player "Copy invite".

**Nothing has been sent in Spond yet.** Next command = "send the Spond invites":
1. Claude in Chrome needs site permission for **spond.com** (extension → site access).
2. Send ONE test DM, confirm it renders with a working link, then the other 56 — one DM per
   player, text = the CSV `message` column, recipient = `spondName` in the `spondGroup`
   subgroup. Mark `sent` per row so a re-run never double-sends.
3. Watch turnout in `/vote-admin` → Ballots; nudge in Spond; results after Sunday 11 AM.

## Decisions made (2026-10-14) — final ballot

- **8 awards:** MVP, Cy Young, Hitter of the Year, Gold Glove, Rookie of the Year, Best Value
  Pick, Best Ump, **Papa Fushuego Award** (fun, energy, promoting the league, good vibes).
  Best Captain dropped; Clutch / Nastiest Pitch / Most Improved / team awards not used.
- **Finalists** (from the commissioners' shared checklist): Rookie 20, Value Pick 22, Ump 20.
  Encoded in `src/voting/ballot2026.ts`; `/vote-admin` → Awards → **"Apply 2026 ballot"**
  writes all 8 awards + finalists in one click (replaces the whole list).
- **Deadline: Sun Oct 18, 2026, 11:00 AM ET** (first pitch of semifinal game one).
  `voting/meta/closesAt`, enforced in the database rules with server time — a late ballot is
  rejected even if voting is left open. Set in `/vote-admin` (one-tap button or ET picker).
- **Partial ballots are fine** — at least one pick; the invite and ballot copy encourage
  voting on every award you have a preference on.
- Ballot additions: award badges (`public/awards/*.svg`), "Browse by team" tap-through picker
  (respects finalists / no-self), live countdown (navy → amber last day → red last hour).

## Decisions made (2026-10-06)

- **One private link per player** (`https://www.ogoley.com/vote/<uuid>`). The link is the
  credential — no login. Low-stakes by design: whoever holds a link votes as that player;
  forwarded links are an accepted risk (revoke/reissue fixes it).
- **Ballot is final on submit.** Admins can reset a ballot (the same link then works again).
- **No voting for yourself**; on team awards, **no voting for your own team**.
- **Subs don't vote** and aren't on the ballot (they live in `/subPlayers`).
- **Skipping:** not offered up front. On "Review & submit", any blank award opens a
  "You didn't pick for…" sheet → **Pick someone** or **No vote** per award. At least one
  pick is required to submit.
- **Mark Gee excluded** — played one game, removed from the league. No link, not on the
  ballot, not in turnout; his stats are untouched.
- **Brian Stromwall skipped** — in Spond's Moose Knucklers group but quit injured before
  the season (Mike LaFleur replaced him). Not on our roster.
- **Ballot page is a dead end** — no navigation or links anywhere; players arrive from
  their Spond DM, vote, leave.
- **Hosting domain:** links use `https://www.ogoley.com/...`. The bare `ogoley.com`
  redirect DROPS query strings, so the token must be in the path (it is). `ogoly.com`
  (no "e") is a parked domain — not ours.

## Award plan (not final — waiting on captains)

**Wanted**
| Award | Type | Notes |
|---|---|---|
| MVP | player | |
| Cy Young | player | Best **pitcher** (not fielding) |
| Hitter of the Year | player | |
| Gold Glove | player | Best fielder |
| Rookie of the Year | player | Needs a finalists list of first-year players (from captains) |
| Best Value Pick | player | Great player despite a late draft pick. Draft order isn't stored → needs a finalists list of late-round picks (from captains) |
| Best Captain | player | Probably restrict finalists to the 8 captains |
| **Best Ump** | player | **Must include.** Decide who's eligible |

**On the fence** — Clutch Player, Nastiest Pitch, Most Improved, Best Teammate /
Sportsmanship. **Possible team awards** — Best Uniforms, Most Fun Team to Play Against,
Best Team Chemistry, Toughest Out.

**Guidance:** keep the ballot to ~10 awards (people vote on phones; every extra award costs
turnout). Stat titles (batting title, HR leader, strikeout leader, games played) come from
the stats — announce them, don't vote on them.

## Captains' message (draft)

Plain text for iMessage (sent via Google Drive → iMessage). Fill in the reply-by day.

```text
Hey captains! 🏆

We're putting together an end-of-season awards vote. Every player will get their own private link to vote: one ballot each, and no voting for yourself. Before it goes out, we'd love your input on the categories.

Here's what we have so far:
• MVP
• Cy Young (best pitcher)
• Hitter of the Year
• Gold Glove (best fielder)
• Rookie of the Year
• Best Value Pick (best player compared to where they were drafted)
• Best Captain
• Best Ump

Here's what we're on the fence about:
• Clutch Player
• Nastiest Pitch
• Most Improved
• Best Teammate / Sportsmanship

And a few possible team awards:
• Best Uniforms
• Most Fun Team to Play Against
• Best Team Chemistry
• Toughest Out

We want to keep it to around 10 awards so people actually finish it on their phones. Stat titles like the batting title and HR leader will come straight from the stats, so those won't be on the ballot.

A few questions for you:
1. Which of the "maybe" awards would you keep, and which would you cut?
2. Anything we're missing?
3. Who on your team is a first-year player? (for Rookie of the Year)
4. Who were your late-round picks? (for Best Value Pick)

If you can, reply by [day]. Thanks!
```

---

## How it works

### Pages
| Route | Who | What |
|---|---|---|
| `/vote/<token>` | Players (public, no login) | Their personal ballot. States: ballot → "didn't pick for…" → review → received; plus already-voted, voting-closed, invalid-link. Phone-first. |
| `/vote/preview?as=<playerId>` | Anyone | The real ballot with submit disabled, even while voting is closed. |
| `/vote-admin` | Admin login (AuthGate) | Open/close voting, ballot title, turnout by team ("waiting on…"), awards editor (player/team, optional finalists, starter set), links (create / copy / copy invite / reissue / revoke / exclude / CSV), ballots (edit / enter on behalf / reset), live results. Also in the nav menu as "Awards Voting". |

### Data (`/voting` in Realtime Database)
```
/voting/meta                 { open, title? }            title defaults to "<year> Season Awards"
/voting/awards/{awardId}     { name, kind: player|team, order, description?, candidates?: {id: true} }
/voting/voters/{token}       { playerId, createdAt, votedAt? }     token = the link's UUID
/voting/ballots/{playerId}   { token, picks: {awardId: id}, submittedAt, editedAt? }
/voting/excluded/{playerId}  true
```
- Ballots are keyed by **player**, so it's one ballot per person even if their link is
  reissued. A skipped / "No vote" award is simply absent from `picks`.
- `candidates` absent = everyone eligible; present = finalists only.

### Security rules (`database.rules.json` → `voting`)
- Admins (custom claim `role: admin`) can write anything under `/voting`.
- An anonymous visitor gets **exactly one write**: their ballot + `votedAt`, in one
  multi-path update, only if the token maps to that player, the ballot doesn't exist
  yet (write-once), voting is open, the player isn't excluded, the timestamp is server
  time, and every pick is valid (real player/team, not themselves / own team, not
  excluded, inside finalists when set, not an exhibition team).
- Nothing outside `/voting` changed. Verified live: anonymous writes to game, games,
  players, teams, config, overlay, gameStats and every voting path → 401.
- Tests: `npm run test:rules` (boots the RTDB emulator on a `demo-` project; never touches
  prod) — 37 cases incl. "anonymous can't write game data", "can't vote twice", "can't
  vote as someone else". **Run after any rules change.**

### Files
```
src/voting/logic.ts                 pure rules: links, eligible options, pick cleaning, turnout, tallies, STARTER_AWARDS
src/voting/__tests__/logic.test.ts  unit tests (npm test)
src/voting/__tests__/rules.test.ts  emulator rules tests (npm run test:rules)
src/hooks/useVoting.ts              useVoting() (admin, whole tree) + useBallotSetup(token) (ballot page)
src/routes/VoteRoute.tsx            public ballot page
src/routes/VoteAdminRoute.tsx       admin screen
src/components/SearchSelect.tsx     type-ahead dropdown (light/dark), 16px text so iOS doesn't zoom
scripts/voteLinks.mjs               create links / exclude a player / export CSV with Spond mapping
database.rules.json                 the voting rules block
```

### Spond mapping (verified 2026-10-06 via Claude in Chrome, read-only)
- Spond = one group **"Brookside Athletics Wiffle Ball"** with a subgroup per team.
- Subgroup names that differ from ours: **"Big Ol' Hitties" = Base Invaders**,
  **"Whalers" = Wiffle Whalers**. The rest match.
- All 57 voters match a Spond member on the right team. Four differ only in case:
  `hywel brown`, `Kris oconnor`, `matthew wrisley`, `kyle venancio` (encoded in
  `SPOND_NAME` in `scripts/voteLinks.mjs`).
- Mike Verteramo is an admin in every subgroup; he's a Whalers player.
- The commissioner's Spond session is logged in as Dragon Ogoley.

---

## Hardening plan (do this before launch)

Goal: nobody but admins can read ballots or list links.

1. In `database.rules.json`, **remove the root `".read": true`** and add `".read": true` to
   each public top-level path: `game`, `overlay`, `games`, `gameStats`, `liveRunners`,
   `gameSummaries`, `teams`, `players`, `subPlayers`, `config`, `derby` (verified 2026-10-06
   to be every path the app reads, plus `.info`, which isn't rules-gated).
2. Under `voting`: `".read"` admin-only at the top; public `".read": true` on `meta`,
   `awards`, `excluded`, and **`voters/$token`** (a single link is readable only by someone
   who already has it — listing `/voting/voters` stays denied). `ballots` stays admin-only.
   The ballot page (`useBallotSetup`) already reads only those four paths.
3. Add rules tests: anonymous can't read `/voting/ballots` or list `/voting/voters`, can
   still read one `voters/<token>`, and the public paths above stay readable.
4. Check every public page still loads against the emulator (stats, overlay, derby,
   ballot, admin) — run the app on the emulator (see Testing) and watch for
   `permission_denied`.
5. Deploy rules (`firebase deploy --only database` — first confirm live rules still equal
   the committed file), then re-probe anonymously: ballots + voters list → 401.
6. **Reissue every link** (Voters & links → per player, or delete `/voting/voters` and run
   `node scripts/voteLinks.mjs --create`), then re-export the CSV.

## Launch runbook

1. Awards final in `/vote-admin` → Awards (finalists set for Rookie / Value Pick / Captain).
2. Hardening done, links reissued, code committed + deployed.
3. `node scripts/voteLinks.mjs` → fresh `vote-links/vote-links.csv` (team, name, playerId,
   Spond group, Spond name, link, voted, invite message).
4. Open `/vote/preview?as=<someone>` on a phone and click through once.
5. Open voting (toggle in `/vote-admin`).
6. Send invites: one Spond DM per player with the CSV's `message` text (Claude in Chrome
   can do this from the commissioner's Spond account — **send one test first, and only
   on explicit go**). Mark each sent in the CSV so a re-run never double-sends.
7. Watch turnout in `/vote-admin` → Ballots ("waiting on…") and nudge in Spond.
8. Close voting. Results are in `/vote-admin` → Results (ties flagged).
9. Future idea: an on-air awards-reveal overlay scene.

## Testing

- `npm test` — unit tests (voting logic included).
- `npm run test:rules` — security rules against the emulator.
- **Full app on emulators (how the UI was verified):** start
  `firebase emulators:start --only database,auth --project demo-wiffle` with a config that
  sets `emulators.auth.port = 9099` / `emulators.database.port = 9000` (the repo's
  `firebase.json` has no emulator block); seed the database over REST with
  `Authorization: Bearer owner`; create an auth user and set `customAttributes`
  `{"role":"admin"}` via the auth emulator's `accounts:update`; run Vite with
  `VITE_FIREBASE_PROJECT_ID=demo-wiffle`, `VITE_FIREBASE_DATABASE_URL=https://demo-wiffle-default-rtdb.firebaseio.com`
  and a tiny plugin that appends `connectDatabaseEmulator` / `connectAuthEmulator` to
  `src/firebase.ts`; drive it with `playwright-core` pointed at the installed Chrome.
  Those harness files lived in a scratch folder and were not saved — rebuild from this
  description, or promote them into `scripts/` if this gets used often.
- Gotcha: stopping the emulator CLI can leave the Java database emulator holding port
  9000 — kill it before restarting.

---

## Reusing this next year (cleanup & reset)

Everything is data-driven; the code is year-agnostic except a few constants. **Not built
yet:** an "Archive & reset" button — model it on the derby's "Season tools → Archive &
reset" (snapshots to `derby/archive/{year}`).

**Proposed "Archive & reset" (admin button in `/vote-admin`, or a script):**
1. Snapshot `{ meta, awards, ballots, excluded, results: tallies }` to
   `/voting/archive/{year}` (keep results; drop tokens — `voters` are credentials and
   worthless after the vote).
2. Clear `/voting/voters`, `/voting/ballots`, `/voting/excluded`; set `meta.open = false`;
   clear `meta.title` (it defaults to the current year).
3. Keep `/voting/awards` as next year's starting list (or reseed from `STARTER_AWARDS`),
   but **clear every `candidates` list** — finalists are per-season.
4. Delete the local `vote-links/` folder.

**Annual checklist**
- New roster in `/players` → review `/voting/excluded` for anyone who left mid-season.
- Re-verify the Spond mapping (teams get renamed, e.g. Base Invaders ↔ "Big Ol' Hitties");
  update `SPOND_GROUP` / `SPOND_NAME` in `scripts/voteLinks.mjs`.
- Collect finalists from captains (rookies, late picks, captains, umps).
- Confirm `VOTE_LINK_BASE` (`https://www.ogoley.com`) still redirects with the path intact.
- If hardening was never done, do it before links go out.
- Run the [Launch runbook](#launch-runbook).

**Year-specific bits to remember:** `DEFAULT_VOTING_TITLE` uses the current year (fine);
`inviteMessage` text is duplicated in `scripts/voteLinks.mjs` (keep in sync); the
exclusion of `mark_gee` is 2026-only data, not code.
