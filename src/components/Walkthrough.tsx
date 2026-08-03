'use client'

import { useState, useEffect } from 'react'

type Step = {
  title: string
  body: string
  emoji: string
  visual?: string // optional illustration description
}

const STEPS: Step[] = [
  {
    emoji: '📅',
    title: 'Your calendar',
    body: 'Green days mean your circle is free. The times below each date (like "4p–2a") show when everyone can meet. Tap any day to see the full hour-by-hour breakdown.',
  },
  {
    emoji: '🟩',
    title: 'What the colors mean',
    body: '🟩 Green border = someone\'s free that window. ⭐ Star = everyone\'s free all day. 🟨 Yellow border = a pact is already set. 🔴 Red border = a birthday or special occasion.',
  },
  {
    emoji: '📋',
    title: 'Tap a day',
    body: 'When you tap a day, you\'ll see everyone\'s schedule hour by hour. Pick a time window, choose a spot, and propose a plan — all in one flow.',
  },
  {
    emoji: '🔵',
    title: 'Circle chips',
    body: 'These are your friend groups. Tap to switch circles — the calendar, chat, and plans all follow. Tap the active one (with the ▾) to see members and circle settings.',
  },
  {
    emoji: '💬',
    title: 'Chat & notifications',
    body: 'The chat bubble (top right) is for messages — group threads and DMs. The bell is for notifications — friend requests, pact updates, and sparks.',
  },
  {
    emoji: '👥',
    title: 'Friends',
    body: 'Add friends by their @username. Once connected, you can see each other in circles and plan together. Check the Friends tab at the bottom.',
  },
  {
    emoji: '📌',
    title: 'Plans & Spots',
    body: 'Plans shows your locked-in pacts. Spots shows the best upcoming hangout windows with location picks based on where everyone\'s coming from.',
  },
  {
    emoji: '👤',
    title: 'Your profile',
    body: 'The "You" tab has your profile, calendar connection, appearance, and account settings. Everything in one place.',
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

  function prev() {
    if (step > 0) setStep(step - 1)
  }

  function dismiss() {
    localStorage.setItem('pact_walkthrough_seen', '1')
    setShow(false)
    setStep(-1)
  }

  if (!show || step < 0) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <>
      {/* Overlay */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 9990,
      }} onClick={dismiss} />

      {/* Card */}
      <div style={{
        position: 'fixed',
        left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 9991,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '24px 20px 18px',
        width: '88%', maxWidth: 340,
        boxShadow: '0 16px 50px rgba(0,0,0,0.4)',
      }}>
        {/* Step dots */}
        <div style={{
          display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 16,
        }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : i < step ? 'var(--green)' : 'var(--border)',
              transition: 'all .2s',
            }} />
          ))}
        </div>

        {/* Emoji + content */}
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 36 }}>{s.emoji}</span>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>{s.title}</h3>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.6, textAlign: 'center' }}>{s.body}</p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {step > 0 ? (
            <button onClick={prev} style={{
              width: 44, padding: '10px 0', border: '1px solid var(--border)', borderRadius: 12,
              background: 'none', color: 'var(--text2)', fontSize: 16, cursor: 'pointer',
            }}>
              ←
            </button>
          ) : (
            <button onClick={dismiss} style={{
              flex: 1, padding: '10px 0', border: '1px solid var(--border)', borderRadius: 12,
              background: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Skip
            </button>
          )}
          <button onClick={next} style={{
            flex: 2, padding: '10px 0', border: 'none', borderRadius: 12,
            background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            {isLast ? 'Get started' : `Next (${step + 1}/${STEPS.length})`}
          </button>
        </div>
      </div>
    </>
  )
}
