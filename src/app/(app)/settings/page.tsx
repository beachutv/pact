'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { txtOn } from '@/lib/utils'
import { IconBell, IconCalendar, IconRefresh, IconSmartphone, IconZap, IconSun, IconMoon } from '@/components/Icons'
import { CURRENT_VERSION } from '@/components/Changelog'

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported'

export default function SettingsPage() {
  const { user, updateUser, circles, setSparkEnabledMap: setContextSparkMap, activeCircle } = useCircle()
  const supabase = createClient()
  const router = useRouter()

  // Calendar
  const [calConnected, setCalConnected] = useState(false)
  const [calLoading, setCalLoading] = useState(true)
  const [calExpired, setCalExpired] = useState(false)
  const [calEmail, setCalEmail] = useState('')
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [selectedCals, setSelectedCals] = useState<string[] | null>(null)

  // Permissions
  const [notifPerm, setNotifPerm] = useState<PermState>('prompt')

  const [pushSubscribed, setPushSubscribed] = useState(false)

  // Theme
  const [theme, setTheme] = useState(user.theme || 'dark')

  // Account
  const [signingOut, setSigningOut] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Add to home screen
  const [showA2HS, setShowA2HS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isiOS, setIsiOS] = useState(false)

  // Visibility window — use user profile value if available, localStorage fallback
  const [visWindow, setVisWindow] = useState(() => {
    if (user.visibility_window === 7 || user.visibility_window === 14) return user.visibility_window
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pact_vis_window')
      return saved ? parseInt(saved) : 7
    }
    return 7
  })

  // Sparks pause
  const [showSparkPause, setShowSparkPause] = useState(false)
  const [sparkCircleStates, setSparkCircleStates] = useState<Record<string, boolean>>({})
  const [silencedUsers, setSilencedUsers] = useState<{ id: string; name: string; color: string; avatar_url: string | null }[]>([])
  const [showSilencePicker, setShowSilencePicker] = useState(false)
  const [allCircleMates, setAllCircleMates] = useState<{ id: string; name: string; color: string; avatar_url: string | null }[]>([])

  // Load per-circle spark states + silenced users
  useEffect(() => {
    async function loadSparkSettings() {
      // Per-circle toggle states
      const { data: cms } = await supabase
        .from('circle_members')
        .select('circle_id, sparks_enabled')
        .eq('user_id', user.id)
      if (cms) {
        const states: Record<string, boolean> = {}
        cms.forEach(cm => { states[cm.circle_id] = cm.sparks_enabled !== false })
        setSparkCircleStates(states)
      }

      // Silenced users
      const { data: silenced } = await supabase
        .from('spark_silenced')
        .select('silenced_user_id, users!silenced_user_id(id, name, color, avatar_url)')
        .eq('user_id', user.id)
      if (silenced) {
        setSilencedUsers(silenced.map((s: any) => s.users).filter(Boolean))
      }
    }
    loadSparkSettings()
  }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toast
  const [toast, setToast] = useState('')
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2200) }

  useEffect(() => {
    // Check calendar connection — verify actual session, not just DB row
    async function checkCal() {
      const { data: conn } = await supabase
        .from('calendar_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'google')
        .single()
      if (!conn) { setCalConnected(false); setCalLoading(false); return }
      // Verify token is still valid by hitting calendar list API
      try {
        const res = await fetch('/api/calendar/list')
        if (res.ok) {
          const data = await res.json()
          setCalConnected(!!(data?.calendars?.length))
        } else {
          // Token expired — connection exists but session is dead
          setCalConnected(false)
          setCalExpired(true)
        }
      } catch {
        setCalConnected(false)
      }
      setCalLoading(false)
    }
    checkCal()

    // Check notification permission — guard for contexts where Notification is undefined
    try {
      if (typeof window !== 'undefined' && typeof Notification !== 'undefined') {
        setNotifPerm(Notification.permission as PermState)
      } else {
        setNotifPerm('unsupported')
      }
    } catch {
      setNotifPerm('unsupported')
    }

    // Register service worker + check push subscription
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        return navigator.serviceWorker.ready
      }).then(reg => {
        if ('pushManager' in reg) {
          return reg.pushManager.getSubscription()
        }
        return null
      }).then(sub => {
        setPushSubscribed(!!sub)
      }).catch(e => console.error('SW/Push check error:', e))
    }

    // Check standalone mode
    if (typeof window !== 'undefined') {
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as any).standalone === true
      setIsStandalone(standalone)
      setIsiOS(/iPad|iPhone|iPod/.test(navigator.userAgent))
    }

    // Get email
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setCalEmail(data.user.email)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleNotificationToggle() {
    if (notifPerm === 'unsupported') {
      showToast('Notifications not supported — try adding Pact to your home screen')
      return
    }
    if (notifPerm === 'denied') {
      showToast('Blocked by browser. Open browser settings to enable.')
      return
    }

    if (pushSubscribed) {
      // Unsubscribe
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        setPushSubscribed(false)
        showToast('Notifications off')
      } catch { showToast('Something went wrong') }
    } else {
      // Subscribe
      try {
        const permission = await Notification.requestPermission()
        setNotifPerm(permission as PermState)
        if (permission !== 'granted') {
          showToast('Permission denied')
          return
        }
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) {
          showToast('Push not configured — tell Bea to add VAPID keys')
          return
        }
        const reg = await navigator.serviceWorker.ready
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        })
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        })
        setPushSubscribed(true)
        showToast('Notifications on ✓')
      } catch (e: any) {
        console.error('Push failed:', e)
        const msg = e?.message || ''
        if (msg.includes('Registration failed')) {
          showToast('Service worker failed — try refreshing')
        } else if (msg.includes('permission')) {
          showToast('Permission blocked — check browser settings')
        } else if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
          showToast('VAPID keys not set — redeploy Vercel')
        } else {
          showToast('Failed: ' + (msg.slice(0, 60) || 'check browser settings'))
        }
      }
    }
  }

  async function sendTestNotification() {
    if (!pushSubscribed) {
      showToast('Turn on notifications first')
      return
    }
    try {
      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: [user.id],
          title: 'Pact Test 🎉',
          body: 'Notifications are working!',
          url: '/settings',
          tag: 'test',
        }),
      })
      showToast('Test sent — check your notifications')
    } catch {
      showToast('Failed to send test')
    }
  }

  function handleTheme(t: string) {
    setTheme(t)
    localStorage.setItem('pact_theme', t)
    const applied = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : t
    document.documentElement.setAttribute('data-theme', applied)
    supabase.from('users').update({ theme: t }).eq('id', user.id)
    updateUser({ theme: t })
  }

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/'
  }

  async function handleDeleteAccount() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    setDeletingAccount(true)
    try {
      const { error } = await supabase.rpc('delete_user_account')
      if (error) { showToast('Failed to delete'); setDeletingAccount(false); return }
      try { await supabase.auth.signOut() } catch {}
      window.location.href = '/'
    } catch {
      showToast('Failed to delete')
      setDeletingAccount(false)
    }
  }

  async function connectCalendar() {
    const { data: { user: u } } = await supabase.auth.getUser()
    const hint = u?.email ? `&login_hint=${encodeURIComponent(u.email)}` : ''
    window.location.href = `/api/calendar/connect?next=${encodeURIComponent('/settings')}${hint}`
  }

  async function disconnectCalendar() {
    if (!confirm('Disconnect Google Calendar?')) return
    await supabase.from('calendar_connections').delete().eq('user_id', user.id).eq('provider', 'google')
    await supabase.from('busy_blocks').delete().eq('user_id', user.id)
    setCalConnected(false)
    showToast('Calendar disconnected')
  }

  async function syncCalendar() {
    setSyncing(true)
    try {
      await fetch('/api/calendar/sync', { method: 'POST' })
      setLastSynced(new Date().toISOString())
      showToast('Synced ✓')
    } catch { showToast('Sync failed') }
    setSyncing(false)
  }

  const themeOptions: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: 'dark', label: 'Dark', icon: <IconMoon size={14} color={theme === 'dark' ? '#fff' : 'var(--text2)'} /> },
    { key: 'light', label: 'Light', icon: <IconSun size={14} color={theme === 'light' ? '#fff' : 'var(--text2)'} /> },
    { key: 'system', label: 'System', icon: <IconRefresh size={14} color={theme === 'system' ? '#fff' : 'var(--text2)'} /> },
  ]

  return (
    <div style={{ padding: '12px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Profile section — centered avatar, name, username */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0 16px', gap: 8,
      }}>
        <div
          onClick={() => router.push(`/profile/${user.id}`)}
          style={{
            width: 72, height: 72, borderRadius: '50%', cursor: 'pointer',
            background: user.color, color: txtOn(user.color),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 800, position: 'relative', overflow: 'hidden',
          }}
        >
          {user.name[0]}
          {user.avatar_url && (
            <img src={user.avatar_url} alt="" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', borderRadius: '50%',
            }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 800 }}>{user.name}</p>
          {(user as any).username && (
            <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>@{(user as any).username}</p>
          )}
        </div>
        <button
          onClick={() => router.push(`/profile/${user.id}`)}
          style={{
            padding: '6px 16px', borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--surface2)', color: 'var(--text)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Edit profile
        </button>
      </div>

      {/* Manage circles */}
      <Section title="Circles">
        {circles.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', padding: '4px 0' }}>
            No circles yet
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {circles.map((c, i) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: i < circles.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{c.emoji}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {circles.length > 1 && (
                    <>
                      <button
                        onClick={() => {
                          if (i === 0) return
                          const ids = circles.map(x => x.id)
                          ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
                          localStorage.setItem('pact_circle_order', JSON.stringify(ids))
                          window.location.reload()
                        }}
                        disabled={i === 0}
                        style={{
                          width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12, cursor: i === 0 ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: i === 0 ? 0.3 : 1,
                        }}
                      >↑</button>
                      <button
                        onClick={() => {
                          if (i === circles.length - 1) return
                          const ids = circles.map(x => x.id)
                          ;[ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]
                          localStorage.setItem('pact_circle_order', JSON.stringify(ids))
                          window.location.reload()
                        }}
                        disabled={i === circles.length - 1}
                        style={{
                          width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12, cursor: i === circles.length - 1 ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: i === circles.length - 1 ? 0.3 : 1,
                        }}
                      >↓</button>
                    </>
                  )}
                  <button
                    onClick={() => router.push(`/circles/${c.id}/settings`)}
                    style={{
                      width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)',
                      background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => router.push('/circles/new')}
          style={{
            marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 10,
            border: '1px dashed var(--border)', background: 'none',
            color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + Create or join a circle
        </button>
      </Section>

      {/* Google Calendar */}
      <Section title="Calendar & Permissions">
        {calLoading ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', padding: '8px 0' }}>Checking...</p>
        ) : calConnected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Google Calendar</p>
                <p style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {calEmail || 'Connected'}
                </p>
              </div>
              <Pill color="var(--green)">Synced</Pill>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('pact-open-cal-selector'))} style={{
                flex: 1, padding: '9px 0', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                Choose calendars
              </button>
              <button onClick={syncCalendar} disabled={syncing} style={{
                padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                opacity: syncing ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>
            <button onClick={disconnectCalendar} style={{
              padding: '6px 0', border: 'none', background: 'transparent',
              color: 'var(--red)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
            }}>
              Disconnect
            </button>
          </div>
        ) : calExpired ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>Session expired</p>
                <p style={{ fontSize: 11, color: 'var(--text2)' }}>Reconnect to keep your calendar in sync</p>
              </div>
            </div>
            <button onClick={connectCalendar} className="btn-primary" style={{ width: '100%', fontSize: 13 }}>
              Reconnect Google Calendar
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700 }}>Not connected</p>
              <p style={{ fontSize: 11, color: 'var(--text2)' }}>We only read busy/free times</p>
            </div>
            <button onClick={connectCalendar} style={{
              padding: '7px 14px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              Connect
            </button>
          </div>
        )}
      </Section>

      {/* Permissions */}
      <Section title="Permissions">
        <PermRow
          icon={<IconBell size={20} color="var(--accent)" />}
          title="Notifications"
          description={pushSubscribed
            ? "You'll get notified for messages, new plans, and friend updates."
            : notifPerm === 'unsupported'
              ? "Your browser doesn't support notifications. Add Pact to your home screen first — notifications require Safari on iOS or Chrome on Android."
              : "Get alerted when friends message you or make plans. Without this, you'll only see updates when you open the app."}
          on={pushSubscribed}
          onToggle={handleNotificationToggle}
          blocked={notifPerm === 'denied'}
        />
        {pushSubscribed && (
          <button onClick={sendTestNotification} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0', border: 'none', background: 'transparent',
            color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
            borderBottom: '1px solid var(--border)', width: '100%',
          }}>
            <IconBell size={14} color="var(--accent)" />
            Send test notification
          </button>
        )}
        {notifPerm === 'unsupported' && (
          <div style={{
            margin: '8px 0', padding: '8px 12px', borderRadius: 10,
            background: 'var(--accent-soft)', fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
          }}>
            <b>To enable:</b> Add Pact to your home screen first. Notifications require <b>Safari on iOS</b> or <b>Chrome on Android</b>.
          </div>
        )}
        {/* Availability window */}
        <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Availability window</p>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                Friends see your availability for the next {visWindow} days
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[7, 14].map(days => (
              <button key={days} onClick={async () => {
                setVisWindow(days)
                localStorage.setItem('pact_vis_window', String(days))
                await supabase.from('users').update({ visibility_window: days }).eq('id', user.id)
                showToast(`Visibility: ${days} days`)
              }} style={{
                flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: visWindow === days ? 'var(--accent)' : 'var(--surface2)',
                color: visWindow === days ? '#fff' : 'var(--text2)',
                fontSize: 12, fontWeight: 700,
              }}>
                {days} days
              </button>
            ))}
          </div>
        </div>

        {/* Global break — applies to everything */}
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Take a break</p>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, lineHeight: 1.5 }}>
                Hides you from all circles and plans. No one will see you as available.
              </p>
            </div>
          </div>

          {/* Global pause card */}
          {(() => {
            const paused = user.sparks_paused_until && new Date(user.sparks_paused_until) > new Date()
            const pausedUntil = paused ? new Date(user.sparks_paused_until!) : null
            const isIndefinite = pausedUntil && pausedUntil.getFullYear() >= 2099
            const pauseLabel = paused
              ? isIndefinite ? 'Paused indefinitely'
                : `Until ${pausedUntil!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${pausedUntil!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
              : null
            return (
              <div style={{
                padding: '12px 14px',
                borderRadius: 14, background: paused ? 'var(--red-soft)' : 'var(--surface2)',
                border: paused ? '1px solid rgba(248,113,113,0.3)' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{paused ? '😴' : '👋'}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{paused ? 'You\'re on a break' : 'Active'}</p>
                    <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                      {paused ? pauseLabel : 'Friends can see your availability'}
                    </p>
                  </div>
                  {paused ? (
                    <button onClick={async () => {
                      await supabase.from('users').update({ sparks_paused_until: null }).eq('id', user.id)
                      updateUser({ sparks_paused_until: null })
                      showToast('Welcome back!')
                    }} style={{
                      padding: '6px 14px', borderRadius: 10, border: 'none',
                      background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>End break</button>
                  ) : (
                    <button onClick={() => setShowSparkPause(true)} style={{
                      padding: '6px 14px', borderRadius: 10, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>Start break</button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Per-circle availability — separate from global break */}
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Circle availability</p>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, lineHeight: 1.5 }}>
                Toggle availability per circle. Off means that circle won&apos;t see you as free.
              </p>
            </div>
          </div>

          {(() => {
            const globalBreakOn = user.sparks_paused_until && new Date(user.sparks_paused_until) > new Date()
            return (
              <>
                {globalBreakOn && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)',
                    border: '1px solid var(--border)', marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 12 }}>😴</span>
                    <p style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>
                      Global break is on — all circles are paused
                    </p>
                  </div>
                )}
                {circles.map(c => {
                  const enabled = !globalBreakOn && sparkCircleStates[c.id] !== false
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                      borderBottom: '1px solid var(--border)',
                      opacity: globalBreakOn ? 0.4 : 1,
                    }}>
                      <span style={{ fontSize: 16 }}>{c.emoji}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                      <button
                        disabled={!!globalBreakOn}
                        onClick={async () => {
                          if (globalBreakOn) return
                          const next = !enabled
                          setSparkCircleStates(prev => ({ ...prev, [c.id]: next }))
                          if (activeCircle && c.id === activeCircle.id) {
                            setContextSparkMap(prev => ({ ...prev, [user.id]: next }))
                          }
                          await supabase.from('circle_members')
                            .update({ sparks_enabled: next })
                            .eq('circle_id', c.id)
                            .eq('user_id', user.id)
                          showToast(next ? `Available in ${c.name}` : `Unavailable in ${c.name}`)
                        }}
                        style={{
                          width: 42, height: 24, borderRadius: 12, border: 'none',
                          cursor: globalBreakOn ? 'not-allowed' : 'pointer',
                          background: enabled ? 'var(--accent)' : 'var(--surface3)',
                          position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%', background: '#fff',
                          position: 'absolute', top: 3, left: enabled ? 21 : 3,
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                        }} />
                      </button>
                    </div>
                  )
                })}
              </>
            )
          })()}

          {/* Silence list */}
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6, marginTop: 14 }}>
            Silence list
          </p>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.5 }}>
            People on this list won&apos;t appear as available to you, regardless of circle settings.
          </p>
          {silencedUsers.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic', padding: '4px 0' }}>Nobody silenced</p>
          ) : (
            silencedUsers.map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: s.color || '#666',
                  color: txtOn(s.color || '#666'), display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0, position: 'relative',
                }}>
                  {s.avatar_url && <img src={s.avatar_url} alt="" style={{ position: 'absolute', inset: 0, borderRadius: '50%', width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />}
                  {s.name?.[0] || '?'}
                </div>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                <button onClick={async () => {
                  await supabase.from('spark_silenced').delete()
                    .eq('user_id', user.id).eq('silenced_user_id', s.id)
                  setSilencedUsers(prev => prev.filter(u => u.id !== s.id))
                  showToast(`${s.name} removed from silence list`)
                }} style={{
                  padding: '4px 10px', borderRadius: 8, border: 'none',
                  background: 'var(--surface2)', color: 'var(--text2)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>Remove</button>
              </div>
            ))
          )}
          <button
            onClick={async () => {
              setShowSilencePicker(true)
              if (allCircleMates.length === 0) {
                // Load all unique circle mates across all circles
                const { data: cms } = await supabase
                  .from('circle_members')
                  .select('user_id, users!user_id(id, name, color, avatar_url)')
                  .in('circle_id', circles.map(c => c.id))
                if (cms) {
                  const seen = new Set<string>()
                  const mates: typeof allCircleMates = []
                  cms.forEach((cm: any) => {
                    if (cm.users && !seen.has(cm.users.id)) {
                      seen.add(cm.users.id)
                      mates.push(cm.users)
                    }
                  })
                  setAllCircleMates(mates.sort((a, b) => a.name.localeCompare(b.name)))
                }
              }
            }}
            style={{
              marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 10,
              border: '1px dashed var(--border)', background: 'none',
              color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            + Add someone to silence list
          </button>
        </div>
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <div style={{ display: 'flex', gap: 8 }}>
          {themeOptions.map(t => (
            <button key={t.key} onClick={() => handleTheme(t.key)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: theme === t.key ? 'var(--accent)' : 'var(--surface2)',
              color: theme === t.key ? '#fff' : 'var(--text2)',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Visibility Window */}
      {/* Add to Home Screen */}
      {!isStandalone && (
        <Section title="Add to Home Screen">
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 10 }}>
            Full-screen experience, faster loading, and push notifications on iOS.
          </p>
          <button onClick={() => setShowA2HS(true)} style={primaryBtn}>
            How to install
          </button>
        </Section>
      )}
      {isStandalone && (
        <Section title="App">
          <Row label="Installed" right={<Pill color="var(--green)">Home Screen ✓</Pill>} />
        </Section>
      )}

      {/* Account */}
      <Section title="Account">
        <button onClick={handleSignOut} disabled={signingOut} style={{
          width: '100%', padding: '10px 0', border: 'none', background: 'transparent',
          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
        }}>
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
        <button onClick={handleDeleteAccount} disabled={deletingAccount} style={{
          width: '100%', padding: '10px 0', border: 'none', background: 'transparent',
          color: 'var(--red)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          borderTop: '1px solid var(--border)',
        }}>
          {deletingAccount ? 'Deleting...' : confirmDelete ? 'Tap again to confirm' : 'Delete account'}
        </button>
      </Section>

      {/* About */}
      <Section title="About">
        <button onClick={() => router.push('/privacy')} style={{
          width: '100%', padding: '8px 0', border: 'none', background: 'transparent',
          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          borderBottom: '1px solid var(--border)',
        }}>Privacy policy →</button>
        <button onClick={() => {
          localStorage.removeItem('pact_walkthrough_seen')
          router.push('/home')
          setTimeout(() => window.dispatchEvent(new CustomEvent('pact-start-walkthrough')), 500)
        }} style={{
          width: '100%', padding: '8px 0', border: 'none', background: 'transparent',
          color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          borderBottom: '1px solid var(--border)',
        }}>Show me around →</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Version {CURRENT_VERSION}</span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('pact-open-changelog'))}
            style={{
              padding: '4px 12px', borderRadius: 10, border: '1px solid var(--accent)',
              background: 'transparent', color: 'var(--accent)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            What&apos;s new?
          </button>
        </div>
      </Section>

      {/* A2HS modal */}
      {showA2HS && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowA2HS(false) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface2)', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Add Pact to Home Screen</p>
            {isiOS ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: 'var(--accent-soft)', fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
                }}>
                  <b>Important:</b> You must use <b>Safari</b> for this. Other browsers on iOS (Chrome, Arc, Firefox) don&apos;t support Add to Home Screen.
                </div>
                <Step n={1} text="Open this page in Safari" />
                <Step n={2} text="Tap the share button at the bottom of Safari (square with arrow ↑)" />
                <Step n={3} text='Scroll down and tap "Add to Home Screen"' />
                <Step n={4} text='Tap "Add" in the top right' />
                <div style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: 'var(--amber-soft)', fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
                }}>
                  Push notifications on iOS <b>only work</b> when Pact is added to your home screen via Safari. This is an Apple requirement.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: 'var(--accent-soft)', fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
                }}>
                  <b>Best with Chrome.</b> Other browsers may also work, but Chrome gives the most reliable experience.
                </div>
                <Step n={1} text="Open this page in Chrome" />
                <Step n={2} text='Tap the three-dot menu ⋮ at the top right' />
                <Step n={3} text='Tap "Add to Home Screen" or "Install app"' />
                <Step n={4} text='Tap "Install" to confirm' />
              </div>
            )}
            <button onClick={() => setShowA2HS(false)} style={{ ...primaryBtn, marginTop: 16 }}>Got it</button>
          </div>
        </div>
      )}

      {/* Spark pause picker */}
      {showSparkPause && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowSparkPause(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 50,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface2)', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            width: '100%', maxWidth: 440,
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>😴 Take a break</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
              You won&apos;t appear as available to friends. Plans won&apos;t include you until you resume.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: '1 hour', hours: 1 },
                { label: '4 hours', hours: 4 },
                { label: 'Until tomorrow', hours: (() => { const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(8, 0, 0, 0); return Math.max(1, (tom.getTime() - Date.now()) / 3600000) })() },
                { label: '1 week', hours: 168 },
                { label: 'Indefinitely', hours: 876000 },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={async () => {
                    const until = new Date(Date.now() + opt.hours * 3600000).toISOString()
                    await supabase.from('users').update({ sparks_paused_until: until }).eq('id', user.id)
                    updateUser({ sparks_paused_until: until })
                    setShowSparkPause(false)
                    showToast(`😴 Break active — ${opt.label.toLowerCase()}`)
                  }}
                  style={{
                    padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--text)',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  {opt.label}
                  <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 8 }}>
                    {opt.hours >= 876000 ? 'until you turn it back on' : ''}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowSparkPause(false)}
              style={{
                marginTop: 12, width: '100%', padding: 12, borderRadius: 12,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Silence list picker */}
      {showSilencePicker && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowSilencePicker(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 50,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface2)', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            width: '100%', maxWidth: 440, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🔇 Silence someone</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.5 }}>
              Pick someone — they won&apos;t be suggested when making plans. They won&apos;t know they&apos;re silenced.
            </p>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {allCircleMates.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text2)', padding: 8 }}>Loading...</p>
              ) : (
                allCircleMates
                  .filter(m => m.id !== user.id && !silencedUsers.some(s => s.id === m.id))
                  .map(m => (
                    <button
                      key={m.id}
                      onClick={async () => {
                        await supabase.from('spark_silenced').insert({
                          user_id: user.id,
                          silenced_user_id: m.id,
                        })
                        setSilencedUsers(prev => [...prev, m])
                        setShowSilencePicker(false)
                        showToast(`🔇 ${m.name} silenced from sparks`)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', width: '100%',
                        borderBottom: '1px solid var(--border)', background: 'none', border: 'none',
                        borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: m.color || '#666',
                        color: txtOn(m.color || '#666'), display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, flexShrink: 0, position: 'relative',
                      }}>
                        {m.avatar_url && <img src={m.avatar_url} alt="" style={{ position: 'absolute', inset: 0, borderRadius: '50%', width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />}
                        {m.name?.[0] || '?'}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                    </button>
                  ))
              )}
            </div>
            <button
              onClick={() => setShowSilencePicker(false)}
              style={{
                marginTop: 12, width: '100%', padding: 12, borderRadius: 12,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', top: '38%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)',
          padding: '10px 18px', borderRadius: 24, fontSize: 13, fontWeight: 600, zIndex: 60,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '14px 16px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        {title}
      </p>
      {children}
    </div>
  )
}

function Row({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {right}
    </div>
  )
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color,
      background: color === 'var(--green)' ? 'var(--green-soft)' : 'var(--accent-soft)',
      padding: '3px 10px', borderRadius: 12,
    }}>{children}</span>
  )
}

function PermRow({ icon, title, description, on, onToggle, blocked }: {
  icon: React.ReactNode; title: string; description: string;
  on: boolean; onToggle: () => void; blocked?: boolean
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ flexShrink: 0, marginTop: 2, display: 'flex' }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 700 }}>{title}</p>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{description}</p>
          {blocked && (
            <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
              Blocked by browser. Enable in your browser or device settings.
            </p>
          )}
        </div>
        <button
          onClick={onToggle}
          style={{
            width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
            background: on ? 'var(--accent)' : 'var(--surface3)',
            position: 'relative', flexShrink: 0, transition: 'background 0.2s', marginTop: 2,
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3,
            left: on ? 23 : 3,
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </button>
      </div>
    </div>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: 'var(--accent)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800,
      }}>{n}</div>
      <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{text}</p>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '12px 0', border: 'none', borderRadius: 12,
  background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
