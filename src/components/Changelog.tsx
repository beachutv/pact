'use client'

import { useState, useEffect } from 'react'

// Increment this version string each time you deploy a batch of fixes/features
const CURRENT_VERSION = '10.0'

const CHANGELOG = [
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
