'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function JoinPage() {
  const { code } = useParams<{ code: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'login' | 'invalid' | 'already'>('loading')
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

      // Find circle by invite code
      const { data: circle } = await supabase
        .from('circles')
        .select('id, name, emoji')
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
        setTimeout(() => { window.location.href = '/calendar' }, 1500)
        return
      }

      await supabase.from('circle_members').insert({
        circle_id: circle.id,
        user_id: user.id,
        role: 'member',
      })

      setStatus('done')
      // Full page load to refresh circle context
      setTimeout(() => { window.location.href = '/calendar' }, 800)
    }

    joinCircle()
  }, [code])

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
        {status === 'invalid' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--red)', marginBottom: 12 }}>
              This invite link is no longer valid or the code doesn&apos;t exist.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              Ask the person who shared it for a new link, or join with a code from the app.
            </p>
            <a href="/calendar" style={{
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
