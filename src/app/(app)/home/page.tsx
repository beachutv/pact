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
        Plan something ✨
      </button>

      {/* Your circles */}
      <p style={{
        fontSize: 11, fontWeight: 800, color: 'var(--text2)',
        textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 24, marginBottom: 10,
      }}>
        Your circles
      </p>
      <div style={{
        display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4,
      }}>
        {circles.map(c => (
          <div
            key={c.id}
            className={`chip ${activeCircle?.id === c.id ? 'active' : ''}`}
            onClick={() => router.push('/circles/' + c.id + '/settings')}
            style={{ flexShrink: 0 }}
          >
            {c.emoji} {c.name}
          </div>
        ))}
        <div
          className="chip"
          onClick={() => router.push('/circles/new')}
          style={{ flexShrink: 0, borderStyle: 'dashed', color: 'var(--text2)' }}
        >
          ＋ New circle
        </div>
      </div>

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
            const cName = circleName(p.circle_id)
            return (
              <div
                key={p.id}
                className="card"
                onClick={() => router.push('/plans')}
                style={{ cursor: 'pointer', marginBottom: 8 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>
                    {p.occasion || when}
                  </p>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
                    background: 'var(--amber-soft)', color: 'var(--amber)',
                    textTransform: 'uppercase', letterSpacing: '.4px',
                  }}>pending</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>
                  {fmtHour(p.win_start)} – {fmtHour(p.win_end)}
                  {cName && <span> · {cName}</span>}
                </p>
                {p.spot_name && (
                  <p style={{ fontSize: 12.5, marginTop: 2 }}>
                    {p.spot_emoji} {p.spot_name} · {p.spot_area}
                  </p>
                )}
                <div style={{ display: 'flex', marginTop: 8 }}>
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
        const cName = circleName(p.circle_id)
        return (
          <div
            key={p.id}
            className="card"
            onClick={() => router.push('/plans')}
            style={{ cursor: 'pointer', marginBottom: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>
                {p.occasion || fmtDate(p.date)}
              </p>
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
                background: 'var(--green-soft)', color: 'var(--green)',
              }}>{countdown}</span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 700, marginTop: 4 }}>
              ⏰ {fmtHour(p.win_start)} – {fmtHour(p.win_end)}
            </p>
            {p.spot_name && (
              <p style={{ fontSize: 12.5, marginTop: 2 }}>
                {p.spot_emoji} {p.spot_name} · {p.spot_area}
              </p>
            )}
            {cName && (
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{cName}</p>
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
