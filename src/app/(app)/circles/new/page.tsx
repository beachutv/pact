'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const QUICK_EMOJIS = ['🍻', '🍷', '☕', '🎮', '💜', '🔥', '✨', '👯', '📚', '✈️', '🏖️', '🎂']

export default function NewCirclePage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<'pick' | 'create' | 'join'>('pick')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🍻')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!name.trim()) return
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: circle, error: createError } = await supabase
      .from('circles')
      .insert({ name: name.trim(), emoji: emoji || '🍻', created_by: user.id })
      .select()
      .single()

    if (createError) {
      setError(createError.message)
      setLoading(false)
      return
    }

    await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'admin',
    })

    router.push('/home')
    router.refresh()
  }

  async function handleJoin() {
    if (!inviteCode.trim()) return
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: circle } = await supabase
      .from('circles')
      .select('id, name, emoji')
      .eq('invite_code', inviteCode.trim())
      .single()

    if (!circle) {
      setError('Invalid invite code. Check with whoever shared it.')
      setLoading(false)
      return
    }

    const { data: existing } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circle.id)
      .eq('user_id', user.id)
      .single()

    if (existing) {
      setError('You\'re already in this circle!')
      setLoading(false)
      return
    }

    await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'member',
    })

    router.push('/home')
    router.refresh()
  }

  if (mode === 'pick') {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Circles</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
          A circle is a friend group. Everything in Pact — availability, chat, plans — is scoped to a circle.
        </p>
        <button className="btn-primary" onClick={() => setMode('create')}>
          Create a new circle
        </button>
        <button className="btn-secondary" onClick={() => setMode('join')} style={{ width: '100%' }}>
          Join with invite code
        </button>
        <button
          className="btn-secondary"
          onClick={() => router.back()}
          style={{ width: '100%', marginTop: 8 }}
        >
          ← Back
        </button>
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Create a circle</h2>
        <input
          className="input"
          placeholder="Circle name (e.g. The Barkada)"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
            Pick an emoji
          </p>
          {/* Native emoji input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input
              type="text"
              value={emoji}
              onChange={e => setEmoji(e.target.value)}
              style={{
                width: 56, height: 56, fontSize: 32, textAlign: 'center',
                background: 'var(--surface)', border: '2px solid var(--accent)',
                borderRadius: 14, outline: 'none',
              }}
              placeholder="😀"
            />
            <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>
              Type or use your emoji keyboard
            </span>
          </div>
          {/* Quick picks */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                style={{
                  width: 38, height: 38, borderRadius: 10, fontSize: 19,
                  background: e === emoji ? 'var(--accent-soft)' : 'var(--surface)',
                  border: e === emoji ? '2px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}
        <button className="btn-primary" onClick={handleCreate} disabled={loading || !name.trim()}>
          {loading ? 'Creating...' : 'Create circle'}
        </button>
        <button className="btn-secondary" onClick={() => setMode('pick')} style={{ width: '100%' }}>
          ← Back
        </button>
      </div>
    )
  }

  // Join mode
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 800 }}>Join a circle</h2>
      <p style={{ fontSize: 13, color: 'var(--text2)' }}>
        Ask your friend for the invite code — it's in their circle settings.
      </p>
      <input
        className="input"
        placeholder="Paste invite code"
        value={inviteCode}
        onChange={e => setInviteCode(e.target.value)}
        autoFocus
      />
      {error && <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>}
      <button className="btn-primary" onClick={handleJoin} disabled={loading || !inviteCode.trim()}>
        {loading ? 'Joining...' : 'Join circle'}
      </button>
      <button className="btn-secondary" onClick={() => setMode('pick')} style={{ width: '100%' }}>
        ← Back
      </button>
    </div>
  )
}
