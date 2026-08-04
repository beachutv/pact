'use client'

import { useState, useEffect, useCallback } from 'react'

type Step = {
  title: string
  body: string
  emoji: string
  target: string          // data-walkthrough="..." selector
  position: 'below' | 'above' | 'auto'
}

const STEPS: Step[] = [
  {
    emoji: '🔵',
    title: 'Your circles',
    body: 'These are your friend groups. Tap to switch — the calendar, chat, and plans all follow. Tap the active one to see members and settings.',
    target: 'circle-chips',
    position: 'below',
  },
  {
    emoji: '💬',
    title: 'Chat & notifications',
    body: 'The chat bubble is for messages — group threads and DMs. The bell is for notifications like friend requests, pact updates, and sparks.',
    target: 'header-actions',
    position: 'below',
  },
  {
    emoji: '📅',
    title: 'Your calendar',
    body: 'Green days mean your circle is free. Tap any day to see the full hour-by-hour breakdown, pick a time, and propose a plan.',
    target: 'nav-calendar',
    position: 'above',
  },
  {
    emoji: '📌',
    title: 'Plans & Spots',
    body: 'Plans shows your locked-in pacts. Spots shows the best hangout windows with location picks based on where everyone\'s coming from.',
    target: 'nav-plans',
    position: 'above',
  },
  {
    emoji: '👥',
    title: 'Friends',
    body: 'Add friends by their @username. Once connected, add each other to circles and plan together.',
    target: 'nav-friends',
    position: 'above',
  },
  {
    emoji: '👤',
    title: 'Your profile',
    body: 'Calendar connection, appearance, account settings — everything in one place.',
    target: 'nav-you',
    position: 'above',
  },
]

export default function Walkthrough() {
  const [step, setStep] = useState(-1)
  const [show, setShow] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Find and measure the target element for the current step
  const measureTarget = useCallback(() => {
    if (step < 0 || step >= STEPS.length) { setRect(null); return }
    const el = document.querySelector(`[data-walkthrough="${STEPS[step].target}"]`)
    if (el) {
      setRect(el.getBoundingClientRect())
    } else {
      setRect(null)
    }
  }, [step])

  useEffect(() => {
    measureTarget()
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)
    return () => {
      window.removeEventListener('resize', measureTarget)
      window.removeEventListener('scroll', measureTarget, true)
    }
  }, [measureTarget])

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
    setRect(null)
  }

  if (!show || step < 0) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1
  const pad = 6 // padding around highlighted element

  // Determine tooltip position
  const viewH = typeof window !== 'undefined' ? window.innerHeight : 800
  let tooltipTop = 0
  let tooltipBelow = true
  if (rect) {
    const spaceBelow = viewH - rect.bottom
    const spaceAbove = rect.top
    if (s.position === 'above' || (s.position === 'auto' && spaceBelow < 220 && spaceAbove > spaceBelow)) {
      tooltipBelow = false
      tooltipTop = rect.top - pad - 12 // 12px gap
    } else {
      tooltipTop = rect.bottom + pad + 12
    }
  }

  // SVG mask: full viewport with a rounded-rect cutout for the target element
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <svg
        onClick={dismiss}
        style={{ position: 'fixed', inset: 0, zIndex: 9990, width: '100%', height: '100%' }}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
      >
        <defs>
          <mask id="wt-mask">
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            {rect && (
              <rect
                x={rect.left - pad}
                y={rect.top - pad}
                width={rect.width + pad * 2}
                height={rect.height + pad * 2}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width={vw} height={vh} fill="rgba(0,0,0,0.72)" mask="url(#wt-mask)" />
      </svg>

      {/* Spotlight border glow around target */}
      {rect && (
        <div style={{
          position: 'fixed',
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          borderRadius: 12,
          border: '2px solid var(--accent)',
          boxShadow: '0 0 16px rgba(124,92,255,0.45)',
          zIndex: 9991,
          pointerEvents: 'none',
          transition: 'all .25s ease-out',
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        left: '50%',
        transform: tooltipBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
        top: tooltipTop,
        zIndex: 9992,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '20px 18px 16px',
        width: '88%',
        maxWidth: 340,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        transition: 'top .25s ease-out',
      }}>
        {/* Arrow pointing to target */}
        <div style={{
          position: 'absolute',
          left: rect ? Math.min(Math.max(rect.left + rect.width / 2 - 8, 20), 300) : '50%',
          ...(tooltipBelow
            ? { top: -8, transform: 'translateX(-50%)' }
            : { bottom: -8, transform: 'translateX(-50%) rotate(180deg)' }),
          width: 0, height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderBottom: '8px solid var(--surface)',
          filter: 'drop-shadow(0 -1px 0 var(--border))',
          zIndex: 1,
        }} />

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 12 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : i < step ? 'var(--green)' : 'var(--border)',
              transition: 'all .2s',
            }} />
          ))}
        </div>

        {/* Emoji + content */}
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 30 }}>{s.emoji}</span>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 800, textAlign: 'center', marginBottom: 6 }}>{s.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, textAlign: 'center' }}>{s.body}</p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {step > 0 ? (
            <button onClick={prev} style={{
              width: 42, padding: '9px 0', border: '1px solid var(--border)', borderRadius: 12,
              background: 'none', color: 'var(--text2)', fontSize: 16, cursor: 'pointer',
            }}>
              ←
            </button>
          ) : (
            <button onClick={dismiss} style={{
              flex: 1, padding: '9px 0', border: '1px solid var(--border)', borderRadius: 12,
              background: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Skip
            </button>
          )}
          <button onClick={next} style={{
            flex: 2, padding: '9px 0', border: 'none', borderRadius: 12,
            background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            {isLast ? 'Get started' : `Next (${step + 1}/${STEPS.length})`}
          </button>
        </div>
      </div>
    </>
  )
}
