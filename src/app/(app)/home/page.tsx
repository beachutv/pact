'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { daysUntil, fmtDate, fmtHour, bdaySoon, toStr, txtOn } from '@/lib/utils'

type Pact = {
  id: string
  date: string
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
      const { data } = await supabase
        .from('pacts')
        .select('*, members:pact_members(user_id)')
        .gte('date', toStr(new Date()))
        .order('date', { ascending: true })
        .limit(10)
      if (data) setPacts(data as Pact[])
      setLoading(false)
    }
    fetchPacts()
  }, [])

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

  // Upcoming birthdays
  const upcomingBirthdays = circleMembers
    .filter(m => m.birthday)
    .map(m => ({ ...m, daysAway: bdaySoon(m.birthday!, 30) }))
    .filter(m => m.daysAway >= 0)
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

  if (!activeCircle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', marginTop: 40 }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>👋</p>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Welcome to Pact!</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.5 }}>
          Create a circle for your friend group, or join one with an invite code.
        </p>
        <a href="/circles/new">
          <button className="btn-primary">Get started</button>
        </a>
      </div>
    )
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

      {/* Break mode banner */}
      {user.sparks_paused_until && new Date(user.sparks_paused_until) > new Date() && (
        <div style={{
          background: 'var(--amber-soft)', border: '1px solid rgba(255,184,84,0.35)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 6,
          fontSize: 12, fontWeight: 600, color: 'var(--amber)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            You are on a break
          </span>
          <button
            onClick={async () => {
              const supabase = createClient()
              await supabase.from('users').update({ sparks_paused_until: null }).eq('id', user.id)
              window.location.reload()
            }}
            style={{
              border: 'none', background: 'none', color: 'var(--amber)',
              fontWeight: 700, cursor: 'pointer', fontSize: 12, textDecoration: 'underline',
            }}
          >End break</button>
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
                  <p style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }} onClick={() => router.push('/plans')}>
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
                  <p style={{ fontSize: 12, color: 'var(--text2)' }} onClick={() => router.push('/plans')}>
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
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }} onClick={() => router.push('/plans')}>
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
              <p style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }} onClick={() => router.push('/plans')}>
                {p.occasion || fmtDate(p.date)}
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
              <p style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }} onClick={() => router.push('/plans')}>
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
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }} onClick={() => router.push('/plans')}>
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
