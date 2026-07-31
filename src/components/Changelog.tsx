'use client'

import { useState, useEffect } from 'react'

// Increment this version string each time you deploy a batch of fixes/features
const CURRENT_VERSION = '18.0'

const CHANGELOG = [
  {
    version: '18.0',
    date: 'August 1, 2026',
    title: 'Commitment, Notifications & Background Sync',
    items: [
      'Slide to lock in — committing to a pact now requires an intentional swipe gesture, both in Plans and in Chat',
      'Can\'t make it — decline pacts with a tap, everyone in the pact gets notified',
      'Full notification flow — every pact action (create, join, decline, break) notifies all members via push + in-app',
      'Background sync — calendars sync every 2 hours even when you\'re offline, so availability stays accurate',
      'Settings page — consolidated calendar, permissions, theme, and account settings in one place',
      'SVG icons — replaced all system emojis with consistent icons across the app',
      'Extended hours — calendar and pact times now go up to 2:00 AM for night owls',
      '30-minute time slots — pick 7:30 PM, 10:30 PM, etc. when creating pacts',
      'Spark improvements — situation-based dismissals, 15-min cap, persistent across refresh',
    ],
  },
  {
    version: '17.0',
    date: 'July 31, 2026',
    title: 'Push Notifications + Pact Commitment',
    items: [
      '🔔 Push notifications — get alerted when friends message you or make plans (works on Android Chrome & iOS Home Screen)',
      '🤝 Slide-to-confirm — creating a pact now feels intentional with a swipe gesture',
      '💔 Hold-to-break — leaving a pact takes 2 seconds of holding, and everyone gets notified',
      '📌 Expandable pact cards — tap to see full member list, RSVP status, and send-to-chat',
      '📅 Calendar only shows this week\'s pacts above sparks (full list in Plans tab)',
      '🔐 Calendar auth now happens before profile setup — blocked users see a clear message',
      '🎨 Logo fix — "Pact." renders consistently everywhere',
    ],
  },
  {
    version: '16.0',
    date: 'July 30, 2026',
    title: 'Add Friends to Circles',
    items: [
      '👥 Add friends from your other circles when creating a new circle',
      '👥 Add members to existing circles from circle settings',
      '📍 Home area now geocoded via Google for accurate travel times',
      '📍 Smarter origin priority — live GPS used more often',
    ],
  },
  {
    version: '15.0',
    date: 'July 30, 2026',
    title: 'Smarter Travel Times + Sidebar',
    items: [
      '📍 Travel times now use real GPS — accurate for any place',
      '📅 Calendar event locations used as travel origins',
      '🌐 Landscape: header becomes a compact sidebar on the left',
      '👥 Friends in the same spot now show matching travel times',
    ],
  },
  {
    version: '14.0',
    date: 'July 30, 2026',
    title: 'Spot Search + Calendar Overrides',
    items: [
      '🔎 Search any place in the day view — see travel time from each friend',
      '📅 Override busy calendar blocks — tap to mark free (green with red border)',
      '📱 Landscape mode now fills the full screen',
      '📍 Spots page cleaned up — just search and favorites',
    ],
  },
  {
    version: '13.0',
    date: 'July 30, 2026',
    title: 'Who\'s Free + Landscape View',
    items: [
      '👀 "Who\'s free?" — see each friend\'s next mutual free window at a glance',
      '⚡ Sparks are now compact 1-line cards with inline "Propose" button',
      '📍 Spot suggestions show 3 at a time — tap to highlight, "Show more" to expand',
      '📱 Landscape mode — turn your phone sideways for calendar + day view side by side',
      '📍 Location updates instantly when you open the app',
    ],
  },
  {
    version: '12.0',
    date: 'July 29, 2026',
    title: 'Presence + Smarter Spots',
    items: [
      '🟢 Online indicator — see who\'s active in your circle right now',
      '📍 Spot recommendations now use your live location instead of always saying "from home"',
      '🔄 Circle reordering — long-press arrows to arrange your circles',
      '📅 Calendar syncs 3 months ahead for better long-term planning',
      '💬 Cross-circle DMs now show correct profile photos',
      '🗑️ Delete proposed hangout messages with long-press',
      '⏳ Calendar loading indicator when fetching your calendars',
    ],
  },
  {
    version: '11.0',
    date: 'July 29, 2026',
    title: 'Better Calendar + Spark Cards',
    items: [
      '📅 Calendar view now shows 8am–12mn for bigger, easier-to-tap hour blocks',
      '⚡ Sparks are now stacked cards — swipe left to dismiss',
      '🗓️ "My calendars" button works from any tab — reconnect easily if your token expires',
      '🎨 Cleaner header layout matching the original Pact design',
      '📍 Spot recommendations now include cafes, activities, coworking, parks, bars, and more',
      '📍 Real-time location now shows for up to 7 days',
    ],
  },
  {
    version: '10.0',
    date: 'July 23, 2026',
    title: 'Plan Creation + UI Polish',
    items: [
      '✅ Select who you\'re making a pact with — tap members to include or exclude',
      '👥 Member list now pops out as an overlay instead of pushing the header down',
      '🏠 Cleaned up profile — removed redundant home address section',
    ],
  },
  {
    version: '9.0',
    date: 'July 23, 2026',
    title: 'Smarter Location + Quality of Life',
    items: [
      '📍 Location search now uses Google Places — way more accurate addresses everywhere',
      '🔐 Streamlined sign-in — Google-only login that auto-connects your calendar',
      '🏠 Home area visibility toggle — choose to show or hide from circle mates',
      '🔗 Invite links now work seamlessly for existing users',
      '📌 Location permission no longer re-prompts every time you open the app',
      '🟢 Online status indicator — see who\'s currently active in your circle',
      '🔔 Clear individual or all notifications at once',
      '⚡ Sparks improvements — see all nearby matches, dismissed ones come back',
      '⭐ Favorite spots can now be private or shared with your group',
      '💡 Update your home area in your profile for better travel time estimates!',
    ],
  },
  {
    version: '7.0',
    date: 'July 18, 2026',
    title: 'Dashboard Redesign + Bug Fixes',
    items: [
      '📅 Merged Home & Calendar into one Dashboard — see your pacts and calendar at a glance',
      '⚡ Sparks are now automatic — no more pressing a button, we detect nearby free friends for you',
      '👤 New header layout — your profile on the left with a personalized greeting',
      '🔔 Chat notification badge — see unread chats at a glance',
      '💬 Fixed chat messages not showing up in realtime',
      '📍 Fixed location suggestions when creating plans',
      '📆 Fixed calendar showing busy when nothing is scheduled',
      '👆 Fixed long press reactions and swipe-to-reply in chat',
      '😀 Added custom emoji reactions via emoji keyboard',
      '📌 Circle name now expands to show members list',
    ],
  },
]

export default function Changelog() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem('pact_changelog_seen')
    if (seen !== CURRENT_VERSION) {
      // Small delay so the main UI loads first
      const t = setTimeout(() => setShow(true), 1200)
      return () => clearTimeout(t)
    }
  }, [])

  function dismiss() {
    localStorage.setItem('pact_changelog_seen', CURRENT_VERSION)
    setShow(false)
  }

  if (!show) return null

  const current = CHANGELOG.find(c => c.version === CURRENT_VERSION)
  if (!current) return null

  return (
    <>
      <div onClick={dismiss} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 10000,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '24px 20px 20px', width: '88%', maxWidth: 360,
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 16px 50px rgba(0,0,0,0.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <p style={{ fontSize: 32, marginBottom: 6 }}>✨</p>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>{current.title}</h2>
          <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
            v{current.version} · {current.date}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {current.items.map((item, i) => (
            <div key={i} style={{
              fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
              padding: '6px 0',
              borderBottom: i < current.items.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              {item}
            </div>
          ))}
        </div>

        <button
          onClick={dismiss}
          style={{
            marginTop: 18, width: '100%', padding: 14, border: 'none', borderRadius: 14,
            background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Got it!
        </button>
      </div>
    </>
  )
}
