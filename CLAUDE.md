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
/game/meta         — GameMeta: scores, inning, outs, bases, team IDs
/teams/{teamId}    — Team: name, shortName, primaryColor, secondaryColor, logoUrl
/overlay           — activeScene + statOverlay trigger state + timer state
/overlay/timer     — TimerState: { durationMs, startedAt, running } — default 60 min
/players/{id}      — Player: name, teamId, position, stats
/gameStats/{gameId}/{atBatId}  — stretch goal at-bat log
```
Full type definitions in `src/types.ts`.

## Key architectural decisions (do not reverse without discussion)
- **Overlay is purely reactive** — `OverlayRoute` never writes to Firebase. Only `ControllerRoute` writes.
- **Firebase listeners only** — no Redux, Zustand, or other state lib. Hooks in `src/hooks/` each own one Firebase path.
- **Team colors via CSS custom properties** — `TeamColorInjector` sets `--team-home-primary` etc. on `:root`. All components reference these vars. Do not hardcode team colors in components.
- **Scene system is a flat map** — adding a scene means: new file in `src/scenes/`, export in `src/scenes/index.ts`, render case in `OverlayRoute.tsx`, button in `SCENES[]` in `ControllerRoute.tsx`, type added to `SceneName` in `types.ts`.
- **Auto-dismiss lives in the overlay, not the controller** — `StatOverlay.tsx` runs the dismiss timer and writes `visible: false` back to Firebase itself. The controller just sets `visible: true`.
- **`dismissAfterMs` is stored in Firebase** so it's live-adjustable from the controller without a redeploy.
- **Scoreboard is a pill layout** — `Scoreboard.tsx` builds the layout directly (does not use `TeamBug`). Away team: left pill `[NAME | SCORE]` rounded-left, home team: right pill `[SCORE | NAME]` rounded-right, scores facing the center. `TeamBug` still exists for potential future use and accepts a `mirrored` prop, but is not used in the overlay scoreboard.
- **Broadcast scoreboard is centered at 36% width** — `GameScene` wraps `Scoreboard` in a centered container (`width: 36%`). Do not make it full-width or reduce below ~30% or the pills will clip.
- **Scoreboard center section uses `flex-1` cells** — inning, timer, bases, and outs each own an equal slice of the center strip via `flex-1`. Do not use `justify-center` with fixed gaps — it leaves dead space at the edges.
- **Timer is always visible in the scoreboard** — `TimerState` lives at `/overlay/timer`. The countdown shows in the center bar at all times (displays `0:00` when expired, full duration when not yet started). Default is 60 minutes. The controller timer control is a single row: `[min input] [Set] [countdown display] [Start/Pause] [Reset]`.
- **Inning control is two half-inning step buttons** — `InteractiveScoreboard` exposes `onAdvanceHalfInning` and `onRewindHalfInning`. Both clear outs and bases. There are no separate +1/-1 inning or top/bottom toggle buttons.
- **Tailwind v4 cascade layers** — do not add unlayered CSS rules (e.g. `* { padding: 0 }`) after `@import "tailwindcss"` in `index.css`. Unlayered styles outrank Tailwind's `@layer utilities`, silently breaking utility classes. Tailwind's Preflight already handles box-model resets.
- **Controller game-state controls are in `InteractiveScoreboard`** — score, inning, bases, and outs are all controlled via the visual `InteractiveScoreboard` component, not separate button sections. Inning ▲/▼ uses the same symbol as the broadcast overlay.

## File map
```
src/
  types.ts                  — all shared TypeScript interfaces
  firebase.ts               — Firebase app init (reads from .env.local)
  hooks/
    useGameData.ts          — /game/meta listener
    useTeams.ts             — /teams listener
    useOverlayState.ts      — /overlay listener
    usePlayers.ts           — /players listener
  components/
    Scoreboard.tsx          — broadcast overlay scoreboard; pill layout built inline (not via TeamBug); always shows countdown timer; centered at 36% width in GameScene
    TeamBug.tsx             — logo + short name + score block (not used in Scoreboard); accepts mirrored prop; available for other scenes
    BaseDiamond.tsx         — read-only base runners diamond (used in Scoreboard overlay)
    OutIndicator.tsx        — read-only out dots (exists but Scoreboard inlines its own scaled version)
    InteractiveScoreboard.tsx — controller-only; tappable scoreboard controlling score, inning (◀½ / ▶½ buttons), bases, outs
    StatOverlay.tsx         — Framer Motion slide-up strip with auto-dismiss timer
    PlayerCard.tsx          — reusable stat display block (used in StatCardScene)
    TeamColorInjector.tsx   — injects CSS vars on mount; renders nothing
  scenes/
    GameScene.tsx           — scoreboard over transparent bg + stat overlay
    StatCardScene.tsx       — full-screen between-innings team stat table
    IdleScene.tsx           — league logo / waiting screen
    MatchupScene.tsx        — pitcher vs batter card (stub, stretch goal)
    index.ts                — barrel export
  routes/
    OverlayRoute.tsx        — 1920×1080 canvas, AnimatePresence scene switcher
    ControllerRoute.tsx     — all game controls; only file that writes game state
    ScorekeeperRoute.tsx    — at-bat log entry
```

## Dev setup
```bash
npm run dev   # starts on localhost:5173
```
Requires `.env.local` with Firebase config. See `.env.example` for keys. See `OBS_SETUP.md` for OBS browser source config and Firebase database seeding.

## Fonts
Always use `fontFamily: 'var(--font-score)'` for scoreboard/stat numbers and `var(--font-ui)` for prose/labels. Do not use Tailwind's `font-sans` — it won't load the right font.
