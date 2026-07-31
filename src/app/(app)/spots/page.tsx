'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { AREAS } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import LocationPicker from '@/components/LocationPicker'

type FavSpot = { id: string; name: string; emoji: string; area: string; x: number; y: number; type: string; circle_id: string | null }
type PlaceResult = { name: string; area: string; placeId: string }

export default function SpotsPage() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()

  const [favSpots, setFavSpots] = useState<FavSpot[]>([])
  const [loading, setLoading] = useState(true)

  // Search
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Add favorite modal
  const [showFavModal, setShowFavModal] = useState(false)
  const [favName, setFavName] = useState('')
  const [favEmoji, setFavEmoji] = useState('📍')
  const [favArea, setFavArea] = useState('')
  const [favVisibility, setFavVisibility] = useState<'private' | 'group'>('private')
  const [savingFav, setSavingFav] = useState(false)

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    await loadFavSpots()
  }, [activeCircle?.id])
  const { containerRef, refreshing, pullY, indicatorText, touchHandlers } = usePullToRefresh(onRefresh)

  // Load favorite spots
  async function loadFavSpots() {
    if (!activeCircle) return
    const { data } = await supabase
      .from('favorite_spots')
      .select('id, name, emoji, area, x, y, type, circle_id')
      .or(`user_id.eq.${user.id},circle_id.eq.${activeCircle.id}`)
    if (data) setFavSpots(data)
  }

  useEffect(() => {
    if (!activeCircle) { setLoading(false); return }
    async function init() {
      await loadFavSpots()
      setLoading(false)
    }
    init()
  }, [activeCircle?.id])

  // Realtime updates
  useEffect(() => {
    if (!activeCircle) return
    const channel = supabase
      .channel('spots-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorite_spots' }, () => {
        loadFavSpots()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeCircle?.id])

  // Search using Google Places
  async function searchSpots(q: string) {
    setQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    // Debounce
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults((data.predictions || []).map((p: any) => ({
            name: p.main_text || p.description,
            area: p.secondary_text || '',
            placeId: p.place_id,
          })))
        }
      } catch { }
      setSearching(false)
    }, 400)
    searchTimeoutRef.current = timer
  }

  // Save a search result as favorite
  async function saveFromSearch(result: PlaceResult) {
    if (favSpots.some(f => f.name === result.name)) return
    // Find nearest area for coordinates
    const areaEntry = Object.entries(AREAS).find(([name]) =>
      result.area.toLowerCase().includes(name.split(',')[0].toLowerCase())
    )
    const coords = areaEntry ? AREAS[areaEntry[0]] : { x: 4.5, y: 5 } // default to center of Metro Manila

    const id = crypto.randomUUID()
    const { error } = await supabase.from('favorite_spots').insert({
      id,
      user_id: user.id,
      circle_id: activeCircle?.id || null,
      name: result.name,
      emoji: '📍',
      area: result.area.split(',')[0] || result.area,
      x: coords.x,
      y: coords.y,
      type: 'food',
    })
    if (!error) {
      setFavSpots(prev => [...prev, { id, name: result.name, emoji: '📍', area: result.area.split(',')[0] || result.area, x: coords.x, y: coords.y, type: 'food', circle_id: activeCircle?.id || null }])
    }
  }

  // Save custom favorite spot
  async function saveFavorite() {
    if (!favName.trim() || !favArea) return
    setSavingFav(true)
    const areaNames = Object.keys(AREAS)
    const exactMatch = AREAS[favArea]
    const fuzzyMatch = !exactMatch && areaNames.find(a => favArea.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(favArea.toLowerCase()))
    const coords = exactMatch || (fuzzyMatch ? AREAS[fuzzyMatch] : { x: 4.5, y: 5 })
    const id = crypto.randomUUID()
    const { error } = await supabase.from('favorite_spots').insert({
      id,
      user_id: user.id,
      circle_id: activeCircle?.id || null,
      name: favName.trim(),
      emoji: favEmoji || '📍',
      area: favArea,
      x: coords.x,
      y: coords.y,
      type: 'food',
      visibility: favVisibility,
    })
    if (!error) {
      setFavSpots(prev => [...prev, { id, name: favName.trim(), emoji: favEmoji || '📍', area: favArea, x: coords.x, y: coords.y, type: 'food', circle_id: activeCircle?.id || null }])
      setShowFavModal(false)
      setFavName('')
      setFavEmoji('📍')
      setFavArea('')
      setFavVisibility('private')
    }
    setSavingFav(false)
  }

  // Remove favorite
  async function removeFav(id: string) {
    await supabase.from('favorite_spots').delete().eq('id', id)
    setFavSpots(prev => prev.filter(f => f.id !== id))
  }

  if (!activeCircle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', marginTop: 40, color: 'var(--text2)' }}>
        <p style={{ fontSize: 40, marginBottom: 8 }}>📍</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Spots</p>
        <p style={{ fontSize: 13 }}>Join a circle first.</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      {...touchHandlers}
      style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
    >
      {/* Pull to refresh indicator */}
      {pullY > 0 && (
        <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: 'var(--text2)', transition: 'opacity 0.2s' }}>
          {indicatorText}
        </div>
      )}

      <div style={{ padding: '16px 16px 24px' }}>
        {/* Header */}
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Spots</h2>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>
          Search for places or save your favorites for quick access when planning hangouts.
        </p>

        {/* Search */}
        <div style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="Search spots: cafe, restaurant, area..."
            value={query}
            onChange={e => searchSpots(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1.5px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          />
        </div>

        {/* Search results */}
        {query.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {searching && (
              <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: 12 }}>Searching...</div>
            )}
            {!searching && searchResults.length === 0 && query.trim() && (
              <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: 12 }}>
                No matches — try an area or cuisine type
              </div>
            )}
            {!searching && searchResults.map((r, i) => {
              const saved = favSpots.some(f => f.name === r.name)
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  background: 'var(--surface2)', borderRadius: 12,
                  border: '1px solid var(--border)',
                }}>
                  <div style={{
                    fontSize: 20, width: 34, height: 34, background: 'var(--surface3)',
                    borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>📍</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.area}
                    </div>
                  </div>
                  <button
                    onClick={() => saveFromSearch(r)}
                    style={{
                      padding: '5px 10px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700,
                      background: saved ? 'var(--green)' : 'var(--accent)',
                      color: '#fff', cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Favorite spots section */}
        {!query.trim() && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 8px' }}>Your favorites</h3>
            {favSpots.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                Save spots to get personalized recommendations based on where your friends are coming from. Search above or add your own below.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {favSpots.map(f => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    background: 'var(--surface2)', borderRadius: 12,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{
                      fontSize: 20, width: 34, height: 34, background: 'var(--surface3)',
                      borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{f.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{f.area}</div>
                    </div>
                    <button
                      onClick={() => removeFav(f.id)}
                      style={{
                        padding: '5px 8px', borderRadius: 8, border: 'none', fontSize: 11,
                        background: 'var(--surface3)', color: 'var(--text2)', cursor: 'pointer',
                      }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowFavModal(true)}
              style={{
                marginTop: 10, width: '100%', padding: '10px 0',
                background: 'var(--surface2)', color: 'var(--accent)',
                border: '1.5px dashed var(--accent)', borderRadius: 10,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              + Add favorite spot
            </button>
          </div>
        )}
      </div>

      {/* Add favorite modal — portaled to body so it overlays header */}
      {showFavModal && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowFavModal(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{
            background: 'var(--surface2)', borderRadius: 20, padding: 22,
            width: '100%', maxWidth: 360, maxHeight: '80vh', overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Add a favorite spot</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>
              Your own picks join the recommendations — favorites float to the top when they{"'"}re convenient for the group.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              <input
                type="text"
                placeholder="Spot name (e.g. Tita's tapsilogan)"
                value={favName}
                onChange={e => setFavName(e.target.value)}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 12,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="text"
                placeholder="Emoji (optional, default 📍)"
                value={favEmoji === '📍' ? '' : favEmoji}
                onChange={e => setFavEmoji(e.target.value || '📍')}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 12,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: 13, outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ position: 'relative', zIndex: 50 }}>
                <LocationPicker
                  onSelect={(name, area) => setFavArea(area ? `${name}, ${area}` : name)}
                  initialValue={favArea}
                  placeholder="Search area (e.g. BGC, Makati, Katipunan)"
                />
              </div>
            </div>

            {/* Private vs Group toggle */}
            <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
              {(['private', 'group'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setFavVisibility(v)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 10,
                    border: favVisibility === v ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                    background: favVisibility === v ? 'var(--accent-soft)' : 'var(--surface2)',
                    color: favVisibility === v ? 'var(--accent)' : 'var(--text)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {v === 'private' ? 'Just me' : `${activeCircle?.name || 'Group'}`}
                </button>
              ))}
            </div>
            {favVisibility === 'group' && (
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, marginBottom: 0 }}>
                This spot will be visible to everyone in {activeCircle?.name || 'your circle'}.
              </p>
            )}

            <button
              onClick={saveFavorite}
              disabled={!favName.trim() || !favArea || savingFav}
              style={{
                marginTop: 18, width: '100%', padding: 14, borderRadius: 14,
                border: 'none', background: 'var(--accent)', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                opacity: (!favName.trim() || !favArea || savingFav) ? 0.5 : 1,
              }}
            >{savingFav ? 'Saving...' : 'Save spot'}</button>
            <button
              onClick={() => setShowFavModal(false)}
              style={{
                marginTop: 8, width: '100%', padding: 12, borderRadius: 12,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
