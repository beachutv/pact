'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCircle } from '@/components/AppShell'
import { txtOn } from '@/lib/utils'

type FriendUser = {
  id: string
  name: string
  username: string | null
  color: string
  avatar_url: string | null
  home_area: string
}

type Friendship = {
  id: string
  requester_id: string
  addressee_id: string
  status: string
  created_at: string
}

type FriendWithProfile = Friendship & { profile: FriendUser }

export default function FriendsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { user, circleFilter, circles } = useCircle()

  const [tab, setTab] = useState<'friends' | 'requests' | 'search'>('friends')
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [incoming, setIncoming] = useState<FriendWithProfile[]>([])
  const [outgoing, setOutgoing] = useState<FriendWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  // Search state
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FriendUser[]>([])
  const [searching, setSearching] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null) // friendship ID pending confirm
  const [circleMemberIds, setCircleMemberIds] = useState<Set<string> | null>(null)

  const loadFriendships = useCallback(async () => {
    setLoading(true)
    const { data: friendships } = await supabase
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

    if (!friendships || friendships.length === 0) {
      setFriends([])
      setIncoming([])
      setOutgoing([])
      setLoading(false)
      return
    }

    // Collect all user IDs we need profiles for
    const userIds = new Set<string>()
    friendships.forEach(f => {
      userIds.add(f.requester_id === user.id ? f.addressee_id : f.requester_id)
    })

    const { data: profiles } = await supabase
      .from('users')
      .select('id, name, username, color, avatar_url, home_area')
      .in('id', [...userIds])

    const profileMap = new Map<string, FriendUser>()
    profiles?.forEach(p => profileMap.set(p.id, p as FriendUser))

    const withProfiles: FriendWithProfile[] = friendships.map(f => ({
      ...f,
      profile: profileMap.get(f.requester_id === user.id ? f.addressee_id : f.requester_id) || {
        id: '', name: 'Unknown', username: null, color: '#666', avatar_url: null, home_area: '',
      },
    }))

    setFriends(withProfiles.filter(f => f.status === 'accepted'))
    setIncoming(withProfiles.filter(f => f.status === 'pending' && f.addressee_id === user.id))
    setOutgoing(withProfiles.filter(f => f.status === 'pending' && f.requester_id === user.id))
    setLoading(false)
  }, [user.id])

  useEffect(() => { loadFriendships() }, [loadFriendships])

  // Load circle member IDs when filter is active
  useEffect(() => {
    if (!circleFilter) { setCircleMemberIds(null); return }
    async function loadCircleMembers() {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', circleFilter!)
      if (data) {
        setCircleMemberIds(new Set(data.map(d => d.user_id)))
      }
    }
    loadCircleMembers()
  }, [circleFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for friendship changes
  useEffect(() => {
    const channel = supabase
      .channel('friendships-changes')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'friendships',
      }, () => { loadFriendships() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [loadFriendships])

  async function searchUsers() {
    const q = query.trim().toLowerCase()
    if (q.length < 2) { setSearchResults([]); return }
    setSearching(true)

    // Search by username (exact prefix match) or name (fuzzy)
    const { data } = await supabase
      .from('users')
      .select('id, name, username, color, avatar_url, home_area')
      .or(`username.ilike.${q}%,name.ilike.%${q}%`)
      .neq('id', user.id)
      .limit(20)

    // Filter out existing friends and pending requests
    const existingIds = new Set([
      ...friends.map(f => f.profile.id),
      ...incoming.map(f => f.profile.id),
      ...outgoing.map(f => f.profile.id),
    ])

    setSearchResults((data || []).filter(u => !existingIds.has(u.id)) as FriendUser[])
    setSearching(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => { if (query.trim().length >= 2) searchUsers() }, 350)
    return () => clearTimeout(timer)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendRequest(targetId: string) {
    setActionLoading(targetId)
    const { error } = await supabase.from('friendships').insert({
      requester_id: user.id,
      addressee_id: targetId,
    })
    if (!error) {
      // Send notification
      await supabase.from('notifications').insert({
        user_id: targetId,
        type: 'friend_request',
        title: `${user.name} says you're friends!`,
        body: 'Tap to accept the friend request',
        link: '/friends',
      })
      setSearchResults(prev => prev.filter(u => u.id !== targetId))
      await loadFriendships()
    }
    setActionLoading(null)
  }

  async function acceptRequest(friendshipId: string, requesterId: string) {
    setActionLoading(friendshipId)
    await supabase.from('friendships').update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    }).eq('id', friendshipId)

    // Clear the friend request notification for the current user
    const requesterProfile = incoming.find(f => f.id === friendshipId)?.profile
    if (requesterProfile) {
      await supabase.from('notifications').delete()
        .eq('user_id', user.id)
        .eq('type', 'friend_request')
        .ilike('title', `%${requesterProfile.name}%`)
    }

    // Notify the requester
    await supabase.from('notifications').insert({
      user_id: requesterId,
      type: 'friend_request',
      title: `${user.name} accepted your friend request!`,
      body: 'You\'re now friends on Pact',
      link: '/friends',
    })
    await loadFriendships()
    setActionLoading(null)
  }

  async function removeFriendship(friendshipId: string) {
    if (confirmRemove !== friendshipId) {
      setConfirmRemove(friendshipId)
      return
    }
    setActionLoading(friendshipId)
    setConfirmRemove(null)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    // Also clear any friend_request notifications related to this friendship
    const friendship = [...friends, ...incoming, ...outgoing].find(f => f.id === friendshipId)
    if (friendship) {
      await supabase.from('notifications').delete()
        .eq('user_id', user.id)
        .eq('type', 'friend_request')
        .ilike('title', `%${friendship.profile.name}%`)
    }
    await loadFriendships()
    setActionLoading(null)
  }

  async function cancelRequest(friendshipId: string) {
    setActionLoading(friendshipId)
    await supabase.from('friendships').delete().eq('id', friendshipId)
    await loadFriendships()
    setActionLoading(null)
  }

  // Filter friends by circle if active
  const filteredFriends = circleMemberIds
    ? friends.filter(f => circleMemberIds.has(f.profile.id))
    : friends
  const filterCircle = circleFilter ? circles.find(c => c.id === circleFilter) : null

  const requestCount = incoming.length

  function Avatar({ u, size = 36 }: { u: FriendUser; size?: number }) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: u.color, color: txtOn(u.color),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 800, position: 'relative',
      }}>
        {u.avatar_url && (
          <img
            src={u.avatar_url}
            alt=""
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              width: '100%', height: '100%', objectFit: 'cover',
            }}
            onError={e => (e.currentTarget.style.display = 'none')}
          />
        )}
        {u.name[0]}
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 13, color: 'var(--text2)' }}>
        Add friends by their username — they&apos;ll get a notification to confirm.
      </p>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6 }}>
        {([
          { key: 'friends' as const, label: 'My friends', count: filteredFriends.length },
          { key: 'requests' as const, label: 'Requests', count: requestCount },
          { key: 'search' as const, label: '+ Add', count: 0 },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', border: 'none', position: 'relative',
              background: tab === t.key ? 'var(--accent)' : 'var(--surface2)',
              color: tab === t.key ? '#fff' : 'var(--text2)',
            }}
          >
            {t.label}
            {t.count > 0 && t.key === 'requests' && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 16, height: 16, borderRadius: 8,
                background: 'var(--red)', color: '#fff', fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px', fontWeight: 700,
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Friends list */}
      {tab === 'friends' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Circle filter label */}
          {filterCircle && (
            <p style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginBottom: -6 }}>
              Showing friends in {filterCircle.emoji} {filterCircle.name}
            </p>
          )}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <div className="spinner" />
            </div>
          ) : filteredFriends.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 16px',
              color: 'var(--text2)', fontSize: 13,
            }}>
              <p style={{ fontSize: 24, marginBottom: 8 }}>👥</p>
              <p>{filterCircle ? `No friends in ${filterCircle.name} yet` : 'No friends yet — tap + Add to search by username'}</p>
            </div>
          ) : (
            filteredFriends.map(f => (
              <div
                key={f.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 8px', borderRadius: 12,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <Avatar u={f.profile} />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => router.push(`/profile/${f.profile.id}`)}>
                  <p style={{ fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{f.profile.name}</p>
                  {f.profile.username && (
                    <p style={{ fontSize: 11, color: 'var(--text2)' }}>@{f.profile.username}</p>
                  )}
                </div>
                <button
                  onClick={() => removeFriendship(f.id)}
                  disabled={actionLoading === f.id}
                  style={{
                    padding: '5px 10px', borderRadius: 8, border: 'none',
                    background: confirmRemove === f.id ? 'var(--red)' : 'var(--surface2)',
                    color: confirmRemove === f.id ? '#fff' : 'var(--text2)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  {actionLoading === f.id ? '...' : confirmRemove === f.id ? 'Confirm?' : 'Remove'}
                </button>
              </div>
            ))
          )}

          {/* Sent requests */}
          {outgoing.length > 0 && (
            <>
              <p style={{
                fontSize: 11, fontWeight: 800, color: 'var(--text2)',
                textTransform: 'uppercase', letterSpacing: '.5px',
                marginTop: 16, marginBottom: 6,
              }}>Pending sent</p>
              {outgoing.map(f => (
                <div
                  key={f.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px', borderRadius: 12,
                    borderBottom: '1px solid var(--border)', opacity: 0.7,
                  }}
                >
                  <Avatar u={f.profile} size={32} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{f.profile.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--text2)' }}>Waiting for response</p>
                  </div>
                  <button
                    onClick={() => cancelRequest(f.id)}
                    disabled={actionLoading === f.id}
                    style={{
                      padding: '5px 10px', borderRadius: 8, border: 'none',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Incoming requests */}
      {tab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {incoming.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 16px',
              color: 'var(--text2)', fontSize: 13,
            }}>
              <p style={{ fontSize: 24, marginBottom: 8 }}>📭</p>
              <p>No pending friend requests</p>
            </div>
          ) : (
            incoming.map(f => (
              <div
                key={f.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 8px', borderRadius: 12,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  marginBottom: 6,
                }}
              >
                <Avatar u={f.profile} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{f.profile.name}</p>
                  {f.profile.username && (
                    <p style={{ fontSize: 11, color: 'var(--text2)' }}>@{f.profile.username}</p>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--text2)' }}>says you&apos;re friends</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => acceptRequest(f.id, f.requester_id)}
                    disabled={actionLoading === f.id}
                    style={{
                      padding: '6px 12px', borderRadius: 8, border: 'none',
                      background: 'var(--accent)', color: '#fff',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {actionLoading === f.id ? '...' : 'Accept'}
                  </button>
                  <button
                    onClick={() => removeFriendship(f.id)}
                    disabled={actionLoading === f.id}
                    style={{
                      padding: '6px 10px', borderRadius: 8, border: 'none',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Search / Add */}
      {tab === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, color: 'var(--text2)', fontWeight: 600, pointerEvents: 'none',
            }}>@</span>
            <input
              className="input"
              placeholder="Search by username or name"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              style={{ paddingLeft: 30 }}
            />
          </div>

          {searching && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
              <div className="spinner" />
            </div>
          )}

          {!searching && query.length >= 2 && searchResults.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 16 }}>
              No users found for &quot;{query}&quot;
            </p>
          )}

          {searchResults.map(u => (
            <div
              key={u.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 8px', borderRadius: 12,
                background: 'var(--surface)', border: '1px solid var(--border)',
              }}
            >
              <Avatar u={u} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</p>
                {u.username && (
                  <p style={{ fontSize: 11, color: 'var(--text2)' }}>@{u.username}</p>
                )}
              </div>
              <button
                onClick={() => sendRequest(u.id)}
                disabled={actionLoading === u.id}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: '#fff',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {actionLoading === u.id ? '...' : 'Add friend'}
              </button>
            </div>
          ))}

          {query.length < 2 && (
            <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: 16 }}>
              Type at least 2 characters to search
            </p>
          )}
        </div>
      )}
    </div>
  )
}
