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
  setCircleMembers: (m: UserProfile[]) => void
}

const CircleContext = createContext<CircleContextType | null>(null)
export function useCircle() {
  const ctx = useContext(CircleContext)
  if (!ctx) throw new Error('useCircle must be used within AppShell')
  return ctx
}

// ---- Nav tabs ----
const TABS = [
  { key: '/home', icon: '🏠', label: 'Home' },
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

  const [currentUser, setCurrentUser] = useState<UserProfile>(user)
  const [activeCircle, setActiveCircle] = useState<Circle | null>(circles[0] || null)
  const [circleMembers, setCircleMembers] = useState<UserProfile[]>([user])

  function updateUser(partial: Partial<UserProfile>) {
    setCurrentUser(prev => ({ ...prev, ...partial }))
    // Also update in circleMembers list
    setCircleMembers(prev => prev.map(m => m.id === user.id ? { ...m, ...partial } : m))
  }
  const [showCirclePicker, setShowCirclePicker] = useState(false)
  const [theme, setTheme] = useState(user.theme || 'dark')
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)

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
      const { data, count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact' })
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

    const channel = supabase
      .channel('notifs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => { fetchNotifs() })
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

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    supabase.from('users').update({ theme: next }).eq('id', user.id)
  }

  return (
    <CircleContext.Provider value={{ user: currentUser, updateUser, circles, activeCircle, setActiveCircle, circleMembers, setCircleMembers }}>
      <div id="app-shell">
        {/* Header */}
        <header style={{
          padding: '16px 18px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px' }}>
                <span style={{ color: 'var(--accent)' }}>P</span>act
              </h1>
              <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                plans that actually happen
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={toggleTheme}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                {theme === 'dark' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', padding: 4, position: 'relative',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <div
                onClick={() => router.push(`/profile/${currentUser.id}`)}
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: currentUser.avatar_url ? `url(${currentUser.avatar_url}) center/cover` : currentUser.color,
                  color: txtOn(currentUser.color),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                  border: '2px solid var(--border)',
                }}
              >
                {!currentUser.avatar_url && currentUser.name[0]}
              </div>
            </div>
          </div>

          {/* Circle switcher + avatars */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginTop: 11,
          }}>
            <button
              onClick={() => setShowCirclePicker(!showCirclePicker)}
              style={{
                fontSize: 13, fontWeight: 600, color: 'var(--text2)',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              {activeCircle
                ? `${activeCircle.emoji} ${activeCircle.name} · ${circleMembers.length} member${circleMembers.length > 1 ? 's' : ''}`
                : 'No circles yet'
              } ▾
            </button>
            <div style={{ display: 'flex' }}>
              {circleMembers.slice(0, 6).map((m, i) => (
                <div
                  key={m.id}
                  className="avatar"
                  style={{
                    background: m.avatar_url ? `url(${m.avatar_url}) center/cover` : m.color,
                    color: txtOn(m.color),
                    marginLeft: i > 0 ? -8 : 0,
                    border: '2px solid var(--bg)',
                  }}
                  onClick={() => router.push(`/profile/${m.id}`)}
                >
                  {!m.avatar_url && m.name[0]}
                </div>
              ))}
              {circleMembers.length > 6 && (
                <div className="avatar" style={{
                  background: 'var(--surface3)',
                  color: 'var(--text2)',
                  marginLeft: -8,
                  border: '2px solid var(--bg)',
                  fontSize: 10,
                }}>
                  +{circleMembers.length - 6}
                </div>
              )}
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

          {/* Circle picker dropdown */}
          {showCirclePicker && (
            <div style={{
              marginTop: 8, background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 14,
              padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {circles.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={() => { setActiveCircle(c); setShowCirclePicker(false) }}
                    style={{
                      flex: 1,
                      background: c.id === activeCircle?.id ? 'var(--accent-soft)' : 'transparent',
                      border: 'none', borderRadius: 10, padding: '8px 12px',
                      fontSize: 13, fontWeight: 600, color: 'var(--text)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {c.emoji} {c.name}
                  </button>
                  <button
                    onClick={() => { setShowCirclePicker(false); router.push(`/circles/${c.id}/settings`) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 16, padding: '4px 8px', color: 'var(--text2)',
                    }}
                  >
                    ⚙️
                  </button>
                </div>
              ))}
              <button
                onClick={() => { setShowCirclePicker(false); router.push('/circles/new') }}
                style={{
                  background: 'transparent', border: 'none',
                  borderRadius: 10, padding: '8px 12px',
                  fontSize: 13, fontWeight: 600, color: 'var(--accent)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                ＋ Create or join a circle
              </button>
            </div>
          )}
        </header>

        {/* Main content */}
        <main style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>

        {/* Bottom nav */}
        <nav className="bottom-nav">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`nav-tab ${pathname === tab.key ? 'active' : ''}`}
              onClick={() => router.push(tab.key)}
            >
              <span className="nav-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </CircleContext.Provider>
  )
}
