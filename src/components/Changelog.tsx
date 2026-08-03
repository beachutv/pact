'use client'

import { useState, useEffect } from 'react'

// Increment this version string each time you deploy a batch of fixes/features
export const CURRENT_VERSION = '5.0'

const CHANGELOG = [
  {
    version: '5.0',
    date: 'August 3, 2026',
    title: 'Friends, Usernames & Circle Privacy',
    items: [
      'Usernames — set a @username so friends can find and add you',
      'Friend list — add friends by username, accept/decline requests with notifications',
      'Friend profiles — add/remove friend button on any profile, see friendship status',
      'Public & private circles — public circles are searchable, private circles require an invite code',
      'Circle join modes — open circles let anyone join instantly, approval circles require admin approval',
      'Browse public circles — search and join open circles from the circles page',
      'Join requests — admins see pending requests and can approve or reject',
      'Username editing — change your username anytime from your profile',
    ],
  },
  {
    version: '4.0',
    date: 'August 1, 2026',
    title: 'Circles, Declines & Calendar Fixes',
    items: [
      'Birthday notifications — get reminded 2 weeks ahead, tap to see shared circles and plan',
      'Shared circles on profiles — see which circles you have in common, tap to plan',
      'Sign out is now device-only — no longer signs you out everywhere',
      'Custom invite codes — admins can set a memorable code in circle settings',
      'Pact declines are now visible — red ✕ and "out" counter on pact cards',
      'Birthdays now show on the calendar with 🎂 badges and red borders',
      'All-day calendar events now properly block through 2 AM',
      'Invite link copy button now shows confirmation + works in all browsers',
      'Invalid invite links show a clear error page',
    ],
  },
  {
    version: '3.0',
    date: 'August 1, 2026',
    title: 'Privacy, Polish & Settings',
    items: [
      'Calendar privacy fix — deselecting all calendars now properly hides your availability',
      'Save button always enabled — you can now save with zero calendars selected to opt out',
      'Calendar ID mismatch fix — selected calendars now display correctly in the modal',
      'Privacy policy page — added back button, uses app theme, fixed cut-off title',
      'Logo consistency — "Pact." renders correctly across all pages',
      '"What\'s new?" button added to settings',
    ],
  },
  {
    version: '2.0',
    date: 'August 1, 2026',
    title: 'Push Notifications & Commitment',
    items: [
      'Slide to lock in — committing to a pact now requires an intentional swipe gesture, both in Plans and in Chat',
      'Can\'t make it — decline pacts with a tap, everyone in the pact gets notified',
      'Full notification flow — every pact action (create, join, decline, break) notifies all members via push + in-app',
      'Background sync — calendars auto-sync daily so availability stays accurate',
      'Settings page — consolidated calendar, permissions, theme, and account settings in one place',
      'SVG icons — replaced all system emojis with consistent icons across the app',
      'Extended hours — calendar and pact times now go up to 2:00 AM for night owls',
      '30-minute time slots — pick 7:30 PM, 10:30 PM, etc. when creating pacts',
      'Spark improvements — situation-based dismissals, 15-min cap, persistent across refresh',
    ],
  },
  {
    version: '1.0',
    date: 'July 31, 2026',
    title: 'Pact Launch',
    items: [
      'Google Calendar sync — see when your friends are free without sharing event details',
      'Circles — create friend groups with invite links and codes',
      'Chat — group and private threads with date card proposals',
      'Plans — propose, RSVP, slide-to-confirm, hold-to-break',
      'Sparks — automatic detection of nearby free friends',
      'Spot recommendations — picks based on where everyone is coming from',
      'Push notifications — get alerted for messages, pacts, and sparks',
      'Who\'s Free — next mutual window at a glance',
      'Live location tracking for accurate travel times',
      'Online presence indicators',
      'Landscape mode support',
      'Dark, light, and system themes',
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
      // Also fire a custom event so AppShell can insert a notification
      const notifKey = `pact_changelog_notif_${CURRENT_VERSION}`
      if (!localStorage.getItem(notifKey)) {
        localStorage.setItem(notifKey, '1')
        window.dispatchEvent(new CustomEvent('pact-new-version', { detail: { version: CURRENT_VERSION } }))
      }
      return () => clearTimeout(t)
    }
    // Listen for manual open from settings
    const handler = () => setShow(true)
    window.addEventListener('pact-open-changelog', handler)
    return () => window.removeEventListener('pact-open-changelog', handler)
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
