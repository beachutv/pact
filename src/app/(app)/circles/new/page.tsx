'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { txtOn } from '@/lib/utils'

const QUICK_EMOJIS = ['🍻', '🍷', '☕', '🎮', '💜', '🔥', '✨', '👯', '📚', '✈️', '🏖️', '🎂']

type Friend = { id: string; name: string; color: string; avatar_url: string | null }

export default function NewCirclePage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<'pick' | 'create' | 'join' | 'add-friends'>('pick')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🍻')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Add friends state
  const [createdCircleId, setCreatedCircleId] = useState<string | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set())
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [addingFriends, setAddingFriends] = useState(false)

  // Load friends from other circles — returns the list directly
  async function loadFriends(circleId: string): Promise<Friend[]> {
    setFriendsLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setFriendsLoading(false); return [] }

    // Get all circles the user is in
    const { data: myCircles } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', user.id)

    if (!myCircles?.length) { setFriendsLoading(false); return [] }

    const circleIds = myCircles.map(c => c.circle_id).filter(cid => cid !== circleId)
    if (!circleIds.length) { setFriendsLoading(false); return [] }

    // Get all members of those circles (excluding self)
    const { data: mates } = await supabase
      .from('circle_members')
      .select('user_id, users(id, name, color, avatar_url)')
      .in('circle_id', circleIds)
      .neq('user_id', user.id)

    if (!mates?.length) { setFriendsLoading(false); return [] }

    // Get members already in new circle
    const { data: existing } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circleId)

    const existingIds = new Set(existing?.map(e => e.user_id) || [])

    // Deduplicate and exclude existing members
    const seen = new Set<string>()
    const friendList: Friend[] = []
    for (const m of mates) {
      const u = (m as any).users as Friend
      if (u && !seen.has(u.id) && !existingIds.has(u.id)) {
        seen.add(u.id)
        friendList.push(u)
      }
    }

    friendList.sort((a, b) => a.name.localeCompare(b.name))
    setFriends(friendList)
    setFriendsLoading(false)
    return friendList
  }

  function toggleFriend(id: string) {
    setSelectedFriends(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddFriends() {
    if (!createdCircleId || selectedFriends.size === 0) return
    setAddingFriends(true)

    // Use RPC to bypass RLS (can't insert rows for other users directly)
    const promises = Array.from(selectedFriends).map(userId =>
      supabase.rpc('add_circle_member', { p_circle_id: createdCircleId, p_user_id: userId })
    )
    await Promise.all(promises)
    window.location.href = '/calendar'
  }

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

    // Check if user has friends in other circles
    setCreatedCircleId(circle.id)
    setLoading(false)
    const foundFriends = await loadFriends(circle.id)
    if (foundFriends.length > 0) {
      setMode('add-friends')
    } else {
      window.location.href = '/calendar'
    }
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

    // Full page reload to refresh circle context (server component fetches circles)
    window.location.href = '/calendar'
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

  if (mode === 'add-friends') {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Add friends</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)' }}>
          Add people you know from your other circles.
        </p>

        {friendsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : friends.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 20 }}>
            No friends to add — share the invite link instead!
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {friends.map(f => {
              const selected = selectedFriends.has(f.id)
              return (
                <div
                  key={f.id}
                  onClick={() => toggleFriend(f.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                    background: selected ? 'var(--accent-soft)' : 'transparent',
                    border: selected ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <div className="avatar" style={{
                    background: f.color, color: txtOn(f.color), position: 'relative',
                  }}>
                    {f.avatar_url && (
                      <img
                        src={f.avatar_url}
                        alt=""
                        style={{
                          position: 'absolute', inset: 0, borderRadius: '50%',
                          width: '100%', height: '100%', objectFit: 'cover',
                        }}
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                    )}
                    {f.name[0]}
                  </div>
                  <p style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{f.name}</p>
                  <div style={{
                    width: 22, height: 22, borderRadius: 6,
                    border: selected ? '2px solid var(--accent)' : '2px solid var(--border)',
                    background: selected ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, color: '#fff', fontWeight: 700,
                  }}>
                    {selected && '✓'}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {selectedFriends.size > 0 && (
            <button
              className="btn-primary"
              onClick={handleAddFriends}
              disabled={addingFriends}
            >
              {addingFriends ? 'Adding...' : `Add ${selectedFriends.size} friend${selectedFriends.size > 1 ? 's' : ''}`}
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={() => { window.location.href = '/calendar' }}
            style={{ width: '100%' }}
          >
            {selectedFriends.size > 0 ? 'Skip for now' : 'Done'}
          </button>
        </div>
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
