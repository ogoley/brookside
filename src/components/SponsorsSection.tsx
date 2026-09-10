import { useState } from 'react'
import { ref, push, set, remove, update } from 'firebase/database'
import { db } from '../firebase'
import { useSponsors } from '../hooks/useSponsors'
import { LogoUpload } from './LogoUpload'
import { deleteStorageLogo } from '../storageUtils'
import type { Sponsor } from '../types'
import { STARTER_SPONSORS } from '../sponsors/starter'
import {
  sortedSponsors, inningsFromMap, inningsToMap, inningAssignments,
  SPONSOR_INNING_CHOICES, displayWebsite, type SponsorEntry,
} from '../sponsors/logic'

interface SponsorForm {
  name: string
  tagline: string
  website: string
  logoUrl: string
  accentColor: string
  lightPlate: boolean
  enabled: boolean
  innings: number[]
}

const EMPTY_FORM: SponsorForm = {
  name: '', tagline: '', website: '', logoUrl: '',
  accentColor: '#fbbf24', lightPlate: false, enabled: true, innings: [],
}

const cardStyle: React.CSSProperties = { background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }
const inputStyle: React.CSSProperties = { background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }
const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-score)' }

function toForm(s: Sponsor): SponsorForm {
  return {
    name: s.name ?? '',
    tagline: s.tagline ?? '',
    website: s.website ?? '',
    logoUrl: s.logoUrl ?? '',
    accentColor: s.accentColor ?? '#fbbf24',
    lightPlate: !!s.lightPlate,
    enabled: s.enabled !== false,
    innings: inningsFromMap(s.innings),
  }
}

function fromForm(f: SponsorForm, order: number): Sponsor {
  const out: Sponsor = {
    name: f.name.trim(),
    logoUrl: f.logoUrl,
    accentColor: f.accentColor,
    lightPlate: f.lightPlate,
    enabled: f.enabled,
    innings: inningsToMap(f.innings),
    order,
  }
  // RTDB rejects undefined — only write optional strings when present
  if (f.tagline.trim()) out.tagline = f.tagline.trim()
  if (f.website.trim()) out.website = f.website.trim()
  return out
}

/** Admin panel: configure who presents which inning. Writes /config/sponsors. */
export function SponsorsSection() {
  const { sponsors } = useSponsors()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SponsorForm>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const list = sortedSponsors(sponsors)
  const assignments = inningAssignments(sponsors)
  const conflicts = [...assignments.entries()].filter(([, ids]) => ids.length > 1)

  const startNew = () => { setEditingId('__new__'); setForm({ ...EMPTY_FORM, innings: [] }) }
  const startEdit = (e: SponsorEntry) => { setEditingId(e.id); setForm(toForm(e.sponsor)) }
  const cancel = () => setEditingId(null)

  const save = async () => {
    if (!form.name.trim()) return
    if (editingId === '__new__') {
      const order = list.length ? Math.max(...list.map(s => (s.order === Number.MAX_SAFE_INTEGER ? 0 : s.order))) + 1 : 1
      await set(push(ref(db, 'config/sponsors')), fromForm(form, order))
    } else if (editingId) {
      const existing = sponsors[editingId]
      const order = typeof existing?.order === 'number' ? existing.order : list.length + 1
      await set(ref(db, `config/sponsors/${editingId}`), fromForm(form, order))
    }
    setEditingId(null)
  }

  const deleteSponsor = async (id: string) => {
    const logo = sponsors[id]?.logoUrl
    if (logo && logo.includes('firebasestorage')) deleteStorageLogo(logo)
    await remove(ref(db, `config/sponsors/${id}`))
    setConfirmDelete(null)
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const reordered = [...list]
    const [item] = reordered.splice(index, 1)
    reordered.splice(target, 0, item)
    const updates: Record<string, number> = {}
    reordered.forEach((s, i) => { updates[`config/sponsors/${s.id}/order`] = i + 1 })
    await update(ref(db), updates)
  }

  const seedStarters = async () => {
    setSeeding(true)
    try {
      const updates: Record<string, Sponsor> = {}
      for (const [id, s] of Object.entries(STARTER_SPONSORS)) {
        if (!sponsors[id]) updates[`config/sponsors/${id}`] = s
      }
      if (Object.keys(updates).length) await update(ref(db), updates)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div id="sponsors" className="flex flex-col gap-3 mb-8" style={{ maxWidth: 640 }}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-white/50 text-xs uppercase tracking-widest" style={labelStyle}>
            Inning Sponsors
          </h2>
          <p className="text-white/35 text-xs mt-1">
            Each sponsor's card slides onto the broadcast when the scorebug reaches one of its innings
            (auto-fire is toggled from the controller). A sponsor can own several innings.
          </p>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
          {conflicts.map(([inning, ids]) => (
            <p key={inning}>
              Inning {inning} has {ids.length} sponsors — only <b>{sponsors[ids[0]]?.name}</b> (first in order) will auto-fire.
            </p>
          ))}
        </div>
      )}

      {/* Inning strip overview */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${SPONSOR_INNING_CHOICES.length}, minmax(0, 1fr))` }}>
        {SPONSOR_INNING_CHOICES.map(n => {
          const ids = assignments.get(n) ?? []
          const s = ids[0] ? sponsors[ids[0]] : undefined
          return (
            <div
              key={n}
              className="rounded-lg flex flex-col items-center justify-center py-1.5 px-0.5 min-w-0"
              style={{ background: s ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', minHeight: 48 }}
              title={s ? `${s.name} presents inning ${n}` : `Inning ${n}: open`}
            >
              <span className="text-sm font-black" style={{ ...labelStyle, color: s ? '#fff' : 'rgba(255,255,255,0.25)' }}>{n}</span>
              <span className="text-[10px] uppercase tracking-wider truncate w-full text-center" style={{ ...labelStyle, color: s ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)' }}>
                {s ? s.name.split(/['\s]/)[0] : 'open'}
              </span>
            </div>
          )
        })}
      </div>

      {list.length === 0 && editingId !== '__new__' && (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={cardStyle}>
          <p className="text-white/40 text-sm">No sponsors configured yet.</p>
          <button
            onClick={seedStarters}
            disabled={seeding}
            className="h-11 rounded-xl text-sm font-bold uppercase tracking-wider"
            style={{ background: 'rgba(37,99,235,0.15)', color: '#60a5fa', border: '1px solid rgba(37,99,235,0.3)' }}
          >
            {seeding ? 'Adding…' : "Add starter sponsors (Pintu's · Pafumi's)"}
          </button>
        </div>
      )}

      {list.map((entry, i) =>
        editingId === entry.id ? (
          <SponsorFormCard key={entry.id} form={form} onChange={setForm} onSave={save} onCancel={cancel} />
        ) : (
          <div key={entry.id} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ ...cardStyle, opacity: entry.enabled ? 1 : 0.55 }}>
            <div
              className="w-20 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
              style={{ background: entry.sponsor.lightPlate ? '#fff' : '#0b1020', border: `1px solid ${entry.sponsor.accentColor ?? 'rgba(255,255,255,0.1)'}55` }}
            >
              {entry.sponsor.logoUrl
                ? <img src={entry.sponsor.logoUrl} alt="" className="w-full h-full object-contain p-1" />
                : <span className="text-white/30 text-xs">no logo</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-base leading-none truncate">
                {entry.sponsor.name}
                {!entry.enabled && <span className="text-white/40 text-xs ml-2 uppercase tracking-widest" style={labelStyle}>disabled</span>}
              </p>
              <p className="text-white/40 text-xs mt-1 uppercase tracking-widest truncate" style={labelStyle}>
                {entry.innings.length ? `Inning${entry.innings.length > 1 ? 's' : ''} ${entry.innings.join(', ')}` : 'No innings'}
                {entry.sponsor.website ? ` · ${displayWebsite(entry.sponsor.website)}` : ''}
              </p>
            </div>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="h-5 w-7 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: i === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)' }} title="Move up">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="h-5 w-7 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: i === list.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)' }} title="Move down">▼</button>
            </div>
            <button
              onClick={() => startEdit(entry)}
              className="h-9 px-4 rounded-lg text-sm font-semibold shrink-0"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Edit
            </button>
            {confirmDelete === entry.id ? (
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => deleteSponsor(entry.id)} className="h-9 px-3 rounded-lg text-xs font-bold" style={{ background: '#7f1d1d', color: '#fca5a5' }}>Delete</button>
                <button onClick={() => setConfirmDelete(null)} className="h-9 px-3 rounded-lg text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(entry.id)}
                className="h-9 px-3 rounded-lg text-sm font-semibold shrink-0"
                style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
              >
                ✕
              </button>
            )}
          </div>
        )
      )}

      {editingId === '__new__' ? (
        <SponsorFormCard form={form} onChange={setForm} onSave={save} onCancel={cancel} />
      ) : (
        <button
          onClick={startNew}
          className="w-full h-14 rounded-2xl text-base font-bold uppercase tracking-wider transition-colors"
          style={{ background: 'transparent', color: 'rgba(255,255,255,0.35)', border: '2px dashed rgba(255,255,255,0.15)', ...labelStyle }}
          onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
        >
          + Add Sponsor
        </button>
      )}
    </div>
  )
}

function SponsorFormCard({ form, onChange, onSave, onCancel }: {
  form: SponsorForm
  onChange: (f: SponsorForm) => void
  onSave: () => void
  onCancel: () => void
}) {
  const patch = <K extends keyof SponsorForm>(key: K, value: SponsorForm[K]) => onChange({ ...form, [key]: value })
  const toggleInning = (n: number) => {
    const has = form.innings.includes(n)
    patch('innings', has ? form.innings.filter(x => x !== n) : [...form.innings, n].sort((a, b) => a - b))
  }
  const canSave = form.name.trim().length > 0

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-4" style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.18)' }}>
      {/* On-air preview */}
      <div
        className="rounded-xl p-4 flex items-center gap-4"
        style={{ background: 'linear-gradient(135deg, #0c1222, #080d18)', borderLeft: `6px solid ${form.accentColor}`, border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div
          className="h-16 w-36 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
          style={{ background: form.lightPlate ? '#fff' : 'transparent' }}
        >
          {form.logoUrl
            ? <img src={form.logoUrl} alt="" className="max-h-full max-w-full object-contain p-1" />
            : <span className="text-white/25 text-xs">logo preview</span>}
        </div>
        <div className="min-w-0">
          <p className="text-white font-black uppercase text-lg leading-none truncate" style={labelStyle}>{form.name || 'Sponsor name'}</p>
          {form.tagline && <p className="text-white/60 text-xs mt-1 truncate">{form.tagline}</p>}
          {form.website && (
            <span className="inline-block mt-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ ...labelStyle, color: form.accentColor, border: `1px solid ${form.accentColor}` }}>
              {displayWebsite(form.website)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Sponsor Name">
          <input type="text" value={form.name} onChange={e => patch('name', e.target.value)} placeholder="e.g. Pintu's Indian Palace" className="w-full h-11 rounded-lg px-3 text-base" style={inputStyle} />
        </Field>
        <Field label="Website (optional)">
          <input type="text" value={form.website} onChange={e => patch('website', e.target.value)} placeholder="https://…" className="w-full h-11 rounded-lg px-3 text-base" style={inputStyle} />
        </Field>
      </div>
      <Field label="Tagline (optional)">
        <input type="text" value={form.tagline} onChange={e => patch('tagline', e.target.value)} placeholder="One short line under the name" className="w-full h-11 rounded-lg px-3 text-base" style={inputStyle} />
      </Field>

      <Field label="Logo">
        <LogoUpload
          currentUrl={form.logoUrl}
          teamName={form.name || 'sponsor'}
          folder="sponsors"
          onUploaded={url => patch('logoUrl', url)}
        />
        <p className="text-white/30 text-xs">Transparent PNG or SVG looks best. Turn on the white plate for logos designed for light backgrounds.</p>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Accent Color">
          <div className="flex items-center gap-3">
            <input type="color" value={form.accentColor} onChange={e => patch('accentColor', e.target.value)} className="rounded-lg cursor-pointer shrink-0" style={{ width: 44, height: 44, padding: 3, ...inputStyle }} />
            <span className="text-white/50 text-sm font-mono">{form.accentColor}</span>
          </div>
        </Field>
        <Field label="Logo Background">
          <button
            type="button"
            onClick={() => patch('lightPlate', !form.lightPlate)}
            className="h-11 rounded-lg text-sm font-semibold"
            style={{ background: form.lightPlate ? '#f8fafc' : '#1c2333', color: form.lightPlate ? '#0b1020' : 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {form.lightPlate ? 'White plate' : 'Transparent (dark)'}
          </button>
        </Field>
      </div>

      <Field label="Presents Innings">
        <div className="flex flex-wrap gap-2">
          {SPONSOR_INNING_CHOICES.map(n => {
            const on = form.innings.includes(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggleInning(n)}
                className="h-11 w-11 rounded-lg text-base font-black"
                style={{
                  ...labelStyle,
                  background: on ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.06)',
                  color: on ? '#fff' : 'rgba(255,255,255,0.5)',
                  border: on ? '1px solid rgba(96,165,250,0.6)' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {n}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-white/50 text-xs uppercase tracking-widest" style={labelStyle}>Enabled</span>
        <button
          type="button"
          onClick={() => patch('enabled', !form.enabled)}
          className="px-5 h-10 rounded-lg font-semibold text-sm"
          style={{ background: form.enabled ? '#16a34a' : '#374151', color: '#fff' }}
        >
          {form.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex-1 h-12 rounded-xl font-bold text-base uppercase tracking-wider"
          style={{ background: canSave ? '#2563eb' : '#1c2333', color: canSave ? '#fff' : 'rgba(255,255,255,0.3)', cursor: canSave ? 'pointer' : 'not-allowed' }}
        >
          Save Sponsor
        </button>
        <button
          onClick={onCancel}
          className="h-12 px-6 rounded-xl font-semibold text-sm uppercase tracking-wider"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-white/50 text-xs uppercase tracking-widest" style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}
