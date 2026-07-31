'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { toStr, fmtDate, fmtHour, fmtTiny, fmtWin, txtOn, readableColor, travelMin, travelMinGps, getBrowserTimezone, currentHourInTz, daysUntil, bdaySoon, AREAS, AREA_GPS, DAY_START, DAY_END } from '@/lib/utils'
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
type OriginInfo = { name: string; color: string; x: number; y: number; lat: number; lng: number; area: string; label: string }
type SpotWithTravel = { name: string; area: string; lat: number; lng: number; emoji: string; travelTimes: { name: string; color: string; minutes: number }[]; isFav: boolean }

function SparkLine({ spark: sp, todayStr, onDismiss }: { spark: Spark; todayStr: string; onDismiss: () => void }) {
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
    if (isHorizontal.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy)
    }
    if (isHorizontal.current) {
      e.preventDefault()
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
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'linear-gradient(135deg, rgba(118,172,179,0.12), rgba(139,176,126,0.08))',
        border: '1px solid rgba(118,172,179,0.35)', borderRadius: 12,
        padding: '8px 10px', marginBottom: 6,
        transform: `translateX(${offsetX}px)`,
        opacity: Math.max(0, 1 + offsetX / 200),
        transition: swiping ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
      }}
    >
      <div style={{ flex: 1, fontSize: 12, lineHeight: 1.35, minWidth: 0 }}>
        <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 10 }}>⚡</span>{' '}
        ~{sp.travelTime} min from <b style={{ color: readableColor(sp.member.color) }}>{sp.member.name.split(' ')[0]}</b>{' '}
        &amp; both free <b>{fmtWin(sp.window.s, sp.window.e)}</b> today
      </div>
      <button
        onClick={() => window.location.href = `/plans/new?date=${todayStr}&hour=${sp.window.s}&end=${sp.window.e}&with=${sp.member.id}`}
        style={{
          padding: '6px 10px', border: 'none', borderRadius: 14,
          background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800,
          cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
        Propose
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: 'var(--text2)',
          fontSize: 13, cursor: 'pointer', padding: '0 2px', flexShrink: 0,
        }}
      >✕</button>
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
  const [selectedWinIdx, setSelectedWinIdx] = useState(0)
  const [selectedSpot, setSelectedSpot] = useState<{ name: string; lat: number; lng: number } | null>(null)
  // Spot search in day view
  const [spotQuery, setSpotQuery] = useState('')
  const [spotSearchResults, setSpotSearchResults] = useState<{ name: string; area: string; placeId: string; lat: number; lng: number }[]>([])
  const [spotSearching, setSpotSearching] = useState(false)
  const spotSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showWhosFree, setShowWhosFree] = useState(false)
  const [whosFreeRange, setWhosFreeRange] = useState(7)
  const [pacts, setPacts] = useState<PactEntry[]>([])
  const [longPressPactId, setLongPressPactId] = useState<string | null>(null)
  const pactLongPressTimer = useRef<NodeJS.Timeout | null>(null)
  // Track which members have connected their calendar
  const [connectedUserIds, setConnectedUserIds] = useState<Set<string>>(new Set())
  // Hour overrides — user can mark their own calendar-busy hours as free (client-side only)
  const [hourOverrides, setHourOverrides] = useState<Set<string>>(new Set())

  // Landscape detection
  const [isLandscape, setIsLandscape] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px)')
    setIsLandscape(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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

  // Geocode current user's home area (once, if home_lat is null)
  useEffect(() => {
    if (user.home_area && !(user as any).home_lat) {
      fetch('/api/geocode', { method: 'POST' }).catch(() => {})
    }
  }, [user.home_area, (user as any).home_lat])

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
        supabase.from('busy_blocks').select('user_id, date, start_hour, end_hour, location').in('user_id', memberIds),
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

  // Check if a block is originally busy (ignoring overrides) — for visual display
  const isRawBusy = useCallback((uid: string, date: string, hour: number) => {
    return busyBlocks.some(b =>
      b.user_id === uid && b.date === date && b.start_hour <= hour && b.end_hour > hour
    )
  }, [busyBlocks])

  // Helpers — past hours today count as busy for everyone; respects overrides for current user
  const isBusy = useCallback((uid: string, date: string, hour: number) => {
    if (date === todayStr && hour < nowHour) return true
    // If user overrode this hour, treat as free
    if (uid === user.id && hourOverrides.has(`${date}-${hour}`)) return false
    return busyBlocks.some(b =>
      b.user_id === uid && b.date === date && b.start_hour <= hour && b.end_hour > hour
    )
  }, [busyBlocks, todayStr, nowHour, hourOverrides, user.id])

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

  // Persist dismissed sparks in localStorage by date — resets daily
  // Key format: "memberId:windowStart:nearBucket" — so a new window or
  // significantly closer distance triggers a fresh spark
  const [dismissedSparks, setDismissedSparks] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('pact_sparks_dismissed')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.date === todayStr) {
          return new Set(parsed.keys as string[])
        }
      }
    } catch {}
    return new Set()
  })
  const [sparkRefreshKey, setSparkRefreshKey] = useState(0)
  const [sparkScanMode, setSparkScanMode] = useState(false)

  // Save dismissals to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('pact_sparks_dismissed', JSON.stringify({
      date: todayStr,
      keys: Array.from(dismissedSparks),
    }))
  }, [dismissedSparks, todayStr])

  // Spark dismissal key: encodes the situation, not just the person
  // - memberId: who
  // - windowStart: when (new free window = new spark)
  // - nearBucket: how close (5-min buckets — getting much closer = new spark)
  function sparkKey(memberId: string, windowStart: number, travelMin: number): string {
    const nearBucket = Math.floor(travelMin / 5) // 0-4 = "very close", 5-9 = "close", 10-14 = "nearby"
    return `${memberId}:${windowStart}:${nearBucket}`
  }

  const SPARK_MAX_TRAVEL = 15
  const LIVE_LOC_STALENESS = 12 * 3600000

  const sparks = useMemo((): Spark[] => {
    if (!activeCircle) { setSparkStatus('no circle'); return [] }
    if (!connectedUserIds.has(user.id)) { setSparkStatus('your calendar is not connected'); return [] }

    const myLive = (user as any).live_lat && (user as any).live_lng && (user as any).live_updated_at &&
      (Date.now() - new Date((user as any).live_updated_at).getTime()) < LIVE_LOC_STALENESS
      ? { lat: (user as any).live_lat as number, lng: (user as any).live_lng as number } : null
    const rawMyCoords = { x: (user as any).home_x || 0, y: (user as any).home_y || 0 }
    const myCoords = sanitizeCoords(rawMyCoords.x, rawMyCoords.y, (user as any).home_area || '')
    const h = Math.max(DAY_START, Math.min(nowHour, 20))
    const result: Spark[] = []
    let debugSkips = { noCal: 0, noCoords: 0, tooFar: 0, noWindow: 0 }

    for (const m of circleMembers) {
      if (m.id === user.id) continue
      if (!connectedUserIds.has(m.id)) { debugSkips.noCal++; continue }

      const theirLive = m.live_lat && m.live_lng && m.live_updated_at &&
        (Date.now() - new Date(m.live_updated_at).getTime()) < LIVE_LOC_STALENESS
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
      if (t > SPARK_MAX_TRAVEL) { debugSkips.tooFar++; continue }

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

      // Check dismissal by situation — not by person
      const key = sparkKey(m.id, best.s, t)
      if (!sparkScanMode && dismissedSparks.has(key)) continue

      result.push({
        member: m,
        travelTime: t,
        window: { s: best.s, e: best.e },
        area: (m.home_area || '').replace(' (home)', ''),
      })
    }

    if (result.length === 0) {
      const reasons: string[] = []
      if (debugSkips.noCal > 0) reasons.push(`${debugSkips.noCal} haven't connected calendars`)
      if (debugSkips.tooFar > 0) reasons.push(`${debugSkips.tooFar} are >15 min away`)
      if (debugSkips.noWindow > 0) reasons.push(`${debugSkips.noWindow} have no shared free time today`)
      if (debugSkips.noCoords > 0) reasons.push(`${debugSkips.noCoords} missing location`)
      setSparkStatus(reasons.length > 0 ? reasons.join(', ') : 'no matches right now')
    } else {
      setSparkStatus('')
    }

    return result.sort((a, b) => a.travelTime - b.travelTime)
  }, [activeCircle, circleMembers, busyBlocks, dismissedSparks, todayStr, nowHour, user.id, connectedUserIds, sparkRefreshKey, sparkScanMode])

  function dismissSpark(memberId: string, windowStart: number, travelTime: number) {
    const key = sparkKey(memberId, windowStart, travelTime)
    setDismissedSparks(prev => new Set(prev).add(key))
    // Don't exit scan mode — only the dismissed spark should disappear
  }

  function refreshSparks() {
    setSparkScanMode(true)
    setSparkRefreshKey(k => k + 1)
  }

  // ================= Who's Free =================
  // Find next mutual free window between current user and a specific member
  function nextMutualWindow(memberId: string, rangeDays: number): { day: number; ds: string; s: number; e: number; now: boolean } | null {
    for (let d = 0; d < rangeDays; d++) {
      const dt = new Date()
      dt.setDate(dt.getDate() + d)
      const ds = toStr(dt)
      let s: number | null = null
      for (let h = (d === 0 ? nowHour : DAY_START); h <= DAY_END; h++) {
        const ok = h < DAY_END && !isBusy(user.id, ds, h) && !isBusy(memberId, ds, h)
        if (ok && s === null) s = h
        if (!ok && s !== null) {
          if (h - s >= 2) return { day: d, ds, s, e: h, now: d === 0 && s <= nowHour }
          s = null
        }
      }
    }
    return null
  }

  // Find next window where ALL active members are free
  function nextGroupWindow(rangeDays: number): { day: number; ds: string; s: number; e: number; now: boolean } | null {
    const members = circleMembers.filter(m => connectedUserIds.has(m.id))
    if (members.length < 2) return null
    for (let d = 0; d < rangeDays; d++) {
      const dt = new Date()
      dt.setDate(dt.getDate() + d)
      const ds = toStr(dt)
      let s: number | null = null
      for (let h = (d === 0 ? nowHour : DAY_START); h <= DAY_END; h++) {
        const ok = h < DAY_END && members.every(m => !isBusy(m.id, ds, h))
        if (ok && s === null) s = h
        if (!ok && s !== null) {
          if (h - s >= 2) return { day: d, ds, s, e: h, now: d === 0 && s <= nowHour }
          s = null
        }
      }
    }
    return null
  }

  function whosFreeLabel(w: { day: number; ds: string; s: number; e: number; now: boolean }): string {
    if (w.now) return `free now · until ${fmtHour(w.e)}`
    const when = w.day === 0 ? 'today ' : w.day === 1 ? 'tomorrow ' : new Date(w.ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) + ' '
    return `${when}${fmtHour(w.s)} – ${fmtHour(w.e)}`
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

    // Helper: look up GPS coords for an area name (multi-strategy fuzzy matching)
    function areaGps(area: string): { lat: number; lng: number } | null {
      if (!area) return null
      const direct = AREA_GPS[area]
      if (direct) return direct
      const lo = area.toLowerCase()
      // Strategy 1: area contains an AREA_GPS key prefix, or key contains area prefix
      const fuzzy1 = Object.keys(AREA_GPS).find(a =>
        lo.includes(a.split(',')[0].toLowerCase()) || a.toLowerCase().includes(lo.split(',')[0].toLowerCase())
      )
      if (fuzzy1) return AREA_GPS[fuzzy1]
      // Strategy 2: check if any city/district word from AREA_GPS keys appears in the area string
      // e.g. "The Grove by Rockwell, Tower D" → check "Rockwell" → might match nearby areas
      const areaWords = lo.split(/[\s,/]+/).filter(w => w.length > 3)
      const fuzzy2 = Object.keys(AREA_GPS).find(a => {
        const keyWords = a.toLowerCase().split(/[\s,/]+/)
        return areaWords.some(w => keyWords.some(kw => kw.includes(w) || w.includes(kw)))
      })
      if (fuzzy2) return AREA_GPS[fuzzy2]
      // Strategy 3: check common city names in the string
      const cityMap: Record<string, string> = {
        'pasig': 'Kapitolyo, Pasig', 'makati': 'Poblacion, Makati', 'taguig': 'BGC, Taguig',
        'manila': 'Ermita, Manila', 'quezon': 'Diliman, QC', 'mandaluyong': 'Mandaluyong',
        'san juan': 'San Juan', 'marikina': 'Marikina', 'parañaque': 'BF Homes, Parañaque',
        'paranaque': 'BF Homes, Parañaque', 'muntinlupa': 'Alabang, Muntinlupa',
        'alabang': 'Alabang, Muntinlupa', 'rockwell': 'Kapitolyo, Pasig',
        'grove': 'C5/Bagong Ilog, Pasig', 'eastwood': 'Eastwood, QC',
        'ortigas': 'Ortigas, Pasig', 'bgc': 'BGC, Taguig', 'uptown': 'Uptown, Taguig',
      }
      for (const [keyword, areaKey] of Object.entries(cityMap)) {
        if (lo.includes(keyword)) return AREA_GPS[areaKey] || null
      }
      return null // No match — caller should use fallback
    }

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

      // Live location data
      const liveArea = (m as any).live_area as string | null
      const liveUpdated = (m as any).live_updated_at as string | null
      const liveLat = (m as any).live_lat as number | null
      const liveLng = (m as any).live_lng as number | null
      const liveRecent = liveArea && liveUpdated && (Date.now() - new Date(liveUpdated).getTime()) < 7 * 24 * 60 * 60 * 1000

      // Home GPS — prefer DB-stored geocoded coords, then area matching, then live GPS fallback
      const dbHomeLat = (m as any).home_lat as number | null
      const dbHomeLng = (m as any).home_lng as number | null
      const homeGps = (dbHomeLat && dbHomeLng) ? { lat: dbHomeLat, lng: dbHomeLng }
        : (homeArea ? areaGps(homeArea) : null)
        || (liveLat && liveLng ? { lat: liveLat, lng: liveLng } : null)
        || { lat: 14.5995, lng: 120.9842 }

      // Find last busy block ending before or at the window start (within 3 hours)
      const priorBlocks = busyBlocks
        .filter(b => b.user_id === m.id && b.date === sheetDate && b.end_hour <= winStart && b.end_hour >= winStart - 3)
        .sort((a, b) => b.end_hour - a.end_hour)
      const prior = priorBlocks[0]
      const priorLocation = (prior as any)?.location as string | null

      // Origin priority:
      // 1. Today: always use live GPS
      // 2. Prior busy block WITH location tag: use that event location
      // 3. No prior block: use live GPS (they're probably still where they are now)
      // 4. Prior block WITHOUT location: fall back to home area
      const name = m.name.split(' ')[0]

      // 1. Today — live GPS is most accurate
      if (isToday && liveRecent && liveLat && liveLng) {
        const label = prior
          ? `currently in ${liveArea} (busy till ${fmtHour(prior.end_hour)})`
          : `currently in ${liveArea}`
        return { name, color: m.color, x: homeX, y: homeY, lat: liveLat, lng: liveLng, area: liveArea || homeArea, label }
      }
      if (isToday && liveRecent && liveArea) {
        const gps = areaGps(liveArea) || homeGps
        const label = prior
          ? `currently in ${liveArea} (busy till ${fmtHour(prior.end_hour)})`
          : `currently in ${liveArea}`
        return { name, color: m.color, x: homeX, y: homeY, lat: gps.lat, lng: gps.lng, area: liveArea, label }
      }

      // 2. Prior block with tagged location — use it as origin
      if (prior && priorLocation) {
        const locGps = areaGps(priorLocation) || homeGps
        return { name, color: m.color, x: homeX, y: homeY, lat: locGps.lat, lng: locGps.lng, area: priorLocation, label: `coming from ${priorLocation} (busy till ${fmtHour(prior.end_hour)})` }
      }

      // 3. No prior block at all — use live GPS if recent (they're probably still around there)
      if (!prior && liveRecent && liveLat && liveLng) {
        return { name, color: m.color, x: homeX, y: homeY, lat: liveLat, lng: liveLng, area: liveArea || homeArea, label: `near ${liveArea || homeArea}` }
      }

      // 4. Prior block without location, or no live GPS — fall back to home
      const label = prior
        ? `coming from ${homeArea || 'unknown'} (busy till ${fmtHour(prior.end_hour)})`
        : `from home · ${homeArea || 'unknown'}`
      return { name, color: m.color, x: homeX, y: homeY, lat: homeGps.lat, lng: homeGps.lng, area: homeArea, label }
    }).filter(o => o.lat !== 0 || o.lng !== 0)
  }, [sheetDate, activeMembers, busyBlocks, selectedWinIdx, todayStr])

  // Helper: get GPS for a favorite spot (area name lookup)
  function favGps(f: FavSpot): { lat: number; lng: number } {
    // If stored coords are in grid range (0-12), look up area GPS
    if (f.area) {
      const direct = AREA_GPS[f.area]
      if (direct) return direct
      const fuzzy = Object.keys(AREA_GPS).find(a =>
        f.area.toLowerCase().includes(a.split(',')[0].toLowerCase()) || a.toLowerCase().includes(f.area.split(',')[0].toLowerCase())
      )
      if (fuzzy) return AREA_GPS[fuzzy]
    }
    // Fallback: use grid coords if they look like GPS already (>12)
    if (f.x > 12 || f.y > 12) return { lat: f.x, lng: f.y }
    // Convert grid to approximate GPS (very rough)
    return { lat: 14.42 + f.y * 0.03, lng: 120.95 + f.x * 0.025 }
  }

  // Compute travel times for favorites using GPS
  const favSpotsWithTravel = useMemo((): SpotWithTravel[] => {
    if (!sheetDate || memberOrigins.length < 2) return []
    return favSpots.filter(f => f.x || f.y || f.area).map(f => {
      const gps = favGps(f)
      return {
        name: f.name, area: f.area || '', lat: gps.lat, lng: gps.lng, emoji: f.emoji || '📍', isFav: true,
        travelTimes: memberOrigins.map(o => ({
          name: o.name, color: o.color,
          minutes: o.lat && o.lng ? travelMinGps({ lat: o.lat, lng: o.lng }, gps) : travelMin({ x: o.x, y: o.y }, { x: f.x, y: f.y }),
        })),
      }
    })
  }, [sheetDate, memberOrigins, favSpots])

  // Compute travel times for search results using GPS
  const searchSpotsWithTravel = useMemo((): SpotWithTravel[] => {
    if (memberOrigins.length < 2) return []
    return spotSearchResults.filter(r => r.lat && r.lng).map(r => ({
      name: r.name, area: r.area, lat: r.lat, lng: r.lng, emoji: '📍', isFav: false,
      travelTimes: memberOrigins.map(o => ({
        name: o.name, color: o.color,
        minutes: o.lat && o.lng ? travelMinGps({ lat: o.lat, lng: o.lng }, { lat: r.lat, lng: r.lng }) : 0,
      })),
    }))
  }, [spotSearchResults, memberOrigins])

  // Search spots using Google Places API
  function searchDaySpots(q: string) {
    setSpotQuery(q)
    if (!q.trim()) { setSpotSearchResults([]); return }
    if (spotSearchTimeout.current) clearTimeout(spotSearchTimeout.current)
    spotSearchTimeout.current = setTimeout(async () => {
      setSpotSearching(true)
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setSpotSearchResults((data.predictions || []).map((p: any) => ({
            name: p.main_text || p.description,
            area: p.secondary_text || '',
            placeId: p.place_id,
            lat: p.lat || 0,
            lng: p.lng || 0,
          })))
        }
      } catch { }
      setSpotSearching(false)
    }, 400)
  }

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
    const overrideKey = `${date}-${hour}`
    const rawBusy = isRawBusy(user.id, date, hour)
    const effectivelyBusy = isBusy(user.id, date, hour)

    if (effectivelyBusy && rawBusy) {
      // Block is busy — try deleting manual block first, otherwise add override
      const { count } = await supabase.from('busy_blocks')
        .delete({ count: 'exact' })
        .eq('user_id', user.id)
        .eq('date', date)
        .eq('source', 'manual')
        .lte('start_hour', hour)
        .gt('end_hour', hour)
      if (count && count > 0) {
        // Was a manual block — remove from local state
        setBusyBlocks(prev => prev.filter(b =>
          !(b.user_id === user.id && b.date === date && b.start_hour <= hour && b.end_hour > hour)
        ))
      } else {
        // Calendar block — add override to treat as free (green with red border)
        setHourOverrides(prev => { const n = new Set(prev); n.add(overrideKey); return n })
      }
    } else if (!effectivelyBusy && hourOverrides.has(overrideKey)) {
      // Currently overridden — remove override to go back to busy
      setHourOverrides(prev => { const n = new Set(prev); n.delete(overrideKey); return n })
    } else if (!effectivelyBusy) {
      // Free block — mark as manually busy
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
    <div style={{
      display: 'flex',
      flexDirection: isLandscape && sheetDate ? 'row' : 'column',
      flex: 1, minHeight: 0, position: 'relative',
    }}>
      <div
        ref={calPullRef}
        {...calTouchHandlers}
        style={{
          padding: '14px 16px 24px', overflowY: 'auto',
          flex: isLandscape && sheetDate ? '0 0 45%' : 1,
          borderRight: isLandscape && sheetDate ? '1px solid var(--border)' : 'none',
        }}
      >
        {(calPullY > 0 || calPullRefreshing) && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', padding: '6px 0',
            transform: `translateY(${calPullY > 0 ? calPullY - 30 : 0}px)`,
            transition: calPullY === 0 ? 'transform 0.2s' : 'none',
          }}>
            {calIndicator}
          </div>
        )}

        {/* Upcoming pacts — this week only */}
        {(() => {
          const now = new Date()
          const dayOfWeek = now.getDay() // 0=Sun
          const monday = new Date(now)
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
          const sunday = new Date(monday)
          sunday.setDate(monday.getDate() + 6)
          const sunStr = sunday.toISOString().slice(0, 10)
          const weekPacts = pacts.filter(p => p.date >= todayStr && p.date <= sunStr)
          return weekPacts.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              📌 This week
            </p>
            {weekPacts.slice(0, 3).map(p => {
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
            {weekPacts.length > 3 && (
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
        ) : null
        })()}

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

        {/* Sparks — compact 1-line, show 2 with scroll */}
        {sparks.length > 0 && (
          <div style={{ marginBottom: 14, maxHeight: sparks.length > 2 ? 120 : undefined, overflowY: sparks.length > 2 ? 'auto' : undefined, overflowX: 'hidden' }}>
            {sparks.map(sp => (
              <SparkLine key={sp.member.id} spark={sp} todayStr={todayStr} onDismiss={() => dismissSpark(sp.member.id, sp.window.s, sp.travelTime)} />
            ))}
          </div>
        )}

        {/* Who's free? button */}
        {circleMembers.length > 1 && (
          <button
            onClick={() => setShowWhosFree(true)}
            style={{
              width: '100%', marginBottom: 14, padding: '12px 14px', borderRadius: 14,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text)', fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            👀 Who{"'"}s free?
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text2)' }}>next 7 days at a glance</span>
          </button>
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

      {/* Day sheet — overlay (portrait) or side panel (landscape) */}
      {sheetDate && (
        <>
          {!isLandscape && (
            <div
              onClick={() => setSheetDate(null)}
              style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
                zIndex: 30,
              }}
            />
          )}
          <div style={isLandscape ? {
            flex: '1 1 55%', background: 'var(--surface2)',
            display: 'flex', flexDirection: 'column', minHeight: 0,
          } : {
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 31,
            background: 'var(--surface2)', borderRadius: '24px 24px 0 0',
            maxHeight: '86%', display: 'flex', flexDirection: 'column',
          }}>
            {!isLandscape && (
              <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '12px auto 10px', flexShrink: 0 }} />
            )}
            {isLandscape && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px 0', flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{fmtDate(sheetDate)}</span>
                <button onClick={() => setSheetDate(null)} style={{
                  background: 'none', border: 'none', color: 'var(--text2)', fontSize: 16, cursor: 'pointer',
                }}>✕</button>
              </div>
            )}
            <div style={{ overflowY: 'auto', padding: isLandscape ? '4px 18px 18px' : '0 18px 26px' }}>
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
                      fontSize: 10.5, fontWeight: 700, color: readableColor(m.color),
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
                      const isOverridden = isMe && hourOverrides.has(`${sheetDate}-${h}`)
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
                              : isOverridden ? 'rgba(139,176,126,0.25)'
                              : busy ? 'rgba(231,118,93,0.28)' : 'rgba(139,176,126,0.25)',
                            border: isPactHour && !isPast ? `1.5px solid ${isPactConfirmed ? '#FFB854' : '#5B7B8A'}`
                              : isOverridden && !isPast ? '2px solid rgba(231,118,93,0.6)'
                              : busy && !isPast ? '1px solid rgba(231,118,93,0.5)' : '1px solid rgba(139,176,126,0.35)',
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
                🟩 free · 🟥 busy · 🟩🔴 overridden · 🟦 pending · 🟧 confirmed · tap your row to toggle
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
                      onClick={() => { setSelectedWinIdx(i); setSelectedSpot(null) }}
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

                  {/* Search spots */}
                  <input
                    type="text"
                    placeholder="🔎 Search a spot (e.g. SM Megamall, Yabu)..."
                    value={spotQuery}
                    onChange={e => searchDaySpots(e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 10,
                      border: '1.5px solid var(--border)', background: 'var(--surface)',
                      color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                  />

                  {/* Search results */}
                  {spotQuery.trim() && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {spotSearching && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center', padding: 8 }}>Searching...</div>
                      )}
                      {!spotSearching && searchSpotsWithTravel.length === 0 && spotQuery.trim() && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center', padding: 8 }}>No matches</div>
                      )}
                      {!spotSearching && searchSpotsWithTravel.map((spot, i) => {
                        const isSel = selectedSpot?.name === spot.name
                        return (
                          <div
                            key={i}
                            onClick={() => setSelectedSpot(isSel ? null : { name: spot.name, lat: spot.lat, lng: spot.lng })}
                            style={{
                              padding: '9px 12px', borderRadius: 12,
                              background: isSel ? 'rgba(139,176,126,0.08)' : 'var(--surface)',
                              border: isSel ? '1.5px solid rgba(139,176,126,0.3)' : '1.5px solid var(--border)',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{spot.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{spot.area}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                              {spot.travelTimes.map((t, j) => (
                                <span key={j} style={{ fontSize: 10.5, fontWeight: 700 }}>
                                  <span style={{ color: t.color }}>{t.name}</span>{' '}
                                  <span style={{ color: 'var(--text2)' }}>~{t.minutes} min</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Favorite spots */}
                  {favSpotsWithTravel.length > 0 && (
                    <div style={{ marginTop: spotQuery.trim() ? 10 : 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700, marginBottom: 6 }}>⭐ Your favorites</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {favSpotsWithTravel.map((spot, i) => {
                          const isSel = selectedSpot?.name === spot.name
                          return (
                            <div
                              key={i}
                              onClick={() => setSelectedSpot(isSel ? null : { name: spot.name, lat: spot.lat, lng: spot.lng })}
                              style={{
                                padding: '9px 12px', borderRadius: 12,
                                background: isSel ? 'rgba(139,176,126,0.08)' : 'var(--surface)',
                                border: isSel ? '1.5px solid rgba(139,176,126,0.3)' : '1.5px solid var(--border)',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ fontSize: 13, fontWeight: 700 }}>⭐ {spot.name}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                {spot.travelTimes.map((t, j) => (
                                  <span key={j} style={{ fontSize: 10.5, fontWeight: 700 }}>
                                    <span style={{ color: t.color }}>{t.name}</span>{' '}
                                    <span style={{ color: 'var(--text2)' }}>~{t.minutes} min</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add favorite spot link */}
                  <button
                    onClick={() => window.location.href = '/spots'}
                    style={{
                      marginTop: 8, width: '100%', padding: 9, borderRadius: 10,
                      border: '1px dashed var(--border)', background: 'none',
                      color: 'var(--text2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ⭐ + Add favorite spot
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
                  {selectedSpot ? ` · ${selectedSpot.name}` : ''}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Calendar selection modal is now in AppShell */}

      {/* Who's free? bottom sheet */}
      {showWhosFree && (() => {
        const otherMembers = circleMembers.filter(m => m.id !== user.id && connectedUserIds.has(m.id))
        const memberWindows = otherMembers.map(m => ({
          member: m,
          window: nextMutualWindow(m.id, whosFreeRange),
        })).sort((a, b) => {
          if (!a.window) return 1
          if (!b.window) return -1
          if (a.window.now !== b.window.now) return a.window.now ? -1 : 1
          return a.window.day - b.window.day || a.window.s - b.window.s
        })
        const groupWin = circleMembers.length > 2 ? nextGroupWindow(whosFreeRange) : null

        return (
          <>
            <div
              onClick={() => setShowWhosFree(false)}
              style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
                zIndex: 30,
              }}
            />
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 31,
              background: 'var(--surface2)', borderRadius: '24px 24px 0 0',
              maxHeight: '80%', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '12px auto 10px' }} />
              <div style={{ padding: '0 18px 20px', overflowY: 'auto' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>👀 Who{"'"}s free?</h3>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {[1, 3, 5, 7].map(r => (
                    <button
                      key={r}
                      onClick={() => setWhosFreeRange(r)}
                      style={{
                        padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                        border: r === whosFreeRange ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                        background: r === whosFreeRange ? 'rgba(139,176,126,0.15)' : 'var(--surface)',
                        color: r === whosFreeRange ? 'var(--green)' : 'var(--text2)',
                        cursor: 'pointer',
                      }}
                    >
                      {r === 1 ? 'Today' : `${r} days`}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
                  {/* Everyone row */}
                  {circleMembers.length > 2 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 0', borderBottom: '1px solid var(--border)',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {activeCircle?.emoji || '👥'}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Everyone ({circleMembers.length})</span>
                      {groupWin ? (
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: groupWin.now ? 'var(--green)' : 'var(--text2)',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}>
                          {groupWin.now && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />}
                          {whosFreeLabel(groupWin)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>no common window</span>
                      )}
                    </div>
                  )}

                  {/* Individual member rows */}
                  {memberWindows.map(({ member: m, window: w }) => (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 0', borderBottom: '1px solid var(--border)',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: m.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: txtOn(m.color), flexShrink: 0,
                      }}>
                        {m.name[0]}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name.split(' ')[0]}
                      </span>
                      {w ? (
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: w.now ? 'var(--green)' : 'var(--text2)',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}>
                          {w.now && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />}
                          {whosFreeLabel(w)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>nothing mutual</span>
                      )}
                      {w && (
                        <button
                          onClick={() => {
                            setShowWhosFree(false)
                            window.location.href = `/plans/new?date=${w.ds}&hour=${w.s}&end=${w.e}`
                          }}
                          style={{
                            border: '1px solid var(--border)', background: 'var(--surface3)',
                            color: 'var(--text)', fontSize: 11, fontWeight: 800,
                            padding: '6px 10px', borderRadius: 14, cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          💬
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
