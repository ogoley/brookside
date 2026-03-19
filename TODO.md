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

## ⚾ Home Run Feature — Player Data Hookup

The Home Run overlay (`HomrunBanner`) currently uses a free-text player name input on the controller (`hrPlayerName` in `ControllerRoute.tsx`). This is a placeholder until the player roster is built out.

**What needs to change:**
- The controller's Home Run section should show a dropdown of current hitters (filtered from `/players` by the batting team) instead of a text input.
- `HomrunState.playerName` should be replaced by `HomrunState.playerId`.
- `HomrunBanner` should resolve the player name from the `PlayersMap` (already available in `GameScene` props).
- The batting team is auto-detected from `game.isTopInning` — this logic is correct and should stay.

**Files to touch:** `src/types.ts`, `src/components/HomrunBanner.tsx`, `src/routes/ControllerRoute.tsx`

---

## 🧹 Other Clean-Up Items

- [ ] `/scorekeeper` route is a stretch goal stub — either fully implement or gate it behind a feature flag so it doesn't appear as a live route.
- [ ] `GAME_ID` in `ScorekeeperRoute.tsx` is hardcoded as `'game1'` — make it dynamic when multiple games per season need to be tracked.
- [ ] No loading states are shown while Firebase hooks are fetching initial data — add skeleton/loading indicators to `/controller` and `/config` for slower connections.
- [ ] Logo images uploaded to Firebase Storage are never deleted when a team is deleted or a logo is replaced — add cleanup (delete old Storage object when `logoUrl` is overwritten or team is removed).
- [ ] The `/overlay` route has no error boundary — if Firebase is unreachable, OBS will show a blank screen with no indication of why.
- [ ] The reset game button should have a confirmation