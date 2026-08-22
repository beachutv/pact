'use client'

import { useState, useEffect } from 'react'

export const CURRENT_VERSION = '10.0'

type ChangeItem = { icon: string; text: string }

const CHANGELOG: { version: string; date: string; title: string; subtitle: string; items: ChangeItem[] }[] = [
  {
    version: '10.0',
    date: 'August 22, 2026',
    title: 'Introvert mode, multi-day plans & conflict alerts',
    subtitle: 'Major update — go quiet, plan trips, and see who\'s busy',
    items: [
      { icon: '🌙', text: 'Introvert mode — single toggle to go off the grid across all circles, replacing the old break system' },
      { icon: '📅', text: 'Multi-day plans — select a date range for trips, getaways, and multi-day events' },
      { icon: '⚠️', text: 'Conflict indicators — amber and red dots on calendar dates show which friends have busy blocks' },
      { icon: '👤', text: 'Conflict callout — tapping a date with conflicts shows exactly who is busy, with names and colors' },
      { icon: '🏕️', text: 'Smart title suggestions — multi-day plans suggest trip-related titles (weekend trip, getaway, etc.)' },
      { icon: '🔒', text: 'Past plans are now read-only — you can view and comment but not edit hours or opt in/out' },
      { icon: '📋', text: 'Past tab shows dimmed cards with a PAST badge, limited to 10 with Show more' },
      { icon: '🎂', text: 'Birthday reminders persist until you dismiss them — no more disappearing on navigation' },
      { icon: '🎂', text: 'New toggle in settings to show or hide your birthday from friends' },
    ],
  },
  {
    version: '9.5',
    date: 'August 10, 2026',
    title: 'Plan anywhere, with anyone',
    subtitle: 'Plans no longer require circles — plan with any friend',
    items: [
      { icon: '🤝', text: 'Plans now work without circles — make plans with any friend, even if you don\'t share a group' },
      { icon: '🏷️', text: 'Circle association is now optional and editable — add, change, or remove a circle from any plan' },
      { icon: '📅', text: 'Calendar event titles now use your plan name directly — no more "Proposed Pact:" prefix' },
      { icon: '🔧', text: 'Fixed group availability bar showing pact time blocks as busy instead of highlighted' },
      { icon: '🖼️', text: 'Profile photos now appear on plan cards and detail views' },
      { icon: '🏷️', text: 'Circle tags now shown on plan cards so you can see which group a plan belongs to' },
    ],
  },
  {
    version: '9.4',
    date: 'August 9, 2026',
    title: 'Polish & guardrails',
    subtitle: 'Smarter scheduling, required fields, bug fixes',
    items: [
      { icon: '🟢', text: 'Date chips now show availability dots — green (mostly free), amber (some busy), red (mostly busy)' },
      { icon: '📅', text: 'Always shows 7+ days to browse when planning, not just the selected range' },
      { icon: '🚫', text: 'Hard busy hour blocks can no longer be proposed — only free or flexible slots are selectable' },
      { icon: '📝', text: 'Plan name is now required — no more empty plans' },
      { icon: '⏰', text: 'Time window is now required — must tap the group bar to set a time before proposing' },
      { icon: '📋', text: 'Plans list fixed — pacts now load correctly regardless of circle membership' },
      { icon: '🔇', text: 'Silence list corrected — silenced people can\'t see YOUR availability, not the other way around' },
    ],
  },
  {
    version: '9.3',
    date: 'August 9, 2026',
    title: 'Time votes & circle matching',
    subtitle: 'Proposed times are now voteable, circles auto-detected',
    items: [
      { icon: '🗳️', text: 'Proposed time cards are now tappable — tap to vote for a time that works for you' },
      { icon: '👥', text: 'People who propose the same time are grouped with a vote count (e.g. 3/5)' },
      { icon: '🔄', text: 'Creator can freely adjust their proposed time — no more locked blocks' },
      { icon: '🏷️', text: 'Circle auto-detect — if your invited friends match a circle, the app offers to tag it' },
      { icon: '🔒', text: 'Tagged plans are circle-scoped: only members can see or access the event' },
    ],
  },
  {
    version: '9.2',
    date: 'August 9, 2026',
    title: 'Plans, refined',
    subtitle: 'Better invites, smarter calendar bars, no forced circles',
    items: [
      { icon: '👥', text: 'Invite friends directly to an existing plan — no need to share a link' },
      { icon: '🚫', text: 'Plans no longer auto-assign a circle — two people making a plan stays simple' },
      { icon: '📌', text: 'Pact events on your calendar bar now show as teal "pact" blocks instead of red busy' },
      { icon: '🔒', text: 'Creator\'s proposed time is locked on the group bar — no accidental re-selection' },
      { icon: '📋', text: 'Proposed time summary now always shows the creator\'s time with a "(proposed)" label' },
      { icon: '📊', text: 'Group bar no longer counts this pact\'s own calendar event as "busy"' },
    ],
  },
  {
    version: '9.1',
    date: 'August 9, 2026',
    title: 'Share & Break',
    subtitle: 'Invite links work for everyone, break mode redesigned',
    items: [
      { icon: '🔗', text: 'Shareable plan invite links now work for people not yet in the circle — they see the plan preview and can join' },
      { icon: '😴', text: 'Global break is now its own section — clearly separate from per-circle availability toggles' },
      { icon: '👥', text: 'Circle availability — toggle which circles see you as free, independent of global break' },
    ],
  },
  {
    version: '9.0',
    date: 'August 8, 2026',
    title: 'Filter & Focus',
    subtitle: 'Circles filter everything, cleaner cards, break mode improved',
    items: [
      { icon: '🔍', text: 'Circle filtering — select a circle on Plans or Friends to filter by that group, or tap All to see everything' },
      { icon: '📋', text: 'Compact home cards — circle tag and status visible at a glance, tap to expand details' },
      { icon: '⏸️', text: 'Break mode now auto-disables all circle availability toggles' },
      { icon: '🔔', text: 'Circle join notifications — existing members get notified when someone new joins' },
      { icon: '🎨', text: 'Minimalist SVG icons replace emoji throughout for a cleaner look' },
      { icon: '⚙️', text: 'Settings reorganized — Visibility moved under Calendar & Permissions' },
    ],
  },
  {
    version: '8.3',
    date: 'August 8, 2026',
    title: 'Vote on plans',
    subtitle: 'Signal before you commit',
    items: [
      { icon: '🗳️', text: 'Voting on plans — tap "works", "maybe", or "can\'t" before committing' },
      { icon: '📊', text: 'Vote tally shows how many are in, maybe, or out at a glance' },
      { icon: '🕐', text: 'Past plans tab — see plans from the last 30 days' },
    ],
  },
  {
    version: '8.2',
    date: 'August 8, 2026',
    title: 'Plans, polished',
    subtitle: 'Comments, tabs, and the details that matter',
    items: [
      { icon: '💬', text: 'Comment threads on plans — discuss details right inside the plan card' },
      { icon: '📋', text: 'Plan tabs — Active, Upcoming, and Past plans organized by status' },
      { icon: '🏷️', text: 'Status badges on plan cards — see at a glance what is open vs locked' },
      { icon: '👤', text: '"Created by" line on each plan so you know who proposed it' },
      { icon: '📆', text: 'Visibility window now saves to your account (not just this device)' },
    ],
  },
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
