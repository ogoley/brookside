# Auth setup — one-time steps

The app uses Firebase Auth with custom role claims to restrict writes. Reads are still public (Ryan's site + stats page keep working).

## Roles

| Role | Can write game state? | Can edit games / generate AI summaries / edit config? |
|---|---|---|
| (no account) | No | No |
| `scorer` | Yes | No |
| `admin` | Yes | Yes |

Gated routes:
- `/controller`, `/scorekeeper` — `scorer` or `admin`
- `/game-editor`, `/ai-summary`, `/config` — `admin` only
- `/`, `/stats`, `/overlay` — public (no login)

## 1. Enable Email/Password sign-in

Firebase Console → **Authentication** → **Sign-in method** → **Email/Password** → Enable → Save.

## 2. Create user accounts (username-based)

The app lets people sign in with a **username** (e.g. `kyle`) instead of an email. Internally we map each username to a synthetic email `<username>@brooksidewiffle.com` — that's just a trick to satisfy Firebase's email/password provider, no real email is ever sent.

In **Firebase Console → Authentication → Users → Add user**, enter:

- **Email**: `<username>@brooksidewiffle.com` (e.g. `kyle@brooksidewiffle.com`, `scorekeeper1@brooksidewiffle.com`)
- **Password**: whatever you want to share with that person

Create one account per person who needs access. The person types just the username part (before the `@`) in the login screen.

> Changing the domain: if you ever want to use a different suffix, update `USERNAME_DOMAIN` in `src/authConfig.ts` and the same constant in `scripts/setRole.js`.

## 3. Install the admin SDK locally (root)

```
npm install --save-dev firebase-admin
```

## 4. Download a service account key

Firebase Console → **Project settings** (gear icon) → **Service accounts** → **Generate new private key**. Save the downloaded JSON as:

```
./service-account.json
```

**Add to `.gitignore` immediately** — this file has full admin access to your Firebase project.

## 5. Assign roles

Pass the **username** (no `@` needed):

```
node scripts/setRole.js kyle admin
node scripts/setRole.js your-cousin admin
node scripts/setRole.js scorekeeper1 scorer
```

Each user must sign out and back in for the new role to take effect.

To remove a role:

```
node scripts/setRole.js someone none
```

## 6. Deploy the rules and updated function

```
npx firebase deploy --only database,functions
```

The rules live in `database.rules.json`. The AI summary function now verifies the caller's ID token and requires the `admin` claim.

## 7. Test

- Open `/` in a fresh browser — should load stats with no login.
- Open `/controller` — should prompt for login. Sign in as a scorer → controller loads.
- Try `/game-editor` as the scorer — should show "Not authorized". Sign in as admin → loads.
- Try to generate an AI summary — should only work when signed in as admin.

## Troubleshooting

- **"Missing or insufficient permissions" after login**: the user hasn't had a role set, or they haven't refreshed their token. Have them sign out and back in.
- **`generateSummary` returns 403**: caller's token doesn't have `role: admin`. Re-run `setRole.js` and have them sign back in.
- **Rules deploy fails**: confirm `firebase.json` has the `"database": { "rules": "database.rules.json" }` block.
