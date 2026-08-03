'use client'

import { useState, useEffect } from 'react'

const STEPS = [
  {
    title: 'Your circles',
    body: 'Switch between friend groups here. Each circle has its own calendar, chat, and plans.',
    position: 'bottom' as const,
  },
  {
    title: 'Circle details',
    body: 'Tap the active circle again to see members, invite friends, and access circle settings.',
    position: 'bottom' as const,
  },
  {
    title: 'Calendar',
    body: 'See when your circle is free. Tap any day for the full schedule and to propose a plan.',
    position: 'top' as const,
  },
  {
    title: 'Notifications',
    body: 'Friend requests, pact updates, and sparks all show up here.',
    position: 'bottom' as const,
  },
  {
    title: 'Friends',
    body: 'Add friends by their username. They\'ll get a notification to confirm.',
    position: 'bottom' as const,
  },
  {
    title: 'Your profile',
    body: 'Your profile, settings, calendar connection, and appearance — all in one place.',
    position: 'bottom' as const,
  },
  {
    title: 'Navigation',
    body: 'Calendar, Chat, Plans, and Spots. Everything you need is down here.',
    position: 'top' as const,
  },
]

export default function Walkthrough() {
  const [step, setStep] = useState(-1) // -1 = not showing
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Auto-start for first-time users
    const seen = localStorage.getItem('pact_walkthrough_seen')
    if (!seen) {
      const t = setTimeout(() => { setStep(0); setShow(true) }, 1500)
      return () => clearTimeout(t)
    }

    // Manual trigger from settings
    const handler = () => { setStep(0); setShow(true) }
    window.addEventListener('pact-start-walkthrough', handler)
    return () => window.removeEventListener('pact-start-walkthrough', handler)
  }, [])

  function next() {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      dismiss()
    }
  }

  function dismiss() {
    localStorage.setItem('pact_walkthrough_seen', '1')
    setShow(false)
    setStep(-1)
  }

  if (!show || step < 0) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1
  const isTop = s.position === 'top'

  return (
    <>
      {/* Overlay */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        zIndex: 9990, transition: 'opacity .2s',
      }} onClick={dismiss} />

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        left: '50%', transform: 'translateX(-50%)',
        ...(isTop
          ? { bottom: 90 }
          : { top: step <= 1 ? 110 : 70 }
        ),
        zIndex: 9991,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '20px 18px 16px',
        width: '85%', maxWidth: 320,
        boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Step indicator */}
        <div style={{
          display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 14,
        }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : 'var(--border)',
              transition: 'all .2s',
            }} />
          ))}
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{s.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{s.body}</p>

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
            {isLast ? 'Done' : `Next (${step + 1}/${STEPS.length})`}
          </button>
        </div>
      </div>
    </>
  )
}
