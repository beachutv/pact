'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, AREAS } from '@/lib/utils'

function NewPlanContent() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const params = useSearchParams()

  const date = params.get('date') || ''
  const hour = parseInt(params.get('hour') || '12')
  const endParam = parseInt(params.get('end') || '0')

  const [title, setTitle] = useState('')
  const [spotName, setSpotName] = useState('')
  const [spotArea, setSpotArea] = useState('')
  const [startHour, setStartHour] = useState(hour)
  const [endHour, setEndHour] = useState(endParam || Math.min(hour + 2, 23))
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  // Calendar selection for posting events
  const [gcals, setGcals] = useState<{ id: string; summary: string; primary: boolean; backgroundColor: string }[]>([])
  const [targetCalId, setTargetCalId] = useState('primary')
  const [calConnected, setCalConnected] = useState(false)

  // Smart title suggestions
  const titleSuggestions = [
    'Dinner', 'Lunch', 'Coffee', 'Drinks', 'Catch up',
    'Movie night', 'Game night', 'Study session', 'Birthday hangout',
    'Brunch', 'Gym', 'Shopping',
  ]

  // Load calendars on mount
  useEffect(() => {
    async function loadCals() {
      try {
        const res = await fetch('/api/calendar/list')
        if (res.ok) {
          const data = await res.json()
          setGcals(data.calendars || [])
          setCalConnected(true)
          // Default to primary or first selected
          if (data.selectedIds?.length > 0) {
            setTargetCalId(data.selectedIds[0])
          }
        }
      } catch {}
    }
    loadCals()
  }, [])

  // Places autocomplete
  const [placeQuery, setPlaceQuery] = useState('')
  const [predictions, setPredictions] = useState<{ place_id: string; description: string; main_text: string; secondary_text: string }[]>([])
  const [showPredictions, setShowPredictions] = useState(false)
  const searchTimer = useRef<NodeJS.Timeout | null>(null)

  const areaNames = Object.keys(AREAS)

  function handlePlaceInput(val: string) {
    setPlaceQuery(val)
    setSpotName(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.length < 2) { setPredictions([]); setShowPredictions(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        setPredictions(data.predictions || [])
        setShowPredictions(data.predictions?.length > 0)
      } catch { setPredictions([]) }
    }, 300)
  }

  function selectPlace(p: { main_text: string; secondary_text: string }) {
    setSpotName(p.main_text)
    setSpotArea(p.secondary_text)
    setPlaceQuery(p.main_text)
    setShowPredictions(false)
    setPredictions([])
  }

  async function createPlan() {
    if (!activeCircle || !date) return
    setSending(true)
    setError('')

    try {
      // Generate ID client-side so we can use it for both inserts
      // (RLS pacts_read requires pact_member to exist, but we need pact first)
      const pactId = crypto.randomUUID()

      // Create the pact
      const { error: pactErr } = await supabase
        .from('pacts')
        .insert({
          id: pactId,
          date,
          win_start: startHour,
          win_end: endHour,
          spot_name: spotName || 'TBD',
          spot_area: spotArea || '',
          circle_id: activeCircle.id,
          occasion: title || null,
          created_by: user.id,
        })

      if (pactErr) {
        setError(pactErr.message)
        throw pactErr
      }

      // Add creator as member
      const { error: pmErr } = await supabase.from('pact_members').insert({
        pact_id: pactId,
        user_id: user.id,
      })

      if (pmErr) {
        setError(pmErr.message)
        throw pmErr
      }

      // Push to Google Calendar with smart title
      const otherMembers = circleMembers.filter(m => m.id !== user.id).map(m => m.name.split(' ')[0])
      const circleName = activeCircle.name
      fetch('/api/calendar/push-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pactId,
          occasion: title || null,
          spotName: spotName || null,
          otherNames: otherMembers,
          circleName,
          date,
          startHour,
          endHour,
          location: spotName && spotArea ? `${spotName}, ${spotArea}` : spotName || undefined,
          calendarId: targetCalId,
          confirmed: false,
          totalCircleMembers: circleMembers.length,
          pactMemberCount: 1, // just the creator at this point
        }),
      }).catch(() => {})

      // Show toast and redirect to plans
      setToast('Pact proposed! Your circle will see it.')
      setTimeout(() => {
        window.location.href = '/plans'
      }, 800)
    } catch (e: any) {
      console.error('Failed to create plan:', e)
    }
    setSending(false)
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <button onClick={() => window.history.back()} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text)' }}>←</button>
        <p style={{ fontSize: 16, fontWeight: 800 }}>Propose a Plan</p>
      </div>

      {error && (
        <div style={{ background: 'var(--red-soft)', color: 'var(--red)', padding: '8px 12px', borderRadius: 10, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Date & time summary */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ fontSize: 13, fontWeight: 700 }}>{date ? fmtDate(date) : 'No date selected'}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--text2)', width: 40 }}>From</label>
          <select
            value={startHour}
            onChange={e => setStartHour(Number(e.target.value))}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10,
              background: 'var(--surface2)', border: 'none',
              color: 'var(--text)', fontSize: 13, fontWeight: 600,
            }}
          >
            {Array.from({ length: 15 }, (_, i) => i + 8).map(h => (
              <option key={h} value={h}>{fmtHour(h)}</option>
            ))}
          </select>
          <label style={{ fontSize: 12, color: 'var(--text2)', width: 20 }}>to</label>
          <select
            value={endHour}
            onChange={e => setEndHour(Number(e.target.value))}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10,
              background: 'var(--surface2)', border: 'none',
              color: 'var(--text)', fontSize: 13, fontWeight: 600,
            }}
          >
            {Array.from({ length: 15 }, (_, i) => i + 9).map(h => (
              <option key={h} value={h} disabled={h <= startHour}>{fmtHour(h)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Title (optional) with suggestions */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>What's the occasion? (optional)</label>
        <input
          type="text"
          placeholder="Dinner, catch up, birthday..."
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 12, marginTop: 6,
            background: 'var(--surface2)', border: 'none',
            color: 'var(--text)', fontSize: 14,
          }}
        />
        {!title && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {titleSuggestions.map(s => (
              <button
                key={s}
                onClick={() => setTitle(s)}
                style={{
                  padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  background: 'var(--surface)', color: 'var(--text2)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spot name with autocomplete */}
      <div style={{ position: 'relative' }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Where? (optional)</label>
        <input
          type="text"
          placeholder="Search for a place..."
          value={placeQuery}
          onChange={e => handlePlaceInput(e.target.value)}
          onFocus={() => predictions.length > 0 && setShowPredictions(true)}
          onBlur={() => setTimeout(() => setShowPredictions(false), 200)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 12, marginTop: 6,
            background: 'var(--surface2)', border: 'none',
            color: 'var(--text)', fontSize: 14,
          }}
        />
        {showPredictions && predictions.length > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, marginTop: 4, maxHeight: 200, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            {predictions.map(p => (
              <div
                key={p.place_id}
                onMouseDown={() => selectPlace(p)}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.main_text}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{p.secondary_text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Area — show manual selection if no autocomplete result was picked */}
      {spotName && !spotArea && (
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Area</label>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6,
            maxHeight: 140, overflowY: 'auto',
          }}>
            {areaNames.map(a => (
              <button
                key={a}
                onClick={() => setSpotArea(a === spotArea ? '' : a)}
                style={{
                  padding: '5px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: a === spotArea ? 'var(--accent)' : 'var(--surface2)',
                  color: a === spotArea ? '#fff' : 'var(--text)',
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show selected area if picked */}
      {spotArea && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>📍</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{spotArea}</span>
          <button onClick={() => setSpotArea('')} style={{
            background: 'none', border: 'none', color: 'var(--text2)',
            fontSize: 12, cursor: 'pointer',
          }}>✕</button>
        </div>
      )}

      {/* Who's free */}
      <div className="card">
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
          Who's free {fmtHour(startHour)}–{fmtHour(endHour)}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {circleMembers.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 20,
              background: 'var(--surface2)', fontSize: 12, fontWeight: 600,
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%', background: m.color,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800, color: '#fff',
              }}>
                {m.name[0]}
              </span>
              {m.name.split(' ')[0]}
            </div>
          ))}
        </div>
      </div>

      {/* Calendar to post to — dropdown */}
      {calConnected && gcals.length > 0 && (
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Post to calendar</label>
          <select
            value={targetCalId}
            onChange={e => setTargetCalId(e.target.value)}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12, marginTop: 6,
              background: 'var(--surface2)', border: 'none',
              color: 'var(--text)', fontSize: 13, fontWeight: 600,
            }}
          >
            {gcals.map(cal => (
              <option key={cal.id} value={cal.id}>
                {cal.summary}{cal.primary ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        className="btn-primary"
        disabled={sending || !date}
        onClick={createPlan}
        style={{ marginTop: 8 }}
      >
        {sending ? 'Creating...' : 'Propose Plan'}
      </button>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--green)', color: '#fff', padding: '12px 20px',
          borderRadius: 14, fontSize: 13, fontWeight: 700, zIndex: 50,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.3s ease',
        }}>
          🎉 {toast}
        </div>
      )}
    </div>
  )
}

export default function NewPlanPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}><div className="spinner" /></div>}>
      <NewPlanContent />
    </Suspense>
  )
}
