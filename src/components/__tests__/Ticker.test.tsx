// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { Ticker } from '../Ticker'
import type { TickerState } from '../../types'
import type { TickerSection } from '../../ticker/items'

afterEach(cleanup)

const state = (over: Partial<TickerState> = {}): TickerState => ({
  visible: true, speed: 120, accentColor: '#fbbf24',
  sections: { standings: true, playoffs: true, batting: true, homeRuns: true, pitching: true, results: true, upcoming: true, sponsors: true, messages: true },
  messages: {},
  ...over,
})

const sections: TickerSection[] = [
  {
    id: 'standings', label: 'Standings',
    items: [
      { key: 'st-a', lead: '1', text: 'Swing Mafia', value: '11-3', detail: 'W3', logoUrl: '/sm.png', color: '#1c7d23' },
      { key: 'st-b', lead: '2', text: 'Gamecocks', value: '10-4' },
    ],
  },
  {
    id: 'messages', label: 'League Wire',
    items: [{ key: 'msg-1', text: 'Playoffs start next Friday' }],
  },
]

describe('Ticker', () => {
  it('renders the bar with the first section cap and its items', () => {
    render(<Ticker ticker={state()} sections={sections} />)
    expect(screen.getByTestId('ticker')).toBeTruthy()
    expect(screen.getByTestId('ticker-cap').textContent).toBe('Standings')
    const items = screen.getAllByTestId('ticker-item')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Swing Mafia')
    expect(items[0].textContent).toContain('11-3')
    expect(items[0].textContent).toContain('W3')
    expect(items[1].textContent).toContain('Gamecocks')
    expect(screen.queryByText('Playoffs start next Friday')).toBeNull()   // second section not yet on
  })

  it('shows logos when provided', () => {
    render(<Ticker ticker={state()} sections={sections} />)
    const imgs = screen.getByTestId('ticker-track').querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe('/sm.png')
  })

  it('renders nothing when hidden', () => {
    render(<Ticker ticker={state({ visible: false })} sections={sections} />)
    expect(screen.queryByTestId('ticker')).toBeNull()
  })

  it('renders nothing when there is no content, even if visible', () => {
    render(<Ticker ticker={state()} sections={[]} />)
    expect(screen.queryByTestId('ticker')).toBeNull()
  })

  it('applies the accent colour to the cap and picks readable cap text', () => {
    render(<Ticker ticker={state({ accentColor: '#1e40af' })} sections={sections} />)
    const cap = screen.getByTestId('ticker-cap').parentElement as HTMLElement
    expect(cap.style.background).toContain('rgb(30, 64, 175)')
    expect(cap.style.color).toBe('rgb(255, 255, 255)')
  })

  it('starts the track parked off-screen to the right of the cap', () => {
    render(<Ticker ticker={state()} sections={sections} width={1920} />)
    const track = screen.getByTestId('ticker-track')
    // 1920 canvas − 300 cap = 1620 viewport
    expect(track.style.transform).toBe('translateX(1620px)')
  })

  it('survives the section list shrinking under the current index', async () => {
    const { rerender } = render(<Ticker ticker={state()} sections={sections} />)
    rerender(<Ticker ticker={state()} sections={[sections[1]]} />)
    expect(screen.getByText('Playoffs start next Friday')).toBeTruthy()
    // The old cap label is still animating out for ~300ms; the new one must be present.
    await waitFor(() => {
      const caps = screen.getAllByTestId('ticker-cap').map(el => el.textContent)
      expect(caps).toContain('League Wire')
      expect(caps).not.toContain('Standings')
    }, { timeout: 3000 })
  })
})
