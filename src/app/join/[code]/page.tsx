'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function JoinPage() {
  const { code } = useParams<{ code: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'login' | 'invalid' | 'already' | 'requested' | 'already_requested'>('loading')
  const [circleName, setCircleName] = useState('')
  const supabase = createClient()

  useEffect(() => {
    async function joinCircle() {
      // Check if user is authenticated (client-side — works in in-app browsers)
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // Not logged in — redirect to login with return URL
        setStatus('login')
        window.location.href = `/?next=/join/${code}`
        return
      }

      setStatus('joining')

      // Find circle by invite code — include join_mode
      const { data: circle } = await supabase
        .from('circles')
        .select('id, name, emoji, join_mode, visibility')
        .eq('invite_code', code)
        .single()

      if (!circle) {
        setStatus('invalid')
        return
      }

      setCircleName(`${circle.emoji || ''} ${circle.name}`)

      // Check if already a member
      const { data: existing } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', circle.id)
        .eq('user_id', user.id)
        .single()

      if (existing) {
        setStatus('already')
        setTimeout(() => { window.location.href = '/home' }, 1500)
        return
      }

      // If circle requires approval, submit a join request instead of auto-joining
      if (circle.join_mode === 'approval') {
        // Check for existing pending request
        const { data: existingReq } = await supabase
          .from('circle_join_requests')
          .select('id, status')
          .eq('circle_id', circle.id)
          .eq('user_id', user.id)
          .single()

        if (existingReq) {
          if (existingReq.status === 'pending') {
            setStatus('already_requested')
            return
          }
          // If previously rejected, allow re-request
        }

        // Submit join request
        const { error: reqError } = await supabase.from('circle_join_requests').insert({
          circle_id: circle.id,
          user_id: user.id,
          status: 'pending',
        })

        if (reqError) {
          // Table might not exist or RLS blocked — fall back to showing error
          setCircleName(`${circle.emoji || ''} ${circle.name}`)
          setStatus('invalid')
          return
        }

        // Notify circle admins
        const { data: admins } = await supabase
          .from('circle_members')
          .select('user_id')
          .eq('circle_id', circle.id)
          .eq('role', 'admin')
        if (admins) {
          const { data: { user: authUser } } = await supabase.auth.getUser()
          const requesterName = authUser?.user_metadata?.full_name || 'Someone'
          await Promise.all(admins.map(a =>
            supabase.from('notifications').insert({
              user_id: a.user_id,
              type: 'pact_change',
              title: `${requesterName} wants to join ${circle.name}`,
              body: 'Tap to review the request in circle settings',
              link: `/circles/${circle.id}/settings`,
            })
          ))
        }

        setStatus('requested')
        return
      }

      // Open join mode — join directly
      await supabase.from('circle_members').insert({
        circle_id: circle.id,
        user_id: user.id,
        role: 'member',
      })

      // Clean up any pending join request (user may have requested before the join mode changed or before getting the link)
      await supabase.from('circle_join_requests')
        .update({ status: 'approved', resolved_at: new Date().toISOString() })
        .eq('circle_id', circle.id)
        .eq('user_id', user.id)
        .eq('status', 'pending')

      // Notify existing circle members about the new member
      const { data: existingMembers } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', circle.id)
        .neq('user_id', user.id)
      if (existingMembers) {
        const { data: { user: authUser } } = await supabase.auth.getUser()
        const joinerName = authUser?.user_metadata?.full_name || 'Someone'
        await Promise.all(existingMembers.map(m =>
          supabase.from('notifications').insert({
            user_id: m.user_id,
            type: 'pact_change',
            title: `${joinerName} joined ${circle.name}!`,
            body: `${circle.emoji} Your circle has a new member`,
            link: '/home',
          })
        ))
      }

      setStatus('done')
      // Full page load to refresh circle context
      setTimeout(() => { window.location.href = '/home' }, 800)
    }

    joinCircle()
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div id="app-shell" style={{ justifyContent: 'center', padding: '0 24px' }}>
      <div style={{ maxWidth: 340, width: '100%', margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', marginBottom: 8 }}>
          Pact<span style={{ color: 'var(--accent)' }}>.</span>
        </h1>
        {status === 'loading' && (
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>Checking your account...</p>
        )}
        {status === 'joining' && (
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>
            Joining{circleName ? ` ${circleName}` : ''}...
          </p>
        )}
        {status === 'done' && (
          <p style={{ fontSize: 14, color: 'var(--green)' }}>
            Joined{circleName ? ` ${circleName}` : ''}! Redirecting...
          </p>
        )}
        {status === 'already' && (
          <p style={{ fontSize: 14, color: 'var(--accent)' }}>
            You&apos;re already in{circleName ? ` ${circleName}` : ' this circle'}! Redirecting...
          </p>
        )}
        {status === 'requested' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--accent)', marginBottom: 8 }}>
              Request sent to join{circleName ? ` ${circleName}` : ''}!
            </p>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              An admin will review your request. You&apos;ll get a notification when you&apos;re approved.
            </p>
            <a href="/home" style={{
              display: 'inline-block', padding: '10px 24px', borderRadius: 12,
              background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700,
              textDecoration: 'none',
            }}>
              Go to Pact
            </a>
          </div>
        )}
        {status === 'already_requested' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--amber)', marginBottom: 8 }}>
              You&apos;ve already requested to join{circleName ? ` ${circleName}` : ''}.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              Hang tight — an admin will review your request.
            </p>
            <a href="/home" style={{
              display: 'inline-block', padding: '10px 24px', borderRadius: 12,
              background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700,
              textDecoration: 'none',
            }}>
              Go to Pact
            </a>
          </div>
        )}
        {status === 'invalid' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--red)', marginBottom: 12 }}>
              This invite link is no longer valid or the code doesn&apos;t exist.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              Ask the person who shared it for a new link, or join with a code from the app.
            </p>
            <a href="/home" style={{
              display: 'inline-block', padding: '10px 24px', borderRadius: 12,
              background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700,
              textDecoration: 'none',
            }}>
              Go to Pact
            </a>
          </div>
        )}
        {status === 'login' && (
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>Redirecting to sign in...</p>
        )}
      </div>
    </div>
  )
}
