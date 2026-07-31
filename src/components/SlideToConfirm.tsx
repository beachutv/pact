'use client'

import { useState, useRef } from 'react'

export default function SlideToConfirm({
  disabled,
  label,
  onConfirm,
  color = 'var(--accent)',
  height = 48,
}: {
  disabled?: boolean
  label: string
  onConfirm: () => void
  color?: string
  height?: number
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const startX = useRef(0)
  const trackWidth = useRef(0)
  const HANDLE = height - 6
  const THRESHOLD = 0.85

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || confirmed) return
    e.preventDefault()
    const track = trackRef.current
    if (!track) return
    trackWidth.current = track.getBoundingClientRect().width - HANDLE - 6
    startX.current = e.clientX
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || disabled) return
    const dx = Math.max(0, Math.min(e.clientX - startX.current, trackWidth.current))
    setDragX(dx)
  }

  function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    const pct = dragX / (trackWidth.current || 1)
    if (pct >= THRESHOLD) {
      setConfirmed(true)
      setDragX(trackWidth.current)
      try { navigator.vibrate?.(50) } catch {}
      onConfirm()
    } else {
      setDragX(0)
    }
  }

  const pct = trackWidth.current ? dragX / trackWidth.current : 0

  return (
    <div
      ref={trackRef}
      style={{
        position: 'relative', height, borderRadius: height / 2,
        background: confirmed ? 'var(--green)' : 'var(--surface2)',
        overflow: 'hidden', opacity: disabled ? 0.4 : 1,
        touchAction: 'none', userSelect: 'none',
      }}
    >
      {/* Fill track */}
      {!confirmed && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${pct * 100}%`, borderRadius: height / 2,
          background: color, opacity: 0.2,
          transition: dragging ? 'none' : 'width 0.3s cubic-bezier(.32,.72,.25,1)',
        }} />
      )}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700,
        color: confirmed ? '#fff' : 'var(--text2)',
        pointerEvents: 'none', letterSpacing: 0.3,
      }}>
        {confirmed ? '✓ Locked in!' : label}
      </div>
      {/* Shimmer hint */}
      {!confirmed && !dragging && pct === 0 && (
        <div style={{
          position: 'absolute', top: 0, left: HANDLE + 8, bottom: 0,
          display: 'flex', alignItems: 'center',
          color: 'var(--text2)', fontSize: 11, opacity: 0.5, pointerEvents: 'none',
        }}>
          {'›››'}
        </div>
      )}
      {!confirmed && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'absolute', top: 3, left: 3 + dragX,
            width: HANDLE, height: HANDLE, borderRadius: '50%',
            background: color, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, cursor: disabled ? 'default' : 'grab',
            transition: dragging ? 'none' : 'left 0.3s cubic-bezier(.32,.72,.25,1)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          →
        </div>
      )}
    </div>
  )
}
