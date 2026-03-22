# Wiffle Overlay — Open To-Dos

## 🔒 Security Hardening (Firebase)

Currently both Firebase Realtime Database and Firebase Storage are running with fully open rules (`allow read/write: true`). This is intentional for rapid development but must be addressed before this app is exposed to anyone outside a trusted local network.

### Realtime Database
**Current rules (dev only):**
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

**What to lock down:**
- `/overlay` — write access should be restricted to authenticated producers only. The `/overlay` route in OBS is read-only by design in code, but the database itself currently has no enforcement.
- `/game/meta` — same; only the controller operator should be able to write scores, inning, etc.
- `/teams` — write access should require auth; reads can remain public (overlay needs them).
- `/gameStats` — write access should be scoped to authenticated scorekeepers.

**Recommended approach:** Add Firebase Anonymous Auth or a simple email/password user for the producer role. Gate all writes behind `auth != null`. Reads on `/teams` and `/game/meta` can stay public since the overlay is unauthenticated by design.

---

### Firebase Storage
**Current rules (dev only):**
```
allow read: if true;
allow write: if true;
```

**What to lock down:**
- Writes to `logos/` should require authentication — only a configured admin should be able to upload team logos.
- Reads can stay public (the overlay and controller both display logo images).

**Recommended approach:** Require `request.auth != null` for writes. Since logo uploads only happen from `/config`, and `/config` would be behind auth, this is a natural fit.

---

### Auth strategy (pick one when ready)
1. **Firebase Anonymous Auth + a shared secret** — simplest; the app auto-signs in with a shared token baked into `.env.local`. No login UI needed, just not fully secure if the token leaks.
2. **Firebase Email/Password** — add a single producer account. Show a login screen before `/controller` and `/config`. The overlay route stays unauthenticated. This is the cleanest production setup.
3. **Google Sign-In** — easy with Firebase Auth, but overkill for one or two operators.

---

## 🌐 Stats API / External Integration

The league has an official website that displays stats. Long-term, `/players` in Firebase should not be the permanent source of truth — it should either pull from the website's data or push to it.

**What to build when ready:**
- Expose a read-only REST endpoint (or Firebase Function) that serializes `/players` + `/gameStats` into a standard JSON format the website can consume.
- Alternatively, if the website already has an authoritative stats database, write an import job that pulls from it into Firebase at the start of each game day instead of using `seedPlayers.js`.
- The `seedPlayers.js` script is a stopgap — it imports last season's stats as a baseline. Real-time game stats via `/gameStats` (scorekeeper route) would layer on top.

---


## 🧹 Scorekeeper items
- [ ] `/scorekeeper` route is a stretch goal stub — either fully implement or gate it behind a feature flag so it doesn't appear as a live route.
- [ ] `GAME_ID` in `ScorekeeperRoute.tsx` is hardcoded as `'game1'` — make it dynamic when multiple games per season need to be tracked.
- [ ] No loading states are shown while Firebase hooks are fetching initial data — add skeleton/loading indicators to `/controller` and `/config` for slower connections.

## 🧹 Other Clean-Up Items
- [x] Logo images uploaded to Firebase Storage are never deleted when a team is deleted or a logo is replaced — add cleanup (delete old Storage object when `logoUrl` is overwritten or team is removed).
- [x] The `/overlay` route has no error boundary — if Firebase is unreachable, OBS will show a blank screen with no indication of why.
- [x] Right now the notch for pitcher/hitter have a baseball and cricket bat. Need this to be a wiffle ball and wiffle bat.
- [x] There is a small space created in the animatino from the notch for pitcher hitter, where there is gap. We can add padding to the top of the notch so it fills that space when it overshoots the bottom of the notch on initial animatino.
- [x] Can we make the dev setting for controller (size slider, border on and off put into a collapsable component so it is not inadvertently messed with)
- [ ] Make 100% sure that at anytime we could 'DETACH' from the live game connection of controller to scoreboard. In case soemthing went wrong with scorekeeping, we can keep the stream going.
- [ ] **Matchup scene — all-time season head-to-head stats.** Currently the matchup scene shows current-game-only stats. Future enhancement: since every at-bat is logged in `gameStats/{gameId}` and player IDs are stable, we can query all historical games and filter for at-bats where `batterId === X && pitcherId === Y` (or vice versa) to compute a true head-to-head career line (H/AB, HR, K, BB) for this exact batter vs. this exact pitcher. This would make the matchup scene genuinely unique and compelling. Requires loading all `gameStats` across every game — worth caching in a separate Firebase path (e.g. `/h2h/{batterId}/{pitcherId}`) if it becomes slow.
- [ ] **Confirm with cousin: 3rd-out run nullification rule.** On a play where the batter's action records the 3rd out (ground out, pop out), should any run that scored on the same play be nullified? In real baseball, a run scored on a force-out that ends the inning doesn't count, but a run that beats the throw on a non-force out does. Currently the scorekeeper can freely mark a runner as 'scored' on any ground/pop out play regardless of out count — we may want to block or warn when `newOuts >= 3` and a runner is marked 'scored'. Confirm the league rule before implementing.