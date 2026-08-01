'use client'

import { useState, createContext, useContext, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { txtOn, bdaySoon, birthdayMMDD } from '@/lib/utils'
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
  last_seen_at: string | null
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

  // Circle ordering — persisted in localStorage
  const [orderedCircles, setOrderedCircles] = useState<Circle[]>(() => {
    if (typeof window === 'undefined') return circles
    try {
      const saved = localStorage.getItem('pact_circle_order')
      if (saved) {
        const order: string[] = JSON.parse(saved)
        const sorted = [...circles].sort((a, b) => {
          const ai = order.indexOf(a.id)
          const bi = order.indexOf(b.id)
          if (ai === -1 && bi === -1) return 0
          if (ai === -1) return 1
          if (bi === -1) return -1
          return ai - bi
        })
        return sorted
      }
    } catch {}
    return circles
  })

  function moveCircle(circleId: string, direction: 'up' | 'down') {
    setOrderedCircles(prev => {
      const idx = prev.findIndex(c => c.id === circleId)
      if (idx === -1) return prev
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      localStorage.setItem('pact_circle_order', JSON.stringify(next.map(c => c.id)))
      return next
    })
  }

  // Persistent location tracking across all tabs
  useLocationUpdate(user.id, 'app-shell')

  // Landscape detection
  const [isLandscape, setIsLandscape] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (min-width: 600px)')
    setIsLandscape(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Request location permission if not yet granted
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    if (!navigator.permissions) {
      // Fallback: try once if we haven't asked before
      const asked = localStorage.getItem('pact_loc_asked')
      if (!asked) {
        localStorage.setItem('pact_loc_asked', '1')
        navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 5000 })
      }
      return
    }
    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'prompt') {
        // Trigger the browser permission dialog
        navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 5000 })
      }
    }).catch(() => {})
  }, [])

  // Heartbeat: update last_seen_at every 2 min while tab is visible (no permissions needed)
  useEffect(() => {
    function heartbeat() {
      if (document.visibilityState === 'visible') {
        supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {})
      }
    }
    heartbeat() // immediate on mount
    const interval = setInterval(heartbeat, 2 * 60 * 1000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', heartbeat)
    }
  }, [user.id])

  // Prefetch all tab routes for instant navigation
  useEffect(() => {
    TABS.forEach(t => router.prefetch(t.key))
  }, [])

  // Auto-collapse members list and close panels when navigating between tabs
  useEffect(() => {
    setShowCirclePanel(false)
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

  // Unified circle panel (replaces separate members + circles dropdowns)
  const [showCirclePanel, setShowCirclePanel] = useState(false)
  // Legacy aliases for compatibility (auto-close on nav)
  const showMembersList = false
  const showYourCircles = false

  // Theme — use localStorage as source of truth to survive SSR staleness
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pact_theme')
      if (saved) return saved
    }
    return user.theme || 'dark'
  })
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)

  // Toast
  const [appToast, setAppToast] = useState('')
  function showAppToast(msg: string) { setAppToast(msg); setTimeout(() => setAppToast(''), 2200) }

  // Chat unread badge
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  // Calendar selection modal (global — works from any tab)
  type GCal = { id: string; summary: string; primary: boolean; backgroundColor: string }
  const [showCalModal, setShowCalModal] = useState(false)
  const [gcals, setGcals] = useState<GCal[]>([])
  const [selectedCals, setSelectedCals] = useState<string[]>([])

  const [calError, setCalError] = useState<string | null>(null)
  const [calLoading, setCalLoading] = useState(false)

  async function loadCalendars() {
    setCalError(null)
    setCalLoading(true)
    try {
      const res = await fetch('/api/calendar/list')
      if (res.ok) {
        const data = await res.json()
        setGcals(data.calendars || [])
        setSelectedCals(data.selectedIds || [])
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
    } finally {
      setCalLoading(false)
    }
  }

  // Listen for calendar modal open events from other pages (e.g. profile)
  const loadCalRef = useRef(loadCalendars)
  loadCalRef.current = loadCalendars
  useEffect(() => {
    const handler = () => loadCalRef.current()
    window.addEventListener('pact-open-cal-selector', handler)
    return () => window.removeEventListener('pact-open-cal-selector', handler)
  }, [])

  // Listen for new version event and insert a notification
  useEffect(() => {
    const handler = (e: Event) => {
      const version = (e as CustomEvent).detail?.version
      if (version && user?.id) {
        const s = createClient()
        s.from('notifications').insert({
          user_id: user.id,
          type: 'pact_change',
          title: "What's new in Pact",
          body: `Version ${version} is here — tap to see what changed`,
          link: '/settings',
        }).then(() => {
          // Refresh notifications
          // realtime subscription handles refresh
        })
      }
    }
    window.addEventListener('pact-new-version', handler)
    return () => window.removeEventListener('pact-new-version', handler)
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Birthday scanner — check circle mates for upcoming birthdays (2 weeks out)
  // Runs once per day per device (tracked in localStorage)
  useEffect(() => {
    if (!user?.id || circles.length === 0) return
    const todayKey = new Date().toISOString().slice(0, 10)
    const scanKey = `pact_bday_scan_${todayKey}`
    if (localStorage.getItem(scanKey)) return

    async function scanBirthdays() {
      const s = createClient()
      // Get all circle mates
      const allMemberIds = new Set<string>()
      for (const c of circles) {
        const { data: members } = await s.from('circle_members').select('user_id').eq('circle_id', c.id)
        members?.forEach(m => { if (m.user_id !== user!.id) allMemberIds.add(m.user_id) })
      }
      if (allMemberIds.size === 0) return

      const { data: mates } = await s.from('users').select('id, name, birthday').in('id', [...allMemberIds])
      if (!mates) return

      for (const mate of mates) {
        if (!mate.birthday) continue
        const days = bdaySoon(mate.birthday, 14)
        if (days < 0) continue

        // Check if we already sent a birthday notification for this person this year
        const year = new Date().getFullYear()
        const notifTag = `bday-${mate.id}-${year}`
        const { data: existing } = await s.from('notifications')
          .select('id')
          .eq('user_id', user!.id)
          .eq('type', 'pact_change')
          .ilike('title', `%${mate.name?.split(' ')[0]}%birthday%`)
          .gte('created_at', `${year}-01-01`)
          .limit(1)
        if (existing && existing.length > 0) continue

        const firstName = mate.name?.split(' ')[0] || 'Someone'
        const mmdd = birthdayMMDD(mate.birthday)
        const bdayDate = new Date(year, parseInt(mmdd.slice(0, 2)) - 1, parseInt(mmdd.slice(3)))
        const dateStr = bdayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

        let title: string, body: string
        if (days === 0) {
          title = `🎂 It's ${firstName}'s birthday today!`
          body = `Plan something special — tap to see your shared circles`
        } else if (days === 1) {
          title = `🎂 ${firstName}'s birthday is tomorrow!`
          body = `${dateStr} — tap to plan something`
        } else {
          title = `🎂 ${firstName}'s birthday in ${days} days`
          body = `${dateStr} — tap to plan something with your circle`
        }

        await s.from('notifications').insert({
          user_id: user!.id,
          type: 'pact_change',
          title,
          body,
          link: `/profile/${mate.id}`,
        })
      }

      localStorage.setItem(scanKey, '1')
    }

    // Delay to not slow down initial load
    const t = setTimeout(scanBirthdays, 3000)
    return () => clearTimeout(t)
  }, [user?.id, circles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCalendarSelection() {
    await fetch('/api/calendar/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds: selectedCals }),
    })
    setShowCalModal(false)

    if (selectedCals.length > 0) {
      // Sync with new selection
      await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }).catch(() => {})
    }
    // Always reload to reflect changes
    window.location.reload()
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

  // Fetch circle members when circle changes + realtime location updates
  useEffect(() => {
    if (!activeCircle) return
    let memberIds: string[] = []

    async function fetchMembers() {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id, users(*)')
        .eq('circle_id', activeCircle!.id)

      if (data) {
        const members = data.map(d => (d as any).users).filter(Boolean) as UserProfile[]
        setCircleMembers(members)
        memberIds = members.map(m => m.id)
      }
    }
    fetchMembers()

    // Realtime: update member profiles (location, avatar, name, etc.) as they change
    const channel = supabase
      .channel(`members-${activeCircle.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users',
      }, (payload) => {
        const updated = payload.new as UserProfile
        if (memberIds.length > 0 && !memberIds.includes(updated.id)) return
        setCircleMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      })
      .subscribe()

    // Also refetch when tab becomes visible (catches missed realtime events)
    function onVisChange() {
      if (document.visibilityState === 'visible') fetchMembers()
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisChange)
    }
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

  // Welcome flow for new users (location → notifications → add to home screen)
  const [showWelcomeFlow, setShowWelcomeFlow] = useState(false)
  const [welcomeStep, setWelcomeStep] = useState<'location' | 'notifications' | 'homescreen' | null>(null)
  const pushSetupDone = useRef(false)
  useEffect(() => {
    if (pushSetupDone.current) return
    pushSetupDone.current = true

    async function setupPushAndWelcome() {
      if (typeof window === 'undefined') return

      // Register service worker if available
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          await navigator.serviceWorker.register('/sw.js')
        } catch (e) {
          console.error('SW registration failed:', e)
        }

        // If already subscribed, save (idempotent)
        try {
          const reg = await navigator.serviceWorker.ready
          const existingSub = await reg.pushManager.getSubscription()
          if (existingSub) {
            await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: existingSub.toJSON() }),
            })
          }
        } catch {}
      }

      // Check if welcome flow has been shown
      const welcomed = localStorage.getItem('pact_welcomed')
      if (!welcomed) {
        setTimeout(() => {
          setShowWelcomeFlow(true)
          // Determine which step to start with
          const locAsked = localStorage.getItem('pact_loc_asked')
          if (!locAsked && navigator.geolocation) {
            setWelcomeStep('location')
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            setWelcomeStep('notifications')
          } else {
            const standalone = window.matchMedia('(display-mode: standalone)').matches
              || (navigator as any).standalone === true
            if (!standalone) {
              setWelcomeStep('homescreen')
            } else {
              // Everything already done
              localStorage.setItem('pact_welcomed', '1')
              setShowWelcomeFlow(false)
            }
          }
        }, 2000)
      }
    }

    setupPushAndWelcome()
  }, [user.id])

  function welcomeNext() {
    if (welcomeStep === 'location') {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        setWelcomeStep('notifications')
      } else {
        const standalone = window.matchMedia('(display-mode: standalone)').matches
          || (navigator as any).standalone === true
        if (!standalone) {
          setWelcomeStep('homescreen')
        } else {
          welcomeDone()
        }
      }
    } else if (welcomeStep === 'notifications') {
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as any).standalone === true
      if (!standalone) {
        setWelcomeStep('homescreen')
      } else {
        welcomeDone()
      }
    } else {
      welcomeDone()
    }
  }

  function welcomeDone() {
    localStorage.setItem('pact_welcomed', '1')
    setShowWelcomeFlow(false)
    setWelcomeStep(null)
  }

  async function welcomeAllowLocation() {
    localStorage.setItem('pact_loc_asked', '1')
    navigator.geolocation.getCurrentPosition(
      () => welcomeNext(),
      () => welcomeNext(),
      { timeout: 10000 }
    )
  }

  async function welcomeAllowNotifications() {
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted' && 'PushManager' in window) {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (vapidKey) {
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
        }
      }
    } catch (e) {
      console.error('Push subscription failed:', e)
    }
    welcomeNext()
  }

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
    localStorage.setItem('pact_theme', t)
    supabase.from('users').update({ theme: t }).eq('id', user.id)
  }

  const themeIcon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system'
  const firstName = currentUser.name.split(' ')[0]

  return (
    <CircleContext.Provider value={{ user: currentUser, updateUser, circles, activeCircle, setActiveCircle, circleMembers, setCircleMembers }}>
      <div id="app-shell" style={isLandscape ? { flexDirection: 'row', maxWidth: '100%' } : {}}>
        {/* Header — portrait: top bar, landscape: left sidebar */}
        <header style={isLandscape ? {
          width: 64, flexShrink: 0, borderRight: '1px solid var(--border)', borderBottom: 'none',
          padding: '12px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          overflowY: 'auto', overflowX: 'hidden',
        } : {
          padding: '16px 18px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Portrait: Row 1: Avatar + Brand | buttons */}
          {isLandscape ? (
            /* Landscape sidebar content */
            <>
              {/* Avatar */}
              <div
                onClick={() => router.push(`/profile/${currentUser.id}`)}
                style={{ cursor: 'pointer', marginBottom: 4 }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: currentUser.color, color: txtOn(currentUser.color),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 800, position: 'relative', overflow: 'hidden',
                }}>
                  {currentUser.name[0]}
                  {currentUser.avatar_url && (
                    <img src={currentUser.avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 32, height: 1, background: 'var(--border)' }} />

              {/* Nav tabs vertical */}
              {TABS.map(tab => {
                const isActive = pathname === tab.key
                const IconComp = NAV_ICONS[tab.key]
                const iconColor = isActive ? 'var(--accent)' : 'var(--text2)'
                return (
                  <button key={tab.key} onClick={() => router.push(tab.key)} style={{
                    background: isActive ? 'var(--accent-soft)' : 'none', border: 'none',
                    borderRadius: 12, padding: '8px 10px', cursor: 'pointer', position: 'relative',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {IconComp ? <IconComp color={iconColor} /> : null}
                    </span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--text2)' }}>{tab.label}</span>
                    {tab.key === '/chat' && chatUnreadCount > 0 && (
                      <span style={{
                        position: 'absolute', top: 2, right: 2,
                        width: 14, height: 14, borderRadius: '50%',
                        background: 'var(--red)', color: '#fff',
                        fontSize: 8, fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{chatUnreadCount > 9 ? '9+' : chatUnreadCount}</span>
                    )}
                  </button>
                )
              })}

              {/* Divider */}
              <div style={{ width: 32, height: 1, background: 'var(--border)' }} />

              {/* Action buttons vertical */}
              <button onClick={() => setShowNotifs(!showNotifs)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 10, position: 'relative',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadNotifCount > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: 'var(--red)', color: '#fff', borderRadius: 8, fontSize: 8, fontWeight: 800, padding: '0 4px', lineHeight: '14px' }}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>
                )}
              </button>

              <button onClick={() => !calLoading && loadCalendars()} style={{
                background: 'none', border: 'none', cursor: calLoading ? 'wait' : 'pointer', padding: 8, borderRadius: 10, opacity: calLoading ? 0.5 : 1,
              }}>
                {calLoading ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                )}
              </button>

              {/* Spacer to push circle pills to bottom */}
              <div style={{ flex: 1 }} />

              {/* Circle pills vertical */}
              {circles.map(c => (
                <button key={c.id} onClick={() => setActiveCircle(c)} style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: activeCircle?.id === c.id ? 'var(--accent)' : 'var(--surface2)',
                  color: activeCircle?.id === c.id ? '#fff' : 'var(--text)',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }} title={c.name}>
                  {c.emoji}
                </button>
              ))}
            </>
          ) : (
          <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              onClick={() => router.push(`/profile/${currentUser.id}`)}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: currentUser.color, color: txtOn(currentUser.color),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 800, position: 'relative', overflow: 'hidden',
              }}>
                {currentUser.name[0]}
                {currentUser.avatar_url && (
                  <img
                    src={currentUser.avatar_url}
                    alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
              </div>
              <div>
                <p style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1 }}>
                  Pact<span style={{ color: 'var(--accent)' }}>.</span>
                </p>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                  plans that actually happen
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

              {/* Settings gear */}
              <button
                onClick={() => router.push('/settings')}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  cursor: 'pointer', padding: '6px 8px', borderRadius: 20,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Row 2: Circle name + avatars — single tap opens unified panel */}
          <button
            onClick={() => activeCircle ? setShowCirclePanel(!showCirclePanel) : router.push('/circles/new')}
            style={{
              marginTop: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            {activeCircle ? (
              <>
                <span style={{
                  color: 'var(--text2)', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ fontSize: 15 }}>{activeCircle.emoji}</span>
                  {activeCircle.name} · {circleMembers.length}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                    {showCirclePanel ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                  </svg>
                </span>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  {circleMembers.slice(0, 6).map((m, i) => {
                    const mOnline = m.last_seen_at && (Date.now() - new Date(m.last_seen_at).getTime()) < 5 * 60 * 1000
                    return (
                    <span key={m.id} style={{ position: 'relative', marginLeft: i > 0 ? -8 : 0 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: m.color, color: txtOn(m.color),
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700,
                        border: '2px solid var(--bg)',
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
                      {mOnline && (
                        <span style={{
                          position: 'absolute', bottom: 0, right: 0,
                          width: 8, height: 8, borderRadius: '50%',
                          background: '#34d399', border: '1.5px solid var(--bg)',
                          zIndex: 2,
                        }} />
                      )}
                    </span>
                    )
                  })}
                  {circleMembers.length > 6 && (
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, border: '2px solid var(--bg)', marginLeft: -8,
                    }}>+{circleMembers.length - 6}</span>
                  )}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>No circles yet — tap to create one</span>
            )}
          </button>
          </>
          )}
        </header>

        {/* Circle panel — bottom sheet */}
        {showCirclePanel && activeCircle && typeof document !== 'undefined' && createPortal(
          <>
          <div onClick={() => setShowCirclePanel(false)} style={{
            position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.45)',
          }} />
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
            background: 'var(--surface)', borderRadius: '20px 20px 0 0',
            maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 30px rgba(0,0,0,0.3)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}>
            {/* Drag handle */}
            <div style={{ padding: '10px 0 6px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
            </div>

            {/* Circle tabs — horizontal scroll for switching circles */}
            {circles.length > 1 && (
              <div style={{
                display: 'flex', gap: 6, padding: '0 16px 10px',
                overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexShrink: 0,
              }}>
                {orderedCircles.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCircle(c)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                      padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                      border: activeCircle.id === c.id ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      background: activeCircle.id === c.id ? 'var(--accent-soft)' : 'var(--surface2)',
                      color: activeCircle.id === c.id ? 'var(--accent)' : 'var(--text2)',
                      fontSize: 13, fontWeight: 700,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{c.emoji}</span>
                    {c.name}
                  </button>
                ))}
                <button
                  onClick={() => { setShowCirclePanel(false); router.push('/circles/new') }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                    padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                    border: '1px dashed var(--border)', background: 'transparent',
                    color: 'var(--text2)', fontSize: 13, fontWeight: 600,
                  }}
                >
                  + New
                </button>
              </div>
            )}

            {/* Active circle header */}
            <div style={{
              padding: '8px 16px 10px', borderTop: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{activeCircle.emoji}</span>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 800 }}>{activeCircle.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--text2)' }}>{circleMembers.length} members</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={async () => {
                    const link = `${window.location.origin}/join/${activeCircle.invite_code}`
                    try {
                      await navigator.clipboard.writeText(link)
                      showAppToast('✓ Invite link copied!')
                    } catch {
                      // Fallback for browsers that block clipboard
                      const ta = document.createElement('textarea')
                      ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0'
                      document.body.appendChild(ta); ta.select()
                      document.execCommand('copy')
                      document.body.removeChild(ta)
                      showAppToast('✓ Invite link copied!')
                    }
                  }}
                  title="Copy invite link"
                  style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '7px 9px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </button>
                <button
                  onClick={() => { setShowCirclePanel(false); router.push(`/circles/${activeCircle.id}/settings`) }}
                  title="Circle settings"
                  style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '7px 9px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Members list — scrollable */}
            <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, padding: '0 16px' }}>
              {circleMembers.map((m, i) => {
                const isMe = m.id === user.id
                const hasLocation = m.live_area && m.live_updated_at
                const locAge = hasLocation ? Math.floor((Date.now() - new Date(m.live_updated_at!).getTime()) / 60000) : null
                const locLabel = locAge !== null ? (
                  locAge < 1 ? 'now'
                  : locAge < 60 ? `${locAge}m ago`
                  : locAge < 1440 ? `${Math.floor(locAge/60)}h ago`
                  : `${Math.floor(locAge/1440)}d ago`
                ) : null
                const isOnline = m.last_seen_at ? (Date.now() - new Date(m.last_seen_at).getTime()) < 5 * 60 * 1000 : false
                return (
                  <div
                    key={m.id}
                    onClick={() => { setShowCirclePanel(false); router.push(`/profile/${m.id}`) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 0', cursor: 'pointer',
                      borderBottom: i < circleMembers.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div className="avatar" style={{
                        width: 36, height: 36, fontSize: 14,
                        background: m.color, color: txtOn(m.color),
                        position: 'relative', overflow: 'hidden',
                      }}>
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
                          position: 'absolute', bottom: 0, right: 0,
                          width: 10, height: 10, borderRadius: '50%',
                          background: '#8BB07E', border: '2px solid var(--surface)',
                        }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                          {m.name}{isMe ? ' (you)' : ''}
                        </span>
                        {isOnline && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: '#8BB07E',
                            background: 'rgba(139,176,126,0.15)', padding: '1px 6px', borderRadius: 8,
                          }}>online</span>
                        )}
                      </div>
                      {hasLocation && locAge !== null && locAge < 10080 && (
                        <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          {m.live_area} · {locLabel}
                        </p>
                      )}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.4 }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                )
              })}
            </div>

            {/* Footer — single circle: show new circle button */}
            {circles.length <= 1 && (
              <div style={{
                padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0,
              }}>
                <button
                  onClick={() => { setShowCirclePanel(false); router.push('/circles/new') }}
                  style={{
                    width: '100%', fontSize: 13, fontWeight: 700,
                    color: 'var(--accent)', background: 'var(--accent-soft)', border: 'none',
                    borderRadius: 12, padding: '10px 0', cursor: 'pointer',
                  }}
                >
                  + Create or join a circle
                </button>
              </div>
            )}
          </div>
          </>,
          document.body
        )}

        {/* Theme picker dropdown — portal */}
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

        {/* Bottom nav — hidden in landscape (nav is in sidebar) */}
        <nav className="bottom-nav" style={isLandscape ? { display: 'none' } : {}}>
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
                style={{
                  marginTop: 12, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {selectedCals.length > 0 ? 'Save & sync' : 'Save (no calendars shared)'}
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
      {/* Welcome flow for new users */}
      {showWelcomeFlow && welcomeStep && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface2)', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            width: '100%', maxWidth: 440,
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />

            {welcomeStep === 'location' && (
              <>
                <div style={{ marginBottom: 8 }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
                <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Enable location?</p>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                  This lets Pact calculate travel times from where you actually are, and detect when you&apos;re near a friend with shared free time (Sparks). Without it, travel times use your home area instead — still works, just less accurate.
                </p>
                <button onClick={welcomeAllowLocation} style={{
                  width: '100%', padding: 14, border: 'none', borderRadius: 14,
                  background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Allow location
                </button>
                <button onClick={() => { localStorage.setItem('pact_loc_asked', '1'); welcomeNext() }} style={{
                  width: '100%', padding: 12, border: 'none', borderRadius: 12, marginTop: 8,
                  background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                  Skip for now
                </button>
              </>
            )}

            {welcomeStep === 'notifications' && (
              <>
                <div style={{ marginBottom: 8 }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
                <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Turn on notifications?</p>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                  Get alerted when friends message you, make plans, or when a Spark detects you&apos;re near someone free. Without this, you&apos;ll only see updates when you open the app.
                </p>
                <button onClick={welcomeAllowNotifications} style={{
                  width: '100%', padding: 14, border: 'none', borderRadius: 14,
                  background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Turn on notifications
                </button>
                <button onClick={welcomeNext} style={{
                  width: '100%', padding: 12, border: 'none', borderRadius: 12, marginTop: 8,
                  background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                  Not now
                </button>
              </>
            )}

            {welcomeStep === 'homescreen' && (
              <>
                <div style={{ marginBottom: 8 }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div>
                <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Add Pact to your home screen</p>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                  This makes Pact open full-screen like a native app, load faster, and is required for push notifications on iOS.
                </p>
                {/iPad|iPhone|iPod/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '') ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>1.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Tap the <b>share button</b> ↑ at the bottom of Safari</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>2.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Scroll down and tap <b>&quot;Add to Home Screen&quot;</b></span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>3.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b>&quot;Add&quot;</b> — Pact appears on your home screen</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>1.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Tap the <b>three-dot menu ⋮</b> in your browser</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>2.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b>&quot;Add to Home Screen&quot;</b> or <b>&quot;Install app&quot;</b></span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' }}>3.</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b>&quot;Install&quot;</b> to confirm</span>
                    </div>
                  </div>
                )}
                <button onClick={welcomeDone} style={{
                  width: '100%', padding: 14, border: 'none', borderRadius: 14,
                  background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Got it
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
      {/* App-level toast — positioned above middle */}
      {appToast && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: '38%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)',
          padding: '10px 18px', borderRadius: 24, fontSize: 13, fontWeight: 600, zIndex: 10001,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          animation: 'toast-in 0.2s ease-out',
        }}>{appToast}</div>,
        document.body
      )}
    </CircleContext.Provider>
  )
}
