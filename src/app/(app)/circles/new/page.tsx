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

  const [mode, setMode] = useState<'pick' | 'create' | 'join' | 'browse' | 'add-friends'>('pick')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🍻')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [joinMode, setJoinMode] = useState<'invite' | 'auto' | 'approval'>('invite')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Browse public circles state
  const [publicCircles, setPublicCircles] = useState<any[]>([])
  const [browseQuery, setBrowseQuery] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)

  // Add friends state
  const [createdCircleId, setCreatedCircleId] = useState<string | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set())
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [addingFriends, setAddingFriends] = useState(false)

  // Pending join requests (user's own)
  const [pendingRequests, setPendingRequests] = useState<{ id: string; circle_name: string; circle_emoji: string; created_at: string }[]>([])

  useEffect(() => {
    async function loadPending() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('circle_join_requests')
        .select('id, created_at, status, circles(name, emoji)')
        .eq('user_id', user.id)
        .eq('status', 'pending')
      if (data) {
        setPendingRequests(data.map((r: any) => ({
          id: r.id,
          circle_name: r.circles?.name || 'Unknown',
          circle_emoji: r.circles?.emoji || '👥',
          created_at: r.created_at,
        })))
      }
    }
    loadPending()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      .insert({
        name: name.trim(),
        emoji: emoji || '🍻',
        created_by: user.id,
        visibility,
        join_mode: visibility === 'private' ? 'invite' : joinMode,
      })
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

  async function browsePublic() {
    setBrowseLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBrowseLoading(false); return }

    let query = supabase
      .from('circles')
      .select('id, name, emoji, join_mode, created_by, circle_members(count)')
      .eq('visibility', 'public')

    if (browseQuery.trim()) {
      query = query.ilike('name', `%${browseQuery.trim()}%`)
    }

    const { data } = await query.limit(20)

    // Filter out circles user is already in
    const { data: myCms } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', user.id)
    const myCircleIds = new Set((myCms || []).map(c => c.circle_id))

    // Also check for pending join requests
    const { data: pendingReqs } = await supabase
      .from('circle_join_requests')
      .select('circle_id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
    const pendingIds = new Set((pendingReqs || []).map(r => r.circle_id))

    setPublicCircles((data || []).map((c: any) => ({
      ...c,
      member_count: c.circle_members?.[0]?.count || 0,
      already: myCircleIds.has(c.id),
      pending: pendingIds.has(c.id),
    })))
    setBrowseLoading(false)
  }

  async function joinPublicCircle(circleId: string, joinModeVal: string) {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    if (joinModeVal === 'auto') {
      await supabase.from('circle_members').insert({
        circle_id: circleId,
        user_id: user.id,
        role: 'member',
      })
      window.location.href = '/calendar'
    } else if (joinModeVal === 'approval') {
      await supabase.from('circle_join_requests').insert({
        circle_id: circleId,
        user_id: user.id,
      })
      // Notify admins
      const { data: admins } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', circleId)
        .eq('role', 'admin')
      if (admins) {
        await Promise.all(admins.map(a =>
          supabase.from('notifications').insert({
            user_id: a.user_id,
            type: 'pact_change',
            title: `${user.user_metadata?.full_name || 'Someone'} wants to join your circle`,
            body: 'Tap to review the request',
            link: `/circles/${circleId}/settings`,
          })
        ))
      }
      setPublicCircles(prev => prev.map(c => c.id === circleId ? { ...c, pending: true } : c))
      setLoading(false)
    }
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
        <button className="btn-secondary" onClick={() => { setMode('browse'); browsePublic() }} style={{ width: '100%' }}>
          🔎 Browse public circles
        </button>

        {/* Pending join requests */}
        {pendingRequests.length > 0 && (
          <div style={{
            background: 'var(--surface)', border: '1.5px solid var(--amber)',
            borderRadius: 16, padding: '14px 16px', marginTop: 4,
          }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              Pending requests · {pendingRequests.length}
            </p>
            {pendingRequests.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 20 }}>{r.circle_emoji}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{r.circle_name}</p>
                  <p style={{ fontSize: 11, color: 'var(--text2)' }}>
                    Requested {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--amber)',
                  background: 'var(--amber-soft)', padding: '3px 8px', borderRadius: 10,
                }}>
                  Pending
                </span>
              </div>
            ))}
          </div>
        )}

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

        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
            Who can find this circle?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              { key: 'private' as const, label: '🔒 Private', desc: 'Invite only' },
              { key: 'public' as const, label: '🌐 Public', desc: 'Searchable' },
            ]).map(v => (
              <button
                key={v.key}
                onClick={() => {
                  setVisibility(v.key)
                  if (v.key === 'private') setJoinMode('invite')
                  else if (joinMode === 'invite') setJoinMode('auto')
                }}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 12,
                  background: visibility === v.key ? 'var(--accent-soft)' : 'var(--surface)',
                  border: visibility === v.key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v.label}</p>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{v.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {visibility === 'public' && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
              How do people join?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { key: 'auto' as const, label: 'Open', desc: 'Anyone can join instantly' },
                { key: 'approval' as const, label: 'Approval', desc: 'Admin must approve' },
              ]).map(v => (
                <button
                  key={v.key}
                  onClick={() => setJoinMode(v.key)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12,
                    background: joinMode === v.key ? 'var(--accent-soft)' : 'var(--surface)',
                    border: joinMode === v.key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v.label}</p>
                  <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{v.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

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

  // Browse public circles mode
  if (mode === 'browse') {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Browse public circles</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            className="input"
            placeholder="Search circles..."
            value={browseQuery}
            onChange={e => setBrowseQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') browsePublic() }}
            style={{ flex: 1, minWidth: 0, fontSize: 14 }}
            autoFocus
          />
          <button
            onClick={browsePublic}
            style={{
              flexShrink: 0, width: 44, borderRadius: 12, border: '1px solid var(--border)',
              background: 'var(--accent)', color: '#fff', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            🔍
          </button>
        </div>

        {browseLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : publicCircles.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 20 }}>
            No public circles found — try a different search or create your own!
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {publicCircles.map(c => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 12px', borderRadius: 14,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                }}
              >
                <span style={{
                  fontSize: 20, width: 40, height: 40, borderRadius: 10,
                  background: 'var(--surface2)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{c.emoji || '👥'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {c.member_count ? `${c.member_count} member${c.member_count === 1 ? '' : 's'} · ` : ''}
                    {c.join_mode === 'auto' ? 'Open — join instantly' : 'Requires approval'}
                  </p>
                </div>
                {c.already ? (
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>✓ Joined</span>
                ) : c.pending ? (
                  <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, flexShrink: 0 }}>⏳ Pending</span>
                ) : (
                  <button
                    onClick={() => joinPublicCircle(c.id, c.join_mode)}
                    disabled={loading}
                    style={{
                      padding: '8px 16px', borderRadius: 10, border: 'none',
                      background: 'var(--accent)', color: '#fff',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {c.join_mode === 'auto' ? 'Join' : 'Request'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

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
