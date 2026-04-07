# Pre-Season Checklist

Work through this with your cousin before the first game.

---

## 1. Reset & Seed (if starting fresh)

- [ ] Run `npm run reset` to wipe Firebase and restore from snapshot
- [ ] Or manually clear `/gameStats`, `/games`, `/gameSummaries`, `/liveRunners` if you only want to clear game data but keep players

## 2. Set Up Teams

Go to `/config` in the browser.

- [ ] Edit both teams: correct names, short names (2-4 chars), colors, logos
- [ ] Delete any leftover fake/test teams

## 3. Set Up Rosters

Still on `/config` — click **Roster** on each team.

- [ ] Remove last year's players who aren't returning
- [ ] Add all new players (name + jersey number)
- [ ] Verify every player is on the correct team
- [ ] Double-check spelling — player names show on the broadcast

## 4. Smoke Test: Create a Game

Go to `/scorekeeper`.

- [ ] Tap "New Game", pick home and away teams
- [ ] Verify you can't proceed with fewer than 4 starters per side
- [ ] Select at least 4 starters per team, create the game

## 5. Smoke Test: Log At-Bats

Log these plays to cover the main paths:

- [ ] **Single** with empty bases — batter appears on 1st in the runner diamond
- [ ] **Double** — batter on 2nd
- [ ] **Home run** with runner(s) on — runs + RBI credited, bases cleared
- [ ] **Walk** — batter on 1st, no AB counted
- [ ] **Walk with bases loaded** — runner forced home, RBI credited
- [ ] **Strikeout** — 1 out, runners stay put
- [ ] **Groundout with runner on 1st** — chain rule pre-fills: lead runner sits, batter on 1st. Verify yellow "sits" badge. 1 out total.
- [ ] **Groundout with 1st + 2nd** — 2nd sits, 1st advances to 2nd, batter on 1st
- [ ] **Popout with runners** — NO chain rule triggered, runners stay, batter out

## 6. Smoke Test: Subs & Editing

- [ ] **Add an anonymous sub** — in the lineup, tap "Custom Sub", type a name. Verify they appear in the batter dropdown and their name shows in the at-bat log.
- [ ] **Edit the last at-bat** — tap the pencil icon. Confirm the old record disappears and the wizard pre-fills at the confirm step. Change the result and submit.
- [ ] **Undo the last at-bat** — tap Undo. Confirm runners and outs rewind correctly.

## 7. Smoke Test: Half-Inning Transition

- [ ] Get to 3 outs — verify the "inning over" interstitial appears
- [ ] Advance the half-inning — verify:
  - [ ] Outs reset to 0
  - [ ] Bases clear
  - [ ] Pitcher persists from last time that side pitched
  - [ ] Batting/fielding sides flip correctly

## 8. Smoke Test: Game Stats Panel

- [ ] Expand the "Game Stats" panel during the test game
- [ ] Verify AB / H / RBI / HR / O columns look correct for each player
- [ ] Sub names should appear (not raw IDs)

## 9. Smoke Test: Finalize

- [ ] Finish the test game (or just finalize early — it works either way)
- [ ] Check the console/summary output:
  - [ ] Hitting lines: AVG, OBP look reasonable
  - [ ] Pitching: ERA is on a ×7 scale (not ×9)
  - [ ] W/L: winning team pitcher gets W, losing gets L (only if they pitched 3+ innings)
  - [ ] Tie game: no W/L awarded
- [ ] Go to `/controller` and check the player stat overlays — season stats should reflect the finalized game

## 10. Smoke Test: Second Game (optional but recommended)

- [ ] Create and play a second short test game
- [ ] Finalize it
- [ ] Verify cumulative season stats add up across both games
- [ ] Verify W/L tallies are correct across games
- [ ] Sub at-bats should appear in game summaries but NOT in season stats

## 11. Clean Up Test Data

Before the real season starts:

- [ ] Delete test games from Firebase (`/games`, `/gameStats`, `/gameSummaries`, `/liveRunners`)
- [ ] Clear season stats from players: set each player's `stats` back to `{}` (or re-run `npm run reset` if your snapshot has clean rosters)

## 12. Game Day

- [ ] OBS browser source pointed at `/overlay` (1920x1080)
- [ ] Controller open on tablet/desktop at `/controller`
- [ ] Scorekeeper open on phone at `/scorekeeper`
- [ ] Timer set in controller
- [ ] First game created in scorekeeper with correct lineups

---

Good luck this season.
