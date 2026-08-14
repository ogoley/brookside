import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { OverlayRoute } from './routes/OverlayRoute'
import { ControllerRoute } from './routes/ControllerRoute'
import { ScorekeeperRoute } from './routes/ScorekeeperRoute'
import { ConfigRoute } from './routes/ConfigRoute'
import { StatsRoute } from './routes/StatsRoute'
import { GameEditorRoute } from './routes/GameEditorRoute'
import { SummaryRoute } from './routes/SummaryRoute'
import { DerbyRoute } from './routes/DerbyRoute'
import { DerbyOverlayRoute } from './routes/DerbyOverlayRoute'
import { DerbyControllerRoute } from './routes/DerbyControllerRoute'
import { AuthGate } from './components/AuthGate'
import { DerbyPreviewRoute } from './routes/DerbyPreviewRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StatsRoute />} />
        <Route path="/stats" element={<StatsRoute />} />
        <Route path="/overlay" element={<OverlayRoute />} />
        <Route path="/derby" element={<DerbyRoute />} />
        <Route path="/derby-overlay" element={<DerbyOverlayRoute />} />
        <Route path="/derby-controller" element={<DerbyControllerRoute />} />
        {/* Dev-only: leaderboard against mock scores, no Firebase. See the file header. */}
        <Route path="/derby-preview" element={<DerbyPreviewRoute />} />
        {/* All-star routes: the overlay is the same OBS source (it renders whatever
            the scorebug state says); the controller runs in allstar mode — team
            pickers restricted to Rist/Hiller, exhibition-only game list, one-tap
            matchup setup. */}
        <Route path="/allstar-overlay" element={<OverlayRoute />} />
        <Route
          path="/allstar-controller"
          element={<AuthGate requiredRole="scorer"><ControllerRoute allstar /></AuthGate>}
        />
        <Route
          path="/controller"
          element={<AuthGate requiredRole="scorer"><ControllerRoute /></AuthGate>}
        />
        <Route
          path="/scorekeeper"
          element={<AuthGate requiredRole="scorer"><ScorekeeperRoute /></AuthGate>}
        />
        <Route
          path="/game-editor"
          element={<AuthGate requiredRole="admin"><GameEditorRoute /></AuthGate>}
        />
        <Route
          path="/ai-summary"
          element={<AuthGate requiredRole="admin"><SummaryRoute /></AuthGate>}
        />
        <Route
          path="/config"
          element={<AuthGate requiredRole="admin"><ConfigRoute /></AuthGate>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
