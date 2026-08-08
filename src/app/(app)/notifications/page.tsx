'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCircle } from '@/components/AppShell'

type Notif = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

function timeAgo(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function groupLabel(ts: string): string {
  const now = new Date()
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const notifDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.floor((today.getTime() - notifDay.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'This week'
  return 'Earlier'
}

function notifIcon(type: string) {
  const size = 20
  const s = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (type) {
    case 'friend_request': return <svg {...s} stroke="var(--accent)"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case 'pact_new': return <svg {...s} stroke="var(--green)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
    case 'pact_change': return <svg {...s} stroke="var(--amber)"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
    case 'pact_upcoming': return <svg {...s} stroke="var(--accent)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    case 'spark': return <svg {...s} stroke="var(--amber)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    case 'birthday': return <span style={{ fontSize: 18 }}>🎂</span>
    case 'circle_join': return <svg {...s} stroke="var(--green)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
    default: return <svg {...s} stroke="var(--text2)"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
  }
}

export default function NotificationsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { user } = useCircle()

  const [notifications, setNotifications] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  // Swipe state per notification
  const [swipeId, setSwipeId] = useState<string | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const isSwiping = useRef(false)

  const loadNotifs = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .neq('type', 'message')  // exclude message notifications — those stay on chat badge
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setNotifications(data as Notif[])
    setLoading(false)
  }, [user.id])

  useEffect(() => { loadNotifs() }, [loadNotifs])

  // Realtime — refresh on changes (INSERT and UPDATE)
  useEffect(() => {
    const channel = supabase
      .channel('notifs-page')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications',
      }, (payload) => {
        if ((payload.new as any)?.user_id === user.id) loadNotifs()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user.id, loadNotifs])

  // Mark all as read when opening the page — update badge in AppShell
  useEffect(() => {
    supabase.from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .then(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
        // Dispatch event so AppShell refreshes the badge count
        window.dispatchEvent(new CustomEvent('pact-notifs-read'))
      })
  }, [user.id])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    window.dispatchEvent(new CustomEvent('pact-notifs-read'))
  }

  async function dismissNotif(id: string) {
    // Delete from DB
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
    setSwipeId(null)
    setSwipeX(0)
  }

  function handleTap(n: Notif) {
    if (!n.read) {
      supabase.from('notifications').update({ read: true }).eq('id', n.id)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
      window.dispatchEvent(new CustomEvent('pact-notifs-read'))
    }
    if (n.link) router.push(n.link)
  }

  // Swipe handlers
  function onTouchStart(id: string, e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isSwiping.current = false
    setSwipeId(id)
    setSwipeX(0)
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!swipeId) return
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    // Only swipe left, and only if mostly horizontal
    if (!isSwiping.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping.current = true
    }
    if (isSwiping.current && dx < 0) {
      setSwipeX(Math.max(dx, -120))
    }
  }
  function onTouchEnd() {
    if (!swipeId) return
    if (swipeX < -70) {
      // Dismiss
      dismissNotif(swipeId)
    } else {
      setSwipeX(0)
      setSwipeId(null)
    }
    isSwiping.current = false
  }

  // Group by time period
  const groups: { label: string; items: Notif[] }[] = []
  for (const n of notifications) {
    const label = groupLabel(n.created_at)
    const existing = groups.find(g => g.label === label)
    if (existing) existing.items.push(n)
    else groups.push({ label, items: [n] })
  }

  const hasUnread = notifications.some(n => !n.read)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', fontSize: 13, fontWeight: 600, padding: 0,
            }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Notifications</span>
        </div>
        {hasUnread && (
          <button
            onClick={markAllRead}
            style={{
              background: 'none', border: 'none', fontSize: 12,
              fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        ) : notifications.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '60px 24px', gap: 12,
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <p style={{ fontSize: 14, color: 'var(--text2)', fontWeight: 600 }}>No notifications yet</p>
            <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.5 }}>
              You&apos;ll see friend requests, plan updates, and birthday reminders here.
            </p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.label}>
              {/* Group header */}
              <div style={{
                padding: '12px 16px 6px', fontSize: 12, fontWeight: 800,
                color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px',
                background: 'var(--bg)',
                position: 'sticky', top: 0, zIndex: 1,
              }}>
                {group.label}
              </div>

              {/* Notifications in group */}
              {group.items.map(n => (
                <div
                  key={n.id}
                  style={{ position: 'relative', overflow: 'hidden' }}
                >
                  {/* Delete background (revealed on swipe) */}
                  <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0,
                    width: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--red)', color: '#fff', fontSize: 13, fontWeight: 700,
                  }}>
                    Remove
                  </div>

                  {/* Notification row (slides) */}
                  <div
                    onTouchStart={(e) => onTouchStart(n.id, e)}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onClick={() => { if (!isSwiping.current && swipeX === 0) handleTap(n) }}
                    style={{
                      display: 'flex', gap: 12, padding: '14px 16px',
                      cursor: n.link ? 'pointer' : 'default',
                      background: n.read ? 'var(--bg)' : 'var(--accent-soft)',
                      borderBottom: '1px solid var(--border)',
                      transition: swipeId === n.id ? 'none' : 'transform .2s ease-out',
                      transform: swipeId === n.id ? `translateX(${swipeX}px)` : 'translateX(0)',
                      position: 'relative', zIndex: 1,
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: 'var(--surface2)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {notifIcon(n.type)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 14, fontWeight: n.read ? 500 : 700,
                        lineHeight: 1.35, color: 'var(--text)',
                      }}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p style={{
                          fontSize: 12, color: 'var(--text2)',
                          marginTop: 3, lineHeight: 1.4,
                        }}>
                          {n.body}
                        </p>
                      )}
                      <p style={{
                        fontSize: 11, color: 'var(--text2)',
                        marginTop: 4,
                      }}>
                        {timeAgo(n.created_at)}
                      </p>
                    </div>

                    {/* Dismiss X button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissNotif(n.id) }}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text2)',
                        fontSize: 16, cursor: 'pointer', padding: '0 2px',
                        alignSelf: 'flex-start', marginTop: 2, opacity: 0.4,
                        flexShrink: 0,
                      }}
                    >✕</button>

                    {/* Unread dot */}
                    {!n.read && (
                      <div style={{
                        width: 8, height: 8, borderRadius: 4,
                        background: 'var(--accent)', flexShrink: 0,
                        alignSelf: 'center',
                      }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
