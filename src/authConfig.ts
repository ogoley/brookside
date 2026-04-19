// Usernames are stored in Firebase Auth as synthetic emails:
//   admin  ->  admin@brooksidewiffle.com
// Users never see or type this domain. It just satisfies Firebase's
// email/password provider, which is the only password-based option.
export const USERNAME_DOMAIN = 'brooksidewiffle.com'

export function usernameToEmail(username: string): string {
  const u = username.trim().toLowerCase()
  if (u.includes('@')) return u
  return `${u}@${USERNAME_DOMAIN}`
}
