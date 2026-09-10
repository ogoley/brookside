// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SponsorInterstitial } from '../SponsorInterstitial'
import type { Sponsor, SponsorOverlayState } from '../../types'

afterEach(cleanup)

const pintus: Sponsor = {
  name: "Pintu's Indian Palace",
  tagline: 'Authentic Indian cuisine',
  logoUrl: '/sponsors/pintus.jpg',
  website: 'https://pintus.website/',
  accentColor: '#f2a33a',
  lightPlate: true,
  innings: { '1': true },
  enabled: true,
}

const active = (over: Partial<SponsorOverlayState> = {}): SponsorOverlayState => ({
  active: true, sponsorId: 'pintus', inning: 2, triggeredAt: 1_000_000, durationMs: 10_000, autoShow: true, ...over,
})

describe('SponsorInterstitial', () => {
  it('renders the sponsor card with inning line, logo, name, tagline and website', () => {
    render(<SponsorInterstitial state={active()} sponsor={pintus} now={() => 1_000_500} />)
    expect(screen.getByTestId('sponsor-interstitial')).toBeTruthy()
    expect(screen.getByTestId('sponsor-eyebrow').textContent).toBe('The 2nd inning is presented by')
    expect(screen.getByTestId('sponsor-name').textContent).toBe("Pintu's Indian Palace")
    expect(screen.getByText('Authentic Indian cuisine')).toBeTruthy()
    expect(screen.getByTestId('sponsor-website').textContent).toBe('pintus.website')
    const img = screen.getByAltText("Pintu's Indian Palace") as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/sponsors/pintus.jpg')
  })

  it('renders nothing when inactive', () => {
    render(<SponsorInterstitial state={active({ active: false })} sponsor={pintus} now={() => 1_000_500} />)
    expect(screen.queryByTestId('sponsor-interstitial')).toBeNull()
  })

  it('renders nothing when the sponsor id is unknown or has no logo', () => {
    const { rerender } = render(<SponsorInterstitial state={active()} sponsor={undefined} now={() => 1_000_500} />)
    expect(screen.queryByTestId('sponsor-interstitial')).toBeNull()
    rerender(<SponsorInterstitial state={active()} sponsor={{ ...pintus, logoUrl: '' }} now={() => 1_000_500} />)
    expect(screen.queryByTestId('sponsor-interstitial')).toBeNull()
  })

  it('does not show a stale active flag whose window already elapsed (dead controller)', () => {
    render(<SponsorInterstitial state={active()} sponsor={pintus} now={() => 1_000_000 + 10_001} />)
    expect(screen.queryByTestId('sponsor-interstitial')).toBeNull()
  })

  it('expires on its own once the window passes, without any external write', async () => {
    let now = 1_000_000
    render(<SponsorInterstitial state={active()} sponsor={pintus} now={() => now} />)
    expect(screen.getByTestId('sponsor-interstitial')).toBeTruthy()
    // Clock jumps past the window; the 500ms re-check notices and the card exits.
    now = 1_000_000 + 10_500
    await waitFor(() => expect(screen.queryByTestId('sponsor-name')).toBeNull(), { timeout: 4000 })
  })

  it('omits optional pieces cleanly', () => {
    render(
      <SponsorInterstitial
        state={active({ inning: 0 })}
        sponsor={{ name: 'Bare Co', logoUrl: '/x.png' }}
        now={() => 1_000_500}
      />,
    )
    expect(screen.getByTestId('sponsor-eyebrow').textContent).toBe('This broadcast is presented by')
    expect(screen.queryByTestId('sponsor-website')).toBeNull()
    expect(screen.getByTestId('sponsor-name').textContent).toBe('Bare Co')
  })

  it('uses ordinals for later innings', () => {
    render(<SponsorInterstitial state={active({ inning: 3 })} sponsor={pintus} now={() => 1_000_500} />)
    expect(screen.getByTestId('sponsor-eyebrow').textContent).toBe('The 3rd inning is presented by')
  })
})
