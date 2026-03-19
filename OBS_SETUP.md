# OBS Browser Source Setup

## Overlay Source (1920×1080)

1. In OBS, add a **Browser Source** to your scene
2. Set URL: `http://localhost:5173/overlay`
   *(use your hosted URL in production)*
3. Set **Width**: `1920`
4. Set **Height**: `1080`
5. Check **"Use custom frame rate"** → 60 fps
6. Check **"Shutdown source when not visible"** → OFF
7. In **Custom CSS**, add:
   ```css
   body { background-color: rgba(0,0,0,0) !important; margin: 0; }
   ```
8. Click **Refresh cache of current page** after any code changes

## Controller (iPad)

1. Connect iPad and laptop to the same network
2. Run `npm run dev` on laptop, note the local IP (e.g. `192.168.1.X`)
3. Open Safari on iPad: `http://192.168.1.X:5173/controller`
4. Tap **Share → Add to Home Screen** for fullscreen PWA feel

## Firebase Setup

1. Create a Firebase project at console.firebase.google.com
2. Enable **Realtime Database** (start in test mode for development)
3. Copy your config and create `.env.local`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_DATABASE_URL=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
4. Import `firebase-seed.json` via the Firebase console Data import, or use:
   ```bash
   firebase database:set / firebase-seed.json
   ```

## Firebase Security Rules (production)

```json
{
  "rules": {
    ".read": true,
    "overlay": { ".write": true },
    "game": { ".write": true },
    "gameStats": { ".write": true },
    "teams": { ".write": false },
    "players": { ".write": false }
  }
}
```
Lock down writes per your league's needs. Reads can stay open since overlay data is not sensitive.

## Adding a New Scene

1. Create `src/scenes/MyScene.tsx` — export a `MyScene` component
2. Add the export to `src/scenes/index.ts`
3. Add a render case in `src/routes/OverlayRoute.tsx` inside the `<AnimatePresence>` block
4. Add a button entry in `SCENES` array in `src/routes/ControllerRoute.tsx`
5. Add the type to `SceneName` in `src/types.ts`

That's it — the Firebase listener and scene switcher handle the rest.
