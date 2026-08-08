'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, toStr, txtOn } from '@/lib/utils'
import LocationPicker from '@/components/LocationPicker'
import SlideToConfirm from '@/components/SlideToConfirm'
import { sendPushNotification } from '@/lib/push'

function NewPlanContent() {
  const { user, activeCircle, circles, circleMembers } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const params = useSearchParams()

  // Pre-fill from URL params (from old calendar flow — still works)
  const preDate = params.get('date') || ''
  const preHour = parseInt(params.get('hour') || '0')
  const preEnd = parseInt(params.get('end') || '0')

  // Step state: 0=type, 1=date/range, 2=invite, 3=details+confirm
  const [step, setStep] = useState(preDate ? 2 : 0)
  const [planType, setPlanType] = useState<'date' | 'find' | null>(preDate ? 'date' : null)

  // Date state
  const [selectedDate, setSelectedDate] = useState(preDate)
  const [calMonth, setCalMonth] = useState(() => {
    const d = preDate ? new Date(preDate + 'T12:00:00') : new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  // Range state (for "find a time")
  const [selectedRange, setSelectedRange] = useState<string | null>(null)

  // Invite state
  const [invitedIds, setInvitedIds] = useState<Set<string>>(() => {
    // Pre-select all circle members if we have a circle
    if (circleMembers.length > 0) return new Set(circleMembers.filter(m => m.id !== user.id).map(m => m.id))
    return new Set()
  })

  // Update invitedIds when circleMembers loads
  useEffect(() => {
    if (circleMembers.length > 0 && invitedIds.size === 0) {
      setInvitedIds(new Set(circleMembers.filter(m => m.id !== user.id).map(m => m.id)))
    }
  }, [circleMembers])

  // Details state
  const [title, setTitle] = useState('')
  const [spotName, setSpotName] = useState('')
  const [spotArea, setSpotArea] = useState('')
  const [startHour, setStartHour] = useState(preHour || 12)
  const [endHour, setEndHour] = useState(preEnd || 14)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  // Calendar state
  const [calConnected, setCalConnected] = useState(false)
  const [gcals, setGcals] = useState<{ id: string; summary: string; primary: boolean }[]>([])
  const [targetCalId, setTargetCalId] = useState('primary')
  const [groupFavs, setGroupFavs] = useState<{ name: string; emoji: string; area: string }[]>([])

  const titleSuggestions = ['Dinner', 'Lunch', 'Coffee', 'Drinks', 'Catch up', 'Movie night', 'Brunch', 'Study session']

  // Load calendars
  useEffect(() => {
    fetch('/api/calendar/list').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.calendars) {
        setGcals(data.calendars)
        setCalConnected(true)
        const primary = data.calendars.find((c: any) => c.primary)
        if (primary) setTargetCalId(primary.id)
      }
    }).catch(() => {})
  }, [])

  // Load group favs
  useEffect(() => {
    if (!activeCircle) return
    supabase.from('favorite_spots').select('name, emoji, area')
      .eq('circle_id', activeCircle.id).eq('visibility', 'group').limit(10)
      .then(({ data }) => { if (data) setGroupFavs(data) })
  }, [activeCircle?.id])

  // Time slots helper
  function timeSlots(from: number, to: number): number[] {
    const s: number[] = []; for (let h = from; h <= to; h += 0.5) s.push(h); return s
  }
  function fmtHourMin(h: number): string {
    const n = Math.floor(h) % 24; const min = h % 1 === 0.5 ? '30' : '00'
    return `${String(n).padStart(2, '0')}:${min}`
  }

  function toggleInvite(id: string) {
    setInvitedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function inviteCircle(cid: string) {
    const c = circles.find(x => x.id === cid)
    if (!c) return
    // Get members of that circle from all circle members we know
    // For now, select all current circleMembers (since we're in active circle context)
    setInvitedIds(new Set(circleMembers.filter(m => m.id !== user.id).map(m => m.id)))
  }

  function handleLocationSelect(name: string, area: string) {
    setSpotName(name); setSpotArea(area)
  }

  // Determine the date to use
  function effectiveDate(): string {
    if (planType === 'date' && selectedDate) return selectedDate
    // For "find a time", pick a date based on range (simplified — just use next available)
    const today = new Date()
    if (selectedRange === 'weekend') {
      const d = new Date(today); d.setDate(d.getDate() + (6 - d.getDay())); return toStr(d)
    }
    if (selectedRange === 'next-week') {
      const d = new Date(today); d.setDate(d.getDate() + (8 - d.getDay())); return toStr(d)
    }
    return toStr(today)
  }

  async function createPlan() {
    const date = effectiveDate()
    if (!activeCircle || !date) return
    setSending(true); setError('')

    try {
      const pactId = crypto.randomUUID()

      const { error: pactErr } = await supabase.from('pacts').insert({
        id: pactId, date,
        win_start: startHour, win_end: endHour,
        spot_name: spotName || 'TBD', spot_area: spotArea || '',
        circle_id: activeCircle.id,
        occasion: title || null,
        created_by: user.id,
      })
      if (pactErr) { setError(pactErr.message); throw pactErr }

      const { error: pmErr } = await supabase.from('pact_members').insert({
        pact_id: pactId, user_id: user.id,
      })
      if (pmErr) { setError(pmErr.message); throw pmErr }

      // Push to Google Calendar
      const otherMembers = circleMembers
        .filter(m => m.id !== user.id && invitedIds.has(m.id))
        .map(m => m.name.split(' ')[0])
      fetch('/api/calendar/push-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pactId, occasion: title || null, spotName: spotName || null,
          otherNames: otherMembers, circleName: activeCircle.name,
          date, startHour, endHour,
          location: spotName && spotArea ? `${spotName}, ${spotArea}` : spotName || undefined,
          calendarId: targetCalId, confirmed: false,
          totalCircleMembers: circleMembers.length, pactMemberCount: invitedIds.size + 1,
        }),
      }).catch(() => {})

      // Push notifications
      const pushTargets = circleMembers.filter(m => m.id !== user.id && invitedIds.has(m.id)).map(m => m.id)
      const pactTitle = title.trim() || `Pact on ${fmtDate(date)}`
      for (const uid of pushTargets) {
        await supabase.from('notifications').insert({
          user_id: uid, type: 'pact_new', title: 'New pact proposed',
          body: `${user.name?.split(' ')[0] || 'Someone'} proposed: ${pactTitle}`,
          link: '/plans',
        })
      }
      if (pushTargets.length) {
        sendPushNotification({
          userIds: pushTargets,
          title: 'New pact proposed',
          body: `${user.name?.split(' ')[0] || 'Someone'} proposed: ${pactTitle}`,
          url: '/plans',
        }).catch(() => {})
      }

      setToast('Pact proposed!')
      setTimeout(() => { window.location.href = '/plans' }, 1500)
    } catch (e: any) {
      setSending(false)
      if (!error) setError(e.message || 'Failed to create plan')
    }
  }

  // ---- Calendar grid for date picker ----
  function renderCalGrid() {
    const { year, month } = calMonth
    const first = new Date(year, month, 1)
    const dim = new Date(year, month + 1, 0).getDate()
    const todayStr = toStr(new Date())
    const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => setCalMonth(prev => {
            let m = prev.month - 1, y = prev.year
            if (m < 0) { m = 11; y-- }
            return { year: y, month: m }
          })} className="btn-secondary" style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{monthLabel}</span>
          <button onClick={() => setCalMonth(prev => {
            let m = prev.month + 1, y = prev.year
            if (m > 11) { m = 0; y++ }
            return { year: y, month: m }
          })} className="btn-secondary" style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {weekdays.map(w => (
            <div key={w} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text2)', padding: '4px 0' }}>{w}</div>
          ))}
          {Array.from({ length: first.getDay() }).map((_, i) => <div key={'b' + i} />)}
          {Array.from({ length: dim }).map((_, i) => {
            const d = i + 1
            const ds = toStr(new Date(year, month, d))
            const isPast = ds < todayStr
            const isToday = ds === todayStr
            const isSel = ds === selectedDate
            return (
              <button
                key={d}
                disabled={isPast}
                onClick={() => setSelectedDate(ds)}
                style={{
                  aspectRatio: '1', borderRadius: 11, border: 'none',
                  background: isSel ? 'var(--accent)' : 'var(--surface)',
                  color: isSel ? '#fff' : isPast ? 'var(--text2)' : 'var(--text)',
                  opacity: isPast ? 0.3 : 1,
                  fontSize: 13, fontWeight: 600, cursor: isPast ? 'default' : 'pointer',
                  outline: isToday && !isSel ? '1.5px solid var(--accent)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ---- RENDER STEPS ----
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 80 }}>
      {/* Back button */}
      <button
        onClick={() => step > 0 ? setStep(step - 1) : router.back()}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none',
          border: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', padding: 0,
        }}
      >
        ← {step === 0 ? 'Back' : 'Previous step'}
      </button>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0, 1, 2, 3].map(s => (
          <div key={s} style={{
            height: 3, flex: 1, borderRadius: 2,
            background: s <= step ? 'var(--accent)' : 'var(--border)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>

      {/* ---- STEP 0: Type ---- */}
      {step === 0 && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>What kind of plan?</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
            Pick a date if you already know when, or find a time that works for everyone.
          </p>
          <button
            onClick={() => { setPlanType('date'); setStep(1) }}
            className="card"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
              border: planType === 'date' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              textAlign: 'left',
            }}
          >
            <span style={{
              fontSize: 28, width: 52, height: 52, background: 'var(--surface3)',
              borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>📅</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700 }}>I have a date in mind</p>
              <p style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>
                You know the day — just need to align on time and who.
              </p>
            </div>
          </button>
          <button
            onClick={() => { setPlanType('find'); setStep(1) }}
            className="card"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
              border: planType === 'find' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              textAlign: 'left',
            }}
          >
            <span style={{
              fontSize: 28, width: 52, height: 52, background: 'var(--surface3)',
              borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>🔍</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Find a time together</p>
              <p style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>
                See who is around and find a window that works.
              </p>
            </div>
          </button>
        </>
      )}

      {/* ---- STEP 1: Date or Range ---- */}
      {step === 1 && planType === 'date' && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Pick a date</h2>
          {renderCalGrid()}
          {selectedDate && (
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'center', marginTop: 8 }}>
              {fmtDate(selectedDate)}
            </p>
          )}
          <button className="btn-primary" disabled={!selectedDate} onClick={() => setStep(2)}>
            Next →
          </button>
        </>
      )}

      {step === 1 && planType === 'find' && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>When are you thinking?</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
            Pick a window and we will help find the best time.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {[
              { key: 'weekend', label: 'This weekend' },
              { key: 'next-week', label: 'Next week' },
              { key: '2-weeks', label: 'Next 2 weeks' },
            ].map(r => (
              <button
                key={r.key}
                onClick={() => setSelectedRange(r.key)}
                className="chip"
                style={{
                  padding: '12px 18px', fontSize: 13,
                  borderColor: selectedRange === r.key ? 'var(--accent)' : 'var(--border)',
                  background: selectedRange === r.key ? 'var(--accent-soft)' : 'var(--surface)',
                  color: selectedRange === r.key ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="btn-primary" disabled={!selectedRange} onClick={() => setStep(2)}>
            Next →
          </button>
        </>
      )}

      {/* ---- STEP 2: Invite ---- */}
      {step === 2 && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Who is joining?</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
            Invite friends from your circle or share a link to your group chat.
          </p>

          {/* Quick circle invite */}
          {circles.length > 1 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginTop: 4 }}>
              {circles.map(c => (
                <button key={c.id} className="chip" style={{ flexShrink: 0 }}
                  onClick={() => inviteCircle(c.id)}>
                  {c.emoji} {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Friend list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
            {circleMembers.filter(m => m.id !== user.id).map(m => {
              const isInvited = invitedIds.has(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleInvite(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid var(--border)',
                    background: 'none', border: 'none', borderBottomWidth: 1,
                    borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                >
                  <div className="avatar" style={{
                    background: m.color, color: txtOn(m.color),
                    position: 'relative', overflow: 'hidden',
                  }}>
                    {m.name[0]}
                    {m.avatar_url && (
                      <img src={m.avatar_url} alt="" style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', borderRadius: '50%',
                      }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    )}
                  </div>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                  <div style={{
                    width: 22, height: 22, borderRadius: 7,
                    border: isInvited ? '2px solid var(--accent)' : '2px solid var(--border)',
                    background: isInvited ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isInvited ? '#fff' : 'transparent', fontSize: 12,
                  }}>
                    ✓
                  </div>
                </button>
              )
            })}
          </div>

          {/* Share link button (placeholder — functional in Phase 3) */}
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: 'Pact — join the plan!',
                  text: `${user.name?.split(' ')[0]} wants to plan something. Tap to join:`,
                  url: window.location.origin + '/join/' + (activeCircle?.invite_code || ''),
                }).catch(() => {})
              } else {
                navigator.clipboard.writeText(window.location.origin + '/join/' + (activeCircle?.invite_code || ''))
                setToast('Link copied!')
                setTimeout(() => setToast(''), 2000)
              }
            }}
            style={{
              marginTop: 8, width: '100%', padding: 14, borderRadius: 14,
              border: '1.5px dashed var(--border)', background: 'none',
              color: 'var(--text)', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            🔗 Share link to group chat
          </button>

          <button className="btn-primary" disabled={invitedIds.size === 0} onClick={() => setStep(3)}>
            Next — {invitedIds.size} friend{invitedIds.size === 1 ? '' : 's'} selected →
          </button>
        </>
      )}

      {/* ---- STEP 3: Details + Confirm ---- */}
      {step === 3 && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Plan details</h2>

          {/* Date summary */}
          <div className="card">
            <p style={{ fontSize: 14, fontWeight: 700 }}>
              📅 {planType === 'date' && selectedDate ? fmtDate(selectedDate) : selectedRange === 'weekend' ? 'This weekend' : selectedRange === 'next-week' ? 'Next week' : 'Next 2 weeks'}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', width: 40 }}>From</label>
              <select className="input" value={startHour} onChange={e => setStartHour(Number(e.target.value))}
                style={{ flex: 1, padding: '8px 12px' }}>
                {timeSlots(6, 23.5).map(h => <option key={h} value={h}>{fmtHourMin(h)}</option>)}
              </select>
              <label style={{ fontSize: 12, color: 'var(--text2)', width: 20 }}>to</label>
              <select className="input" value={endHour} onChange={e => setEndHour(Number(e.target.value))}
                style={{ flex: 1, padding: '8px 12px' }}>
                {timeSlots(6.5, 24).map(h => <option key={h} value={h} disabled={h <= startHour}>{fmtHourMin(h)}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
              What is the occasion? (optional)
            </label>
            <input className="input" type="text" placeholder="Dinner, catch up, birthday..."
              value={title} onChange={e => setTitle(e.target.value)} style={{ marginTop: 6 }} />
            {!title && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {titleSuggestions.map(s => (
                  <button key={s} onClick={() => setTitle(s)} className="chip" style={{ fontSize: 11 }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6, display: 'block' }}>
              Where? (optional)
            </label>
            <LocationPicker onSelect={handleLocationSelect} placeholder="Add location" />
            {groupFavs.length > 0 && !spotName && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Group favorites
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {groupFavs.map(f => (
                    <button key={f.name} onClick={() => handleLocationSelect(f.name, f.area)}
                      className="chip" style={{ fontSize: 11 }}>
                      {f.emoji} {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {spotName && spotArea && (
              <p style={{ fontSize: 13, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                📍 <b>{spotName}</b> <span style={{ color: 'var(--text2)' }}>· {spotArea}</span>
              </p>
            )}
          </div>

          {/* Calendar to post to */}
          {calConnected && gcals.length > 0 && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Post to calendar</label>
              <select className="input" value={targetCalId} onChange={e => setTargetCalId(e.target.value)}
                style={{ marginTop: 6 }}>
                {gcals.map(cal => (
                  <option key={cal.id} value={cal.id}>{cal.summary}{cal.primary ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Who's invited summary */}
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
              Inviting {invitedIds.size} friend{invitedIds.size === 1 ? '' : 's'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {circleMembers.filter(m => invitedIds.has(m.id) || m.id === user.id).map(m => (
                <div key={m.id} className="avatar" style={{
                  background: m.color, color: txtOn(m.color), width: 28, height: 28, fontSize: 11,
                  position: 'relative', overflow: 'hidden',
                }}>
                  {m.name[0]}
                  {m.avatar_url && (
                    <img src={m.avatar_url} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover', borderRadius: '50%',
                    }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: 'var(--red)', textAlign: 'center' }}>{error}</p>
          )}

          {/* Slide to confirm */}
          <SlideToConfirm
            disabled={sending}
            label={sending ? 'Creating...' : 'Slide to propose'}
            onConfirm={createPlan}
          />
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast">🎉 {toast}</div>
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
