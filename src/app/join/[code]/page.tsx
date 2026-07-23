'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function JoinPage() {
  const { code } = useParams<{ code: string }>()
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'login'>('loading')
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
        // Invalid code — just go to calendar
        window.location.href = '/calendar'
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

      if (!existing) {
        await supabase.from('circle_members').insert({
          circle_id: circle.id,
          user_id: user.id,
          role: 'member',
        })
      }

      setStatus('done')
      // Full page load to refresh circle context
      window.location.href = '/calendar'
    }

    joinCircle()
  }, [code])

  return (
    <div id="app-shell" style={{ justifyContent: 'center', padding: '0 24px' }}>
      <div style={{ maxWidth: 340, width: '100%', margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', marginBottom: 8 }}>
          <span style={{ color: 'var(--accent)' }}>P</span>act
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
        {status === 'login' && (
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>Redirecting to sign in...</p>
        )}
      </div>
    </div>
  )
}
