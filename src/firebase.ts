import { initializeApp } from 'firebase/app'
import { getDatabase, connectDatabaseEmulator } from 'firebase/database'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { getAuth, browserLocalPersistence, setPersistence, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-central1')
export const auth = getAuth(app)
setPersistence(auth, browserLocalPersistence).catch(() => {/* non-fatal */})

// Dev-only: `VITE_USE_EMULATORS=1 npm run dev` points the app at local
// database/auth emulators (firebase emulators:start --only database,auth)
// so flows like finalize can be exercised without touching production.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS) {
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}
