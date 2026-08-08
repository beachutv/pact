'use client'

import { useState, useEffect } from 'react'

export const CURRENT_VERSION = '8.1'

type ChangeItem = { icon: string; text: string }

const CHANGELOG: { version: string; date: string; title: string; subtitle: string; items: ChangeItem[] }[] = [
  {
    version: '8.1',
    date: 'August 8, 2026',
    title: 'Polish & cleanup',
    subtitle: 'The details that make it feel right',
    items: [
      { icon: '✨', text: 'Pact. logo in the header — tap it to go home' },
      { icon: '📅', text: 'Availability step in plan wizard — see who is free before confirming' },
      { icon: '🎉', text: 'Celebration screen after creating a plan' },
      { icon: '👥', text: 'Friends tab restored to navigation' },
      { icon: '🌙', text: 'Quick theme toggle in the header' },
      { icon: '📆', text: 'Visibility window setting — control how far ahead friends see your schedule' },
      { icon: '🧹', text: 'Removed old calendar grid and chat features — leaner and faster' },
    ],
  },
  {
    version: '8.0',
    date: 'August 8, 2026',
    title: 'The big reimagine',
    subtitle: 'Willingness first, logistics second',
    items: [
      { icon: '🏠', text: 'New home screen — greeting, rotating prompts, and a big "Plan something" button' },
      { icon: '✨', text: 'Multi-step plan wizard — pick a date or find a time, invite friends, set details, slide to confirm' },
      { icon: '📅', text: 'Built-in date picker — no more jumping between tabs to pick a day' },
      { icon: '🔗', text: 'Share plan links — drop a link in your group chat, friends on Pact join instantly' },
      { icon: '😴', text: 'Take a break — pause availability so friends know not to expect you' },
      { icon: '🧭', text: 'Simplified navigation — 3 tabs (Home, Plans, You) instead of 5' },
      { icon: '🧹', text: 'Calendar grid, built-in chat, spots, and sparks removed — the app is leaner and more focused' },
    ],
  },
  {
    version: '7.0',
    date: 'August 7, 2026',
    title: 'Sparks on your terms',
    subtitle: 'New controls for when you want to be found',
    items: [
      { icon: '⚡', text: 'Pause Sparks — opt out for 1 hour, 4 hours, until tomorrow, 1 week, or indefinitely' },
      { icon: '🙈', text: 'When paused, you won\'t see sparks and nobody will see sparks about you' },
      { icon: '⏰', text: 'Resume anytime from Settings — your spark toggle remembers when the pause ends' },
      { icon: '🔔', text: 'Admins now see a badge when someone\'s waiting to join their circle' },
      { icon: '❌', text: 'Cancel pending join requests you no longer want' },
      { icon: '🔧', text: 'Fixed: pending join requests now visible to admins in circle settings' },
    ],
  },
  {
    version: '6.2',
    date: 'August 6, 2026',
    title: 'Stability & polish',
    subtitle: 'Bug fixes before wider launch',
    items: [
      { icon: '🛡️', text: 'Fixed crash when opening calendar in landscape before selecting a day' },
      { icon: '📅', text: 'Overnight and multi-day events now sync correctly in background cron' },
      { icon: '🎨', text: 'Terms of Service page now matches your dark/light theme' },
      { icon: '📱', text: 'Landscape mode works in PWA home screen installs' },
      { icon: '🧹', text: 'Empty state screens when you have no circles yet (no more blank pages)' },
    ],
  },
  {
    version: '6.1',
    date: 'August 4, 2026',
    title: 'Polish & walkthrough',
    subtitle: 'Better onboarding and circle management',
    items: [
      { icon: '🔦', text: 'Spotlight walkthrough — guided tour that highlights each part of the app' },
      { icon: '◀▶', text: 'Circle reorder arrows now work in the circle panel' },
      { icon: '👆', text: 'Tap circle name in panel to open settings (not just the gear icon)' },
    ],
  },
  {
    version: '6.0',
    date: 'August 4, 2026',
    title: 'New look, new feel',
    subtitle: 'Redesigned from the ground up',
    items: [
      { icon: '🎨', text: 'Redesigned header — bold page titles, clean icon buttons, circle chips' },
      { icon: '🔔', text: 'Full-screen notifications — grouped by time, mark as read, tap to navigate' },
      { icon: '👥', text: 'Friends system — add by username, accept requests, see who\'s on Pact' },
      { icon: '🔒', text: 'Public & private circles — browse, search, request to join, or invite only' },
      { icon: '🏷️', text: 'Usernames — set an @username so friends can find you' },
      { icon: '⚙️', text: 'Settings + profile consolidated — your avatar, name, and all settings in one place' },
      { icon: '📱', text: 'WhatsApp-style navigation — familiar layout, content starts higher' },
      { icon: '🔧', text: 'Calendar sync fix — overnight events no longer break the sync' },
    ],
  },
  {
    version: '5.0',
    date: 'August 3, 2026',
    title: 'Friends & Privacy',
    subtitle: 'Social features and circle controls',
    items: [
      { icon: '👤', text: 'Usernames for finding friends' },
      { icon: '🤝', text: 'Friend requests with notifications' },
      { icon: '🌍', text: 'Public and private circles' },
      { icon: '🚪', text: 'Circle join modes — open, approval, invite' },
      { icon: '🔍', text: 'Browse and search public circles' },
    ],
  },
  {
    version: '4.0',
    date: 'August 1, 2026',
    title: 'Circles & Calendar',
    subtitle: 'Birthday tracking and invite improvements',
    items: [
      { icon: '🎂', text: 'Birthday notifications and calendar badges' },
      { icon: '🔗', text: 'Custom invite codes for circles' },
      { icon: '❌', text: 'Visible pact declines with undo' },
      { icon: '🌙', text: 'All-day events block through 2 AM' },
    ],
  },
  {
    version: '3.0',
    date: 'August 1, 2026',
    title: 'Privacy Polish',
    subtitle: 'Calendar privacy and settings cleanup',
    items: [
      { icon: '🔒', text: 'Calendar privacy — deselect all to hide availability' },
      { icon: '📄', text: 'Privacy policy page with app theme' },
    ],
  },
  {
    version: '2.0',
    date: 'August 1, 2026',
    title: 'Notifications & Commitment',
    subtitle: 'Push notifications and pact gestures',
    items: [
      { icon: '🔔', text: 'Full push notification flow' },
      { icon: '👆', text: 'Slide to lock in, hold to break pacts' },
      { icon: '⏰', text: 'Extended hours to 2 AM and 30-min slots' },
      { icon: '⚡', text: 'Improved sparks with smart dismissal' },
    ],
  },
  {
    version: '1.0',
    date: 'July 31, 2026',
    title: 'Pact Launch',
    subtitle: 'The beginning',
    items: [
      { icon: '📅', text: 'Google Calendar sync' },
      { icon: '💬', text: 'Group and private chat with date cards' },
      { icon: '📌', text: 'Plans with RSVP and confirmations' },
      { icon: '📍', text: 'Smart spot recommendations' },
      { icon: '⚡', text: 'Sparks — find nearby free friends' },
    ],
  },
]

export default function Changelog() {
  const [show, setShow] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem('pact_changelog_seen')
    if (seen !== CURRENT_VERSION) {
      const t = setTimeout(() => setShow(true), 1200)
      const notifKey = `pact_changelog_notif_${CURRENT_VERSION}`
      if (!localStorage.getItem(notifKey)) {
        localStorage.setItem(notifKey, '1')
        window.dispatchEvent(new CustomEvent('pact-new-version', { detail: { version: CURRENT_VERSION } }))
      }
      return () => clearTimeout(t)
    }
    const handler = () => { setShowAll(true); setShow(true) }
    window.addEventListener('pact-open-changelog', handler)
    return () => window.removeEventListener('pact-open-changelog', handler)
  }, [])

  function dismiss() {
    localStorage.setItem('pact_changelog_seen', CURRENT_VERSION)
    setShow(false)
    setShowAll(false)
  }

  if (!show) return null

  const entries = showAll ? CHANGELOG : CHANGELOG.slice(0, 1)

  return (
    <>
      <div onClick={dismiss} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 10000,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '24px 20px 20px', width: '88%', maxWidth: 360,
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 16px 50px rgba(0,0,0,0.4)',
      }}>
        {entries.map((entry, ei) => (
          <div key={entry.version} style={{ marginBottom: ei < entries.length - 1 ? 24 : 0 }}>
            {ei === 0 && !showAll && (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <p style={{ fontSize: 36, marginBottom: 4 }}>✨</p>
                <h2 style={{ fontSize: 20, fontWeight: 800 }}>{entry.title}</h2>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  {entry.subtitle} · v{entry.version}
                </p>
              </div>
            )}
            {(ei > 0 || showAll) && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800 }}>{entry.title}</h3>
                  <span style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 600 }}>v{entry.version}</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{entry.subtitle}</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {entry.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '7px 0',
                  borderBottom: i < entry.items.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, width: 22, textAlign: 'center' }}>
                    {item.icon}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text)' }}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {!showAll && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                flex: 1, padding: 12, border: '1px solid var(--border)', borderRadius: 14,
                background: 'var(--surface2)', color: 'var(--text2)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              All updates
            </button>
          )}
          <button
            onClick={dismiss}
            style={{
              flex: 2, padding: 12, border: 'none', borderRadius: 14,
              background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </>
  )
}
