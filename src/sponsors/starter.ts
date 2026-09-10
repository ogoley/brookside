import type { Sponsor } from '../types'

// Same-origin starter art shipped in public/sponsors/ — a one-tap seed for
// a fresh database. Everything about a sponsor is editable afterwards.
export const STARTER_SPONSORS: Record<string, Sponsor> = {
  pintus: {
    name: "Pintu's Indian Palace",
    tagline: 'Authentic Indian cuisine · Dine in, takeout & catering',
    logoUrl: '/sponsors/pintus.jpg',
    website: 'https://pintus.website/',
    accentColor: '#f2a33a',
    lightPlate: true,
    innings: { '1': true },
    enabled: true,
    order: 1,
  },
  pafumis: {
    name: "Pafumi's on Main",
    tagline: 'Neighborhood dining on Main Street',
    logoUrl: '/sponsors/pafumis.svg',
    website: 'https://pafumis-on-main.webflow.io/',
    accentColor: '#a3182f',
    lightPlate: false,
    innings: { '2': true },
    enabled: true,
    order: 2,
  },
  guilty_grape: {
    name: 'The Guilty Grape',
    tagline: 'Beer, wine & provisions · Main St Market, Wilbraham',
    logoUrl: '/sponsors/guilty-grape.png',
    website: 'https://www.guiltygrape.com/',
    accentColor: '#6d2a6e',
    lightPlate: true,
    innings: { '3': true },
    enabled: true,
    order: 3,
  },
  evergreen_financial: {
    // Logo not received yet — the card needs one, so this stays disabled
    // until it's uploaded in /config → Sponsors and switched on.
    name: 'Evergreen Financial',
    logoUrl: '',
    accentColor: '#2f7d4f',
    lightPlate: true,
    innings: { '4': true },
    enabled: false,
    order: 4,
  },
}
