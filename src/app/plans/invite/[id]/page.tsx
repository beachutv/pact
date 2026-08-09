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

type CircleInfo = {
  id: string
  name: string
  emoji: string
  invite_code: string
}

type FlowState = 'loading' | 'not-logged-in' | 'not-in-circle' | 'joining-circle' | 'redirecting' | 'error'

export default function PlanInvitePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [plan, setPlan] = useState<PlanInfo | null>(null)
  const [circle, setCircle] = useState<CircleInfo | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('loading')
  const [error, setError] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // 1) Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession()

      // 2) Load plan details via SECURITY DEFINER function (bypasses RLS)
      const { data: preview, error: previewErr } = await supabase
        .rpc('get_plan_invite_preview', { plan_id: id })

      if (previewErr || !preview || !preview.id) {
        setError('Plan not found or has been deleted.')
        setFlowState('error')
        return
      }

      setCircle({
        id: preview.circle_id,
        name: preview.circle_name,
        emoji: preview.circle_emoji,
        invite_code: preview.circle_invite_code,
      })

      setPlan({
        id: preview.id,
        occasion: preview.occasion,
        date: preview.date,
        win_start: preview.win_start,
        win_end: preview.win_end,
        spot_name: preview.spot_name,
        spot_area: preview.spot_area,
        status: preview.status,
        circle_id: preview.circle_id,
        created_by: preview.created_by,
        memberCount: preview.member_count || 0,
        creatorName: preview.creator_name || 'someone',
      })

      // Not logged in → show sign-up prompt
      if (!session?.user) {
        setFlowState('not-logged-in')
        return
      }

      setUserId(session.user.id)

      // 3) Check if user is in the circle
      const { data: membership } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', preview.circle_id)
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (membership) {
        // User is in the circle → join pact if needed, then redirect to the plan
        setFlowState('redirecting')

        // Ensure they're a pact member
        await supabase.from('pact_members').upsert(
          { pact_id: id, user_id: session.user.id },
          { onConflict: 'pact_id,user_id' }
        )

        router.replace(`/plans?pact=${id}`)
      } else {
        // Not in circle → show join circle prompt
        setFlowState('not-in-circle')
      }
    }
    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLogin() {
    // Redirect to login with next param pointing back here
    router.push(`/?next=/plans/invite/${id}`)
  }

  async function handleJoinCircle() {
    if (!userId || !plan || !circle) return
    setFlowState('joining-circle')

    // Join the circle
    await supabase.from('circle_members').insert({
      circle_id: plan.circle_id,
      user_id: userId,
      role: 'member',
    })

    // Join the pact
    await supabase.from('pact_members').upsert(
      { pact_id: id, user_id: userId },
      { onConflict: 'pact_id,user_id' }
    )

    // Redirect to the plan modal
    router.replace(`/plans?pact=${id}`)
  }

  // Shared plan card component
  function PlanCard() {
    if (!plan) return null
    return (
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
          {circle && (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              {circle.emoji} {circle.name}
            </p>
          )}
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
    )
  }

  if (flowState === 'loading' || flowState === 'redirecting') return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', gap: 12 }}>
      <div className="spinner" />
      {flowState === 'redirecting' && <p style={{ fontSize: 13, color: 'var(--text2)' }}>Opening plan...</p>}
    </div>
  )

  if (flowState === 'error') return (
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

  const isPast = plan ? plan.date < new Date().toISOString().slice(0, 10) : false

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

        <PlanCard />

        {/* Actions based on flow state */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {isPast ? (
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>This plan has already passed.</p>
          ) : flowState === 'not-logged-in' ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 4 }}>
                Sign in to join this plan and coordinate with the group.
              </p>
              <button onClick={handleLogin} className="btn-primary" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Continue with Google
              </button>
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                New to Pact? You&apos;ll create an account automatically.
              </p>
            </>
          ) : flowState === 'not-in-circle' ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 4 }}>
                This plan is in <b>{circle?.emoji} {circle?.name}</b>. Join the group to see availability, propose times, and coordinate.
              </p>
              <button onClick={handleJoinCircle} className="btn-primary">
                Join {circle?.emoji} {circle?.name} &amp; view plan
              </button>
            </>
          ) : flowState === 'joining-circle' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 }}>
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>Joining...</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
