'use client'

import { useState, createContext, useContext, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

// ---- SVG Nav Icons (Lucide-style line icons) ----
function CalendarIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function ChatIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
function PlansIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}
function SpotsIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  )
}

const NAV_ICONS: Record<string, (props: { color: string }) => React.ReactNode> = {
  '/calendar': CalendarIcon,
  '/chat': ChatIcon,
  '/plans': PlansIcon,
  '/spots': SpotsIcon,
}

// ---- Nav tabs (4 tabs) ----
const TABS = [
  { key: '/calendar', label: 'Calendar' },
  { key: '/chat', label: 'Chat' },
  { key: '/plans', label: 'Plans' },
  { key: '/spots', label: 'Spots' },
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

  // Auto-collapse members list and close panels when navigating between tabs
  useEffect(() => {
    setShowMembersList(false)
    setShowNotifs(false)
    setShowThemePicker(false)
  }, [pathname])

  const [currentUser, setCurrentUser] = useState<UserProfile>(user)
  // Restore last active circle from localStorage, fallback to first circle
  const [activeCircle, setActiveCircleState] = useState<Circle | null>(() => {
    if (typeof window === 'undefined') return circles[0] || null
    const savedId = localStorage.getItem('pact_active_circle')
    if (savedId) {
      const found = circles.find(c => c.id === savedId)
      if (found) return found
    }
    return circles[0] || null
  })
  const setActiveCircle = (c: Circle) => {
    setActiveCircleState(c)
    localStorage.setItem('pact_active_circle', c.id)
  }
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

  // Calendar selection modal (global — works from any tab)
  type GCal = { id: string; summary: string; primary: boolean; backgroundColor: string }
  const [showCalModal, setShowCalModal] = useState(false)
  const [gcals, setGcals] = useState<GCal[]>([])
  const [selectedCals, setSelectedCals] = useState<string[]>([])

  const [calError, setCalError] = useState<string | null>(null)

  async function loadCalendars() {
    setCalError(null)
    try {
      const res = await fetch('/api/calendar/list')
      if (res.ok) {
        const data = await res.json()
        setGcals(data.calendars || [])
        setSelectedCals(data.selectedIds || ['primary'])
        setShowCalModal(true)
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Calendar list error:', res.status, err)
        setGcals([])
        setSelectedCals([])
        if (res.status === 500 && err.error?.includes('Token refresh')) {
          setCalError('Your Google Calendar session expired. Please reconnect below.')
        } else if (res.status === 400) {
          setCalError('No Google Calendar connected yet. Connect one from your profile.')
        } else if (res.status === 401) {
          setCalError('Please sign in again to access your calendars.')
        } else {
          setCalError(err.error || 'Could not load calendars. Try again.')
        }
        setShowCalModal(true)
      }
    } catch (e) {
      console.error('Calendar list fetch error:', e)
      setCalError('Network error — check your connection and try again.')
      setGcals([])
      setSelectedCals([])
      setShowCalModal(true)
    }
  }

  async function saveCalendarSelection() {
    await fetch('/api/calendar/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds: selectedCals }),
    })
    setShowCalModal(false)
    // Trigger a sync after saving
    fetch('/api/calendar/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }).catch(() => {})
  }

  async function disconnectCalendar() {
    const s = createClient()
    const { data: { user: u } } = await s.auth.getUser()
    if (!u) return
    await s.from('calendar_connections').delete().eq('user_id', u.id).eq('provider', 'google')
    await s.from('busy_blocks').delete().eq('user_id', u.id)
    setShowCalModal(false)
    window.location.reload()
  }

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

  async function clearAllNotifs() {
    await supabase.from('notifications').delete().eq('user_id', user.id)
    setNotifications([])
    setUnreadNotifCount(0)
  }

  async function clearNotif(notifId: string, wasUnread: boolean) {
    await supabase.from('notifications').delete().eq('id', notifId)
    setNotifications(prev => prev.filter(n => n.id !== notifId))
    if (wasUnread) setUnreadNotifCount(prev => Math.max(0, prev - 1))
  }

  function notifIcon(type: string) {
    const s = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
    switch (type) {
      case 'message': return <svg {...s} stroke="var(--accent)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      case 'pact_new': return <svg {...s} stroke="var(--green)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      case 'pact_change': return <svg {...s} stroke="var(--amber)"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      case 'pact_upcoming': return <svg {...s} stroke="var(--lavender)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      case 'spark': return <svg {...s} stroke="var(--amber)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      default: return <svg {...s} stroke="var(--text2)"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
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
        {/* Header — matches prototype: 2-row layout */}
        <header style={{
          padding: '16px 18px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Row 1: Brand | buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              onClick={() => router.push(`/profile/${currentUser.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1 }}>
                Pact<span style={{ color: 'var(--accent)' }}>.</span>
              </p>
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                plans that actually happen
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Theme picker */}
              <button
                onClick={() => setShowThemePicker(!showThemePicker)}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  cursor: 'pointer', padding: '6px 8px', borderRadius: 20,
                  display: 'flex', alignItems: 'center',
                }}
              >
                {themeIcon === 'sun' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                ) : themeIcon === 'moon' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20V2z" fill="var(--text)"/>
                  </svg>
                )}
              </button>

              {/* Notification bell */}
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  cursor: 'pointer', padding: '6px 10px', borderRadius: 20, position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadNotifCount > 0 && (
                  <span style={{
                    background: 'var(--red)', color: '#fff', borderRadius: 8,
                    fontSize: 9, fontWeight: 800, padding: '1px 5px', lineHeight: 1.3,
                  }}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>
                )}
              </button>

              {/* Calendar selector */}
              <button
                onClick={() => loadCalendars()}
                title="My Calendars"
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  cursor: 'pointer', padding: '6px 10px', borderRadius: 20,
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 600, color: 'var(--text)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                My calendars
              </button>
            </div>
          </div>

          {/* Row 2: Circle name + members | circle switcher */}
          <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {activeCircle ? (
              <>
                <button
                  onClick={() => circles.length > 1 ? setShowYourCircles(!showYourCircles) : setShowMembersList(!showMembersList)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text2)', fontSize: 13, fontWeight: 600,
                    padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  {activeCircle.name} · {circleMembers.length} members
                  {circles.length > 1 && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                      {showYourCircles ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setShowMembersList(!showMembersList)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  {circleMembers.slice(0, 6).map((m, i) => (
                    <span key={m.id} style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: m.color, color: txtOn(m.color),
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                      border: '2px solid var(--bg)',
                      marginLeft: i > 0 ? -8 : 0,
                      position: 'relative', overflow: 'hidden',
                    }}>
                      {m.name?.[0] || '?'}
                      {m.avatar_url && (
                        <img src={m.avatar_url} alt="" style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', borderRadius: '50%',
                        }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </span>
                  ))}
                  {circleMembers.length > 6 && (
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, border: '2px solid var(--bg)', marginLeft: -8,
                    }}>+{circleMembers.length - 6}</span>
                  )}
                </button>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>No circles yet</span>
            )}
          </div>
        </header>

        {/* Circle switcher dropdown */}
        {showYourCircles && circles.length > 1 && typeof document !== 'undefined' && createPortal(
          <>
          <div onClick={() => setShowYourCircles(false)} style={{
            position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.3)',
          }} />
          <div style={{
            position: 'fixed', left: 12, right: 12, top: 90, zIndex: 9999,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '10px 14px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Your circles
            </div>
            {circles.map(c => (
              <button
                key={c.id}
                onClick={() => { setActiveCircle(c); setShowYourCircles(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '10px 0', textAlign: 'left',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  color: c.id === activeCircle?.id ? 'var(--accent)' : 'var(--text)',
                  fontSize: 14, fontWeight: c.id === activeCircle?.id ? 700 : 500,
                }}
              >
                <span style={{ fontSize: 18 }}>{c.emoji}</span>
                {c.name}
                {c.id === activeCircle?.id && <span style={{ marginLeft: 'auto', fontSize: 12 }}>✓</span>}
              </button>
            ))}
            <button
              onClick={() => { setShowYourCircles(false); router.push('/circles/new') }}
              style={{
                marginTop: 6, fontSize: 13, fontWeight: 600,
                color: 'var(--accent)', background: 'none', border: 'none',
                cursor: 'pointer', padding: '6px 0',
              }}
            >
              + Create new circle
            </button>
          </div>
          </>,
          document.body
        )}

        {/* Members list popup — portal to avoid header clipping */}
        {showMembersList && activeCircle && typeof document !== 'undefined' && createPortal(
          <>
          <div onClick={() => setShowMembersList(false)} style={{
            position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.3)',
          }} />
          <div style={{
            position: 'fixed', left: 12, right: 12, top: 100, zIndex: 9999,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '10px 14px', maxHeight: 360, overflowY: 'auto',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {activeCircle.emoji} {activeCircle.name} · {circleMembers.length} members
            </div>
            {circleMembers.map(m => {
              const isMe = m.id === user.id
              const hasLocation = m.live_area && m.live_updated_at
              const locAge = hasLocation ? Math.floor((Date.now() - new Date(m.live_updated_at!).getTime()) / 60000) : null
              const locLabel = locAge !== null ? (
                locAge < 1 ? 'now'
                : locAge < 60 ? `${locAge}m ago`
                : locAge < 1440 ? `${Math.floor(locAge/60)}h ago`
                : `${Math.floor(locAge/1440)}d ago`
              ) : null
              const isOnline = locAge !== null && locAge < 5
              return (
                <div
                  key={m.id}
                  onClick={() => { setShowMembersList(false); router.push(`/profile/${m.id}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 0', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      className="avatar"
                      style={{
                        width: 32, height: 32, fontSize: 12,
                        background: m.color,
                        color: txtOn(m.color),
                        position: 'relative', overflow: 'hidden',
                      }}
                    >
                      {m.name?.[0] || '?'}
                      {m.avatar_url && (
                        <img src={m.avatar_url} alt="" style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', borderRadius: '50%',
                        }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </div>
                    {isOnline && (
                      <div style={{
                        position: 'absolute', bottom: -1, right: -1,
                        width: 10, height: 10, borderRadius: '50%',
                        background: '#8BB07E', border: '2px solid var(--surface)',
                      }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {m.name}{isMe ? ' (you)' : ''}
                      {isOnline && <span style={{ fontSize: 10, color: '#8BB07E', marginLeft: 4 }}>online</span>}
                    </span>
                    {hasLocation && locAge !== null && locAge < 10080 && (
                      <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {m.live_area} · {locLabel}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
            <button
              onClick={(e) => { e.stopPropagation(); setShowMembersList(false); router.push(`/circles/${activeCircle.id}/settings`) }}
              style={{
                marginTop: 8, fontSize: 12, fontWeight: 600,
                color: 'var(--accent)', background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px 0',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Circle settings
            </button>
          </div>
          </>,
          document.body
        )}

        {/* Theme picker dropdown — portal */}
        {showThemePicker && typeof document !== 'undefined' && createPortal(
          <>
            <div onClick={() => setShowThemePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
            <div style={{
              position: 'fixed', right: 16, top: 52, zIndex: 9999,
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
          </>,
          document.body
        )}

        {/* Notifications dropdown — portal */}
        {showNotifs && typeof document !== 'undefined' && createPortal(
          <>
            <div onClick={() => setShowNotifs(false)} style={{
              position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.3)',
            }} />
            <div style={{
              position: 'fixed', right: 12, left: 12, top: 60, zIndex: 9999,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, maxWidth: 340, marginLeft: 'auto', maxHeight: 400, overflowY: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}>
              <div style={{ padding: '12px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Notifications</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {unreadNotifCount > 0 && (
                    <button onClick={markAllNotifsRead} style={{
                      background: 'none', border: 'none', fontSize: 11,
                      fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                    }}>Mark all read</button>
                  )}
                  {notifications.length > 0 && (
                    <button onClick={clearAllNotifs} style={{
                      background: 'none', border: 'none', fontSize: 11,
                      fontWeight: 600, color: 'var(--red)', cursor: 'pointer',
                    }}>Clear all</button>
                  )}
                </div>
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
                    <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{notifIcon(n.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, lineHeight: 1.3 }}>{n.title}</p>
                      {n.body && <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{n.body}</p>}
                      <p style={{ fontSize: 10, color: 'var(--text2)', marginTop: 3 }}>{notifTimeAgo(n.created_at)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); clearNotif(n.id, !n.read) }}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text2)',
                        fontSize: 14, cursor: 'pointer', padding: '2px 4px',
                        flexShrink: 0, marginTop: 2,
                      }}
                    >✕</button>
                  </div>
                ))
              )}
            </div>
          </>,
          document.body
        )}

        {/* Main content */}
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>

        {/* Bottom nav */}
        <nav className="bottom-nav">
          {TABS.map(tab => {
            const isActive = pathname === tab.key
            const IconComp = NAV_ICONS[tab.key]
            const iconColor = isActive ? 'var(--accent)' : 'var(--text2)'
            return (
              <button
                key={tab.key}
                className={`nav-tab ${isActive ? 'active' : ''}`}
                onClick={() => router.push(tab.key)}
                style={{ position: 'relative' }}
              >
                <span className="nav-icon">{IconComp ? <IconComp color={iconColor} /> : null}</span>
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

      {/* Calendar selection modal — portaled to body, works from any tab */}
      {showCalModal && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCalModal(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface)', borderRadius: 20, padding: 20,
            width: '90%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>My calendars</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
              Pick which calendars Pact checks for busy times. We only read busy/free — never event details.
            </p>
            {calError && (
              <div style={{
                fontSize: 13, color: 'var(--red)', padding: '14px 12px', textAlign: 'center',
                background: 'rgba(231,118,93,0.1)', borderRadius: 12, marginBottom: 10,
              }}>
                {calError}
              </div>
            )}
            {!calError && gcals.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text2)', padding: '16px 0', textAlign: 'center' }}>
                No calendars found. Make sure your Google Calendar is connected.
              </div>
            )}
            {gcals.map(cal => {
              const on = selectedCals.includes(cal.id)
              return (
                <div
                  key={cal.id}
                  onClick={() => {
                    setSelectedCals(prev =>
                      prev.includes(cal.id)
                        ? prev.filter(id => id !== cal.id)
                        : [...prev, cal.id]
                    )
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12, marginBottom: 6,
                    background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                    cursor: 'pointer', border: on ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                  }}
                >
                  <div style={{
                    width: 12, height: 12, borderRadius: 3,
                    background: cal.backgroundColor,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cal.summary}</div>
                    {cal.primary && <div style={{ fontSize: 10, color: 'var(--text2)' }}>Primary</div>}
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: 6,
                    border: on ? 'none' : '2px solid var(--border)',
                    background: on ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 800,
                  }}>
                    {on ? '✓' : ''}
                  </div>
                </div>
              )
            })}
            {gcals.length > 0 && (
              <button
                onClick={saveCalendarSelection}
                disabled={selectedCals.length === 0}
                style={{
                  marginTop: 12, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                  background: selectedCals.length > 0 ? 'var(--accent)' : 'var(--surface3)',
                  color: selectedCals.length > 0 ? '#fff' : 'var(--text2)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Save & sync
              </button>
            )}
            {calError && calError.includes('expired') && (
              <button
                onClick={() => { setShowCalModal(false); window.location.href = '/api/calendar/connect' }}
                style={{
                  marginTop: 8, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                  background: 'var(--accent)', color: '#fff',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Reconnect Google Calendar
              </button>
            )}
            <button
              onClick={() => { setShowCalModal(false); disconnectCalendar() }}
              style={{
                marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
                background: 'transparent', color: 'var(--red)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Disconnect Google Calendar
            </button>
          </div>
        </div>,
        document.body
      )}
    </CircleContext.Provider>
  )
}
