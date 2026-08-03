'use client'

import { useState, useEffect } from 'react'

type Step = {
  title: string
  body: string
  anchor: 'top-left' | 'top-right' | 'center' | 'bottom'
  arrow?: 'up-right' | 'up-left' | 'down' | 'none'
}

const STEPS: Step[] = [
  {
    title: '👋 Welcome to Pact',
    body: 'Let\'s show you around. This takes 30 seconds.',
    anchor: 'center',
    arrow: 'none',
  },
  {
    title: '💬 Chat & 🔔 Notifications',
    body: 'These icons at the top are your inbox. Chat has your group and private messages. The bell shows friend requests, pact updates, and sparks.',
    anchor: 'top-right',
    arrow: 'up-right',
  },
  {
    title: '🍻 Your circles',
    body: 'These chips are your friend groups. Tap one to switch. Tap the active circle again (the one with ▾) to see members, invite friends, and access settings.',
    anchor: 'top-left',
    arrow: 'up-left',
  },
  {
    title: '📅 The calendar',
    body: 'Green days = your circle is free. Tap any day to see the full schedule, pick a time window, and propose a hangout. Red borders = busy. Blue = pending pact. Yellow = confirmed.',
    anchor: 'center',
    arrow: 'none',
  },
  {
    title: '⚡ Sparks',
    body: 'When you and a friend are nearby and both free, a Spark card appears at the top. Tap "Propose" to send a quick plan — just the two of you.',
    anchor: 'center',
    arrow: 'none',
  },
  {
    title: '🧭 Navigation',
    body: 'Calendar shows availability. Friends is your contact list. Plans has your locked-in hangouts. Spots finds places near everyone. "You" is your profile and settings.',
    anchor: 'bottom',
    arrow: 'down',
  },
  {
    title: '✅ You\'re all set',
    body: 'Start by syncing your Google Calendar in Settings, then invite friends to a circle. You can replay this tour anytime from You → Show me around.',
    anchor: 'center',
    arrow: 'none',
  },
]

export default function Walkthrough() {
  const [step, setStep] = useState(-1)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem('pact_walkthrough_seen')
    if (!seen) {
      const t = setTimeout(() => { setStep(0); setShow(true) }, 1500)
      return () => clearTimeout(t)
    }
    const handler = () => { setStep(0); setShow(true) }
    window.addEventListener('pact-start-walkthrough', handler)
    return () => window.removeEventListener('pact-start-walkthrough', handler)
  }, [])

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1)
    else dismiss()
  }

  function dismiss() {
    localStorage.setItem('pact_walkthrough_seen', '1')
    setShow(false)
    setStep(-1)
  }

  if (!show || step < 0) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  // Position the card based on what we're pointing at
  const cardStyle: React.CSSProperties = {
    position: 'fixed', left: '50%', transform: 'translateX(-50%)',
    zIndex: 9991,
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 20, padding: '20px 18px 16px',
    width: '88%', maxWidth: 340,
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
  }

  if (s.anchor === 'top-left' || s.anchor === 'top-right') {
    cardStyle.top = 120
  } else if (s.anchor === 'bottom') {
    cardStyle.bottom = 90
  } else {
    cardStyle.top = '50%'
    cardStyle.transform = 'translate(-50%, -50%)'
  }

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 9990,
      }} onClick={dismiss} />

      <div style={cardStyle}>
        {/* Arrow pointer */}
        {s.arrow === 'up-right' && (
          <div style={{
            position: 'absolute', top: -10, right: 40,
            width: 0, height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderBottom: '10px solid var(--surface)',
          }} />
        )}
        {s.arrow === 'up-left' && (
          <div style={{
            position: 'absolute', top: -10, left: 40,
            width: 0, height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderBottom: '10px solid var(--surface)',
          }} />
        )}
        {s.arrow === 'down' && (
          <div style={{
            position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '10px solid var(--surface)',
          }} />
        )}

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 14 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : 'var(--border)',
              transition: 'all .2s',
            }} />
          ))}
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{s.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>{s.body}</p>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={dismiss} style={{
            flex: 1, padding: '10px 0', border: '1px solid var(--border)', borderRadius: 12,
            background: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Skip
          </button>
          <button onClick={next} style={{
            flex: 2, padding: '10px 0', border: 'none', borderRadius: 12,
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            {isLast ? 'Get started' : `Next (${step + 1}/${STEPS.length})`}
          </button>
        </div>
      </div>
    </>
  )
}
