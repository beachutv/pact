'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { txtOn } from '@/lib/utils'

type Friend = { id: string; name: string; color: string; avatar_url: string | null }

export default function CircleSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { user, circles, setActiveCircle } = useCircle()

  const [circle, setCircle] = useState<any>(null)
  const [members, setMembers] = useState<(UserProfile & { role: string })[]>([])
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Editing state
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingEmoji, setEditingEmoji] = useState(false)
  const [newEmoji, setNewEmoji] = useState('')
  const [saving, setSaving] = useState(false)

  // Invite code editing
  const [editingCode, setEditingCode] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [savingCode, setSavingCode] = useState(false)

  // Member action state
  const [actionMember, setActionMember] = useState<string | null>(null)

  // Add friends state
  const [showAddFriends, setShowAddFriends] = useState(false)
  const [friends, setFriends] = useState<Friend[]>([])
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set())
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [addingFriends, setAddingFriends] = useState(false)

  // Join requests state
  const [joinRequests, setJoinRequests] = useState<any[]>([])
  const [joiningAction, setJoiningAction] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: c } = await supabase
        .from('circles')
        .select('*')
        .eq('id', id)
        .single()
      if (c) {
        setCircle(c)
        setNewName(c.name)
        setNewEmoji(c.emoji)
      }

      const { data: cms } = await supabase
        .from('circle_members')
        .select('user_id, role, users(*)')
        .eq('circle_id', id)

      if (cms) {
        setMembers(cms.map(cm => ({
          ...(cm as any).users,
          role: cm.role,
        })))
      }

      // Load pending join requests
      const { data: reqs } = await supabase
        .from('circle_join_requests')
        .select('id, user_id, status, created_at, users(id, name, color, avatar_url)')
        .eq('circle_id', id)
        .eq('status', 'pending')
      if (reqs) setJoinRequests(reqs)

      setLoading(false)
    }
    load()
  }, [id])

  const isAdmin = members.find(m => m.id === user.id)?.role === 'admin'

  async function loadFriends() {
    setFriendsLoading(true)
    setShowAddFriends(true)

    // Get all circles the user is in
    const { data: myCircles } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', user.id)

    if (!myCircles?.length) { setFriendsLoading(false); return }

    const circleIds = myCircles.map(c => c.circle_id).filter(cid => cid !== id)
    if (!circleIds.length) { setFriendsLoading(false); return }

    // Get all members of those circles (excluding self)
    const { data: mates } = await supabase
      .from('circle_members')
      .select('user_id, users(id, name, color, avatar_url)')
      .in('circle_id', circleIds)
      .neq('user_id', user.id)

    if (!mates?.length) { setFriendsLoading(false); return }

    // Exclude people already in this circle
    const memberIds = new Set(members.map(m => m.id))

    const seen = new Set<string>()
    const friendList: Friend[] = []
    for (const m of mates) {
      const u = (m as any).users as Friend
      if (u && !seen.has(u.id) && !memberIds.has(u.id)) {
        seen.add(u.id)
        friendList.push(u)
      }
    }

    friendList.sort((a, b) => a.name.localeCompare(b.name))
    setFriends(friendList)
    setFriendsLoading(false)
  }

  function toggleFriend(fid: string) {
    setSelectedFriends(prev => {
      const next = new Set(prev)
      if (next.has(fid)) next.delete(fid)
      else next.add(fid)
      return next
    })
  }

  async function handleAddFriends() {
    if (selectedFriends.size === 0) return
    setAddingFriends(true)

    // Use RPC to bypass RLS (can't insert rows for other users directly)
    const results = await Promise.all(
      Array.from(selectedFriends).map(userId =>
        supabase.rpc('add_circle_member', { p_circle_id: id, p_user_id: userId })
      )
    )
    const error = results.find(r => r.error)?.error
    if (error) {
      console.error('Add friends error:', error)
      setAddingFriends(false)
      return
    }

    // Add to local members list
    const newMembers = friends
      .filter(f => selectedFriends.has(f.id))
      .map(f => ({
        ...f,
        role: 'member',
        email: '', home_area: '', home_x: 0, home_y: 0,
        birthday: null, theme: 'dark', precise_loc: false,
        live_lat: null, live_lng: null, live_area: null,
        live_updated_at: null, last_seen_at: null,
      } as UserProfile & { role: string }))

    setMembers(prev => [...prev, ...newMembers])
    setShowAddFriends(false)
    setSelectedFriends(new Set())
    setAddingFriends(false)
  }

  function copyInviteLink() {
    if (!circle) return
    navigator.clipboard.writeText(`${window.location.origin}/join/${circle.invite_code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyInviteCode() {
    if (!circle) return
    navigator.clipboard.writeText(circle.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copySecretCode() {
    if (!circle?.secret_code) return
    navigator.clipboard.writeText(circle.secret_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveInviteCode() {
    const code = newCode.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!code || code.length < 3) { setCodeError('Code must be at least 3 characters'); return }
    if (code.length > 32) { setCodeError('Code must be 32 characters or less'); return }
    setSavingCode(true); setCodeError('')
    // Check uniqueness
    const { data: existing } = await supabase
      .from('circles').select('id').eq('invite_code', code).neq('id', id).single()
    if (existing) { setCodeError('This code is already taken — try another'); setSavingCode(false); return }
    const { error } = await supabase.from('circles').update({ invite_code: code }).eq('id', id)
    if (error) { setCodeError('Failed to update: ' + error.message); setSavingCode(false); return }
    setCircle({ ...circle, invite_code: code })
    setEditingCode(false); setSavingCode(false)
  }

  async function saveName() {
    if (!newName.trim() || !circle) return
    setSaving(true)
    await supabase.from('circles').update({ name: newName.trim() }).eq('id', id)
    setCircle({ ...circle, name: newName.trim() })
    setEditingName(false)
    setSaving(false)
  }

  async function saveEmoji() {
    if (!newEmoji.trim() || !circle) return
    setSaving(true)
    await supabase.from('circles').update({ emoji: newEmoji.trim() }).eq('id', id)
    setCircle({ ...circle, emoji: newEmoji.trim() })
    setEditingEmoji(false)
    setSaving(false)
  }

  async function removeMember(memberId: string) {
    const { error } = await supabase.rpc('remove_circle_member', {
      p_circle_id: id,
      p_user_id: memberId,
    })
    if (error) {
      console.error('Remove member error:', error)
      alert('Failed to remove member.')
      return
    }
    setMembers(prev => prev.filter(m => m.id !== memberId))
    setActionMember(null)
  }

  async function promoteToAdmin(memberId: string) {
    await supabase.from('circle_members').update({ role: 'admin' })
      .eq('circle_id', id)
      .eq('user_id', memberId)
    setMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, role: 'admin' } : m
    ))
    setActionMember(null)
  }

  async function demoteToMember(memberId: string) {
    await supabase.from('circle_members').update({ role: 'member' })
      .eq('circle_id', id)
      .eq('user_id', memberId)
    setMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, role: 'member' } : m
    ))
    setActionMember(null)
  }

  async function approveJoinRequest(reqId: string, userId: string) {
    setJoiningAction(reqId)
    await supabase.from('circle_join_requests').update({
      status: 'approved',
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    }).eq('id', reqId)

    await supabase.rpc('add_circle_member', { p_circle_id: id, p_user_id: userId })
    setJoinRequests(prev => prev.filter(r => r.id !== reqId))

    // Reload members
    const { data: cms } = await supabase
      .from('circle_members')
      .select('user_id, role, users(*)')
      .eq('circle_id', id)
    if (cms) {
      setMembers(cms.map(cm => ({ ...(cm as any).users, role: cm.role })))
    }

    // Notify the user
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'pact_change',
      title: `You're in! Welcome to ${circle?.name}`,
      body: 'Your request to join was approved',
      link: '/calendar',
    })
    setJoiningAction(null)
  }

  async function rejectJoinRequest(reqId: string, userId: string) {
    setJoiningAction(reqId)
    await supabase.from('circle_join_requests').update({
      status: 'rejected',
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    }).eq('id', reqId)
    setJoinRequests(prev => prev.filter(r => r.id !== reqId))
    setJoiningAction(null)
  }

  async function updateVisibility(v: string) {
    const jm = v === 'private' ? 'invite' : (circle?.join_mode === 'invite' ? 'auto' : circle?.join_mode)
    await supabase.from('circles').update({ visibility: v, join_mode: jm }).eq('id', id)
    setCircle({ ...circle, visibility: v, join_mode: jm })
  }

  async function updateJoinMode(jm: string) {
    await supabase.from('circles').update({ join_mode: jm }).eq('id', id)
    setCircle({ ...circle, join_mode: jm })
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    await supabase.from('circle_members').delete().eq('circle_id', id)
    await supabase.from('circles').delete().eq('id', id)
    const remaining = circles.filter(c => c.id !== id)
    if (remaining.length > 0) setActiveCircle(remaining[0])
    window.location.href = '/calendar'
  }

  async function handleLeave() {
    await supabase.from('circle_members').delete()
      .eq('circle_id', id)
      .eq('user_id', user.id)
    const remaining = circles.filter(c => c.id !== id)
    if (remaining.length > 0) {
      setActiveCircle(remaining[0])
      window.location.href = '/calendar'
    } else {
      // No circles left — go to create/join
      localStorage.removeItem('pact_active_circle')
      window.location.href = '/circles/new'
    }
  }

  if (loading) return <div style={{ padding: 20 }}><div className="spinner" /></div>
  if (!circle) return <div style={{ padding: 20, color: 'var(--text2)' }}>Circle not found.</div>

  // Sort: own profile first
  const sortedMembers = [...members].sort((a, b) => {
    if (a.id === user.id) return -1
    if (b.id === user.id) return 1
    return 0
  })

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button onClick={() => router.back()} style={{
        alignSelf: 'flex-start', background: 'none', border: 'none',
        color: 'var(--accent)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
      }}>
        ← Back
      </button>

      {/* Circle header — editable emoji + name */}
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        {editingEmoji ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <input
              type="text"
              value={newEmoji}
              onChange={e => setNewEmoji(e.target.value)}
              autoFocus
              style={{
                width: 60, height: 50, fontSize: 36, textAlign: 'center',
                background: 'var(--surface2)', border: '2px solid var(--accent)',
                borderRadius: 12, outline: 'none',
              }}
            />
            <button onClick={saveEmoji} disabled={saving} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              {saving ? '...' : '✓'}
            </button>
            <button onClick={() => { setEditingEmoji(false); setNewEmoji(circle.emoji) }} style={{
              background: 'var(--surface2)', border: 'none', borderRadius: 10,
              padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--text2)',
            }}>
              ✕
            </button>
          </div>
        ) : (
          <p
            onClick={() => isAdmin && setEditingEmoji(true)}
            style={{ fontSize: 36, cursor: isAdmin ? 'pointer' : 'default' }}
            title={isAdmin ? 'Tap to change emoji' : undefined}
          >
            {circle.emoji}
          </p>
        )}

        {editingName ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && saveName()}
              style={{
                fontSize: 18, fontWeight: 800, textAlign: 'center',
                background: 'var(--surface2)', border: '2px solid var(--accent)',
                borderRadius: 12, padding: '6px 12px', outline: 'none',
                color: 'var(--text)', width: 200,
              }}
            />
            <button onClick={saveName} disabled={saving} style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              {saving ? '...' : '✓'}
            </button>
            <button onClick={() => { setEditingName(false); setNewName(circle.name) }} style={{
              background: 'var(--surface2)', border: 'none', borderRadius: 10,
              padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--text2)',
            }}>
              ✕
            </button>
          </div>
        ) : (
          <h2
            onClick={() => isAdmin && setEditingName(true)}
            style={{ fontSize: 20, fontWeight: 800, cursor: isAdmin ? 'pointer' : 'default', marginTop: 4 }}
            title={isAdmin ? 'Tap to rename' : undefined}
          >
            {circle.name}
            {isAdmin && <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 6 }}></span>}
          </h2>
        )}
        <p style={{ fontSize: 13, color: 'var(--text2)' }}>{members.length} members</p>
      </div>

      {/* Invite section */}
      <div className="card">
        <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Invite friends
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-primary" onClick={copyInviteLink} style={{ width: '100%' }}>
            {copied ? '✓ Copied!' : '🔗 Copy invite link'}
          </button>
          <button
            className="btn-secondary"
            onClick={loadFriends}
            style={{ width: '100%' }}
          >
            Add from your other circles
          </button>

          {/* URL Slug — editable */}
          <div style={{
            background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px',
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.3px' }}>
              Link slug
            </p>
            {editingCode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => { setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setCodeError('') }}
                  placeholder="e.g. barkada-2026"
                  autoFocus
                  style={{
                    padding: '8px 10px', borderRadius: 8, fontSize: 13,
                    background: 'var(--surface)', border: '1.5px solid var(--accent)',
                    color: 'var(--text)', outline: 'none', fontFamily: 'monospace',
                  }}
                />
                <p style={{ fontSize: 10, color: 'var(--text2)' }}>
                  Lowercase letters, numbers, and dashes only. This is the URL people see when you share the link.
                </p>
                {codeError && <p style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>{codeError}</p>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveInviteCode} disabled={savingCode} style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, border: 'none',
                    background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>{savingCode ? 'Saving...' : 'Save'}</button>
                  <button onClick={() => { setEditingCode(false); setCodeError('') }} style={{
                    padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text2)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, fontSize: 13, color: 'var(--text2)', wordBreak: 'break-all' }}>
                  {circle.invite_code}
                </code>
                <button
                  onClick={copyInviteCode}
                  style={{
                    background: 'none', border: 'none', fontSize: 12,
                    color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Copy
                </button>
                {isAdmin && (
                  <button
                    onClick={() => { setNewCode(circle.invite_code); setEditingCode(true) }}
                    style={{
                      background: 'none', border: 'none', fontSize: 12,
                      color: 'var(--text2)', cursor: 'pointer', fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
            <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 6 }}>
              Link: {typeof window !== 'undefined' ? window.location.origin : ''}/join/{circle.invite_code}
            </p>
            {circle.join_mode === 'approval' && (
              <p style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>
                ⚠️ This link requires admin approval to join.
              </p>
            )}
          </div>

          {/* Secret invite code */}
          <div style={{
            background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px',
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.3px' }}>
              Secret invite code
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: 1 }}>
                {circle.secret_code || '—'}
              </code>
              {circle.secret_code && (
                <button
                  onClick={copySecretCode}
                  style={{
                    background: 'none', border: 'none', fontSize: 12,
                    color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Copy
                </button>
              )}
            </div>
            <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 6 }}>
              Share this privately — anyone who enters it in &quot;Join with code&quot; is added directly, even if the circle requires approval.
            </p>
          </div>
        </div>
      </div>

      {/* Visibility & Join Mode — admin only */}
      {isAdmin && circle && (
        <div className="card">
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Circle visibility
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {([
              { key: 'private', label: '🔒 Private', desc: 'Invite only' },
              { key: 'public', label: '🌐 Public', desc: 'Searchable by anyone' },
            ] as const).map(v => (
              <button
                key={v.key}
                onClick={() => updateVisibility(v.key)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 12,
                  background: circle.visibility === v.key ? 'var(--accent-soft)' : 'var(--surface)',
                  border: circle.visibility === v.key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v.label}</p>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{v.desc}</p>
              </button>
            ))}
          </div>

          {circle.visibility === 'public' && (
            <>
              <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                How people join
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { key: 'auto', label: 'Open', desc: 'Anyone joins instantly' },
                  { key: 'approval', label: 'Approval', desc: 'Admin must approve' },
                ] as const).map(v => (
                  <button
                    key={v.key}
                    onClick={() => updateJoinMode(v.key)}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 12,
                      background: circle.join_mode === v.key ? 'var(--accent-soft)' : 'var(--surface)',
                      border: circle.join_mode === v.key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{v.desc}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Join Requests — admin only, show when approval mode */}
      {isAdmin && joinRequests.length > 0 && (
        <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Pending join requests · {joinRequests.length}
          </p>
          {joinRequests.map(req => {
            const reqUser = (req as any).users
            return (
              <div key={req.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--border)',
              }}>
                <div className="avatar" style={{
                  background: reqUser?.color || '#666', color: txtOn(reqUser?.color || '#666'),
                  position: 'relative',
                }}>
                  {reqUser?.avatar_url && (
                    <img
                      src={reqUser.avatar_url}
                      alt=""
                      style={{
                        position: 'absolute', inset: 0, borderRadius: '50%',
                        width: '100%', height: '100%', objectFit: 'cover',
                      }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  {reqUser?.name?.[0] || '?'}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{reqUser?.name || 'Unknown'}</p>
                  <p style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {new Date(req.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => approveJoinRequest(req.id, req.user_id)}
                    disabled={joiningAction === req.id}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: 'var(--accent)', color: '#fff',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {joiningAction === req.id ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => rejectJoinRequest(req.id, req.user_id)}
                    disabled={joiningAction === req.id}
                    style={{
                      padding: '5px 10px', borderRadius: 8, border: 'none',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {showAddFriends && (
        <div className="card" style={{ border: '1.5px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 800 }}>Add from other circles</p>
            <button
              onClick={() => { setShowAddFriends(false); setSelectedFriends(new Set()) }}
              style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 16, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          {friendsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
              <div className="spinner" />
            </div>
          ) : friends.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 12 }}>
              Everyone from your other circles is already here!
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {friends.map(f => {
                  const selected = selectedFriends.has(f.id)
                  return (
                    <div
                      key={f.id}
                      onClick={() => toggleFriend(f.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                        background: selected ? 'var(--accent-soft)' : 'transparent',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div className="avatar" style={{
                        background: f.color, color: txtOn(f.color), position: 'relative',
                        width: 28, height: 28, fontSize: 11,
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
                      <p style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{f.name}</p>
                      <div style={{
                        width: 20, height: 20, borderRadius: 5,
                        border: selected ? '2px solid var(--accent)' : '2px solid var(--border)',
                        background: selected ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, color: '#fff', fontWeight: 700,
                      }}>
                        {selected && '✓'}
                      </div>
                    </div>
                  )
                })}
              </div>
              {selectedFriends.size > 0 && (
                <button
                  className="btn-primary"
                  onClick={handleAddFriends}
                  disabled={addingFriends}
                  style={{ marginTop: 10 }}
                >
                  {addingFriends ? 'Adding...' : `Add ${selectedFriends.size} friend${selectedFriends.size > 1 ? 's' : ''}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Members — own profile first */}
      <div className="card">
        <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Members
        </p>
        {sortedMembers.map(m => {
          const isMe = m.id === user.id
          const showActions = actionMember === m.id
          return (
            <div key={m.id}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (isAdmin && !isMe) {
                    setActionMember(showActions ? null : m.id)
                  } else {
                    router.push(`/profile/${m.id}`)
                  }
                }}
              >
                <div className="avatar" style={{ background: m.color, color: txtOn(m.color) }}>
                  {m.avatar_url && (
                    <img
                      src={m.avatar_url}
                      alt=""
                      style={{
                        position: 'absolute', inset: 0, borderRadius: '50%',
                        width: '100%', height: '100%', objectFit: 'cover',
                      }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  {m.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>
                    {m.name} {isMe ? '(you)' : ''}
                  </p>
                  <p style={{ fontSize: 11, color: m.role === 'admin' ? 'var(--accent)' : 'var(--text2)' }}>
                    {m.role === 'admin' ? '👑 Admin' : 'Member'}
                  </p>
                </div>
                {isAdmin && !isMe && (
                  <span style={{ fontSize: 10, color: 'var(--text2)' }}>
                    {showActions ? '▲' : '⋯'}
                  </span>
                )}
              </div>
              {/* Action buttons for admins */}
              {showActions && isAdmin && !isMe && (
                <div style={{
                  display: 'flex', gap: 6, padding: '8px 0 8px 42px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  {m.role === 'member' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); promoteToAdmin(m.id) }}
                      style={{
                        padding: '5px 10px', borderRadius: 8, border: 'none',
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      👑 Make admin
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); demoteToMember(m.id) }}
                      style={{
                        padding: '5px 10px', borderRadius: 8, border: 'none',
                        background: 'var(--surface2)', color: 'var(--text2)',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      Remove admin
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Remove ${m.name} from this circle?`)) removeMember(m.id)
                    }}
                    style={{
                      padding: '5px 10px', borderRadius: 8, border: 'none',
                      background: 'rgba(248,113,113,0.1)', color: 'var(--red)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/profile/${m.id}`) }}
                    style={{
                      padding: '5px 10px', borderRadius: 8, border: 'none',
                      background: 'var(--surface2)', color: 'var(--text)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Profile →
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {!isAdmin && (
          <button
            className="btn-secondary"
            onClick={handleLeave}
            style={{ width: '100%', color: 'var(--red)' }}
          >
            Leave circle
          </button>
        )}
        {isAdmin && (
          <button
            className="btn-secondary"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              width: '100%',
              color: confirmDelete ? '#fff' : 'var(--red)',
              background: confirmDelete ? 'var(--red)' : undefined,
            }}
          >
            {deleting ? 'Deleting...' : confirmDelete ? 'Tap again to confirm delete' : 'Delete circle'}
          </button>
        )}
      </div>
    </div>
  )
}
