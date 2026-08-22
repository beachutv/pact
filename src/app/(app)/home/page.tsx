'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { daysUntil, fmtDate, fmtDateRange, fmtHour, bdaySoon, toStr, txtOn } from '@/lib/utils'

type Pact = {
  id: string
  date: string
  end_date: string | null
  win_start: number
  win_end: number
  spot_name: string
  spot_emoji: string
  spot_area: string
  occasion: string | null
  status: string
  circle_id: string
  created_by: string | null
  members: { user_id: string }[]
  notes: string | null
}

const PROMPTS = [
  "Wanna plan something?",
  "Who do you want to see?",
  "Free this weekend?",
  "Been a while — time to catch up?",
  "Missing anyone?",
  "Time to lock in a plan?",
  "What are you in the mood for?",
]

export default function HomePage() {
  const { user, activeCircle, circles, circleMembers } = useCircle()
  const router = useRouter()
  const supabase = createClient()
  const [pacts, setPacts] = useState<Pact[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  // Personal calendar month view
  const [myBusyDates, setMyBusyDates] = useState<Map<string, number>>(new Map())
  const [calViewMonth, setCalViewMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [calShowDetails, setCalShowDetails] = useState(false)
  const [myPactDates, setMyPactDates] = useState<Map<string, string[]>>(new Map())

  // Pull-down refresh
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const touchStartY = useRef(0)
  const mainRef = useRef<HTMLDivElement>(null)

  // Rotating prompt — changes each render
  const prompt = useMemo(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)], [])

  // Fetch pacts across ALL circles (not just active)
  useEffect(() => {
    async function fetchPacts() {
      setLoading(true)
      const { data, error } = await supabase
        .from('pacts')
        .select('*, members:pact_members(user_id)')
        .gte('date', toStr(new Date()))
        .order('date', { ascending: true })
        .limit(10)
      if (error) console.error('[Home] pacts query error:', error)
      if (data) setPacts(data as Pact[])
      setLoading(false)
    }
    fetchPacts()
  }, [])

  // Load personal busy blocks + pact dates for calendar view
  useEffect(() => {
    async function loadMyCalendar() {
      const start = toStr(new Date(calViewMonth.year, calViewMonth.month, 1))
      const end = toStr(new Date(calViewMonth.year, calViewMonth.month + 1, 0))
      const [busyRes, pactRes] = await Promise.all([
        supabase.from('busy_blocks').select('date, start_hour, end_hour, source').eq('user_id', user.id).gte('date', start).lte('date', end),
        supabase.from('pacts').select('id, date, end_date, occasion, win_start, win_end, members:pact_members(user_id)').gte('date', start).lte('date', end),
      ])
      const busyMap = new Map<string, number>()
      busyRes.data?.forEach((b: any) => busyMap.set(b.date, (busyMap.get(b.date) || 0) + 1))
      setMyBusyDates(busyMap)
      const pactMap = new Map<string, string[]>()
      pactRes.data?.filter((p: any) => p.members?.some((m: any) => m.user_id === user.id)).forEach((p: any) => {
        const label = p.occasion || `Plan ${fmtHour(p.win_start)}-${fmtHour(p.win_end)}`
        const existing = pactMap.get(p.date) || []
        existing.push(label)
        pactMap.set(p.date, existing)
      })
      setMyPactDates(pactMap)
    }
    loadMyCalendar()
  }, [calViewMonth.year, calViewMonth.month]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pull-down refresh
  async function doRefresh() {
    setRefreshing(true)
    const { data } = await supabase
      .from('pacts')
      .select('*, members:pact_members(user_id)')
      .gte('date', toStr(new Date()))
      .order('date', { ascending: true })
      .limit(10)
    if (data) setPacts(data as Pact[])
    setRefreshing(false)
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY
  }
  function onTouchMove(e: React.TouchEvent) {
    if (refreshing) return
    const scrollParent = mainRef.current?.closest('main')
    if (scrollParent && scrollParent.scrollTop > 0) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80))
  }
  function onTouchEnd() {
    if (pullY > 50) doRefresh()
    setPullY(0)
  }

  // Upcoming birthdays — filter out hidden birthdays + dismissed ones
  const [dismissedBirthdays, setDismissedBirthdays] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    const year = new Date().getFullYear()
    const stored = localStorage.getItem(`pact_bday_dismissed_${year}`)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  })

  function dismissBirthday(userId: string) {
    const year = new Date().getFullYear()
    setDismissedBirthdays(prev => {
      const next = new Set(prev)
      next.add(userId)
      localStorage.setItem(`pact_bday_dismissed_${year}`, JSON.stringify([...next]))
      return next
    })
  }

  const upcomingBirthdays = circleMembers
    .filter(m => m.birthday && m.birthday_visible !== false)
    .map(m => ({ ...m, daysAway: bdaySoon(m.birthday!, 30) }))
    .filter(m => m.daysAway >= 0 && !dismissedBirthdays.has(m.id))
    .sort((a, b) => a.daysAway - b.daysAway)

  // Split pacts: active (pending) vs upcoming (confirmed/locked)
  const activePacts = pacts.filter(p => p.status === 'pending')
  const upcomingPacts = pacts.filter(p => p.status === 'confirmed')

  // Find circle by ID
  function circleName(cid: string | null) {
    if (!cid) return null
    const c = circles.find(x => x.id === cid)
    return c ? `${c.emoji} ${c.name}` : null
  }

  return (
    <div
      ref={mainRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', paddingBottom: 80 }}
    >
      {/* Pull-down refresh */}
      {(pullY > 0 || refreshing) && (
        <div style={{
          textAlign: 'center', fontSize: 12, fontWeight: 700,
          color: 'var(--accent)', paddingBottom: 8,
          transform: `translateY(${pullY > 0 ? pullY - 30 : 0}px)`,
          transition: pullY === 0 ? 'transform 0.2s' : 'none',
        }}>
          {refreshing ? '⟳ Refreshing...' : pullY > 50 ? '↓ Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}

      {/* Introvert mode banner */}
      {user.sparks_paused_until && new Date(user.sparks_paused_until) > new Date() && (
        <div style={{
          background: 'rgba(118,172,179,0.1)', border: '1px solid rgba(118,172,179,0.25)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 6,
          fontSize: 12, fontWeight: 600, color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            Introvert mode is on
          </span>
          <button
            onClick={async () => {
              const supabase = createClient()
              await supabase.from('users').update({ sparks_paused_until: null }).eq('id', user.id)
              window.location.reload()
            }}
            style={{
              border: 'none', background: 'none', color: 'var(--accent)',
              fontWeight: 700, cursor: 'pointer', fontSize: 12, textDecoration: 'underline',
            }}
          >Turn off</button>
        </div>
      )}

      {/* Greeting + prompt */}
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>
          Hey {user.name.split(' ')[0]} 👋
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 2 }}>
          {prompt}
        </p>
      </div>

      {/* Plan something CTA */}
      <button
        onClick={() => router.push('/plans/new')}
        style={{
          width: '100%', padding: 18, border: 'none', borderRadius: 20, marginTop: 14,
          background: 'linear-gradient(135deg, var(--accent), var(--green))',
          color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        Plan something +
      </button>

      {/* Active plans (pending/in-progress) */}
      {activePacts.length > 0 && (
        <>
          <p style={{
            fontSize: 11, fontWeight: 800, color: 'var(--text2)',
            textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 24, marginBottom: 10,
          }}>
            Active plans ({activePacts.length})
          </p>
          {activePacts.map(p => {
            const du = daysUntil(p.date)
            const when = du === 0 ? 'Today' : du === 1 ? 'Tomorrow' : fmtDate(p.date)
            const circle = circles.find(x => x.id === p.circle_id)
            const isExpanded = expandedCard === p.id
            return (
              <div
                key={p.id}
                className="card"
                style={{ cursor: 'pointer', marginBottom: 8, padding: '12px 14px' }}
              >
                {/* Row 1: Title + circle tag + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                    {p.occasion || when}
                  </p>
                  {circle && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: 'var(--accent-soft)', color: 'var(--accent)',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {circle.emoji} {circle.name}
                    </span>
                  )}
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                    background: 'var(--amber-soft)', color: 'var(--amber)',
                    textTransform: 'uppercase', letterSpacing: '.3px', flexShrink: 0,
                  }}>pending</span>
                </div>
                {/* Row 2: Time + member count + expand toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                  <p style={{ fontSize: 12, color: 'var(--text2)' }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                    {when} · {fmtHour(p.win_start)}–{fmtHour(p.win_end)} · {(p.members || []).length} going
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedCard(isExpanded ? null : p.id) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      color: 'var(--text2)', display: 'flex', alignItems: 'center',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {isExpanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                    </svg>
                  </button>
                </div>
                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                    {p.spot_name && (
                      <p style={{ fontSize: 12, marginBottom: 4 }}>
                        {p.spot_emoji} {p.spot_name} · {p.spot_area}
                      </p>
                    )}
                    {p.notes && (
                      <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {p.notes}
                      </p>
                    )}
                    <div style={{ display: 'flex', marginTop: 6 }}>
                      {(p.members || []).slice(0, 6).map((m, i) => {
                        const mem = circleMembers.find(cm => cm.id === m.user_id)
                        if (!mem) return null
                        return (
                          <div key={m.user_id} className="avatar" style={{
                            background: mem.color, color: txtOn(mem.color),
                            width: 24, height: 24, fontSize: 10,
                            marginLeft: i > 0 ? -6 : 0,
                            border: '2px solid var(--surface)',
                            position: 'relative', overflow: 'hidden',
                          }}>
                            {mem.name[0]}
                            {mem.avatar_url && (
                              <img src={mem.avatar_url} alt="" style={{
                                position: 'absolute', inset: 0, width: '100%', height: '100%',
                                objectFit: 'cover', borderRadius: '50%',
                              }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* Coming up (confirmed pacts) */}
      <p style={{
        fontSize: 11, fontWeight: 800, color: 'var(--text2)',
        textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 24, marginBottom: 10,
      }}>
        Coming up
      </p>
      {upcomingPacts.length > 0 ? upcomingPacts.slice(0, 3).map(p => {
        const du = daysUntil(p.date)
        const countdown = du === 0 ? 'today!' : du === 1 ? 'tomorrow' : `in ${du} days`
        const circle = circles.find(x => x.id === p.circle_id)
        const isExpanded = expandedCard === p.id
        return (
          <div
            key={p.id}
            className="card"
            style={{ cursor: 'pointer', marginBottom: 8, padding: '12px 14px' }}
          >
            {/* Row 1: Title + circle tag + countdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                {p.occasion || fmtDateRange(p.date, p.end_date)}
              </p>
              {circle && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {circle.emoji} {circle.name}
                </span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                background: 'var(--green-soft)', color: 'var(--green)',
                flexShrink: 0,
              }}>{countdown}</span>
            </div>
            {/* Row 2: Time + expand */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <p style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                {fmtHour(p.win_start)}–{fmtHour(p.win_end)}
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedCard(isExpanded ? null : p.id) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                  color: 'var(--text2)', display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {isExpanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                </svg>
              </button>
            </div>
            {/* Expanded */}
            {isExpanded && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }} onClick={() => router.push(`/plans?pact=${p.id}`)}>
                {p.spot_name && (
                  <p style={{ fontSize: 12, marginBottom: 4 }}>
                    {p.spot_emoji} {p.spot_name} · {p.spot_area}
                  </p>
                )}
                {p.notes && (
                  <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {p.notes}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      }) : (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            Nothing locked in yet — tap the button above to start planning!
          </p>
        </div>
      )}

      {/* Personal calendar — your availability at a glance */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            📅 My calendar
          </p>
          <button
            onClick={() => setCalShowDetails(!calShowDetails)}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: calShowDetails ? 'var(--accent)' : 'var(--surface)',
              color: calShowDetails ? '#fff' : 'var(--text2)', cursor: 'pointer',
            }}
          >{calShowDetails ? 'Details' : 'Availability'}</button>
        </div>
        <div className="card" style={{ padding: 12 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onClick={() => setCalViewMonth(prev => { let m = prev.month - 1, y = prev.year; if (m < 0) { m = 11; y-- } return { year: y, month: m } })} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{new Date(calViewMonth.year, calViewMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setCalViewMonth(prev => { let m = prev.month + 1, y = prev.year; if (m > 11) { m = 0; y++ } return { year: y, month: m } })} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          </div>
          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {['S','M','T','W','T','F','S'].map(w => <div key={w} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text2)', padding: '2px 0' }}>{w}</div>)}
            {/* Blank days */}
            {Array.from({ length: new Date(calViewMonth.year, calViewMonth.month, 1).getDay() }).map((_, i) => <div key={'b'+i} />)}
            {/* Days */}
            {Array.from({ length: new Date(calViewMonth.year, calViewMonth.month + 1, 0).getDate() }).map((_, i) => {
              const d = i + 1
              const ds = toStr(new Date(calViewMonth.year, calViewMonth.month, d))
              const todayStr = toStr(new Date())
              const isPast = ds < todayStr
              const isToday = ds === todayStr
              const busyCount = myBusyDates.get(ds) || 0
              const pactList = myPactDates.get(ds) || []
              const hasPlan = pactList.length > 0
              const isBusy = busyCount > 0
              const isFree = !isBusy && !hasPlan && !isPast
              return (
                <div key={d} style={{
                  aspectRatio: '1', borderRadius: 8, position: 'relative',
                  background: isToday ? 'rgba(118,172,179,0.12)' : 'transparent',
                  opacity: isPast ? 0.35 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                  border: isToday ? '1.5px solid var(--accent)' : '1px solid transparent',
                }}>
                  <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? 'var(--accent)' : 'var(--text)' }}>{d}</span>
                  {!isPast && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      {isFree && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green)' }} />}
                      {isBusy && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--red)' }} />}
                      {hasPlan && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
            {[
              { color: 'var(--green)', label: 'Free' },
              { color: 'var(--red)', label: 'Busy' },
              { color: 'var(--accent)', label: 'Plans' },
            ].map(l => (
              <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text2)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: l.color }} /> {l.label}
              </span>
            ))}
          </div>
          {/* Details view — show what's on each day this month */}
          {calShowDetails && (() => {
            const days = Array.from({ length: new Date(calViewMonth.year, calViewMonth.month + 1, 0).getDate() }).map((_, i) => {
              const d = i + 1
              const ds = toStr(new Date(calViewMonth.year, calViewMonth.month, d))
              const pacts = myPactDates.get(ds) || []
              const busy = myBusyDates.get(ds) || 0
              if (pacts.length === 0 && busy === 0) return null
              if (ds < toStr(new Date())) return null
              return { d, ds, pacts, busy }
            }).filter(Boolean)
            if (days.length === 0) return <p style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center', marginTop: 8 }}>Nothing scheduled this month</p>
            return (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {days.map((day: any) => (
                  <div key={day.d} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', minWidth: 28 }}>
                      {new Date(calViewMonth.year, calViewMonth.month, day.d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                    </span>
                    <div style={{ flex: 1 }}>
                      {day.pacts.map((label: string, i: number) => (
                        <p key={i} style={{ fontSize: 11, fontWeight: 600 }}>📋 {label}</p>
                      ))}
                      {day.busy > 0 && <p style={{ fontSize: 11, color: 'var(--text2)' }}>🔴 {day.busy} busy block{day.busy > 1 ? 's' : ''}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Birthday reminders */}
      {upcomingBirthdays.length > 0 && (
        <>
          <p style={{
            fontSize: 11, fontWeight: 800, color: 'var(--text2)',
            textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 24, marginBottom: 10,
          }}>
            🎂 Birthdays coming up
          </p>
          <div className="card">
            {upcomingBirthdays.map(m => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
              }}>
                <div className="avatar" style={{
                  background: m.color, color: txtOn(m.color),
                  position: 'relative', overflow: 'hidden',
                }}>
                  {m.name[0]}
                  {m.avatar_url && (
                    <img src={m.avatar_url} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover', borderRadius: '50%',
                    }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {m.daysAway === 0 ? 'Today!' : m.daysAway === 1 ? 'Tomorrow' : `in ${m.daysAway} days`}
                  </p>
                </div>
                <button
                  onClick={() => dismissBirthday(m.id)}
                  title="Dismiss"
                  style={{
                    background: 'none', border: 'none', color: 'var(--text2)',
                    fontSize: 16, cursor: 'pointer', padding: '4px 8px', opacity: 0.5,
                  }}
                >✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
