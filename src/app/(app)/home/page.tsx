'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { daysUntil, fmtDate, fmtHour, fmtWin, bdaySoon, toStr, txtOn, travelMin, travelMinGps, getBrowserTimezone, currentHourInTz, DAY_START, DAY_END } from '@/lib/utils'
import { useLocationUpdate } from '@/lib/useLocationUpdate'

type Pact = {
  id: string
  date: string
  win_start: number
  win_end: number
  spot_name: string
  spot_emoji: string
  spot_area: string
  occasion: string | null
}

type BusyBlock = { user_id: string; date: string; start_hour: number; end_hour: number }

type Spark = {
  member: { id: string; name: string; color: string; home_area: string }
  travelTime: number
  window: { s: number; e: number }
  area: string
}

export default function HomePage() {
  const { user, activeCircle, circleMembers, setCircleMembers } = useCircle()
  const router = useRouter()
  const supabase = createClient()
  const [pacts, setPacts] = useState<Pact[]>([])
  const [sparks, setSparks] = useState<Spark[]>([])
  const [sparkChecked, setSparkChecked] = useState(false)
  const [sparkLoading, setSparkLoading] = useState(false)
  const [dismissedSparks, setDismissedSparks] = useState<Set<string>>(new Set())

  // Long-press quick settings for pacts
  const [longPressPactId, setLongPressPactId] = useState<string | null>(null)
  const pactLongPressTimer = useRef<NodeJS.Timeout | null>(null)

  function onPactTouchStart(pactId: string) {
    pactLongPressTimer.current = setTimeout(() => {
      setLongPressPactId(pactId)
    }, 500)
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

  // Pull-down refresh
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const touchStartY = useRef(0)
  const mainRef = useRef<HTMLDivElement>(null)

  const tz = useMemo(() => getBrowserTimezone(), [])
  const todayStr = useMemo(() => toStr(new Date()), [])

  // Update own live location on home page load
  useLocationUpdate(user.id, 'home')

  // Re-fetch circle members to get everyone's latest live location
  useEffect(() => {
    if (!activeCircle) return
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id, users(*)')
        .eq('circle_id', activeCircle.id)
      if (data) {
        const members = data.map((d: any) => d.users).filter(Boolean) as UserProfile[]
        setCircleMembers(members)
      }
    }, 500) // Brief delay to let own location update land first
    return () => clearTimeout(timer)
  }, [activeCircle?.id])

  useEffect(() => {
    if (!activeCircle) return
    async function fetchPacts() {
      const { data } = await supabase
        .from('pacts')
        .select('*')
        .eq('circle_id', activeCircle!.id)
        .gte('date', toStr(new Date()))
        .order('date', { ascending: true })
        .limit(3)
      if (data) setPacts(data)
    }
    fetchPacts()
  }, [activeCircle?.id])

  async function checkSparks() {
    if (!activeCircle) return
    setSparkLoading(true)

    const memberIds = circleMembers.map(m => m.id)
    const { data: blocks } = await supabase
      .from('busy_blocks')
      .select('user_id, date, start_hour, end_hour')
      .in('user_id', memberIds)
      .eq('date', todayStr)

    const busyBlocks: BusyBlock[] = blocks || []
    const nowHour = currentHourInTz(tz)
    const h = Math.max(DAY_START, Math.min(nowHour, 20))

    function isBusy(uid: string, hour: number) {
      if (hour < nowHour) return true
      return busyBlocks.some(b =>
        b.user_id === uid && b.start_hour <= hour && b.end_hour > hour
      )
    }

    // Prefer live GPS coordinates (if recent) over static home coords
    const myLive = user.live_lat && user.live_lng && user.live_updated_at &&
      (Date.now() - new Date(user.live_updated_at).getTime()) < 4 * 3600000
      ? { lat: user.live_lat, lng: user.live_lng } : null
    const myCoords = { x: (user as any).home_x || 0, y: (user as any).home_y || 0 }
    const result: Spark[] = []

    for (const m of circleMembers) {
      if (m.id === user.id) continue

      // Use live GPS if both users have recent coordinates
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

      let ws: number | null = null
      let best: { s: number; e: number; len: number } | null = null
      for (let x = h; x <= DAY_END; x++) {
        const ok = x < DAY_END && !isBusy(user.id, x) && !isBusy(m.id, x)
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

    setSparks(result.sort((a, b) => a.travelTime - b.travelTime).slice(0, 3))
    setSparkChecked(true)
    setSparkLoading(false)
  }

  /** Format how fresh the live location is */
  function liveAgo(ts: string | null): string {
    if (!ts) return ''
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return ''
  }

  /** Get display location for a member: live if recent, otherwise home */
  function displayLocation(m: UserProfile): { area: string; isLive: boolean } {
    if (m.live_area && m.live_updated_at) {
      const mins = (Date.now() - new Date(m.live_updated_at).getTime()) / 60000
      if (mins < 240) { // Show live if updated within 4 hours
        return { area: m.live_area, isLive: true }
      }
    }
    return { area: m.home_area || '', isLive: false }
  }

  // Pull-down refresh handlers
  async function doRefresh() {
    setRefreshing(true)
    // Re-fetch pacts
    if (activeCircle) {
      const { data } = await supabase
        .from('pacts')
        .select('*')
        .eq('circle_id', activeCircle.id)
        .gte('date', toStr(new Date()))
        .order('date', { ascending: true })
        .limit(3)
      if (data) setPacts(data)
      // Re-fetch members
      const { data: md } = await supabase
        .from('circle_members')
        .select('user_id, users(*)')
        .eq('circle_id', activeCircle.id)
      if (md) {
        const members = md.map((d: any) => d.users).filter(Boolean) as UserProfile[]
        setCircleMembers(members)
      }
    }
    setSparkChecked(false)
    setSparks([])
    setDismissedSparks(new Set())
    setRefreshing(false)
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    if (refreshing) return
    // Check the parent <main> scroll container, not this inner div
    const scrollParent = mainRef.current?.closest('main')
    if (scrollParent && scrollParent.scrollTop > 0) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80))
  }

  function onTouchEnd() {
    if (pullY > 50) doRefresh()
    setPullY(0)
  }

  const upcomingBirthdays = circleMembers
    .filter(m => m.birthday)
    .map(m => ({ ...m, daysAway: bdaySoon(m.birthday!, 30) }))
    .filter(m => m.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway)

  if (!activeCircle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', marginTop: 40 }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>👋</p>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Welcome to Pact!</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 20 }}>
          Create a circle for your friend group, or join one with an invite code.
        </p>
        <a href="/circles/new">
          <button className="btn-primary">Get started</button>
        </a>
      </div>
    )
  }

  const visibleSparks = sparks.filter(s => !dismissedSparks.has(s.member.id))

  return (
    <div
      ref={mainRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', paddingBottom: 80 }}
    >
      {/* Pull-down refresh indicator */}
      {(pullY > 0 || refreshing) && (
        <div style={{
          textAlign: 'center', fontSize: 12, fontWeight: 700,
          color: 'var(--accent)', paddingBottom: 4,
          transform: `translateY(${pullY > 0 ? pullY - 30 : 0}px)`,
          transition: pullY === 0 ? 'transform 0.2s' : 'none',
        }}>
          {refreshing ? '⟳ Refreshing...' : pullY > 50 ? '↓ Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}

      {/* Upcoming pacts */}
      {pacts.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            📌 Upcoming Pacts
          </p>
          {pacts.map(p => {
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
                style={{ cursor: 'pointer', position: 'relative' }}
              >
                <p style={{ fontSize: 16, fontWeight: 800 }}>
                  {p.occasion || fmtDate(p.date)}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                  {fmtHour(p.win_start)} – {fmtHour(p.win_end)} · {count}
                </p>
                <p style={{ fontSize: 13, marginTop: 4 }}>
                  {p.spot_emoji} {p.spot_name} · {p.spot_area}
                </p>

                {/* Long press quick settings popup */}
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
        </>
      )}

      {/* Spark results (cards) */}
      {sparkChecked && visibleSparks.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
          No sparks right now — nobody close enough and free at the same time.
        </div>
      )}

      {visibleSparks.map(sp => (
        <div key={sp.member.id} style={{
          background: 'linear-gradient(135deg, rgba(124,92,255,0.18), rgba(52,211,153,0.12))',
          border: '1px solid rgba(124,92,255,0.45)', borderRadius: 16,
          padding: '12px 14px', position: 'relative',
        }}>
          <button
            onClick={() => setDismissedSparks(prev => new Set(prev).add(sp.member.id))}
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
            Propose a plan with {sp.member.name.split(' ')[0]}
          </button>
        </div>
      ))}

      {/* Birthday reminders */}
      {upcomingBirthdays.length > 0 && (
        <div className="card">
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            🎂 Birthdays coming up
          </p>
          {upcomingBirthdays.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 0',
            }}>
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

      {/* Circle members — own profile first, with live location */}
      <div className="card">
        <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          {activeCircle.emoji} {activeCircle.name} · {circleMembers.length} members
        </p>
        {[...circleMembers].sort((a, b) => {
          if (a.id === user.id) return -1
          if (b.id === user.id) return 1
          return 0
        }).map(m => {
          const isMe = m.id === user.id
          const loc = displayLocation(m)
          const ago = liveAgo(m.live_updated_at)
          return (
            <div
              key={m.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ position: 'relative' }}>
                <div
                  className="avatar"
                  style={{
                    background: m.avatar_url ? `url(${m.avatar_url}) center/cover` : m.color,
                    color: txtOn(m.color), cursor: 'pointer',
                  }}
                  onClick={() => router.push(`/profile/${m.id}`)}
                >
                  {!m.avatar_url && m.name[0]}
                </div>
                {loc.isLive && (
                  <div style={{
                    position: 'absolute', bottom: -1, right: -1,
                    width: 10, height: 10, borderRadius: '50%',
                    background: 'var(--green)', border: '2px solid var(--bg)',
                  }} />
                )}
              </div>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => router.push(`/profile/${m.id}`)}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>
                  {m.name} {isMe ? '(you)' : ''}
                </p>
                <p style={{ fontSize: 12, color: loc.isLive ? 'var(--green)' : 'var(--text2)' }}>
                  {loc.isLive && '📍 '}
                  {loc.area || (isMe ? 'Tap to edit profile' : 'View profile →')}
                  {loc.isLive && ago && (
                    <span style={{ color: 'var(--text2)', fontWeight: 400 }}> · {ago}</span>
                  )}
                </p>
              </div>
              {!isMe && (
                <button
                  onClick={(e) => { e.stopPropagation(); router.push('/chat') }}
                  style={{
                    background: 'var(--surface2)', border: 'none', borderRadius: 10,
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, cursor: 'pointer', flexShrink: 0,
                  }}
                  title={`Message ${m.name.split(' ')[0]}`}
                >
                  💬
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Floating Spark button */}
      <button
        onClick={checkSparks}
        disabled={sparkLoading}
        style={{
          position: 'fixed', bottom: 80, right: 20, zIndex: 20,
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c5cff, #34d399)',
          border: 'none', boxShadow: '0 4px 16px rgba(124,92,255,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, cursor: 'pointer',
        }}
      >
        {sparkLoading ? '⟳' : '⚡'}
      </button>
    </div>
  )
}
