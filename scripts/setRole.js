/**
 * setRole.js — Set a custom role claim on a Firebase Auth user.
 *
 * Usage:
 *   node scripts/setRole.js <username> <admin|scorer|none>
 *
 * The username is mapped to the synthetic email <username>@brooksidewiffle.com
 * (see src/authConfig.ts). You can also pass a full email if you want.
 *
 * Example:
 *   node scripts/setRole.js kyle admin
 *   node scripts/setRole.js scorekeeper1 scorer
 *   node scripts/setRole.js former-user none        # clears the claim
 *
 * Prereqs (one-time):
 *   1. Create the user in Firebase Console -> Authentication -> Users
 *      using <username>@brooksidewiffle.com as the email.
 *   2. Download a service account key:
 *        Firebase Console -> Project settings -> Service accounts ->
 *        Generate new private key. Save as ./service-account.json (gitignored).
 *   3. Install admin SDK (only needed here): npm i -D firebase-admin
 *
 * After running, the user must sign out and sign back in (or call
 * user.getIdToken(true)) for the new claim to appear in their token.
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const USERNAME_DOMAIN = 'brooksidewiffle.com'

const [, , rawId, role] = process.argv

if (!rawId || !role) {
  console.error('Usage: node scripts/setRole.js <username> <admin|scorer|none>')
  process.exit(1)
}

const email = rawId.includes('@') ? rawId.trim().toLowerCase() : `${rawId.trim().toLowerCase()}@${USERNAME_DOMAIN}`

if (!['admin', 'scorer', 'none'].includes(role)) {
  console.error(`Invalid role "${role}". Must be "admin", "scorer", or "none".`)
  process.exit(1)
}

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'))
} catch {
  console.error('Could not read ./service-account.json.')
  console.error('Download one from Firebase Console -> Project settings -> Service accounts.')
  process.exit(1)
}

initializeApp({ credential: cert(serviceAccount) })

const auth = getAuth()
const user = await auth.getUserByEmail(email)
const claims = role === 'none' ? {} : { role }
await auth.setCustomUserClaims(user.uid, claims)
console.log(`Set claims for ${email} (uid: ${user.uid}):`, claims)
console.log('User must sign out and sign back in for the new claim to take effect.')
