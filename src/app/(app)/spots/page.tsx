'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { toStr, fmtShort, fmtWin, travelMin, txtOn, AREAS, DAY_START, DAY_END, getBrowserTimezone, currentHourInTz } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

type BusyBlock = { user_id: string; date: string; start_hour: number; end_hour: number }
type FavSpot = { id: string; name: string; emoji: string; area: string; x: number; y: number; type: string; circle_id: string | null }
type PlaceResult = { name: string; area: string; placeId: string }
type UpcomingCard = {
  dateStr: string
  dayOffset: number
  window: { s: number; e: number }
  isFull: boolean
  memberCount: number
  totalActive: number
  spot: { name: string; emoji: string; area: string; avg: number } | null
}

export default function SpotsPage() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()

  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([])
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [favSpots, setFavSpots] = useState<FavSpot[]>([])
  const [loading, setLoading] = useState(true)

  // Search
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useState<ReturnType<typeof setTimeout> | null>(null)

  // Add favorite modal
  const [showFavModal, setShowFavModal] = useState(false)
  const [favName, setFavName] = useState('')
  const [favEmoji, setFavEmoji] = useState('📍')
  const [favArea, setFavArea] = useState('')
  const [favAreaQuery, setFavAreaQuery] = useState('')
  const [favAreaFocused, setFavAreaFocused] = useState(false)
  const [savingFav, setSavingFav] = useState(false)

  const tz = useMemo(() => getBrowserTimezone(), [])
  const todayStr = useMemo(() => toStr(new Date()), [])
  const nowHour = useMemo(() => currentHourInTz(tz), [tz])
  const memberIdsKey = useMemo(() => circleMembers.map(m => m.id).sort().join(','), [circleMembers])

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    await loadBlocks()
    await loadFavSpots()
  }, [activeCircle?.id, memberIdsKey])
  const { containerRef, refreshing, pullY, indicatorText, touchHandlers } = usePullToRefresh(onRefresh)

  // Load busy blocks
  async function loadBlocks() {
    if (!activeCircle || circleMembers.length === 0) return
    const memberIds = circleMembers.map(m => m.id)
    const { data: blocks } = await supabase
      .from('busy_blocks')
      .select('user_id, date, start_hour, end_hour')
      .in('user_id', memberIds)
    if (blocks) setBusyBlocks(blocks)
    setActiveIds(new Set(memberIds))
  }

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
      await Promise.all([loadBlocks(), loadFavSpots()])
      setLoading(false)
    }
    init()
  }, [activeCircle?.id, memberIdsKey])

  // Realtime updates
  useEffect(() => {
    if (!activeCircle) return
    const channel = supabase
      .channel('spots-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'busy_blocks' }, () => {
        loadBlocks()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'favorite_spots' }, () => {
        loadFavSpots()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeCircle?.id])

  // Busy check helper
  const isBusy = useCallback((uid: string, date: string, hour: number) => {
    if (date === todayStr && hour < nowHour) return true
    return busyBlocks.some(b =>
      b.user_id === uid && b.date === date && b.start_hour <= hour && b.end_hour > hour
    )
  }, [busyBlocks, todayStr, nowHour])

  const activeMembers = useMemo(() =>
    circleMembers.filter(m => activeIds.has(m.id))
      .sort((a, b) => a.id === user.id ? -1 : b.id === user.id ? 1 : 0),
    [circleMembers, activeIds, user.id]
  )

  function freeCountAt(date: string, hour: number) {
    return activeMembers.filter(m => !isBusy(m.id, date, hour)).length
  }

  // Find free windows where minFree people are available
  function findWindows(date: string, minFree: number, minLen = 2): { s: number; e: number; count: number }[] {
    const wins: { s: number; e: number; count: number }[] = []
    let s: number | null = null
    let minCount = Infinity
    for (let h = DAY_START; h <= DAY_END; h++) {
      const fc = h < DAY_END ? freeCountAt(date, h) : 0
      if (fc >= minFree) {
        if (s === null) { s = h; minCount = fc }
        minCount = Math.min(minCount, fc)
      } else {
        if (s !== null && h - s >= minLen) {
          wins.push({ s, e: h, count: minCount })
        }
        s = null; minCount = Infinity
      }
    }
    return wins
  }

  // Recommend spots based on travel time from each member's home
  function recommendSpot(dateStr: string, win: { s: number; e: number }): { name: string; emoji: string; area: string; avg: number } | null {
    if (favSpots.length === 0) return null
    const origins = activeMembers.map(m => ({
      x: (m as any).home_x || 0,
      y: (m as any).home_y || 0,
    })).filter(o => o.x !== 0 || o.y !== 0)
    if (origins.length === 0) return null

    const scored = favSpots.map(v => {
      const times = origins.map(o => travelMin(o, v))
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      const max = Math.max(...times)
      let score = avg + 0.6 * max
      // Time-of-day bonuses
      if (win.s >= 18 && ['bar', 'karaoke', 'food', 'cinema', 'arcade'].includes(v.type)) score -= 2.5
      if (win.s < 12 && ['coffee', 'park'].includes(v.type)) score -= 2.5
      return { v, avg: Math.round(avg), score }
    }).sort((a, b) => a.score - b.score)

    if (scored.length === 0) return null
    const best = scored[0]
    return { name: best.v.name, emoji: best.v.emoji, area: best.v.area, avg: best.avg }
  }

  // Compute upcoming hangout cards
  const upcomingCards = useMemo((): UpcomingCard[] => {
    if (!activeCircle || activeMembers.length < 2) return []
    const n = activeMembers.length
    const cards: UpcomingCard[] = []

    for (let i = 0; i < 14 && cards.length < 5; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const ds = toStr(d)

      // Full windows (everyone free)
      const fullWins = findWindows(ds, n, 2)
      // Partial windows (n-1 free) as fallback
      const partialWins = fullWins.length === 0 && n >= 3 ? findWindows(ds, n - 1, 2) : []
      const wins = fullWins.length ? fullWins : partialWins
      if (wins.length === 0) continue

      const isFull = fullWins.length > 0
      const best = wins.reduce((a, b) => (b.e - b.s) > (a.e - a.s) ? b : a)
      const spot = recommendSpot(ds, best)

      cards.push({
        dateStr: ds,
        dayOffset: i,
        window: { s: best.s, e: best.e },
        isFull,
        memberCount: isFull ? n : n - 1,
        totalActive: n,
        spot,
      })
    }
    return cards
  }, [activeCircle, activeMembers, busyBlocks, favSpots, todayStr, nowHour])

  // Toggle friend filter
  function toggleFriend(id: string) {
    setActiveIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size <= 2) return prev
        next.delete(id)
      } else next.add(id)
      return next
    })
  }

  function selectAll() {
    setActiveIds(new Set(circleMembers.map(m => m.id)))
  }

  // Search using Google Places
  async function searchSpots(q: string) {
    setQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    // Debounce
    if (searchTimeout[0]) clearTimeout(searchTimeout[0])
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
    searchTimeout[1] = timer as any
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
    const coords = AREAS[favArea] || { x: 4.5, y: 5 }
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
    })
    if (!error) {
      setFavSpots(prev => [...prev, { id, name: favName.trim(), emoji: favEmoji || '📍', area: favArea, x: coords.x, y: coords.y, type: 'food', circle_id: activeCircle?.id || null }])
      setShowFavModal(false)
      setFavName('')
      setFavEmoji('📍')
      setFavArea('')
    }
    setSavingFav(false)
  }

  // Remove favorite
  async function removeFav(id: string) {
    await supabase.from('favorite_spots').delete().eq('id', id)
    setFavSpots(prev => prev.filter(f => f.id !== id))
  }

  // Navigate to calendar day
  function openDay(dateStr: string) {
    // Use URL params to tell calendar which date to open
    window.location.href = `/dashboard?date=${dateStr}`
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
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>📍 Best upcoming hangouts</h2>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>
          Windows in the next 2 weeks when everyone selected is free — with a spot that's easiest for wherever each of you is coming from that day.
        </p>

        {/* Search */}
        <div style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="🔎 Search spots: cafe, restaurant, area..."
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
                    {saved ? '✓ Saved' : '⭐ Save'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Friend filter chips */}
        {circleMembers.length > 1 && !query.trim() && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600, width: '100%', marginBottom: 2 }}>
              👥 Checking availability with
            </div>
            {circleMembers.map(m => {
              const isMe = m.id === user.id
              const on = activeIds.has(m.id)
              return (
                <div
                  key={m.id}
                  onClick={() => !isMe && toggleFriend(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px 4px 4px', borderRadius: 20,
                    background: on ? 'var(--surface3)' : 'var(--surface2)',
                    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    cursor: isMe ? 'default' : 'pointer',
                    opacity: on ? 1 : 0.5,
                    fontSize: 12, fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: m.color, color: txtOn(m.color),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800,
                  }}>
                    {m.name?.[0]}
                  </div>
                  {isMe ? 'You' : m.name}
                </div>
              )
            })}
            <div
              onClick={selectAll}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: activeIds.size === circleMembers.length ? 'var(--accent)' : 'var(--surface2)',
                color: activeIds.size === circleMembers.length ? '#fff' : 'var(--text)',
                border: `1.5px solid ${activeIds.size === circleMembers.length ? 'var(--accent)' : 'var(--border)'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}
            >
              everyone
            </div>
          </div>
        )}

        {/* Upcoming hangout cards */}
        {!query.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)', fontSize: 13 }}>Loading...</div>
            ) : upcomingCards.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '24px 16px', color: 'var(--text2)', fontSize: 13,
                background: 'var(--surface2)', borderRadius: 12, lineHeight: 1.6,
              }}>
                {activeMembers.length < 2
                  ? 'Select at least 2 friends above to see shared free windows.'
                  : favSpots.length === 0
                    ? 'No shared windows found in the next 2 weeks 😬 — save some favorite spots below to get recommendations!'
                    : 'No shared windows in the next 2 weeks 😬 — time for someone to cancel something.'}
              </div>
            ) : (
              upcomingCards.map((card, i) => (
                <div key={i} style={{
                  background: 'var(--surface2)', borderRadius: 14,
                  border: '1px solid var(--border)', padding: '14px 14px 12px',
                }}>
                  {/* Date + window */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>
                      {fmtShort(card.dateStr)}{card.dayOffset === 0 ? ' · today' : ''}
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: card.isFull ? 'var(--green)' : 'var(--text2)',
                    }}>
                      {fmtWin(card.window.s, card.window.e)}{!card.isFull ? ` · ${card.memberCount}/${card.totalActive}` : ''}
                    </span>
                  </div>

                  {/* Spot recommendation */}
                  {card.spot && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 9, marginTop: 9,
                      fontSize: 12, color: 'var(--text2)',
                    }}>
                      <span style={{ fontSize: 16 }}>{card.spot.emoji}</span>
                      <span>
                        <b style={{ color: 'var(--text)' }}>{card.spot.name}</b> · {card.spot.area} — ~{card.spot.avg} min avg
                      </span>
                    </div>
                  )}

                  {/* Open day button */}
                  <button
                    onClick={() => openDay(card.dateStr)}
                    style={{
                      marginTop: 10, width: '100%', padding: '9px 0',
                      background: 'var(--accent)', color: '#fff',
                      border: 'none', borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Open day & pick a spot
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Favorite spots section */}
        {!query.trim() && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 8px' }}>⭐ Your favorite spots</h3>
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
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>⭐ {f.name}</div>
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
              ⭐ ＋ Add your own favorite spot
            </button>
          </div>
        )}
      </div>

      {/* Add favorite modal */}
      {showFavModal && (
        <>
          <div
            onClick={() => setShowFavModal(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
              zIndex: 100,
            }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: 'var(--bg)', borderRadius: '18px 18px 0 0',
            padding: '20px 20px 32px', zIndex: 101,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 14px' }}>⭐ Add a favorite spot</h3>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                placeholder="Emoji"
                value={favEmoji}
                onChange={e => setFavEmoji(e.target.value)}
                style={{
                  width: 50, padding: '10px 8px', borderRadius: 10,
                  border: '1.5px solid var(--border)', background: 'var(--surface2)',
                  color: 'var(--text)', fontSize: 18, textAlign: 'center', outline: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Spot name (e.g. Tita's tapsilogan)"
                value={favName}
                onChange={e => setFavName(e.target.value)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10,
                  border: '1.5px solid var(--border)', background: 'var(--surface2)',
                  color: 'var(--text)', fontSize: 13, outline: 'none',
                }}
              />
            </div>

            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type="text"
                placeholder="Search area (e.g. BGC, Makati, Katipunan)"
                value={favArea || favAreaQuery}
                onChange={e => {
                  setFavAreaQuery(e.target.value)
                  setFavArea('')
                  setFavAreaFocused(true)
                }}
                onFocus={() => setFavAreaFocused(true)}
                onBlur={() => setTimeout(() => setFavAreaFocused(false), 150)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: `1.5px solid ${favArea ? 'var(--accent)' : 'var(--border)'}`,
                  background: 'var(--surface2)',
                  color: favArea ? 'var(--text)' : (favAreaQuery ? 'var(--text)' : 'var(--text2)'),
                  fontSize: 13, outline: 'none',
                }}
              />
              {favArea && (
                <span
                  onClick={() => { setFavArea(''); setFavAreaQuery('') }}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    cursor: 'pointer', fontSize: 14, color: 'var(--text2)',
                  }}
                >✕</span>
              )}
              {favAreaFocused && !favArea && (() => {
                const q = favAreaQuery.toLowerCase()
                const filtered = Object.keys(AREAS).filter(a => !q || a.toLowerCase().includes(q))
                return filtered.length > 0 ? (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, maxHeight: 180, overflowY: 'auto', zIndex: 10,
                  }}>
                    {filtered.slice(0, 15).map(a => (
                      <div
                        key={a}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setFavArea(a); setFavAreaQuery(''); setFavAreaFocused(false) }}
                        style={{
                          padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{a}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              })()}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowFavModal(false)}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 10,
                  border: '1.5px solid var(--border)', background: 'var(--surface2)',
                  color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={saveFavorite}
                disabled={!favName.trim() || !favArea || savingFav}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 10,
                  border: 'none', background: 'var(--accent)', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: (!favName.trim() || !favArea || savingFav) ? 0.5 : 1,
                }}
              >{savingFav ? 'Saving...' : 'Save spot'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
