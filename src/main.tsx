import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ref, onValue } from 'firebase/database'
import { db } from './firebase'
import './index.css'
import App from './App.tsx'

// Set favicon from league logo in Firebase.
// Skip SVG — browsers fetch SVG favicons in CORS mode and Firebase Storage's
// default response has no Access-Control-Allow-Origin header, so the icon
// would be blocked and pollute the console.
onValue(ref(db, 'config/leagueLogo'), snap => {
  const url: string | null = snap.val()
  if (!url) return
  const lower = url.split('?')[0].toLowerCase()
  if (lower.endsWith('.svg')) return
  const type = lower.endsWith('.ico') ? 'image/x-icon' : 'image/png'
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  link.type = type
  link.href = url
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
