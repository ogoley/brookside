import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { OverlayRoute } from './routes/OverlayRoute'
import { ControllerRoute } from './routes/ControllerRoute'
import { ScorekeeperRoute } from './routes/ScorekeeperRoute'
import { ConfigRoute } from './routes/ConfigRoute'
import { StatsRoute } from './routes/StatsRoute'
import { GameEditorRoute } from './routes/GameEditorRoute'
import { SummaryRoute } from './routes/SummaryRoute'
import { AuthGate } from './components/AuthGate'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StatsRoute />} />
        <Route path="/stats" element={<StatsRoute />} />
        <Route path="/overlay" element={<OverlayRoute />} />
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
