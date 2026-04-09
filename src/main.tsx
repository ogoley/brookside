import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ref, onValue } from 'firebase/database'
import { db } from './firebase'
import './index.css'
import App from './App.tsx'

// Set favicon from league logo in Firebase
onValue(ref(db, 'config/leagueLogo'), snap => {
  const url = snap.val()
  if (!url) return
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  link.type = 'image/png'
  link.href = url
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
