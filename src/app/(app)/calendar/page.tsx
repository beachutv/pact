'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { toStr, fmtDate, fmtHour, fmtTiny, fmtWin, txtOn, travelMin, travelMinGps, getBrowserTimezone, currentHourInTz, daysUntil, bdaySoon, AREAS, DAY_START, DAY_END } from '@/lib/utils'
import { useLocationUpdate } from '@/lib/useLocationUpdate'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

type BusyBlock = { user_id: string; date: string; start_hour: number; end_hour: number }
type Win = { s: number; e: number; count: number }
type DaySummary = { past?: boolean; allDay?: boolean; bestFull?: Win; bestPartial?: Win }
type Spark = {
  member: { id: string; name: string; color: string; home_area: string; home_x: number; home_y: number }
  travelTime: number
  window: { s: number; e: number }
  area: string
}
type PactEntry = { id: string; date: string; occasion: string | null; spot_name: string; spot_area: string | null; spot_emoji: string | null; win_start: number | null; win_end: number | null; status: string }
type FavSpot = { id: string; name: string; emoji: string; area: string; x: number; y: number }
type OriginInfo = { name: string; color: string; x: number; y: number; area: string; label: string }
type SpotRec = { name: string; emoji: string; area: string; travelTimes: { name: string; color: string; minutes: number }[]; avgMin: number; maxMin: number; maxWho: string; source: 'favorite' | 'venue' }

// Known hangout venues in Metro Manila — diverse locations for varied recommendations
const VENUES: { name: string; emoji: string; area: string; x: number; y: number; type: string }[] = [
  // Restaurants — spread across Metro Manila
  { name: 'Wildflour', emoji: '🥐', area: 'BGC, Taguig', x: 5.5, y: 3.5, type: 'food' },
  { name: 'Manam', emoji: '🍛', area: 'Ayala, Makati', x: 4, y: 3.4, type: 'food' },
  { name: 'Mendokoro Ramenba', emoji: '🍜', area: 'Poblacion, Makati', x: 4.2, y: 3.8, type: 'food' },
  { name: 'Maginhawa Food Trip', emoji: '🍳', area: 'Maginhawa, QC', x: 5.2, y: 7.5, type: 'food' },
  { name: 'Kapitolyo Food Crawl', emoji: '🌮', area: 'Kapitolyo, Pasig', x: 5.3, y: 5.3, type: 'food' },
  { name: 'Samgyupsalamat', emoji: '🥓', area: 'Timog Ave, QC', x: 4.8, y: 7, type: 'food' },
  { name: 'Tim Ho Wan', emoji: '🥟', area: 'Megamall, Ortigas', x: 5.4, y: 5.5, type: 'food' },
  { name: 'Yabu', emoji: '🍱', area: 'BGC, Taguig', x: 5.6, y: 3.3, type: 'food' },
  { name: 'Sarsa Kitchen', emoji: '🍗', area: 'Bonifacio Stopover, BGC', x: 5.4, y: 3.6, type: 'food' },
  { name: 'Ramen Nagi', emoji: '🍜', area: 'SM North EDSA, QC', x: 4.5, y: 8.2, type: 'food' },
  { name: 'Locavore', emoji: '🥘', area: 'Kapitolyo, Pasig', x: 5.3, y: 5.4, type: 'food' },
  { name: 'Mesa Filipino', emoji: '🍲', area: 'Greenbelt, Makati', x: 4.1, y: 3.5, type: 'food' },
  { name: 'Ooma', emoji: '🍣', area: 'Power Plant Mall, Makati', x: 4.3, y: 3.6, type: 'food' },
  { name: 'Vikings Buffet', emoji: '🍖', area: 'SM MOA, Pasay', x: 3.2, y: 3.2, type: 'food' },
  { name: 'Liliw\'s Café', emoji: '🥞', area: 'Alabang, Muntinlupa', x: 5.2, y: 1.5, type: 'food' },
  // Cafés
  { name: 'Kape Diem Café', emoji: '☕', area: 'Katipunan, QC', x: 6, y: 7.9, type: 'coffee' },
  { name: 'CBTL Eastwood', emoji: '☕', area: 'Eastwood, QC', x: 6, y: 6.5, type: 'coffee' },
  { name: 'Yardstick Coffee', emoji: '☕', area: 'Legazpi Village, Makati', x: 4.0, y: 3.3, type: 'coffee' },
  { name: 'The Commune', emoji: '☕', area: 'Poblacion, Makati', x: 4.2, y: 3.7, type: 'coffee' },
  // Bars & nightlife
  { name: 'Poblacion Rooftop', emoji: '🍹', area: 'Poblacion, Makati', x: 4.2, y: 3.7, type: 'bar' },
  { name: 'Bank Bar', emoji: '🍸', area: 'BGC, Taguig', x: 5.5, y: 3.4, type: 'bar' },
  { name: 'Xylo at The Palace', emoji: '🍷', area: 'BGC, Taguig', x: 5.6, y: 3.5, type: 'bar' },
  { name: 'Tipsy Pig', emoji: '🍻', area: 'Kapitolyo, Pasig', x: 5.3, y: 5.3, type: 'bar' },
  // Desserts & sweets
  { name: 'Café Mary Grace', emoji: '🧁', area: 'Serendra, BGC', x: 5.5, y: 3.5, type: 'dessert' },
  { name: 'Sebastian\'s', emoji: '🍦', area: 'Aguirre Ave, BF Homes', x: 4.5, y: 1.8, type: 'dessert' },
  { name: 'Poison Doughnuts', emoji: '🍩', area: 'Legazpi Village, Makati', x: 4.0, y: 3.3, type: 'dessert' },
  { name: 'Bungalow', emoji: '🍰', area: 'Scout Castor, QC', x: 5.0, y: 7.2, type: 'dessert' },
  { name: 'Early Bird Breakfast Club', emoji: '🥞', area: 'Salcedo Village, Makati', x: 4.1, y: 3.4, type: 'food' },
  // Activities & fun
  { name: 'Board Game Café', emoji: '🎲', area: 'Maginhawa, QC', x: 5.2, y: 7.5, type: 'activity' },
  { name: 'Family KTV', emoji: '🎤', area: 'Timog Ave, QC', x: 4.8, y: 7, type: 'activity' },
  { name: 'Timezone Arcade', emoji: '🕹️', area: 'Glorietta, Makati', x: 4.1, y: 3.4, type: 'activity' },
  { name: 'B&D by Commune', emoji: '🎳', area: 'Poblacion, Makati', x: 4.2, y: 3.7, type: 'activity' },
  { name: 'Ace Water Spa', emoji: '♨️', area: 'Kapitolyo, Pasig', x: 5.3, y: 5.4, type: 'activity' },
  { name: 'Kidzania Manila', emoji: '🎪', area: 'BGC, Taguig', x: 5.5, y: 3.4, type: 'activity' },
  { name: 'Art in Island Museum', emoji: '🎨', area: 'Cubao, QC', x: 5.5, y: 6.5, type: 'activity' },
  { name: 'Escape Room PH', emoji: '🔐', area: 'BGC, Taguig', x: 5.5, y: 3.5, type: 'activity' },
  // Coworking & chill
  { name: 'Common Ground', emoji: '💻', area: 'Ayala, Makati', x: 4.0, y: 3.4, type: 'cowork' },
  { name: 'WeWork Uptown', emoji: '💼', area: 'Uptown, BGC', x: 5.4, y: 3.6, type: 'cowork' },
  { name: 'A-Space', emoji: '🖥️', area: 'Salcedo Village, Makati', x: 4.1, y: 3.5, type: 'cowork' },
  // Nature & outdoors
  { name: 'Luneta Park', emoji: '🌳', area: 'Ermita, Manila', x: 3.0, y: 5.0, type: 'outdoor' },
  { name: 'La Mesa Eco Park', emoji: '🌿', area: 'Novaliches, QC', x: 5.0, y: 9.0, type: 'outdoor' },
  { name: 'Ninoy Aquino Parks & Wildlife', emoji: '🦋', area: 'Diliman, QC', x: 5.0, y: 7.8, type: 'outdoor' },
  // Malls & shopping
  { name: 'UP Town Center', emoji: '🛍️', area: 'Katipunan, QC', x: 6, y: 8, type: 'mall' },
  { name: 'SM Megamall', emoji: '🛍️', area: 'Megamall, Ortigas', x: 5.4, y: 5.5, type: 'mall' },
  { name: 'Ayala Malls Manila Bay', emoji: '🌊', area: 'Parañaque', x: 3.5, y: 2.8, type: 'mall' },
  { name: 'Eastwood Mall', emoji: '🛍️', area: 'Eastwood, QC', x: 6, y: 6.5, type: 'mall' },
  { name: 'Trinoma', emoji: '🛍️', area: 'North EDSA, QC', x: 4.5, y: 8.3, type: 'mall' },
  { name: 'Robinsons Galleria', emoji: '🛍️', area: 'Ortigas, Pasig', x: 5.4, y: 5.6, type: 'mall' },
  { name: 'Greenbelt', emoji: '🛍️', area: 'Ayala, Makati', x: 4.1, y: 3.5, type: 'mall' },
  { name: 'Venice Grand Canal', emoji: '🏙️', area: 'McKinley Hill, Taguig', x: 5.3, y: 3.3, type: 'mall' },
  // Markets & food halls
  { name: 'Mercato Centrale', emoji: '🍢', area: 'BGC, Taguig', x: 5.5, y: 3.5, type: 'food' },
  { name: 'Legazpi Sunday Market', emoji: '🥑', area: 'Legazpi Village, Makati', x: 4.0, y: 3.3, type: 'food' },
  { name: 'Salcedo Saturday Market', emoji: '🫒', area: 'Salcedo Village, Makati', x: 4.1, y: 3.4, type: 'food' },
]

function SparkCard({ spark: sp, todayStr, onDismiss }: { spark: Spark; todayStr: string; onDismiss: () => void }) {
  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontal = useRef<boolean | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontal.current = null
    setSwiping(true)
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!swiping) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current
    // Lock direction on first significant move
    if (isHorizontal.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy)
    }
    if (isHorizontal.current) {
      e.preventDefault()
      // Only allow swiping left (negative)
      setOffsetX(Math.min(0, dx))
    }
  }
  function onTouchEnd() {
    setSwiping(false)
    isHorizontal.current = null
    if (offsetX < -80) {
      setDismissed(true)
      setOffsetX(-500)
      setTimeout(onDismiss, 250)
    } else {
      setOffsetX(0)
    }
  }

  if (dismissed) return null

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        background: 'linear-gradient(135deg, rgba(118,172,179,0.18), rgba(139,176,126,0.12))',
        border: '1px solid rgba(118,172,179,0.45)', borderRadius: 16,
        padding: '10px 14px', marginBottom: 8, position: 'relative',
        transform: `translateX(${offsetX}px)`,
        opacity: Math.max(0, 1 + offsetX / 200),
        transition: swiping ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute', top: 8, right: 11,
          background: 'none', border: 'none', color: 'var(--text2)',
          fontSize: 14, cursor: 'pointer', padding: '2px 4px',
        }}
      >✕</button>
      <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
        ⚡ Spark
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 3 }}>
        You're <b>~{sp.travelTime} min</b> from{' '}
        <b style={{ color: sp.member.color }}>{sp.member.name}</b>{' '}
        ({sp.area}) and you're both free{' '}
        <b>{fmtWin(sp.window.s, sp.window.e)}</b> today.
      </div>
      <button
        onClick={() => window.location.href = `/plans/new?date=${todayStr}&hour=${sp.window.s}&end=${sp.window.e}`}
        style={{
          marginTop: 8, padding: '8px 14px', border: 'none', borderRadius: 18,
          background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
        }}
      >
        Propose a plan with {sp.member.name.split(' ')[0]}
      </button>
    </div>
  )
}

export default function CalendarPage() {
  const { user, activeCircle, circleMembers, setCircleMembers } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const dateParam = searchParams.get('date')

  const [connected, setConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([])
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [sheetDate, setSheetDate] = useState<string | null>(null)
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  // Map of memberId → dismissal timestamp (sparks return after 1 hour)
  const [dismissedSparks, setDismissedSparks] = useState<Map<string, number>>(new Map())
  const [sparkRefreshKey, setSparkRefreshKey] = useState(0)
  const [selectedWinIdx, setSelectedWinIdx] = useState(0)
  const [pacts, setPacts] = useState<PactEntry[]>([])
  const [longPressPactId, setLongPressPactId] = useState<string | null>(null)
  const pactLongPressTimer = useRef<NodeJS.Timeout | null>(null)
  // Track which members have connected their calendar
  const [connectedUserIds, setConnectedUserIds] = useState<Set<string>>(new Set())

  // Favorite spots for recommendations
  const [favSpots, setFavSpots] = useState<FavSpot[]>([])

  // Calendar selection modal is now in AppShell (global)

  // Load favorite spots for recommendations
  useEffect(() => {
    if (!activeCircle) return
    async function loadFavs() {
      const { data } = await supabase
        .from('favorite_spots')
        .select('id, name, emoji, area, x, y')
        .or(`user_id.eq.${user.id},and(circle_id.eq.${activeCircle!.id},visibility.eq.group)`)
        .limit(20)
      if (data) setFavSpots(data)
    }
    loadFavs()
  }, [activeCircle?.id])

  // Auto-sync tracking
  const hasAutoSynced = useRef(false)

  const onCalRefresh = useCallback(async () => {
    await syncCalendar()
  }, [])
  const { containerRef: calPullRef, refreshing: calPullRefreshing, pullY: calPullY, indicatorText: calIndicator, touchHandlers: calTouchHandlers } = usePullToRefresh(onCalRefresh)

  const tz = useMemo(() => getBrowserTimezone(), [])
  const todayStr = useMemo(() => toStr(new Date()), [])

  useLocationUpdate(user.id, 'calendar')

  // Track circle member IDs for dependency (stable string key)
  const memberIdsKey = useMemo(() => circleMembers.map(m => m.id).sort().join(','), [circleMembers])

  // Init: check connection + auto-sync (once)
  useEffect(() => {
    if (!activeCircle) { setLoading(false); return }
    async function init() {
      const { data: conn } = await supabase
        .from('calendar_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'google')
        .single()
      setConnected(!!conn)
      setLoading(false)

      // Auto-sync on first load if connected
      if (conn && !hasAutoSynced.current) {
        hasAutoSynced.current = true
        setSyncing(true)
        try {
          const res = await fetch('/api/calendar/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: tz }),
          })
          if (!res.ok) {
            console.error('Auto-sync failed:', res.status, await res.text())
          }
        } catch (e) {
          console.error('Auto-sync error:', e)
        }
        setSyncing(false)
        // Trigger block reload
        setBlockReloadKey(k => k + 1)
      }
    }
    init()
  }, [user.id, activeCircle?.id])

  // Reload blocks whenever circleMembers change or after sync
  const [blockReloadKey, setBlockReloadKey] = useState(0)
  useEffect(() => {
    if (!activeCircle || circleMembers.length === 0) return
    async function loadBlocks() {
      const memberIds = circleMembers.map(m => m.id)
      const [blocksRes, connRes] = await Promise.all([
        supabase.from('busy_blocks').select('user_id, date, start_hour, end_hour').in('user_id', memberIds),
        supabase.rpc('get_connected_user_ids', { p_user_ids: memberIds }),
      ])
      if (blocksRes.data) setBusyBlocks(blocksRes.data)
      if (connRes.data) setConnectedUserIds(new Set(connRes.data as string[]))
      setActiveIds(new Set(memberIds))
    }
    loadBlocks()
  }, [memberIdsKey, activeCircle?.id, blockReloadKey])

  // Load pacts for calendar indicators
  useEffect(() => {
    if (!activeCircle) return
    async function fetchPacts() {
      const { data } = await supabase
        .from('pacts')
        .select('id, date, occasion, spot_name, spot_area, spot_emoji, win_start, win_end, status')
        .eq('circle_id', activeCircle!.id)
        .gte('date', todayStr)
      if (data) setPacts(data)
    }
    fetchPacts()
  }, [activeCircle?.id, blockReloadKey])

  // Build a map of date -> pact count for calendar dots
  const pactsByDate = useMemo(() => {
    const map: Record<string, PactEntry[]> = {}
    for (const p of pacts) {
      if (!map[p.date]) map[p.date] = []
      map[p.date].push(p)
    }
    return map
  }, [pacts])

  // Realtime: auto-refresh when any circle member's busy_blocks or pacts change
  useEffect(() => {
    if (!activeCircle) return
    const channel = supabase
      .channel('calendar-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'busy_blocks',
      }, () => {
        setBlockReloadKey(k => k + 1)
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pacts',
      }, () => {
        setBlockReloadKey(k => k + 1)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload: any) => {
        const updated = payload.new as any
        if (updated && circleMembers.some(m => m.id === updated.id)) {
          setCircleMembers(prev => prev.map(m =>
            m.id === updated.id ? {
              ...m,
              live_lat: updated.live_lat,
              live_lng: updated.live_lng,
              live_area: updated.live_area,
              live_updated_at: updated.live_updated_at,
            } : m
          ))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeCircle?.id])

  // Open day sheet from ?date= query param (e.g. from Spots tab)
  const dateParamHandled = useRef(false)
  useEffect(() => {
    if (!dateParam || dateParamHandled.current || loading) return
    dateParamHandled.current = true
    const y = parseInt(dateParam.slice(0, 4))
    const m = parseInt(dateParam.slice(5, 7)) - 1
    if (!isNaN(y) && !isNaN(m)) {
      setViewYear(y)
      setViewMonth(m)
    }
    setSheetDate(dateParam)
  }, [dateParam, loading])

  // Calendar modal is now handled globally in AppShell

  // Sync calendar (manual trigger)
  async function syncCalendar() {
    setSyncing(true)
    try {
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      })
      if (!res.ok) console.error('Sync failed:', res.status)
    } catch (e) {
      console.error('Sync error:', e)
    }
    setSyncing(false)
    setBlockReloadKey(k => k + 1)
  }

  // Calendar selection modal is in AppShell

  // Current hour in user's timezone
  const nowHour = useMemo(() => currentHourInTz(tz), [tz])

  // Helpers — past hours today count as busy for everyone
  const isBusy = useCallback((uid: string, date: string, hour: number) => {
    if (date === todayStr && hour < nowHour) return true
    return busyBlocks.some(b =>
      b.user_id === uid && b.date === date && b.start_hour <= hour && b.end_hour > hour
    )
  }, [busyBlocks, todayStr, nowHour])

  // Sort: current user first, then everyone else
  const activeMembers = useMemo(() =>
    circleMembers.filter(m => activeIds.has(m.id))
      .sort((a, b) => {
        if (a.id === user.id) return -1
        if (b.id === user.id) return 1
        return 0
      }),
    [circleMembers, activeIds, user.id]
  )

  // Only members with a connected calendar count toward availability
  const calConnectedMembers = useMemo(() =>
    activeMembers.filter(m => connectedUserIds.has(m.id)),
    [activeMembers, connectedUserIds]
  )

  function freeCountAt(date: string, hour: number) {
    return calConnectedMembers.filter(m => !isBusy(m.id, date, hour)).length
  }

  // Find windows where all (or n-1) active members are free
  function findWindows(date: string, minFree: number, minLen = 1): Win[] {
    const wins: Win[] = []
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

  // Day summary for calendar cell indicators — only counts members with calendar connected
  function daySummary(date: string): DaySummary {
    if (date < todayStr) return { past: true }
    const n = calConnectedMembers.length
    if (n === 0) return {}
    const allFreeHours = []
    for (let h = DAY_START; h < DAY_END; h++) {
      if (freeCountAt(date, h) === n) allFreeHours.push(h)
    }
    const allDay = allFreeHours.length === DAY_END - DAY_START
    const fullWins = findWindows(date, n)
    const partialWins = fullWins.length === 0 && n >= 3 ? findWindows(date, n - 1, 2) : []
    const bestFull = fullWins.sort((a, b) => (b.e - b.s) - (a.e - a.s))[0]
    const bestPartial = partialWins.sort((a, b) => (b.e - b.s) - (a.e - a.s))[0]
    return { allDay, bestFull, bestPartial, past: false }
  }

  // Helper: sanitize coordinates — if they look like GPS (>12), fall back to area lookup
  function sanitizeCoords(x: number, y: number, area: string): { x: number; y: number } {
    if (x > 12 || y > 12) {
      const areaCoords = area ? AREAS[area] : undefined
      const fuzzyKey = !areaCoords ? Object.keys(AREAS).find(a =>
        area.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(area.toLowerCase())
      ) : undefined
      const fallback = areaCoords || (fuzzyKey ? AREAS[fuzzyKey] : { x: 4.5, y: 5.5 })
      return fallback
    }
    return { x, y }
  }

  // ================= Sparks =================
  const [sparkStatus, setSparkStatus] = useState<string>('')

  const sparks = useMemo((): Spark[] => {
    if (!activeCircle) { setSparkStatus('no circle'); return [] }
    // Can't compute sparks if current user hasn't connected calendar
    if (!connectedUserIds.has(user.id)) { setSparkStatus('your calendar is not connected'); return [] }
    const myLive = (user as any).live_lat && (user as any).live_lng && (user as any).live_updated_at &&
      (Date.now() - new Date((user as any).live_updated_at).getTime()) < 4 * 3600000
      ? { lat: (user as any).live_lat as number, lng: (user as any).live_lng as number } : null
    const rawMyCoords = { x: (user as any).home_x || 0, y: (user as any).home_y || 0 }
    const myCoords = sanitizeCoords(rawMyCoords.x, rawMyCoords.y, (user as any).home_area || '')
    const h = Math.max(DAY_START, Math.min(nowHour, 20))
    const result: Spark[] = []
    let debugSkips = { noCal: 0, noCoords: 0, tooFar: 0, noWindow: 0 }

    for (const m of circleMembers) {
      // Skip dismissed sparks (but they return after 1 hour)
      const dismissedAt = dismissedSparks.get(m.id)
      if (m.id === user.id || (dismissedAt && Date.now() - dismissedAt < 3600000)) continue
      // Skip members without calendar connected — their availability is unknown
      if (!connectedUserIds.has(m.id)) { debugSkips.noCal++; continue }

      const theirLive = m.live_lat && m.live_lng && m.live_updated_at &&
        (Date.now() - new Date(m.live_updated_at).getTime()) < 4 * 3600000
        ? { lat: m.live_lat, lng: m.live_lng } : null

      let t: number
      if (myLive && theirLive) {
        t = travelMinGps(myLive, theirLive)
      } else {
        const rawTheirCoords = { x: m.home_x || 0, y: m.home_y || 0 }
        const theirCoords = sanitizeCoords(rawTheirCoords.x, rawTheirCoords.y, m.home_area || '')
        if (myCoords.x === 0 && myCoords.y === 0) { debugSkips.noCoords++; continue }
        if (theirCoords.x === 0 && theirCoords.y === 0) { debugSkips.noCoords++; continue }
        t = travelMin(myCoords, theirCoords)
      }
      if (t > 45) { debugSkips.tooFar++; continue }

      // Find shared free window today (min 1.5 hours)
      let ws: number | null = null
      let best: { s: number; e: number; len: number } | null = null
      for (let x = h; x <= DAY_END; x++) {
        const ok = x < DAY_END && !isBusy(user.id, todayStr, x) && !isBusy(m.id, todayStr, x)
        if (ok && ws === null) ws = x
        if (!ok && ws !== null) {
          if (x - ws >= 1.5 && (!best || x - ws > best.len)) best = { s: ws, e: x, len: x - ws }
          ws = null
        }
      }
      if (!best) { debugSkips.noWindow++; continue }
      result.push({
        member: m,
        travelTime: t,
        window: { s: best.s, e: best.e },
        area: (m.home_area || '').replace(' (home)', ''),
      })
    }

    // Build status message for empty sparks
    if (result.length === 0) {
      const reasons: string[] = []
      if (debugSkips.noCal > 0) reasons.push(`${debugSkips.noCal} haven't connected calendars`)
      if (debugSkips.tooFar > 0) reasons.push(`${debugSkips.tooFar} are too far away`)
      if (debugSkips.noWindow > 0) reasons.push(`${debugSkips.noWindow} have no shared free time today`)
      if (debugSkips.noCoords > 0) reasons.push(`${debugSkips.noCoords} missing location`)
      setSparkStatus(reasons.length > 0 ? reasons.join(', ') : 'no matches right now')
    } else {
      setSparkStatus('')
    }

    return result.sort((a, b) => a.travelTime - b.travelTime)
  }, [activeCircle, circleMembers, busyBlocks, dismissedSparks, todayStr, nowHour, user.id, connectedUserIds, sparkRefreshKey])

  function dismissSpark(memberId: string) {
    setDismissedSparks(prev => new Map(prev).set(memberId, Date.now()))
  }

  function refreshSparks() {
    setDismissedSparks(new Map())
    setSparkRefreshKey(k => k + 1)
  }

  // Compute where each member is coming from (last busy block location or home)
  const memberOrigins = useMemo((): OriginInfo[] => {
    if (!sheetDate || activeMembers.length < 2) return []
    // Get the first window start hour to determine origin
    const wins = [
      ...findWindows(sheetDate, activeMembers.length).map(w => ({ ...w, full: true })),
      ...(findWindows(sheetDate, activeMembers.length).length === 0 && activeMembers.length >= 3
        ? findWindows(sheetDate, activeMembers.length - 1, 2).map(w => ({ ...w, full: false }))
        : []),
    ].sort((a, b) => a.s - b.s)
    const winStart = wins[selectedWinIdx]?.s ?? 18

    const isToday = sheetDate === todayStr

    return activeMembers.map(m => {
      let homeX = (m as any).home_x || 0
      let homeY = (m as any).home_y || 0
      const homeArea = (m as any).home_area || ''
      // Sanity check: if coords look like GPS (lat/lng ~14/121) instead of grid (0-10), look up area
      if (homeX > 12 || homeY > 12) {
        const areaCoords = homeArea ? AREAS[homeArea] : undefined
        const fuzzyKey = !areaCoords ? Object.keys(AREAS).find(a =>
          homeArea.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(homeArea.toLowerCase())
        ) : undefined
        const fallback = areaCoords || (fuzzyKey ? AREAS[fuzzyKey] : { x: 4.5, y: 5.5 })
        homeX = fallback.x
        homeY = fallback.y
      }

      // For today: use live location if recent (within 7 days), else fall back to home
      const liveArea = (m as any).live_area as string | null
      const liveUpdated = (m as any).live_updated_at as string | null
      const liveRecent = liveArea && liveUpdated && (Date.now() - new Date(liveUpdated).getTime()) < 7 * 24 * 60 * 60 * 1000

      // Determine current origin: live location (today only) or home
      let originX = homeX
      let originY = homeY
      let originArea = homeArea
      let originLabel = `from home · ${homeArea || 'unknown'}`

      if (isToday && liveRecent && liveArea) {
        // Look up grid coordinates for the live area
        const liveCoords = AREAS[liveArea]
        const fuzzyLive = !liveCoords ? Object.keys(AREAS).find(a =>
          liveArea.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(liveArea.toLowerCase())
        ) : undefined
        const coords = liveCoords || (fuzzyLive ? AREAS[fuzzyLive] : null)
        if (coords) {
          originX = coords.x
          originY = coords.y
          originArea = liveArea
          originLabel = `currently in ${liveArea}`
        }
      }

      // Find last busy block ending before or at the window start
      const priorBlocks = busyBlocks
        .filter(b => b.user_id === m.id && b.date === sheetDate && b.end_hour <= winStart && b.end_hour >= winStart - 3)
        .sort((a, b) => b.end_hour - a.end_hour)
      const prior = priorBlocks[0]

      if (prior) {
        // If today with live location, use live coords but mention busy block
        if (isToday && liveRecent && liveArea && originArea !== homeArea) {
          return {
            name: m.name.split(' ')[0],
            color: m.color,
            x: originX,
            y: originY,
            area: originArea,
            label: `currently in ${originArea} (busy till ${fmtHour(prior.end_hour)})`,
          }
        }
        return {
          name: m.name.split(' ')[0],
          color: m.color,
          x: homeX,
          y: homeY,
          area: homeArea,
          label: `coming from ${homeArea || 'unknown'} (busy till ${fmtHour(prior.end_hour)})`,
        }
      }
      return {
        name: m.name.split(' ')[0],
        color: m.color,
        x: originX,
        y: originY,
        area: originArea,
        label: originLabel,
      }
    }).filter(o => o.x !== 0 || o.y !== 0)
  }, [sheetDate, activeMembers, busyBlocks, selectedWinIdx, todayStr])

  // Spot recommendations using ALL venues + favorites
  const spotRecommendations = useMemo((): SpotRec[] => {
    if (!sheetDate || memberOrigins.length < 2) return []

    // Combine known venues with user favorites (dedup by name)
    const seenNames = new Set<string>()
    const allSpots: { name: string; emoji: string; area: string; x: number; y: number; type: string; isFav: boolean }[] = []
    for (const f of favSpots) {
      if (!f.x || !f.y) continue
      seenNames.add(f.name)
      allSpots.push({ ...f, type: 'food', isFav: true })
    }
    for (const v of VENUES) {
      if (!seenNames.has(v.name)) {
        allSpots.push({ ...v, isFav: false })
      }
    }
    if (allSpots.length === 0) return []

    // Get current window for time-of-day bonuses
    const wins = [
      ...findWindows(sheetDate, activeMembers.length).map(w => ({ ...w, full: true })),
      ...(findWindows(sheetDate, activeMembers.length).length === 0 && activeMembers.length >= 3
        ? findWindows(sheetDate, activeMembers.length - 1, 2).map(w => ({ ...w, full: false }))
        : []),
    ].sort((a, b) => a.s - b.s)
    const winStart = wins[selectedWinIdx]?.s ?? 18

    const scored = allSpots.map(spot => {
      const travelTimes = memberOrigins.map(o => ({
        name: o.name,
        color: o.color,
        minutes: travelMin({ x: o.x, y: o.y }, { x: spot.x, y: spot.y }),
      }))
      const avgMin = Math.round(travelTimes.reduce((s, t) => s + t.minutes, 0) / travelTimes.length)
      const maxEntry = travelTimes.reduce((a, b) => b.minutes > a.minutes ? b : a)

      let score = avgMin + 0.6 * maxEntry.minutes
      if (winStart >= 18 && ['bar', 'karaoke', 'food', 'cinema', 'arcade'].includes(spot.type)) score -= 2.5
      if (winStart < 12 && ['coffee', 'park'].includes(spot.type)) score -= 2.5
      if (spot.isFav) score -= 3

      return {
        name: spot.name,
        emoji: spot.emoji,
        area: spot.area,
        travelTimes,
        avgMin,
        maxMin: maxEntry.minutes,
        maxWho: maxEntry.name,
        source: (spot.isFav ? 'favorite' : 'venue') as 'favorite' | 'venue',
        score,
        _type: spot.type,
      }
    }).sort((a, b) => a.score - b.score)

    // Ensure variety — pick best from each type first, then fill remaining
    const byType = new Map<string, typeof scored[0][]>()
    scored.forEach(s => {
      if (!byType.has(s._type)) byType.set(s._type, [])
      byType.get(s._type)!.push(s)
    })
    const diverse: typeof scored = []
    const usedNames = new Set<string>()
    // Round-robin: one from each type
    for (const [, items] of byType) {
      if (diverse.length >= 10) break
      const pick = items.find(s => !usedNames.has(s.name))
      if (pick) { diverse.push(pick); usedNames.add(pick.name) }
    }
    // Fill remaining from best overall
    for (const s of scored) {
      if (diverse.length >= 10) break
      if (!usedNames.has(s.name)) { diverse.push(s); usedNames.add(s.name) }
    }
    // Re-sort by score
    diverse.sort((a, b) => a.score - b.score)

    return diverse
  }, [sheetDate, memberOrigins, favSpots, selectedWinIdx, activeMembers])

  // Pact long press handlers
  function onPactTouchStart(pactId: string) {
    pactLongPressTimer.current = setTimeout(() => setLongPressPactId(pactId), 500)
  }
  function onPactTouchEnd() {
    if (pactLongPressTimer.current) clearTimeout(pactLongPressTimer.current)
  }
  async function deletePact(pactId: string) {
    if (!confirm('Delete this pact?')) return
    await supabase.from('pacts').delete().eq('id', pactId)
    setPacts(prev => prev.filter(p => p.id !== pactId))
    setLongPressPactId(null)
  }

  // Birthdays
  const upcomingBirthdays = circleMembers
    .filter(m => m.birthday)
    .map(m => ({ ...m, daysAway: bdaySoon(m.birthday!, 30) }))
    .filter(m => m.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway)

  // Toggle manual busy/free for own row
  async function toggleManualHour(date: string, hour: number) {
    const busy = isBusy(user.id, date, hour)
    if (busy) {
      await supabase.from('busy_blocks')
        .delete()
        .eq('user_id', user.id)
        .eq('date', date)
        .eq('source', 'manual')
        .lte('start_hour', hour)
        .gt('end_hour', hour)
      setBusyBlocks(prev => prev.filter(b =>
        !(b.user_id === user.id && b.date === date && b.start_hour <= hour && b.end_hour > hour)
      ))
    } else {
      const { data } = await supabase.from('busy_blocks')
        .insert({ user_id: user.id, date, start_hour: hour, end_hour: hour + 1, source: 'manual' })
        .select('user_id, date, start_hour, end_hour')
        .single()
      if (data) setBusyBlocks(prev => [...prev, data])
    }
  }

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
    setSheetDate(null)
  }

  // Month navigation
  function changeMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewMonth(m)
    setViewYear(y)
    setSheetDate(null)
  }

  // Render month grid
  function renderDays() {
    const first = new Date(viewYear, viewMonth, 1)
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate()
    const blanks = first.getDay()
    const cells = []

    for (let i = 0; i < blanks; i++) {
      cells.push(<div key={`b${i}`} style={{ aspectRatio: '0.86' }} />)
    }

    for (let d = 1; d <= dim; d++) {
      const ds = toStr(new Date(viewYear, viewMonth, d))
      const sum = daySummary(ds)
      const isToday = ds === todayStr
      const isSelected = ds === sheetDate
      const isPast = ds < todayStr
      const datePacts = pactsByDate[ds] || []

      let bg = 'var(--surface)'
      let borderColor = 'transparent'
      let winText = ''
      let winColor = 'var(--green)'

      if (sum.allDay) {
        bg = 'rgba(52, 211, 153, 0.12)'
        borderColor = 'rgba(52, 211, 153, 0.5)'
      } else if (sum.bestFull) {
        bg = 'rgba(52, 211, 153, 0.06)'
        borderColor = 'rgba(52, 211, 153, 0.22)'
        winText = `${fmtTiny(sum.bestFull.s)}-${fmtTiny(sum.bestFull.e)}`
      } else if (sum.bestPartial) {
        winText = `${activeMembers.length - 1}/${activeMembers.length} ${fmtTiny(sum.bestPartial.s)}-${fmtTiny(sum.bestPartial.e)}`
        winColor = 'var(--text2)'
      }

      // Pact indicators: red border=pending, orange/yellow fill=confirmed
      const hasConfirmed = datePacts.some(p => p.status === 'confirmed')
      const hasPending = datePacts.some(p => p.status === 'pending')
      if (hasConfirmed) {
        bg = 'rgba(245, 158, 11, 0.18)' // orange/yellow fill for confirmed
      }
      if (hasPending) {
        bg = 'rgba(59,130,246,0.15)' // blue fill for pending pacts
        borderColor = '#5B7B8A'
      }

      // Special event mini icons (occasion-based like birthdays, anniversaries)
      const occasionIcons: string[] = []
      for (const p of datePacts) {
        if (p.occasion) {
          const occ = p.occasion.toLowerCase()
          if (occ.includes('birthday') || occ.includes('bday')) occasionIcons.push('🎂')
          else if (occ.includes('anniversary')) occasionIcons.push('💍')
          else if (occ.includes('wedding')) occasionIcons.push('💒')
          else if (occ.includes('graduation')) occasionIcons.push('🎓')
          else if (occ.includes('holiday') || occ.includes('christmas') || occ.includes('new year')) occasionIcons.push('🎄')
          // no fallback icon — only special occasions get icons
        }
      }

      if (isToday) borderColor = 'var(--accent)'
      if (isSelected) borderColor = 'var(--text)'

      cells.push(
        <div
          key={d}
          onClick={() => !isPast && setSheetDate(ds === sheetDate ? null : ds)}
          style={{
            aspectRatio: '0.86', borderRadius: 11,
            background: isPast ? 'transparent' : bg,
            border: `1.5px solid ${borderColor}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 1,
            cursor: isPast ? 'default' : 'pointer',
            opacity: isPast ? 0.3 : 1,
            position: 'relative',
          }}
        >
          {sum.allDay && (
            <span style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: 'var(--green)' }} />
          )}
          {occasionIcons.length > 0 && (
            <span style={{ position: 'absolute', top: 1, left: 2, fontSize: 8, lineHeight: 1 }}>
              {occasionIcons.slice(0, 2).join('')}
            </span>
          )}
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: sum.allDay ? 'var(--green)' : 'var(--text)',
          }}>
            {d}
          </span>
          {!isPast && winText && (
            <span style={{ fontSize: 7.5, fontWeight: 800, color: winColor, letterSpacing: -0.2, lineHeight: 1 }}>
              {sum.allDay ? 'all day' : winText}
            </span>
          )}
        </div>
      )
    }
    return cells
  }

  if (!activeCircle) {
    return <div style={{ padding: 20, color: 'var(--text2)', textAlign: 'center', marginTop: 40 }}>
      Join or create a circle first!
    </div>
  }

  if (loading) return <div style={{ padding: 20 }}><div className="spinner" /></div>

  if (!connected) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 40, marginBottom: 8 }}>📅</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Calendar</p>
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>
            Connect your Google Calendar to see when everyone in {activeCircle.name} is free.
          </p>
          <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
            We only check if you're busy or free — never see event titles or details.
          </p>
          <button className="btn-primary" style={{ marginTop: 16 }}
            onClick={() => window.location.href = '/api/calendar/connect'}>
            Connect Google Calendar
          </button>
        </div>
      </div>
    )
  }

  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Sheet data
  const sheetWindows = sheetDate ? [
    ...findWindows(sheetDate, activeMembers.length).map(w => ({ ...w, full: true })),
    ...(findWindows(sheetDate, activeMembers.length).length === 0 && activeMembers.length >= 3
      ? findWindows(sheetDate, activeMembers.length - 1, 2).map(w => ({ ...w, full: false }))
      : []),
  ].sort((a, b) => a.s - b.s) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
      <div
        ref={calPullRef}
        {...calTouchHandlers}
        style={{ padding: '14px 16px 24px', overflowY: 'auto', flex: 1 }}
      >
        {(calPullY > 0 || calPullRefreshing) && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', padding: '6px 0',
            transform: `translateY(${calPullY > 0 ? calPullY - 30 : 0}px)`,
            transition: calPullY === 0 ? 'transform 0.2s' : 'none',
          }}>
            {calIndicator}
          </div>
        )}

        {/* Upcoming pacts */}
        {pacts.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              📌 Upcoming Pacts
            </p>
            {pacts.slice(0, 3).map(p => {
              const du = daysUntil(p.date)
              const count = du === 0 ? 'today!' : du === 1 ? 'tomorrow' : `in ${du} days`
              return (
                <div
                  key={p.id}
                  className="card"
                  onClick={() => { if (!longPressPactId) router.push('/plans') }}
                  onTouchStart={() => onPactTouchStart(p.id)}
                  onTouchEnd={onPactTouchEnd}
                  onTouchCancel={onPactTouchEnd}
                  style={{ cursor: 'pointer', position: 'relative', marginBottom: 8 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ fontSize: 16, fontWeight: 800 }}>
                        {p.occasion || fmtDate(p.date)}
                      </p>
                      <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                        {p.win_start !== null ? fmtHour(p.win_start) : '?'} – {p.win_end !== null ? fmtHour(p.win_end) : '?'}
                      </p>
                      <p style={{ fontSize: 13, marginTop: 4 }}>
                        {p.spot_emoji} {p.spot_name} {p.spot_area ? `· ${p.spot_area}` : ''}
                      </p>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--green)',
                      background: 'rgba(139,176,126,0.12)', padding: '3px 10px',
                      borderRadius: 12, whiteSpace: 'nowrap',
                    }}>
                      {count}
                    </span>
                  </div>

                  {longPressPactId === p.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: 0, right: 0, zIndex: 20,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 14, padding: 6, minWidth: 140,
                        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                      }}
                    >
                      <button onClick={() => { setLongPressPactId(null); router.push('/plans') }} style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: 'transparent', fontSize: 13, fontWeight: 600,
                        color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                      }}>✏️ Edit</button>
                      <button onClick={() => { setLongPressPactId(null); router.push('/chat') }} style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: 'transparent', fontSize: 13, fontWeight: 600,
                        color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                      }}>💬 Discuss</button>
                      <button onClick={() => deletePact(p.id)} style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: 'transparent', fontSize: 13, fontWeight: 600,
                        color: 'var(--red)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                      }}>🗑 Delete</button>
                      <button onClick={() => setLongPressPactId(null)} style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: 'transparent', fontSize: 13, fontWeight: 600,
                        color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                      }}>✕ Cancel</button>
                    </div>
                  )}
                </div>
              )
            })}
            {pacts.length > 3 && (
              <button
                onClick={() => router.push('/plans')}
                style={{
                  width: '100%', padding: '10px', border: '1px solid var(--border)',
                  borderRadius: 14, background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center',
                }}
              >
                See all plans →
              </button>
            )}
          </div>
        )}

        {/* Birthday reminders */}
        {upcomingBirthdays.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              🎂 Birthdays coming up
            </p>
            {upcomingBirthdays.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <div className="avatar" style={{ background: m.color, color: txtOn(m.color) }}>
                  {m.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {m.daysAway === 0 ? 'Today!' : m.daysAway === 1 ? 'Tomorrow' : `in ${m.daysAway} days`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sparks — stacked, swipe left to dismiss */}
        {sparks.length > 0 && (
          <div style={{ marginBottom: 14, overflow: 'hidden' }}>
            {sparks.map(sp => (
              <SparkCard key={sp.member.id} spark={sp} todayStr={todayStr} onDismiss={() => dismissSpark(sp.member.id)} />
            ))}
          </div>
        )}

        {/* Friend filter */}
        {circleMembers.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
              👥 Checking availability with
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {circleMembers.map(m => {
                const isMe = m.id === user.id
                const on = activeIds.has(m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => !isMe && toggleFriend(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 20, border: 'none',
                      background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                      color: on ? 'var(--text)' : 'var(--text2)',
                      fontSize: 12, fontWeight: 600, cursor: isMe ? 'default' : 'pointer',
                      opacity: on ? 1 : 0.5,
                    }}
                  >
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%', background: m.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 800, color: txtOn(m.color),
                    }}>
                      {m.name[0]}
                    </span>
                    {isMe ? 'You' : m.name.split(' ')[0]}
                  </button>
                )
              })}
              <button
                onClick={() => setActiveIds(new Set(circleMembers.map(m => m.id)))}
                style={{
                  padding: '4px 10px', borderRadius: 20, border: 'none',
                  background: activeIds.size === circleMembers.length ? 'var(--accent-soft)' : 'var(--surface2)',
                  color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                everyone
              </button>
            </div>
          </div>
        )}

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => changeMonth(-1)} style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
            width: 30, height: 30, borderRadius: 10, fontSize: 14, cursor: 'pointer',
          }}>‹</button>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>{monthLabel}</h2>
          <button onClick={() => changeMonth(1)} style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
            width: 30, height: 30, borderRadius: 10, fontSize: 14, cursor: 'pointer',
          }}>›</button>
        </div>

        {/* Weekday headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text2)', padding: '4px 0', textTransform: 'uppercase' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {renderDays()}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} /> free all day
          </span>
          <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>2–6p</span>
          <span style={{ fontSize: 10, color: 'var(--text2)', marginLeft: -6 }}>= window</span>
          <span style={{ fontSize: 10, color: 'var(--text2)' }}>
            <b>2/3</b> one short
          </span>
          <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 9, height: 9, border: '1.5px solid var(--accent)', borderRadius: 3, display: 'inline-block' }} /> today
          </span>
          <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 9, height: 9, border: '1.5px solid #5B7B8A', borderRadius: 3, display: 'inline-block' }} /> pending
          </span>
          <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 9, height: 9, background: 'rgba(245,158,11,0.3)', borderRadius: 3, display: 'inline-block' }} /> confirmed
          </span>
          <span style={{ fontSize: 10, color: 'var(--text2)' }}>
            🎂 event
          </span>
        </div>

        {/* Hint card */}
        <div style={{
          marginTop: 14, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '12px 14px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.5,
        }}>
          ⏰ <b style={{ color: 'var(--text)' }}>Auto-synced.</b> Calendar syncs every time you open this page.
          Tap any day for busy blocks, shared free windows, and to propose a plan.
          Friends only see <i>when</i> you're busy, never what your events are.
        </div>
      </div>

      {/* Floating spark button + status tooltip */}
      {!sheetDate && (
        <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {sparks.length === 0 && sparkStatus && sparkRefreshKey > 0 && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '8px 12px', fontSize: 11, color: 'var(--text2)',
              maxWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', lineHeight: 1.4,
            }}>
              No sparks right now — {sparkStatus}
            </div>
          )}
          <button
            onClick={refreshSparks}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(118,172,179,0.9), rgba(139,176,126,0.8))',
              border: 'none', color: '#fff', fontSize: 20,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(118,172,179,0.4)',
            }}
            title="Check for sparks"
          >
            ⚡
          </button>
        </div>
      )}

      {/* Day sheet overlay */}
      {sheetDate && (
        <>
          <div
            onClick={() => setSheetDate(null)}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
              zIndex: 30,
            }}
          />
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 31,
            background: 'var(--surface2)', borderRadius: '24px 24px 0 0',
            maxHeight: '86%', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '12px auto 10px', flexShrink: 0 }} />
            <div style={{ overflowY: 'auto', padding: '0 18px 26px' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{fmtDate(sheetDate)}</h3>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                Checking {activeIds.size === circleMembers.length ? 'everyone' : `${activeMembers.length} members`} · busy blocks are red — friends only see when, never what
              </div>

              {/* Occasion banners */}
              {(pactsByDate[sheetDate] || []).filter(p => p.occasion).map(p => (
                <div
                  key={p.id}
                  style={{
                    marginTop: 10, padding: '10px 12px', borderRadius: 12,
                    background: 'var(--accent-soft)', border: '1px solid rgba(118,172,179,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    fontSize: 12.5, fontWeight: 700,
                  }}
                >
                  <span>{p.spot_emoji || '🎉'} {p.occasion} · special occasion</span>
                  <button
                    onClick={() => window.location.href = '/plans'}
                    style={{
                      border: 'none', background: 'var(--accent)', color: '#fff',
                      borderRadius: 10, padding: '7px 11px', fontSize: 11, fontWeight: 800,
                      cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    Make it a pact 📌
                  </button>
                </div>
              ))}

              {/* All free banner */}
              {daySummary(sheetDate).allDay && (
                <div style={{
                  marginTop: 10, background: 'rgba(139,176,126,0.12)', border: '1px solid rgba(139,176,126,0.4)',
                  color: 'var(--green)', fontSize: 12.5, fontWeight: 700, padding: '9px 12px', borderRadius: 12, textAlign: 'center',
                }}>
                  🎉 {activeIds.size === circleMembers.length ? "Everyone's" : "This group is"} free all day — lock it in!
                </div>
              )}

              {/* Timeline */}
              <div style={{ marginTop: 14 }}>
                {/* Time axis */}
                <div style={{ display: 'grid', gridTemplateColumns: `46px repeat(${DAY_END - DAY_START}, 1fr)`, gap: 2, marginBottom: 3 }}>
                  <div />
                  {Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i).map(h => (
                    <div key={h} style={{ fontSize: 7.5, color: 'var(--text2)', fontWeight: 700 }}>
                      {(h - DAY_START) % 3 === 0 ? fmtTiny(h) : ''}
                    </div>
                  ))}
                </div>
                {/* Member rows */}
                {activeMembers.map(m => {
                  const isConnected = connectedUserIds.has(m.id)
                  return (
                  <div key={m.id} style={{
                    display: 'grid', gridTemplateColumns: `46px repeat(${DAY_END - DAY_START}, 1fr)`,
                    gap: 2, marginBottom: 3,
                  }}>
                    <div style={{
                      fontSize: 10.5, fontWeight: 700, color: m.color,
                      paddingRight: 4, whiteSpace: 'nowrap', overflow: 'hidden',
                    }}>
                      {m.name.split(' ')[0]}{m.id === user.id ? ' ✏️' : ''}
                    </div>
                    {!isConnected ? (
                      <div style={{
                        gridColumn: `span ${DAY_END - DAY_START}`,
                        height: 28, borderRadius: 4,
                        background: 'repeating-linear-gradient(90deg, rgba(150,150,150,0.1) 0px, rgba(150,150,150,0.1) 4px, transparent 4px, transparent 8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, color: 'var(--text2)', fontWeight: 600, letterSpacing: 0.3,
                      }}>
                        calendar not connected
                      </div>
                    ) : Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i).map(h => {
                      const busy = isBusy(m.id, sheetDate!, h)
                      const isMe = m.id === user.id
                      const isPast = sheetDate === todayStr && h < nowHour
                      // Check if this hour falls within any pact's time window
                      const datePacts = sheetDate ? (pactsByDate[sheetDate] || []) : []
                      const pactAtHour = datePacts.find(p => p.win_start !== null && p.win_end !== null && h >= p.win_start! && h < p.win_end!)
                      const isPactHour = !!pactAtHour
                      const isPactConfirmed = pactAtHour?.status === 'confirmed'
                      return (
                        <div
                          key={h}
                          onClick={isMe && !isPast ? () => toggleManualHour(sheetDate!, h) : undefined}
                          title={isMe ? `${fmtHour(h)} — tap to toggle` : `${m.name.split(' ')[0]}: ${busy ? 'busy' : 'free'}`}
                          style={{
                            height: 28, borderRadius: 4,
                            background: isPast ? 'rgba(80,80,80,0.1)'
                              : isPactHour ? (isPactConfirmed ? 'rgba(245,158,11,0.35)' : 'rgba(59,130,246,0.22)')
                              : busy ? 'rgba(231,118,93,0.28)' : 'rgba(139,176,126,0.25)',
                            border: isPactHour && !isPast ? `1.5px solid ${isPactConfirmed ? '#FFB854' : '#5B7B8A'}` : busy && !isPast ? '1px solid rgba(231,118,93,0.5)' : '1px solid rgba(139,176,126,0.35)',
                            cursor: isMe && !isPast ? 'pointer' : 'default',
                            opacity: isPast ? 0.4 : 1,
                          }}
                        />
                      )
                    })}
                  </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 5 }}>
                🟩 free · 🟥 busy · 🟦 pending · 🟧 confirmed · ▤ not connected · tap your row to toggle
              </div>

              {/* Pacts on this day */}
              {sheetDate && (pactsByDate[sheetDate] || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text2)', marginBottom: 6 }}>
                    📌 Pacts on this day
                  </div>
                  {(pactsByDate[sheetDate] || []).map(p => {
                    const isConfirmed = p.status === 'confirmed'
                    return (
                    <div
                      key={p.id}
                      onClick={() => window.location.href = '/plans'}
                      style={{
                        padding: '10px 12px', borderRadius: 12, marginBottom: 6,
                        background: isConfirmed ? 'rgba(245, 158, 11, 0.15)' : 'var(--surface)',
                        border: `1.5px solid ${isConfirmed ? '#FFB854' : '#5B7B8A'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {p.spot_emoji ? `${p.spot_emoji} ` : ''}{p.occasion || p.spot_name || 'Pact'}
                      </div>
                      {(p.win_start !== null && p.win_end !== null) && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                          🕐 {fmtHour(p.win_start)} – {fmtHour(p.win_end)}
                        </div>
                      )}
                      {p.spot_area && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                          📍 {p.spot_area}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}

              {/* Windows */}
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text2)', margin: '16px 0 8px' }}>
                ⏰ {sheetWindows.length && sheetWindows[0].full ? 'Windows when everyone is free' : 'Best windows'}
              </div>
              {sheetWindows.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sheetWindows.map((w, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedWinIdx(i)}
                      style={{
                        padding: '8px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 700,
                        cursor: 'pointer',
                        border: i === selectedWinIdx ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                        background: i === selectedWinIdx ? 'rgba(139,176,126,0.15)' : w.full ? 'rgba(139,176,126,0.06)' : 'var(--surface)',
                        color: w.full ? 'var(--green)' : 'var(--text2)',
                      }}
                    >
                      {fmtHour(w.s)} – {fmtHour(w.e)}
                      {!w.full && (
                        <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 800, marginLeft: 4 }}>
                          {activeMembers.length - 1}/{activeMembers.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--text2)', padding: '10px 0' }}>
                  😕 No shared window for this group. Try another day or a smaller group.
                </div>
              )}

              {/* Spot recommendations — per-member origins + venue cards */}
              {sheetWindows.length > 0 && memberOrigins.length >= 2 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text2)', marginBottom: 8 }}>
                    📍 Spots for {fmtHour(sheetWindows[selectedWinIdx]?.s ?? 18)} – {fmtHour(sheetWindows[selectedWinIdx]?.e ?? 22)} — based on where everyone{"'"}s coming from
                  </div>

                  {/* Per-member origin info */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {memberOrigins.map((o, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--text2)' }}>
                        <b style={{ color: o.color, fontWeight: 700 }}>{o.name}</b> — {o.label}
                      </div>
                    ))}
                  </div>

                  {/* Spot cards */}
                  {spotRecommendations.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {spotRecommendations.map((rec, i) => (
                        <div
                          key={i}
                          onClick={() => {
                            const w = sheetWindows[selectedWinIdx] || sheetWindows[0]
                            if (w) window.location.href = `/plans/new?date=${sheetDate}&hour=${w.s}&end=${w.e}`
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 11,
                            padding: '10px 12px', borderRadius: 14,
                            background: i === 0 ? 'rgba(139,176,126,0.08)' : 'var(--surface)',
                            border: i === 0 ? '1.5px solid rgba(139,176,126,0.3)' : '1.5px solid var(--border)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{
                            fontSize: 20, width: 34, height: 34, background: 'var(--surface3)',
                            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>{rec.emoji}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                              {rec.source === 'favorite' ? '⭐ ' : ''}{rec.name}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                              {rec.area} · ~{rec.avgMin.toLocaleString()} min avg
                            </div>
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--green)', flexShrink: 0, textAlign: 'right', lineHeight: 1.4 }}>
                            {rec.maxMin.toLocaleString()} min max<br />({rec.maxWho})
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add favorite spot button */}
                  <button
                    onClick={() => window.location.href = '/spots'}
                    style={{
                      marginTop: 8, width: '100%', padding: 9, borderRadius: 10,
                      border: '1px dashed var(--border)', background: 'none',
                      color: 'var(--text2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ⭐ + Add your own favorite spot
                  </button>
                </div>
              )}

              {/* Suggest button */}
              {sheetWindows.length > 0 && (
                <button
                  onClick={() => {
                    const w = sheetWindows[selectedWinIdx] || sheetWindows[0]
                    window.location.href = `/plans/new?date=${sheetDate}&hour=${w.s}&end=${w.e}`
                  }}
                  style={{
                    marginTop: 16, width: '100%', padding: 14, border: 'none', borderRadius: 14,
                    background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  💬 Suggest {fmtDate(sheetDate!).split(',')[0]}, {fmtHour((sheetWindows[selectedWinIdx] || sheetWindows[0]).s)} – {fmtHour((sheetWindows[selectedWinIdx] || sheetWindows[0]).e)}
                  {spotRecommendations[0] ? ` · ${spotRecommendations[0].name}` : ''}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Calendar selection modal is now in AppShell */}
    </div>
  )
}
