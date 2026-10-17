/**
 * Controller tile for the booth ID card: one compact grid cell with a label
 * and two one-tap halves — Show/Hide and Edit. Edit opens a modal with three
 * name + description rows, each field with an ✕ to clear it instantly.
 * Writes /overlay/announcers.
 */
import { useState } from 'react'
import { ref, update } from 'firebase/database'
import { db } from '../firebase'
import type { Announcer, AnnouncersState } from '../types'

const SLOTS = 3

export function AnnouncersControl({ announcers }: { announcers: AnnouncersState }) {
  const [editing, setEditing] = useState<Announcer[] | null>(null)
  const named = announcers.people.filter(p => p.name.trim()).length
  const on = announcers.visible

  const toggle = () => update(ref(db, 'overlay/announcers'), { visible: !on })
  const openEditor = () => setEditing(Array.from({ length: SLOTS }, (_, i) => ({ ...(announcers.people[i] ?? { name: '', role: '' }) })))
  const setField = (i: number, field: keyof Announcer, value: string) =>
    setEditing(rows => rows && rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
  const save = async () => {
    if (!editing) return
    await update(ref(db, 'overlay/announcers'), { people: editing.map(r => ({ name: r.name.trim(), role: r.role.trim() })) })
    setEditing(null)
  }

  return (
    <>
      <div
        className="h-16 rounded-xl flex flex-col overflow-hidden"
        style={{
          border: `1px solid ${on ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
          background: on ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.07)',
        }}
      >
        <div className="text-[10px] font-bold uppercase tracking-widest text-center pt-1"
          style={{ fontFamily: 'var(--font-score)', color: on ? '#fbbf24' : 'rgba(255,255,255,0.45)' }}>
          Announcers{named ? ` · ${named}` : ''}{on ? ' · on air' : ''}
        </div>
        <div className="flex-1 grid grid-cols-2">
          <button
            onClick={toggle}
            disabled={!named && !on}
            title={named ? undefined : 'Add a name first'}
            className="text-sm font-bold"
            style={{ color: on ? '#fbbf24' : named ? '#fff' : 'rgba(255,255,255,0.3)' }}
          >
            {on ? 'Hide' : 'Show'}
          </button>
          <button
            onClick={openEditor}
            className="text-sm font-semibold"
            style={{ color: 'rgba(255,255,255,0.75)', borderLeft: '1px solid rgba(255,255,255,0.1)' }}
          >
            Edit
          </button>
        </div>
      </div>

      {editing && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h2 className="text-white text-sm font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                Edit Announcers
              </h2>
              <p className="text-white/40 text-xs mt-1">Up to 3, shown top to bottom. Leave a name blank to skip that slot.</p>
            </div>

            {editing.map((row, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-white/40 text-[11px] uppercase tracking-widest" style={{ fontFamily: 'var(--font-score)' }}>
                  Announcer {i + 1}
                </span>
                <ClearableInput value={row.name} onChange={v => setField(i, 'name', v)} placeholder="Name" bold />
                <ClearableInput value={row.role} onChange={v => setField(i, 'role', v)} placeholder="Description (e.g. Commissioner)" />
              </div>
            ))}

            <div className="flex gap-2">
              <button onClick={save} className="flex-1 h-12 rounded-xl font-bold text-sm uppercase tracking-wider" style={{ background: '#1d4ed8', color: '#fff' }}>
                Save
              </button>
              <button
                onClick={() => setEditing(null)}
                className="flex-1 h-12 rounded-xl font-semibold text-sm uppercase tracking-wider"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ClearableInput({ value, onChange, placeholder, bold }: { value: string; onChange: (v: string) => void; placeholder: string; bold?: boolean }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full h-11 rounded-lg pl-3 pr-10 text-sm ${bold ? 'font-semibold' : 'font-medium'}`}
        style={{ background: '#1c2333', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Clear ${placeholder}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md text-base"
          style={{ color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.06)' }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
