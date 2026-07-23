'use client'

import { useState, useRef, useEffect } from 'react'

type Place = {
  place_id: string
  main_text: string
  secondary_text: string
}

const RECENTS_KEY = 'pact_recent_locations'
const MAX_RECENTS = 8

function getRecents(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
  } catch { return [] }
}

function saveRecent(place: Place) {
  const recents = getRecents().filter(r => r.place_id !== place.place_id)
  recents.unshift(place)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)))
}

type Props = {
  onSelect: (name: string, area: string) => void
  initialValue?: string
  placeholder?: string
}

export default function LocationPicker({ onSelect, initialValue, placeholder }: Props) {
  const [query, setQuery] = useState(initialValue || '')
  const [predictions, setPredictions] = useState<Place[]>([])
  const [recents, setRecents] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const searchTimer = useRef<NodeJS.Timeout | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRecents(getRecents())
  }, [])

  // Close on outside click/touch (iOS needs touchstart)
  useEffect(() => {
    function handleClick(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [])

  function handleInput(val: string) {
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.length < 2) {
      setPredictions([])
      return
    }
    setLoading(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        setPredictions(data.predictions || [])
      } catch {
        setPredictions([])
      }
      setLoading(false)
    }, 300)
  }

  function selectPlace(p: Place) {
    setQuery(p.main_text)
    saveRecent(p)
    setRecents(getRecents())
    setPredictions([])
    setOpen(false)
    onSelect(p.main_text, p.secondary_text)
  }

  function clearInput() {
    setQuery('')
    setPredictions([])
    onSelect('', '')
  }

  const showRecents = open && query.length < 2 && recents.length > 0
  const showResults = open && predictions.length > 0

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface2)', borderRadius: 12,
        padding: '0 12px',
      }}>
        {/* Search icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          type="text"
          placeholder={placeholder || 'Add location'}
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          style={{
            flex: 1, padding: '10px 0', border: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 14, outline: 'none',
          }}
        />
        {query && (
          <button onClick={clearInput} style={{
            background: 'none', border: 'none', color: 'var(--text2)',
            fontSize: 16, cursor: 'pointer', padding: '0 2px',
          }}>×</button>
        )}
      </div>

      {/* Dropdown */}
      {(showRecents || showResults) && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 30,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, marginTop: 4, maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}>
          {showRecents && (
            <>
              <div style={{
                padding: '10px 14px 4px', fontSize: 11, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text2)',
              }}>
                Recents
              </div>
              {recents.map(r => (
                <PlaceRow key={r.place_id} place={r} onSelect={selectPlace} />
              ))}
            </>
          )}

          {showResults && predictions.map(p => (
            <PlaceRow key={p.place_id} place={p} onSelect={selectPlace} />
          ))}

          {loading && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
              Searching...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlaceRow({ place, onSelect }: { place: Place; onSelect: (p: Place) => void }) {
  return (
    <div
      onClick={() => onSelect(place)}
      style={{
        padding: '10px 14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {place.main_text}
        </div>
        {place.secondary_text && (
          <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {place.secondary_text}
          </div>
        )}
      </div>
      {/* Pin icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round">
        <path d="M12 21c-4-4-8-7.5-8-12a8 8 0 1 1 16 0c0 4.5-4 8-8 12z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    </div>
  )
}
