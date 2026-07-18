'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { txtOn } from '@/lib/utils'

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

  // Member action state
  const [actionMember, setActionMember] = useState<string | null>(null)

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
      setLoading(false)
    }
    load()
  }, [id])

  const isAdmin = members.find(m => m.id === user.id)?.role === 'admin'

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
    await supabase.from('circle_members').delete()
      .eq('circle_id', id)
      .eq('user_id', memberId)
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

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    await supabase.from('circle_members').delete().eq('circle_id', id)
    await supabase.from('circles').delete().eq('id', id)
    const remaining = circles.filter(c => c.id !== id)
    if (remaining.length > 0) setActiveCircle(remaining[0])
    window.location.href = '/dashboard'
  }

  async function handleLeave() {
    await supabase.from('circle_members').delete()
      .eq('circle_id', id)
      .eq('user_id', user.id)
    window.location.href = '/dashboard'
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
              onChange={e => {
                // Only keep the last emoji character(s) entered
                const val = e.target.value
                setNewEmoji(val)
              }}
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
            {isAdmin && <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 6 }}>✏️</span>}
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
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface2)', borderRadius: 10, padding: '8px 12px',
          }}>
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
              Copy code
            </button>
          </div>
        </div>
      </div>

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
