import { useState, useRef } from 'react'
import { ref, push, set, remove } from 'firebase/database'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { Link } from 'react-router-dom'
import { db, storage } from '../firebase'
import { useTeams } from '../hooks/useTeams'
import { TeamPillPreview } from '../components/TeamPillPreview'
import type { Team } from '../types'

const EMPTY_TEAM: Team = {
  name: '',
  shortName: '',
  primaryColor: '#1a3a6b',
  secondaryColor: '#ffffff',
  logoUrl: '',
}

export function ConfigRoute() {
  const { teams } = useTeams()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Team>(EMPTY_TEAM)

  const startEdit = (id: string, team: Team) => {
    setEditingId(id)
    setForm({ ...team })
  }

  const startNew = () => {
    setEditingId('__new__')
    setForm({ ...EMPTY_TEAM })
  }

  const cancel = () => setEditingId(null)

  const save = async () => {
    if (!form.name.trim() || !form.shortName.trim()) return
    if (editingId === '__new__') {
      await push(ref(db, 'teams'), form)
    } else {
      await set(ref(db, `teams/${editingId}`), form)
    }
    setEditingId(null)
  }

  const deleteTeam = async (id: string) => {
    await remove(ref(db, `teams/${id}`))
  }

  const teamList = Object.entries(teams)

  return (
    <div
      className="min-h-screen px-4 py-4 sm:px-6 lg:px-10 lg:py-8"
      style={{ background: '#0d1117', fontFamily: 'var(--font-ui)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-white text-2xl font-black uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-score)' }}
        >
          Team Configuration
        </h1>
        <Link
          to="/controller"
          className="text-sm font-semibold transition-colors"
          style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-ui)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
        >
          ← Controller
        </Link>
      </div>

      <div className="flex flex-col gap-3" style={{ maxWidth: 640 }}>
        {/* Empty state */}
        {teamList.length === 0 && editingId !== '__new__' && (
          <p className="text-white/30 text-sm py-4" style={{ fontFamily: 'var(--font-ui)' }}>
            No teams configured yet. Add your first team below.
          </p>
        )}

        {/* Existing teams */}
        {teamList.map(([id, team]) =>
          editingId === id ? (
            <TeamForm key={id} form={form} onChange={setForm} onSave={save} onCancel={cancel} />
          ) : (
            <TeamCard
              key={id}
              team={team}
              onEdit={() => startEdit(id, team)}
              onDelete={() => deleteTeam(id)}
            />
          )
        )}

        {/* New team form or Add button */}
        {editingId === '__new__' ? (
          <TeamForm form={form} onChange={setForm} onSave={save} onCancel={cancel} />
        ) : (
          <button
            onClick={startNew}
            className="w-full h-14 rounded-2xl text-base font-bold uppercase tracking-wider transition-colors"
            style={{
              background: 'transparent',
              color: 'rgba(255,255,255,0.35)',
              border: '2px dashed rgba(255,255,255,0.15)',
              fontFamily: 'var(--font-score)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'rgba(255,255,255,0.65)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'rgba(255,255,255,0.35)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
            }}
          >
            + Add Team
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Team card (list view) ── */

function TeamCard({ team, onEdit, onDelete }: { team: Team; onEdit: () => void; onDelete: () => void }) {
  return (
    <div
      className="flex items-center gap-4 rounded-2xl px-4 py-3"
      style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <TeamPillPreview team={team} />
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-base leading-none truncate">{team.name}</p>
        <p className="text-white/40 text-xs mt-1 uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
          {team.shortName}
        </p>
      </div>
      <button
        onClick={onEdit}
        className="h-9 px-4 rounded-lg text-sm font-semibold shrink-0"
        style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="h-9 px-3 rounded-lg text-sm font-semibold shrink-0"
        style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
      >
        ✕
      </button>
    </div>
  )
}

/* ── Team form (add / edit) ── */

function TeamForm({
  form, onChange, onSave, onCancel,
}: {
  form: Team
  onChange: (t: Team) => void
  onSave: () => void
  onCancel: () => void
}) {
  const patch = (key: keyof Team, value: string) => onChange({ ...form, [key]: value })
  const canSave = form.name.trim().length > 0 && form.shortName.trim().length > 0

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-4"
      style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.18)' }}
    >
      {/* Live preview */}
      <div className="flex items-center gap-3">
        <TeamPillPreview team={form} />
        <span className="text-white/30 text-xs" style={{ fontFamily: 'var(--font-ui)' }}>Live preview</span>
      </div>

      {/* Name + short name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Team Name">
          <input
            type="text"
            value={form.name}
            onChange={e => patch('name', e.target.value)}
            placeholder="e.g. Red Wolves"
            className="w-full h-11 rounded-lg px-3 text-base"
            style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          />
        </Field>
        <Field label="Short Name (2–4 chars)">
          <input
            type="text"
            value={form.shortName}
            onChange={e => patch('shortName', e.target.value.slice(0, 4).toUpperCase())}
            placeholder="e.g. WLV"
            className="w-full h-11 rounded-lg px-3 text-base font-bold uppercase tracking-wider"
            style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', fontFamily: 'var(--font-score)' }}
          />
        </Field>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary Color">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primaryColor}
              onChange={e => patch('primaryColor', e.target.value)}
              className="rounded-lg cursor-pointer shrink-0"
              style={{ width: 44, height: 44, padding: 3, background: '#1c2333', border: '1px solid rgba(255,255,255,0.15)' }}
            />
            <span className="text-white/50 text-sm font-mono">{form.primaryColor}</span>
          </div>
        </Field>
        <Field label="Secondary Color">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.secondaryColor}
              onChange={e => patch('secondaryColor', e.target.value)}
              className="rounded-lg cursor-pointer shrink-0"
              style={{ width: 44, height: 44, padding: 3, background: '#1c2333', border: '1px solid rgba(255,255,255,0.15)' }}
            />
            <span className="text-white/50 text-sm font-mono">{form.secondaryColor}</span>
          </div>
        </Field>
      </div>

      {/* Logo upload */}
      <Field label="Team Logo (optional)">
        <LogoUpload
          currentUrl={form.logoUrl}
          teamName={form.name || 'team'}
          onUploaded={url => patch('logoUrl', url)}
        />
      </Field>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex-1 h-12 rounded-xl font-bold text-base uppercase tracking-wider transition-all"
          style={{
            background: canSave ? '#2563eb' : '#1c2333',
            color: canSave ? '#fff' : 'rgba(255,255,255,0.3)',
            cursor: canSave ? 'pointer' : 'not-allowed',
          }}
        >
          Save Team
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

function LogoUpload({ currentUrl, teamName, onUploaded }: {
  currentUrl: string
  teamName: string
  onUploaded: (url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    setError(null)
    const ext = file.name.split('.').pop()
    const path = `logos/${teamName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${ext}`
    const sRef = storageRef(storage, path)
    const task = uploadBytesResumable(sRef, file)

    task.on(
      'state_changed',
      snap => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => { setError('Upload failed. Check Firebase Storage rules.'); setProgress(null) },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        onUploaded(url)
        setProgress(null)
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Current logo or placeholder */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: '#1c2333', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {currentUrl ? (
            <img src={currentUrl} alt="" className="w-full h-full object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span style={{ fontSize: 20 }}>🖼</span>
          )}
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={progress !== null}
          className="h-11 px-4 rounded-lg text-sm font-semibold transition-colors shrink-0"
          style={{
            background: 'rgba(255,255,255,0.07)',
            color: progress !== null ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: progress !== null ? 'not-allowed' : 'pointer',
          }}
        >
          {progress !== null ? `Uploading ${progress}%` : currentUrl ? 'Replace Image' : 'Upload Image'}
        </button>

        {/* Progress bar */}
        {progress !== null && (
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: '#2563eb' }}
            />
          </div>
        )}

        {/* Clear button */}
        {currentUrl && progress === null && (
          <button
            type="button"
            onClick={() => onUploaded('')}
            className="h-11 px-3 rounded-lg text-sm font-semibold shrink-0"
            style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
          >
            ✕
          </button>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-xs" style={{ fontFamily: 'var(--font-ui)' }}>{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-white/50 text-xs uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-score)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
