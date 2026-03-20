import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface State { error: Error | null }

export class OverlayErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OverlayErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            width: 1920, height: 1080,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
            fontFamily: 'monospace',
            gap: 16,
          }}
        >
          <span style={{ fontSize: 48 }}>⚠️</span>
          <p style={{ color: '#f87171', fontSize: 24, fontWeight: 700 }}>Overlay Error</p>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, maxWidth: 800, textAlign: 'center' }}>
            {this.state.error.message}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
            Check the browser console for details. Reload the OBS source to recover.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
