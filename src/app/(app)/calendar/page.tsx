'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { toStr, fmtDate, fmtHour, fmtTiny, fmtWin, txtOn, travelMin, travelMinGps, getBrowserTimezone, currentHourInTz, AREAS, DAY_START, DAY_END } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

type BusyBlock = { user_id: string; date: string; start_hour: number; end_hour: number }
type GCal = { id: string; summary: string; primary: boolean; backgroundColor: string }
type Win = { s: number; e: number; count: number }
type DaySummary = { past?: boolean; allDay?: boolean; bestFull?: Win; bestPartial?: Win }
type Spark = {
  member: { id: string; name: string; color: string; home_area: string; home_x: number; home_y: number }
  travelTime: number
  window: { s: number; e: number }
  area: string
}
type PactEntry = { id: string; date: string; occasion: string | null; spot_name: string }

export default function CalendarPage() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()

  const [connected, setConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([])
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [sheetDate, setSheetDate] = useState<string | null>(null)
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [dismissedSparks, setDismissedSparks] = useState<Set<string>>(new Set())
  const [pacts, setPacts] = useState<PactEntry[]>([])

  // Calendar selection modal
  const [showCalModal, setShowCalModal] = useState(false)
  const [gcals, setGcals] = useState<GCal[]>([])
  const [selectedCals, setSelectedCals] = useState<string[]>([])

  // Auto-sync tracking
  const hasAutoSynced = useRef(false)

  const onCalRefresh = useCallback(async () => {
    await syncCalendar()
  }, [])
  const { containerRef: calPullRef, refreshing: calPullRefreshing, pullY: calPullY, indicatorText: calIndicator, touchHandlers: calTouchHandlers } = usePullToRefresh(onCalRefresh)

  const tz = useMemo(() => getBrowserTimezone(), [])
  const todayStr = useMemo(() => toStr(new Date()), [])

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
      const { data: blocks } = await supabase
        .from('busy_blocks')
        .select('user_id, date, start_hour, end_hour')
        .in('user_id', memberIds)
      if (blocks) setBusyBlocks(blocks)
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
        .select('id, date, occasion, spot_name')
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
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeCircle?.id])

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

  // Load Google calendars for selection modal
  async function loadCalendars() {
    const res = await fetch('/api/calendar/list')
    if (res.ok) {
      const data = await res.json()
      setGcals(data.calendars)
      setSelectedCals(data.selectedIds)
      setShowCalModal(true)
    }
  }

  async function saveCalendarSelection() {
    await fetch('/api/calendar/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds: selectedCals }),
    })
    setShowCalModal(false)
    syncCalendar()
  }

  async function disconnectCalendar() {
    if (!confirm('Disconnect Google Calendar? You can reconnect anytime.')) return
    await supabase.from('calendar_connections').delete().eq('user_id', user.id).eq('provider', 'google')
    await supabase.from('busy_blocks').delete().eq('user_id', user.id).eq('source', 'google')
    setConnected(false)
    setBusyBlocks(prev => prev.filter(b => b.user_id !== user.id))
  }

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

  function freeCountAt(date: string, hour: number) {
    return activeMembers.filter(m => !isBusy(m.id, date, hour)).length
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

  // Day summary for calendar cell indicators
  function daySummary(date: string): DaySummary {
    if (date < todayStr) return { past: true }
    const n = activeMembers.length
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

  // ================= Sparks =================
  const sparks = useMemo((): Spark[] => {
    if (!activeCircle || busyBlocks.length === 0) return []
    const myLive = (user as any).live_lat && (user as any).live_lng && (user as any).live_updated_at &&
      (Date.now() - new Date((user as any).live_updated_at).getTime()) < 4 * 3600000
      ? { lat: (user as any).live_lat as number, lng: (user as any).live_lng as number } : null
    const myCoords = { x: (user as any).home_x || 0, y: (user as any).home_y || 0 }
    const h = Math.max(DAY_START, Math.min(nowHour, 20))
    const result: Spark[] = []

    for (const m of circleMembers) {
      if (m.id === user.id || dismissedSparks.has(m.id)) continue

      const theirLive = m.live_lat && m.live_lng && m.live_updated_at &&
        (Date.now() - new Date(m.live_updated_at).getTime()) < 4 * 3600000
        ? { lat: m.live_lat, lng: m.live_lng } : null

      let t: number
      if (myLive && theirLive) {
        t = travelMinGps(myLive, theirLive)
      } else {
        const theirCoords = { x: m.home_x || 0, y: m.home_y || 0 }
        if (myCoords.x === 0 && myCoords.y === 0) continue
        if (theirCoords.x === 0 && theirCoords.y === 0) continue
        t = travelMin(myCoords, theirCoords)
      }
      if (t > 25) continue

      // Find shared free window today (min 2 hours)
      let ws: number | null = null
      let best: { s: number; e: number; len: number } | null = null
      for (let x = h; x <= DAY_END; x++) {
        const ok = x < DAY_END && !isBusy(user.id, todayStr, x) && !isBusy(m.id, todayStr, x)
        if (ok && ws === null) ws = x
        if (!ok && ws !== null) {
          if (x - ws >= 2 && (!best || x - ws > best.len)) best = { s: ws, e: x, len: x - ws }
          ws = null
        }
      }
      if (!best) continue
      result.push({
        member: m,
        travelTime: t,
        window: { s: best.s, e: best.e },
        area: (m.home_area || '').replace(' (home)', ''),
      })
    }
    return result.sort((a, b) => a.travelTime - b.travelTime).slice(0, 2)
  }, [activeCircle, circleMembers, busyBlocks, dismissedSparks, todayStr, nowHour, user.id])

  function dismissSpark(memberId: string) {
    setDismissedSparks(prev => new Set(prev).add(memberId))
  }

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
            <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 7, color: 'var(--green)' }}>★</span>
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
          {/* Pact indicator dots */}
          {datePacts.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 2,
              display: 'flex', gap: 2, justifyContent: 'center',
            }}>
              {datePacts.slice(0, 3).map((_, i) => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--accent)',
                }} />
              ))}
            </div>
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

        {/* Sparks */}
        {sparks.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {sparks.map(sp => (
              <div key={sp.member.id} style={{
                background: 'linear-gradient(135deg, rgba(124,92,255,0.18), rgba(52,211,153,0.12))',
                border: '1px solid rgba(124,92,255,0.45)', borderRadius: 16,
                padding: '12px 14px', marginBottom: 8, position: 'relative',
              }}>
                <button
                  onClick={() => dismissSpark(sp.member.id)}
                  style={{
                    position: 'absolute', top: 8, right: 11,
                    background: 'none', border: 'none', color: 'var(--text2)',
                    fontSize: 14, cursor: 'pointer', padding: '2px 4px',
                  }}
                >✕</button>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                  ⚡ Spark
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                  You're <b>~{sp.travelTime} min</b> from{' '}
                  <b style={{ color: sp.member.color }}>{sp.member.name}</b>{' '}
                  ({sp.area}) and you're both free{' '}
                  <b>{fmtWin(sp.window.s, sp.window.e)}</b> today.
                </div>
                <button
                  onClick={() => window.location.href = `/plans/new?date=${todayStr}&hour=${sp.window.s}&end=${sp.window.e}`}
                  style={{
                    marginTop: 9, padding: '8px 14px', border: 'none', borderRadius: 18,
                    background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  Propose a plan with {sp.member.name.split(' ')[0]} →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Calendar settings gear */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={loadCalendars} style={{
            background: 'none', border: 'none', fontSize: 16,
            color: 'var(--text2)', cursor: 'pointer', padding: 4,
          }} title="Calendar settings">
            ⚙️
          </button>
        </div>

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
            <i style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} /> ★ free all day
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
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} /> pact
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
                Checking {activeIds.size === circleMembers.length ? 'everyone' : `${activeMembers.length} members`} · busy blocks are red
              </div>

              {/* All free banner */}
              {daySummary(sheetDate).allDay && (
                <div style={{
                  marginTop: 10, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)',
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
                {activeMembers.map(m => (
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
                    {Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i).map(h => {
                      const busy = isBusy(m.id, sheetDate!, h)
                      const isMe = m.id === user.id
                      const isPast = sheetDate === todayStr && h < nowHour
                      return (
                        <div
                          key={h}
                          onClick={isMe && !isPast ? () => toggleManualHour(sheetDate!, h) : undefined}
                          title={isMe ? `${fmtHour(h)} — tap to toggle` : `${m.name.split(' ')[0]}: ${busy ? 'busy' : 'free'}`}
                          style={{
                            height: 17, borderRadius: 4,
                            background: isPast ? 'rgba(100,100,100,0.15)'
                              : busy ? 'rgba(248,113,113,0.16)' : 'rgba(52,211,153,0.14)',
                            border: busy && !isPast ? '1px solid rgba(248,113,113,0.35)' : 'none',
                            cursor: isMe && !isPast ? 'pointer' : 'default',
                            opacity: isPast ? 0.4 : 1,
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 5 }}>
                🟩 free · 🟥 busy · ✏️ tap your row to toggle hours
              </div>

              {/* Pacts on this day */}
              {sheetDate && (pactsByDate[sheetDate] || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text2)', marginBottom: 6 }}>
                    📌 Pacts on this day
                  </div>
                  {(pactsByDate[sheetDate] || []).map(p => (
                    <div
                      key={p.id}
                      onClick={() => window.location.href = '/plans'}
                      style={{
                        padding: '8px 12px', borderRadius: 12, marginBottom: 4,
                        background: 'var(--accent-soft)', border: '1px solid var(--accent)',
                        cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                      }}
                    >
                      {p.occasion || p.spot_name || 'Pact'}
                    </div>
                  ))}
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
                      onClick={() => window.location.href = `/plans/new?date=${sheetDate}&hour=${w.s}&end=${w.e}`}
                      style={{
                        padding: '8px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 700,
                        cursor: 'pointer', border: '1.5px solid var(--border)',
                        background: w.full ? 'rgba(52,211,153,0.12)' : 'var(--surface)',
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

              {/* Suggest button */}
              {sheetWindows.length > 0 && (
                <button
                  onClick={() => {
                    const w = sheetWindows[0]
                    window.location.href = `/plans/new?date=${sheetDate}&hour=${w.s}&end=${w.e}`
                  }}
                  style={{
                    marginTop: 16, width: '100%', padding: 14, border: 'none', borderRadius: 14,
                    background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  💬 Suggest {fmtDate(sheetDate!).split(',')[0]}, {fmtHour(sheetWindows[0].s)} – {fmtHour(sheetWindows[0].e)}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Calendar selection modal */}
      {showCalModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCalModal(false) }}
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface)', borderRadius: 20, padding: 20,
            width: '90%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>My calendars</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
              Pick which calendars Pact checks for busy times. We only read busy/free — never event details.
            </p>
            {gcals.map(cal => {
              const on = selectedCals.includes(cal.id)
              return (
                <div
                  key={cal.id}
                  onClick={() => {
                    setSelectedCals(prev =>
                      prev.includes(cal.id)
                        ? prev.filter(id => id !== cal.id)
                        : [...prev, cal.id]
                    )
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12, marginBottom: 6,
                    background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                    cursor: 'pointer', border: on ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                  }}
                >
                  <div style={{
                    width: 12, height: 12, borderRadius: 3,
                    background: cal.backgroundColor,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cal.summary}</div>
                    {cal.primary && <div style={{ fontSize: 10, color: 'var(--text2)' }}>Primary</div>}
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: 6,
                    border: on ? 'none' : '2px solid var(--border)',
                    background: on ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 800,
                  }}>
                    {on ? '✓' : ''}
                  </div>
                </div>
              )
            })}
            <button
              onClick={saveCalendarSelection}
              disabled={selectedCals.length === 0}
              style={{
                marginTop: 12, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                background: selectedCals.length > 0 ? 'var(--accent)' : 'var(--surface3)',
                color: selectedCals.length > 0 ? '#fff' : 'var(--text2)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Save & sync
            </button>
            <button
              onClick={() => { setShowCalModal(false); disconnectCalendar() }}
              style={{
                marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
                background: 'transparent', color: 'var(--red)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Disconnect Google Calendar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
