'use client'

import { useState, createContext, useContext, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { txtOn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useLocationUpdate } from '@/lib/useLocationUpdate'

// ---- Types ----
export type UserProfile = {
  id: string
  name: string
  email: string
  color: string
  home_area: string
  home_x: number
  home_y: number
  birthday: string | null
  theme: string
  precise_loc: boolean
  live_lat: number | null
  live_lng: number | null
  live_area: string | null
  live_updated_at: string | null
  avatar_url: string | null
}

export type Circle = {
  id: string
  name: string
  emoji: string
  invite_code: string
}

type CircleContextType = {
  user: UserProfile
  updateUser: (partial: Partial<UserProfile>) => void
  circles: Circle[]
  activeCircle: Circle | null
  setActiveCircle: (c: Circle) => void
  circleMembers: UserProfile[]
  setCircleMembers: React.Dispatch<React.SetStateAction<UserProfile[]>>
}

const CircleContext = createContext<CircleContextType | null>(null)
export function useCircle() {
  const ctx = useContext(CircleContext)
  if (!ctx) throw new Error('useCircle must be used within AppShell')
  return ctx
}

// ---- Nav tabs (4 tabs) ----
const TABS = [
  { key: '/calendar', icon: '📅', label: 'Calendar' },
  { key: '/chat', icon: '💬', label: 'Chat' },
  { key: '/plans', icon: '📌', label: 'Plans' },
  { key: '/spots', icon: '📍', label: 'Spots' },
]

export default function AppShell({
  user,
  circles,
  children,
}: {
  user: UserProfile
  circles: Circle[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // Persistent location tracking across all tabs
  useLocationUpdate(user.id, 'app-shell')

  // Request location permission once (first app load only)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    const asked = localStorage.getItem('pact_loc_asked')
    if (asked) return
    localStorage.setItem('pact_loc_asked', '1')
    // Single getCurrentPosition triggers the browser prompt once
    navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 5000 })
  }, [])

  // Prefetch all tab routes for instant navigation
  useEffect(() => {
    TABS.forEach(t => router.prefetch(t.key))
  }, [])

  const [currentUser, setCurrentUser] = useState<UserProfile>(user)
  const [activeCircle, setActiveCircle] = useState<Circle | null>(circles[0] || null)
  const [circleMembers, setCircleMembers] = useState<UserProfile[]>([user])

  function updateUser(partial: Partial<UserProfile>) {
    setCurrentUser(prev => ({ ...prev, ...partial }))
    setCircleMembers(prev => prev.map(m => m.id === user.id ? { ...m, ...partial } : m))
  }

  // Circle members expanded from circle name
  const [showMembersList, setShowMembersList] = useState(false)
  // Your Circles section
  const [showYourCircles, setShowYourCircles] = useState(false)

  const [theme, setTheme] = useState(user.theme || 'dark')
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)

  // Chat unread badge
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  // Fetch circle members when circle changes
  useEffect(() => {
    if (!activeCircle) return
    async function fetchMembers() {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id, users(*)')
        .eq('circle_id', activeCircle!.id)

      if (data) {
        const members = data.map(d => (d as any).users).filter(Boolean) as UserProfile[]
        setCircleMembers(members)
      }
    }
    fetchMembers()
  }, [activeCircle?.id])

  // Notifications
  useEffect(() => {
    async function fetchNotifs() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (data) setNotifications(data)
      const { count: unread } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)
      setUnreadNotifCount(unread || 0)
    }
    fetchNotifs()

    // Listen for any notification insert (no user_id filter — RLS handles security,
    // and default replica identity may not propagate the filter correctly)
    const channel = supabase
      .channel('notifs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
      }, (payload) => {
        // Only refetch if the notification is for this user
        if ((payload.new as any)?.user_id === user.id) {
          fetchNotifs()
        }
      })
      .subscribe()

    // Also refetch when tab becomes visible (catches missed realtime events)
    function onVisChange() {
      if (document.visibilityState === 'visible') fetchNotifs()
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [user.id])

  // Chat unread count
  useEffect(() => {
    async function fetchChatUnread() {
      // Get user's threads
      const { data: threadMembers } = await supabase
        .from('thread_members')
        .select('thread_id')
        .eq('user_id', user.id)
      if (!threadMembers || threadMembers.length === 0) return

      const threadIds = threadMembers.map(tm => tm.thread_id)

      // Get thread reads
      const { data: reads } = await supabase
        .from('thread_reads')
        .select('thread_id, last_read_at')
        .eq('user_id', user.id)
        .in('thread_id', threadIds)

      const readMap: Record<string, string> = {}
      for (const r of (reads || [])) readMap[r.thread_id] = r.last_read_at

      // Get threads with last_message_at
      const { data: threads } = await supabase
        .from('threads')
        .select('id, last_message_at')
        .in('id', threadIds)

      let count = 0
      for (const t of (threads || [])) {
        if (!t.last_message_at) continue
        const lastRead = readMap[t.id]
        if (!lastRead || new Date(t.last_message_at) > new Date(lastRead)) count++
      }
      setChatUnreadCount(count)
    }
    fetchChatUnread()

    // Realtime updates for messages
    const channel = supabase
      .channel('chat-unread-badge')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, () => { fetchChatUnread() })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'thread_reads',
        filter: `user_id=eq.${user.id}`,
      }, () => { fetchChatUnread() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user.id])

  async function markAllNotifsRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadNotifCount(0)
  }

  function notifIcon(type: string) {
    switch (type) {
      case 'message': return '💬'
      case 'pact_new': return '🎉'
      case 'pact_change': return '✏️'
      case 'pact_upcoming': return '⏰'
      case 'spark': return '⚡'
      default: return '🔔'
    }
  }

  function notifTimeAgo(ts: string) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  // Theme
  useEffect(() => {
    const applied = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme
    document.documentElement.setAttribute('data-theme', applied)
  }, [theme])

  function selectTheme(t: string) {
    setTheme(t)
    setShowThemePicker(false)
    supabase.from('users').update({ theme: t }).eq('id', user.id)
  }

  const themeIcon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system'
  const firstName = currentUser.name.split(' ')[0]

  return (
    <CircleContext.Provider value={{ user: currentUser, updateUser, circles, activeCircle, setActiveCircle, circleMembers, setCircleMembers }}>
      <div id="app-shell">
        {/* Header — matches prototype */}
        <header style={{
          padding: '14px 18px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Row 1: Pact. logo left, theme/bell/calendar icons right */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1 }}>
                <span style={{ color: 'var(--accent)' }}>P</span>act.
              </p>
              <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>plans that actually happen</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Theme picker */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowThemePicker(!showThemePicker)}
                  style={{
                    background: 'none', border: 'none',
                    cursor: 'pointer', padding: 4,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {themeIcon === 'sun' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/>
                      <line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/>
                      <line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  ) : themeIcon === 'moon' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 2a10 10 0 0 1 0 20V2z" fill="var(--text)"/>
                    </svg>
                  )}
                </button>
                {showThemePicker && (
                  <>
                    <div onClick={() => setShowThemePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />
                    <div style={{
                      position: 'absolute', right: 0, top: 32, zIndex: 60,
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                      padding: 6, minWidth: 150,
                    }}>
                      {[
                        { key: 'light', label: 'Light', icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5"/>
                            <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                          </svg>
                        )},
                        { key: 'dark', label: 'Dark', icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                          </svg>
                        )},
                        { key: 'system', label: 'System', icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 2a10 10 0 0 1 0 20V2z" fill="currentColor"/>
                          </svg>
                        )},
                      ].map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => selectTheme(opt.key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            width: '100%', padding: '9px 12px', border: 'none',
                            borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            background: theme === opt.key ? 'var(--accent-soft)' : 'transparent',
                            color: theme === opt.key ? 'var(--accent)' : 'var(--text)',
                          }}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Notification bell */}
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', padding: 4, position: 'relative',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadNotifCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 0, right: -2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--red)', color: '#fff',
                    fontSize: 9, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>
                )}
              </button>

              {/* Calendar selector button (top right like prototype) */}
              <button
                onClick={async () => {
                  // Load and show calendar selection — dispatch custom event for dashboard
                  window.dispatchEvent(new CustomEvent('pact-open-cal-selector'))
                }}
                title="My Calendars"
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Row 2: Circle name left, avatar stack right — click to expand */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {activeCircle ? (
              <button
                onClick={() => setShowMembersList(!showMembersList)}
                style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--text2)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0,
                }}
              >
                {activeCircle.emoji} {activeCircle.name} · {circleMembers.length} member{circleMembers.length > 1 ? 's' : ''} {showMembersList ? '▴' : '▾'}
              </button>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>No circles yet</span>
            )}

            {/* Avatar stack */}
            {activeCircle && (
              <div style={{ display: 'flex', marginLeft: 'auto' }}>
                {circleMembers.slice(0, 5).map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: m.avatar_url ? `url(${m.avatar_url}) center/cover` : m.color,
                      color: txtOn(m.color),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800,
                      border: '2px solid var(--bg)',
                      marginLeft: i > 0 ? -8 : 0,
                      zIndex: 5 - i,
                    }}
                  >
                    {!m.avatar_url && m.name[0]}
                  </div>
                ))}
                {circleMembers.length > 5 && (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'var(--surface2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 800, color: 'var(--text2)',
                    border: '2px solid var(--bg)',
                    marginLeft: -8,
                  }}>
                    +{circleMembers.length - 5}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Expanded members list with live locations */}
          {showMembersList && activeCircle && (
            <div style={{
              marginTop: 8, background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '8px 12px',
            }}>
              {circleMembers.map(m => {
                const isMe = m.id === user.id
                const hasLocation = m.live_area && m.live_updated_at
                const locAge = hasLocation ? Math.floor((Date.now() - new Date(m.live_updated_at!).getTime()) / 60000) : null
                const locLabel = locAge !== null ? (locAge < 1 ? 'now' : locAge < 60 ? `${locAge}m ago` : `${Math.floor(locAge/60)}h ago`) : null
                return (
                  <div
                    key={m.id}
                    onClick={() => router.push(`/profile/${m.id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 0', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div
                      className="avatar"
                      style={{
                        width: 28, height: 28, fontSize: 11,
                        background: m.avatar_url ? `url(${m.avatar_url}) center/cover` : m.color,
                        color: txtOn(m.color),
                      }}
                    >
                      {!m.avatar_url && m.name[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {m.name}{isMe ? ' (you)' : ''}
                      </span>
                      {hasLocation && locAge !== null && locAge < 120 && (
                        <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1 }}>
                          📍 {m.live_area} · {locLabel}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
              <button
                onClick={(e) => { e.stopPropagation(); setShowMembersList(false); router.push(`/circles/${activeCircle.id}/settings`) }}
                style={{
                  marginTop: 6, fontSize: 12, fontWeight: 600,
                  color: 'var(--accent)', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '4px 0',
                }}
              >
                ⚙️ Circle settings
              </button>
            </div>
          )}

          {/* Row 3: Hi Name greeting + profile photo */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              onClick={() => router.push(`/profile/${currentUser.id}`)}
              style={{
                width: 42, height: 42, borderRadius: '50%',
                background: currentUser.avatar_url ? `url(${currentUser.avatar_url}) center/cover` : currentUser.color,
                color: txtOn(currentUser.color),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, cursor: 'pointer',
                border: '2px solid var(--border)',
                flexShrink: 0,
              }}
            >
              {!currentUser.avatar_url && currentUser.name[0]}
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>
                Hi {firstName} 👋
              </p>
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, lineHeight: 1.3 }}>
                {activeCircle ? `Pick a date to see when ${activeCircle.name} is free` : 'Create or join a circle to get started'}
              </p>
            </div>
          </div>

          {/* YOUR CIRCLES — pill chips */}
          <div style={{ marginTop: 10 }}>
            <p style={{
              fontSize: 10, fontWeight: 800, color: 'var(--text2)',
              textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6,
            }}>
              Your Circles
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {circles.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setActiveCircle(c); setShowMembersList(false) }}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    border: c.id === activeCircle?.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: c.id === activeCircle?.id ? 'var(--accent-soft)' : 'var(--surface)',
                    color: c.id === activeCircle?.id ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {c.emoji} {c.name}
                </button>
              ))}
              <button
                onClick={() => router.push('/circles/new')}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: '1px dashed var(--border)',
                  background: 'transparent', color: 'var(--accent)',
                  cursor: 'pointer',
                }}
              >
                ＋ New
              </button>
            </div>
          </div>

          {/* Notifications dropdown */}
          {showNotifs && (
            <>
            <div onClick={() => setShowNotifs(false)} style={{
              position: 'fixed', inset: 0, zIndex: 49,
            }} />
            <div style={{
              position: 'absolute', right: 12, top: 56, zIndex: 50,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, width: 300, maxHeight: 360, overflowY: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}>
              <div style={{ padding: '12px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Notifications</span>
                {unreadNotifCount > 0 && (
                  <button onClick={markAllNotifsRead} style={{
                    background: 'none', border: 'none', fontSize: 11,
                    fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                  }}>Mark all read</button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (n.link) router.push(n.link)
                      setShowNotifs(false)
                      if (!n.read) {
                        supabase.from('notifications').update({ read: true }).eq('id', n.id)
                        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
                        setUnreadNotifCount(prev => Math.max(0, prev - 1))
                      }
                    }}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                      background: n.read ? 'transparent' : 'var(--accent-soft)',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{notifIcon(n.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, lineHeight: 1.3 }}>{n.title}</p>
                      {n.body && <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{n.body}</p>}
                      <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 3 }}>{notifTimeAgo(n.created_at)}</p>
                    </div>
                    {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 4, flexShrink: 0 }} />}
                  </div>
                ))
              )}
            </div>
            </>
          )}
        </header>

        {/* Main content */}
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>

        {/* Bottom nav */}
        <nav className="bottom-nav">
          {TABS.map(tab => {
            const isActive = pathname === tab.key
            return (
              <button
                key={tab.key}
                className={`nav-tab ${isActive ? 'active' : ''}`}
                onClick={() => router.push(tab.key)}
                style={{ position: 'relative' }}
              >
                <span className="nav-icon">{tab.icon}</span>
                {tab.label}
                {/* Chat unread badge */}
                {tab.key === '/chat' && chatUnreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 2, right: '50%', transform: 'translateX(12px)',
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--red)', color: '#fff',
                    fontSize: 9, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>
    </CircleContext.Provider>
  )
}
