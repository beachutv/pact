'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour } from '@/lib/utils'
import LocationPicker from '@/components/LocationPicker'

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
  const [groupFavs, setGroupFavs] = useState<{ name: string; emoji: string; area: string }[]>([])
  // Selected members for the pact (creator always included)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())

  // Initialize selected members to all circle members
  useEffect(() => {
    if (circleMembers.length > 0) {
      setSelectedMemberIds(new Set(circleMembers.map(m => m.id)))
    }
  }, [circleMembers])

  function toggleMember(id: string) {
    // Creator is always included
    if (id === user.id) return
    setSelectedMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          const cals = data.calendars || []
          setGcals(cals)
          setCalConnected(true)
          // Default to primary calendar, fallback to first selected
          const primary = cals.find((c: any) => c.primary)
          if (primary) {
            setTargetCalId(primary.id)
          } else if (data.selectedIds?.length > 0) {
            setTargetCalId(data.selectedIds[0])
          }
        }
      } catch {}
    }
    loadCals()
  }, [])

  // Load group favorite spots for quick selection
  useEffect(() => {
    if (!activeCircle) return
    async function loadGroupFavs() {
      const { data } = await supabase
        .from('favorite_spots')
        .select('name, emoji, area')
        .eq('circle_id', activeCircle!.id)
        .eq('visibility', 'group')
        .limit(10)
      if (data) setGroupFavs(data)
    }
    loadGroupFavs()
  }, [activeCircle?.id])

  function handleLocationSelect(name: string, area: string) {
    setSpotName(name)
    setSpotArea(area)
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

      // Push to Google Calendar with smart title (only selected members)
      const otherMembers = circleMembers.filter(m => m.id !== user.id && selectedMemberIds.has(m.id)).map(m => m.name.split(' ')[0])
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
          pactMemberCount: selectedMemberIds.size,
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

      {/* Location picker */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6, display: 'block' }}>Where? (optional)</label>
        <LocationPicker onSelect={handleLocationSelect} placeholder="Add location" />
        {/* Group favorite spots as quick picks */}
        {groupFavs.length > 0 && !spotName && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Group favorites
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {groupFavs.map(f => (
                <button
                  key={f.name}
                  onClick={() => handleLocationSelect(f.name, f.area)}
                  style={{
                    padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    background: 'var(--surface)', color: 'var(--text2)',
                  }}
                >
                  {f.emoji} {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {spotName && spotArea && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <path d="M12 21c-4-4-8-7.5-8-12a8 8 0 1 1 16 0c0 4.5-4 8-8 12z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span style={{ fontWeight: 600 }}>{spotName}</span>
            <span style={{ color: 'var(--text2)' }}>· {spotArea}</span>
          </div>
        )}
      </div>

      {/* Who to invite */}
      <div className="card">
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>
          Who's in?
        </p>
        <p style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 8 }}>
          Tap to select who you're making this pact with
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {circleMembers.map(m => {
            const isSelected = selectedMemberIds.has(m.id)
            const isCreator = m.id === user.id
            return (
              <button
                key={m.id}
                onClick={() => toggleMember(m.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: isCreator ? 'default' : 'pointer',
                  border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
                  background: isSelected ? 'var(--accent-soft, rgba(99,102,241,0.1))' : 'var(--surface2)',
                  color: isSelected ? 'var(--text)' : 'var(--text2)',
                  opacity: isSelected ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Avatar */}
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', background: m.color,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 800, color: '#fff',
                }}>
                  {m.name[0]}
                </span>
                {m.name.split(' ')[0]}
                {/* Checkmark for selected */}
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {/* "You" label for creator */}
                {isCreator && (
                  <span style={{ fontSize: 9, color: 'var(--text2)', fontWeight: 500 }}>(you)</span>
                )}
              </button>
            )
          })}
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
