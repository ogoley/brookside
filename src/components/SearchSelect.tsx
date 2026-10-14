import { useEffect, useMemo, useRef, useState } from 'react'

export interface SearchOption {
  id: string
  name: string
  sub?: string     // secondary text (team name, short name) — also searchable
  logo?: string
}

const THEMES = {
  light: {
    bg: '#ffffff', border: '#d1d5db', focus: '#1e3a5f', text: '#1e293b', sub: '#64748b', muted: '#94a3b8',
    hover: 'rgba(30,58,95,0.07)', selected: 'rgba(30,58,95,0.12)', shadow: '0 10px 28px rgba(15,23,42,0.18)',
  },
  dark: {
    bg: '#1c2333', border: 'rgba(255,255,255,0.15)', focus: '#60a5fa', text: '#ffffff', sub: 'rgba(255,255,255,0.45)', muted: 'rgba(255,255,255,0.35)',
    hover: 'rgba(255,255,255,0.07)', selected: 'rgba(96,165,250,0.18)', shadow: '0 10px 28px rgba(0,0,0,0.5)',
  },
}

/** Type-ahead dropdown: tap/focus to search, arrow keys + Enter to pick.
 *  16px text so iOS doesn't zoom the page on focus. */
export function SearchSelect({ options, value, onChange, placeholder, dark, emptyText }: {
  options: SearchOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  dark?: boolean
  emptyText?: string
}) {
  const t = dark ? THEMES.dark : THEMES.light
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.id === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.name.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (o: SearchOption) => {
    onChange(o.id)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onFocus = () => {
    setOpen(true)
    setQuery('')
    setActive(0)
    // On phones the keyboard covers the lower half — lift the field so the
    // list has room to open under it.
    if (window.matchMedia('(max-width: 640px)').matches) {
      setTimeout(() => inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive(a => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) { e.preventDefault(); choose(filtered[active]) }
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showLogo = !open && selected?.logo

  return (
    <div style={{ position: 'relative' }}>
      {showLogo && (
        <img src={selected.logo} alt="" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, objectFit: 'contain', pointerEvents: 'none' }} />
      )}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : (selected ? selected.name : '')}
        placeholder={open && selected ? selected.name : (placeholder ?? 'Search…')}
        onFocus={onFocus}
        onBlur={() => setOpen(false)}
        onChange={e => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={{
          width: '100%', boxSizing: 'border-box', height: 48, borderRadius: 10,
          padding: `0 ${value && !open ? 40 : 12}px 0 ${showLogo ? 42 : 12}px`,
          fontSize: 16, fontWeight: selected && !open ? 700 : 500, fontFamily: 'var(--font-ui)',
          color: t.text, background: t.bg, outline: 'none',
          border: `1.5px solid ${open ? t.focus : t.border}`, scrollMarginTop: 12,
        }}
      />
      {value && !open && (
        <button
          type="button"
          aria-label="Clear"
          onMouseDown={e => { e.preventDefault(); onChange('') }}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32,
            borderRadius: 8, border: 'none', background: 'transparent', color: t.muted, fontSize: 16, cursor: 'pointer',
          }}
        >
          ✕
        </button>
      )}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
            background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10,
            boxShadow: t.shadow, maxHeight: 280, overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 14, color: t.muted }}>{emptyText ?? 'No matches.'}</div>
          ) : filtered.map((o, i) => (
            <div
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              // mousedown + preventDefault keeps the input focused until the
              // pick lands (a click would blur and close the list first)
              onMouseDown={e => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', minHeight: 44, cursor: 'pointer',
                background: i === active ? t.hover : o.id === value ? t.selected : 'transparent',
              }}
            >
              {o.logo
                ? <img src={o.logo} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />
                : <span style={{ width: 24, flexShrink: 0 }} />}
              <span style={{ fontWeight: 600, fontSize: 15, color: t.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
              {o.sub && <span style={{ marginLeft: 'auto', fontSize: 12, color: t.sub, flexShrink: 0 }}>{o.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
