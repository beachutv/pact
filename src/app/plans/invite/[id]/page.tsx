'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour } from '@/lib/utils'

type PlanInfo = {
  id: string
  occasion: string | null
  date: string
  win_start: number
  win_end: number
  spot_name: string
  spot_area: string
  status: string
  circle_id: string
  created_by: string | null
  memberCount: number
  creatorName: string
}

export default function PlanInvitePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [alreadyIn, setAlreadyIn] = useState(false)

  useEffect(() => {
    async function load() {
      // Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) setUserId(session.user.id)

      // Load plan
      const { data: pact, error: pactErr } = await supabase
        .from('pacts')
        .select('id, occasion, date, win_start, win_end, spot_name, spot_area, status, circle_id, created_by')
        .eq('id', id)
        .single()

      if (pactErr || !pact) {
        setError('Plan not found or has been deleted.')
        setLoading(false)
        return
      }

      // Get member count
      const { count } = await supabase
        .from('pact_members')
        .select('*', { count: 'exact', head: true })
        .eq('pact_id', id)

      // Get creator name
      let creatorName = 'someone'
      if (pact.created_by) {
        const { data: creator } = await supabase
          .from('users')
          .select('name')
          .eq('id', pact.created_by)
          .single()
        if (creator) creatorName = creator.name?.split(' ')[0] || 'someone'
      }

      // Check if already a member
      if (session?.user) {
        const { data: existing } = await supabase
          .from('pact_members')
          .select('user_id')
          .eq('pact_id', id)
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (existing) setAlreadyIn(true)
      }

      setPlan({
        ...pact,
        memberCount: count || 0,
        creatorName,
      })
      setLoading(false)
    }
    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleJoin() {
    if (!userId) {
      // Redirect to login, then back here
      router.push(`/login?redirect=/plans/invite/${id}`)
      return
    }
    setJoining(true)
    // Join as pact member
    await supabase.from('pact_members').upsert(
      { pact_id: id, user_id: userId },
      { onConflict: 'pact_id,user_id' }
    )
    // Redirect to the plan in the app
    router.push(`/plans?pact=${id}`)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="spinner" />
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>😕</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{error}</p>
        <button onClick={() => router.push('/home')} className="btn-primary" style={{ marginTop: 12 }}>
          Go to Pact
        </button>
      </div>
    </div>
  )

  if (!plan) return null

  const isPast = plan.date < new Date().toISOString().slice(0, 10)

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 360, background: 'var(--surface2)',
        borderRadius: 20, padding: 24, textAlign: 'center',
      }}>
        {/* Logo */}
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 20, letterSpacing: '-0.5px' }}>
          Pact<span style={{ color: 'var(--accent)' }}>.</span>
        </h1>

        {/* Plan card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 16, padding: 20,
          border: '1px solid var(--border)', textAlign: 'left',
        }}>
          <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text2)', marginBottom: 8 }}>
            You&apos;re invited
          </p>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
            {plan.occasion || `Plan on ${fmtDate(plan.date)}`}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              📅 {fmtDate(plan.date)} · {fmtHour(plan.win_start)}–{fmtHour(plan.win_end)}
            </p>
            {plan.spot_name !== 'TBD' && (
              <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                📍 {plan.spot_name}{plan.spot_area ? ` — ${plan.spot_area}` : ''}
              </p>
            )}
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              👤 Proposed by {plan.creatorName} · {plan.memberCount} going
            </p>
          </div>

          <span style={{
            display: 'inline-block', marginTop: 12,
            fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
            textTransform: 'uppercase', letterSpacing: '.4px',
            background: plan.status === 'confirmed' ? 'var(--green-soft)' : 'var(--amber-soft)',
            color: plan.status === 'confirmed' ? 'var(--green)' : 'var(--amber)',
          }}>
            {plan.status === 'confirmed' ? 'locked in' : 'open'}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
          {alreadyIn ? (
            <button onClick={() => router.push(`/plans?pact=${id}`)} className="btn-primary">
              View plan
            </button>
          ) : isPast ? (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>This plan has already passed.</p>
          ) : (
            <button onClick={handleJoin} disabled={joining} className="btn-primary">
              {joining ? 'Joining...' : userId ? "I'm in" : 'Log in to join'}
            </button>
          )}
          {!userId && (
            <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              New to Pact? You&apos;ll create an account when you log in.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
