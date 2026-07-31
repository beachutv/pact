'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { txtOn } from '@/lib/utils'

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported'

export default function SettingsPage() {
  const { user, updateUser } = useCircle()
  const supabase = createClient()
  const router = useRouter()

  // Calendar
  const [calConnected, setCalConnected] = useState(false)
  const [calLoading, setCalLoading] = useState(true)
  const [calEmail, setCalEmail] = useState('')
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Permissions
  const [notifPerm, setNotifPerm] = useState<PermState>('prompt')
  const [locPerm, setLocPerm] = useState<PermState>('prompt')
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

  // Toast
  const [toast, setToast] = useState('')
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2200) }

  useEffect(() => {
    // Check calendar connection via API (bypasses RLS)
    async function checkCal() {
      try {
        const res = await fetch('/api/calendar/status')
        const json = await res.json()
        setCalConnected(json.connected)
        if (json.createdAt) setLastSynced(json.createdAt)
      } catch (e) {
        console.error('Cal status check failed:', e)
      }
      setCalLoading(false)
    }
    checkCal()

    // Check notification permission
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPerm(Notification.permission as PermState)
    } else {
      setNotifPerm('unsupported')
    }

    // Register service worker + check push subscription
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        return navigator.serviceWorker.ready
      }).then(reg => {
        return reg.pushManager.getSubscription()
      }).then(sub => {
        setPushSubscribed(!!sub)
      }).catch(e => console.error('SW/Push check error:', e))
    }

    // Check location permission
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        setLocPerm(result.state as PermState)
        result.addEventListener('change', () => setLocPerm(result.state as PermState))
      }).catch(() => {})
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

  function handleLocationToggle() {
    if (locPerm === 'denied') {
      showToast('Open browser settings → Site settings → Location → Allow')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => { setLocPerm('granted'); showToast('Location enabled ✓') },
      (err) => {
        if (err.code === 1) { setLocPerm('denied'); showToast('Permission denied') }
        else showToast('Location unavailable')
      },
      { timeout: 10000 }
    )
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
    await supabase.auth.signOut()
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

  const themeOptions = [
    { key: 'dark', label: '🌙 Dark' },
    { key: 'light', label: '☀️ Light' },
    { key: 'system', label: '🔄 System' },
  ]

  return (
    <div style={{ padding: '12px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 18, fontWeight: 800 }}>Settings</p>

      {/* Profile card */}
      <button
        onClick={() => router.push(`/profile/${user.id}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: user.color, color: txtOn(user.color),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 800, position: 'relative', overflow: 'hidden',
        }}>
          {user.name[0]}
          {user.avatar_url && (
            <img src={user.avatar_url} alt="" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', borderRadius: '50%',
            }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{user.name}</p>
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>Edit profile →</p>
        </div>
        <span style={{ color: 'var(--text2)', fontSize: 18 }}>›</span>
      </button>

      {/* Google Calendar */}
      <Section title="Google Calendar">
        {calLoading ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', padding: '8px 0' }}>Checking...</p>
        ) : calConnected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Row label="Status" right={<Pill color="var(--green)">Connected</Pill>} />
            {calEmail && <Row label="Account" right={<span style={{ fontSize: 12, color: 'var(--text2)' }}>{calEmail}</span>} />}
            <Row label="Last synced" right={
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {lastSynced ? new Date(lastSynced).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}
              </span>
            } />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => window.dispatchEvent(new CustomEvent('pact-open-cal-selector'))} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                Select calendars
              </button>
              <button onClick={syncCalendar} disabled={syncing} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                opacity: syncing ? 0.5 : 1,
              }}>
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>
            <button onClick={disconnectCalendar} style={{
              marginTop: 8, padding: '8px 0', border: 'none', background: 'transparent',
              color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
            }}>
              Disconnect calendar
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 10 }}>
              Connect your Google Calendar so Pact can find times when your group is free. We only read busy/free — never event details.
            </p>
            <button onClick={connectCalendar} style={primaryBtn}>
              Connect Google Calendar
            </button>
          </>
        )}
      </Section>

      {/* Permissions */}
      <Section title="Permissions">
        <PermRow
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
          title="Notifications"
          description={pushSubscribed
            ? "You'll get notified for messages, new pacts, and sparks."
            : "Get alerted when friends message you or make plans. Without this, you'll only see updates when you open the app."}
          on={pushSubscribed}
          onToggle={handleNotificationToggle}
          blocked={notifPerm === 'denied'}
        />
        {pushSubscribed && (
          <button onClick={sendTestNotification} style={{
            padding: '8px 0', border: 'none', background: 'transparent',
            color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
            borderBottom: '1px solid var(--border)',
          }}>
            Send test notification →
          </button>
        )}
        <div style={{ height: 4 }} />
        <PermRow
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
          title="Location"
          description={locPerm === 'granted'
            ? "Sparks and spot travel times use your live location."
            : "Lets Pact calculate real travel times and detect nearby friends (Sparks). Without this, travel times use your home area — still works, just less accurate."}
          on={locPerm === 'granted'}
          onToggle={handleLocationToggle}
          blocked={locPerm === 'denied'}
        />
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
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </Section>

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
        }}>Privacy policy</button>
        <Row label="Version" right={<span style={{ fontSize: 12, color: 'var(--text2)' }}>17.0</span>} />
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
                <Step n={1} text="Tap the share button ↑ at the bottom of Safari" />
                <Step n={2} text='Scroll down and tap "Add to Home Screen"' />
                <Step n={3} text='Tap "Add" in the top right' />
                <p style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.5, padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 10 }}>
                  iOS requires adding to Home Screen for push notifications.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Step n={1} text="Tap the ⋮ menu at the top right of your browser" />
                <Step n={2} text='Tap "Add to Home Screen" or "Install app"' />
                <Step n={3} text='Tap "Install" to confirm' />
              </div>
            )}
            <button onClick={() => setShowA2HS(false)} style={{ ...primaryBtn, marginTop: 16 }}>Got it</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
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
