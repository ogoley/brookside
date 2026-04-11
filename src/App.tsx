import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { OverlayRoute } from './routes/OverlayRoute'
import { ControllerRoute } from './routes/ControllerRoute'
import { ScorekeeperRoute } from './routes/ScorekeeperRoute'
import { ConfigRoute } from './routes/ConfigRoute'
import { StatsRoute } from './routes/StatsRoute'
import { GameEditorRoute } from './routes/GameEditorRoute'
import { SummaryRoute } from './routes/SummaryRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StatsRoute />} />
        <Route path="/stats" element={<StatsRoute />} />
        <Route path="/game-editor" element={<GameEditorRoute />} />
        <Route path="/overlay" element={<OverlayRoute />} />
        <Route path="/controller" element={<ControllerRoute />} />
        <Route path="/scorekeeper" element={<ScorekeeperRoute />} />
        <Route path="/config" element={<ConfigRoute />} />
        <Route path="/ai-summary" element={<SummaryRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
