'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, toStr, txtOn } from '@/lib/utils'
import LocationPicker from '@/components/LocationPicker'
import CalendarBars from '@/components/CalendarBars'
import { sendPushNotification } from '@/lib/push'

function NewPlanContent() {
  const { user, activeCircle, circles, circleMembers } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const params = useSearchParams()

  const preDate = params.get('date') || ''
  const preHour = parseInt(params.get('hour') || '0')
  const preEnd = parseInt(params.get('end') || '0')

  // Steps: 0=type, 1=date/range, 2=invite, 3=availability+details+confirm, 4=confirmed
  const [step, setStep] = useState(preDate ? 2 : 0)
  const [planType, setPlanType] = useState<'date' | 'find' | null>(preDate ? 'date' : null)

  // Friends
  const [allFriends, setAllFriends] = useState<UserProfile[]>([])
  const [loadingFriends, setLoadingFriends] = useState(true)
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(activeCircle?.id || null)

  // Date
  const [selectedDate, setSelectedDate] = useState(preDate)
  const [viewingDate, setViewingDate] = useState('')
  const [calMonth, setCalMonth] = useState(() => {
    const d = preDate ? new Date(preDate + 'T12:00:00') : new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selectedRange, setSelectedRange] = useState<string | null>(null)

  // Invite
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set())

  // Details
  const [title, setTitle] = useState('')
  const [spotName, setSpotName] = useState('')
  const [spotArea, setSpotArea] = useState('')
  const [startHour, setStartHour] = useState(preHour || 12)
  const [endHour, setEndHour] = useState(preEnd || 14)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  // Calendar
  const [calConnected, setCalConnected] = useState(false)
  const [gcals, setGcals] = useState<{ id: string; summary: string; primary: boolean }[]>([])
  const [targetCalId, setTargetCalId] = useState('primary')
  const [groupFavs, setGroupFavs] = useState<{ name: string; emoji: string; area: string }[]>([])

  const titleSuggestions = ['Dinner', 'Lunch', 'Coffee', 'Drinks', 'Catch up', 'Movie night', 'Brunch', 'Study session']

  // Circle membership map: userId -> set of circleIds
  const [friendCircles, setFriendCircles] = useState<Map<string, Set<string>>>(new Map())
  // Busy block counts for availability signals
  const [friendBusy, setFriendBusy] = useState<Map<string, number>>(new Map())

  // Load friends
  useEffect(() => {
    async function load() {
      setLoadingFriends(true)
      const seen = new Set<string>()
      const friends: UserProfile[] = []
      const circleMembership = new Map<string, Set<string>>()
      const cIds = circles.map(c => c.id)
      if (cIds.length > 0) {
        const { data: cms } = await supabase
          .from('circle_members').select('user_id, circle_id, users!user_id(*)').in('circle_id', cIds)
        if (cms) cms.forEach((cm: any) => {
          if (cm.users && cm.users.id !== user.id) {
            // Track circle membership
            if (!circleMembership.has(cm.users.id)) circleMembership.set(cm.users.id, new Set())
            circleMembership.get(cm.users.id)!.add(cm.circle_id)
            if (!seen.has(cm.users.id)) {
              seen.add(cm.users.id); friends.push(cm.users)
            }
          }
        })
      }
      const { data: fships } = await supabase
        .from('friendships').select('requester_id, addressee_id')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).eq('status', 'accepted')
      if (fships) {
        const fIds = fships.map(f => f.requester_id === user.id ? f.addressee_id : f.requester_id).filter(id => !seen.has(id))
        if (fIds.length > 0) {
          const { data: profiles } = await supabase.from('users').select('*').in('id', fIds)
          if (profiles) profiles.forEach((p: any) => { if (!seen.has(p.id)) { seen.add(p.id); friends.push(p) } })
        }
      }
      setFriendCircles(circleMembership)
      const sorted = friends.sort((a, b) => a.name.localeCompare(b.name))
      setAllFriends(sorted)
      setLoadingFriends(false)

      // Load busy blocks for availability signals (next 7 days)
      const friendIds = sorted.map(f => f.id)
      if (friendIds.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10)
        const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
        const weekEndStr = weekEnd.toISOString().slice(0, 10)
        const { data: blocks } = await supabase.from('busy_blocks')
          .select('user_id')
          .in('user_id', friendIds)
          .gte('date', todayStr)
          .lte('date', weekEndStr)
        if (blocks) {
          const counts = new Map<string, number>()
          blocks.forEach((b: any) => counts.set(b.user_id, (counts.get(b.user_id) || 0) + 1))
          setFriendBusy(counts)
        }
      }
    }
    load()
  }, [user.id, circles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/calendar/list').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.calendars) {
        setGcals(data.calendars); setCalConnected(true)
        const primary = data.calendars.find((c: any) => c.primary)
        if (primary) setTargetCalId(primary.id)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    supabase.from('favorite_spots').select('name, emoji, area')
      .eq('circle_id', selectedCircleId).eq('visibility', 'group').limit(10)
      .then(({ data }) => { if (data) setGroupFavs(data) })
  }, [selectedCircleId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Set viewingDate when entering step 3
  useEffect(() => {
    if (step === 3 && !viewingDate) setViewingDate(effectiveDate())
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleInvite(id: string) {
    setInvitedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function inviteCircle(cid: string) {
    // Toggle circle filter — just filter the list, don't auto-select
    setSelectedCircleId(prev => prev === cid ? null : cid)
  }

  // Filtered friends based on selected circle
  const displayedFriends = (() => {
    if (!selectedCircleId) return allFriends
    // Show only friends from the selected circle
    return allFriends // We filter by circle membership below
  })()

  function handleLocationSelect(name: string, area: string) { setSpotName(name); setSpotArea(area) }

  function effectiveDate(): string {
    if (planType === 'date' && selectedDate) return selectedDate
    const today = new Date()
    if (selectedRange === 'weekend') { const d = new Date(today); d.setDate(d.getDate() + (6 - d.getDay())); return toStr(d) }
    if (selectedRange === 'next-week') { const d = new Date(today); d.setDate(d.getDate() + (8 - d.getDay())); return toStr(d) }
    return toStr(today)
  }

  function visibilityDays(): number {
    if (planType === 'date') return 1
    if (selectedRange === 'weekend') return 3
    if (selectedRange === 'next-week') return 7
    return 14
  }

  async function createPlan() {
    const date = viewingDate || effectiveDate()
    if (!date) return
    const circleId = selectedCircleId || circles[0]?.id
    if (!circleId) { setError('Join or create a circle first'); return }
    setSending(true); setError('')

    try {
      const pactId = crypto.randomUUID()
      const { error: pactErr } = await supabase.from('pacts').insert({
        id: pactId, date,
        win_start: startHour, win_end: endHour,
        spot_name: spotName || 'TBD', spot_area: spotArea || '',
        circle_id: circleId, occasion: title || null, created_by: user.id,
      })
      if (pactErr) { setError(pactErr.message); throw pactErr }

      await supabase.from('pact_members').insert({ pact_id: pactId, user_id: user.id })

      const pushTargets = allFriends.filter(m => m.id !== user.id && invitedIds.has(m.id)).map(m => m.id)
      const pactTitle = title.trim() || `Pact on ${fmtDate(date)}`
      for (const uid of pushTargets) {
        await supabase.from('notifications').insert({
          user_id: uid, type: 'pact_new', title: 'New pact proposed',
          body: `${user.name?.split(' ')[0] || 'Someone'} proposed: ${pactTitle}`, link: `/plans?pact=${pactId}`,
        })
      }
      if (pushTargets.length) {
        sendPushNotification({ userIds: pushTargets, title: 'New pact proposed',
          body: `${user.name?.split(' ')[0] || 'Someone'} proposed: ${pactTitle}`, url: `/plans?pact=${pactId}`,
        }).catch(() => {})
      }
      setStep(4)
    } catch (e: any) {
      setSending(false)
      if (!error) setError(e.message || 'Failed to create plan')
    }
  }

  // Calendar grid
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
          <button onClick={() => setCalMonth(prev => { let m = prev.month - 1, y = prev.year; if (m < 0) { m = 11; y-- }; return { year: y, month: m } })} className="btn-secondary" style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{monthLabel}</span>
          <button onClick={() => setCalMonth(prev => { let m = prev.month + 1, y = prev.year; if (m > 11) { m = 0; y++ }; return { year: y, month: m } })} className="btn-secondary" style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {weekdays.map(w => <div key={w} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text2)', padding: '4px 0' }}>{w}</div>)}
          {Array.from({ length: first.getDay() }).map((_, i) => <div key={'b' + i} />)}
          {Array.from({ length: dim }).map((_, i) => {
            const d = i + 1, ds = toStr(new Date(year, month, d)), isPast = ds < todayStr, isToday = ds === todayStr, isSel = ds === selectedDate
            return (
              <button key={d} disabled={isPast} onClick={() => setSelectedDate(ds)} style={{
                aspectRatio: '1', borderRadius: 11, border: 'none',
                background: isSel ? 'var(--accent)' : 'var(--surface)', color: isSel ? '#fff' : isPast ? 'var(--text2)' : 'var(--text)',
                opacity: isPast ? 0.3 : 1, fontSize: 13, fontWeight: 600, cursor: isPast ? 'default' : 'pointer',
                outline: isToday && !isSel ? '1.5px solid var(--accent)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{d}</button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 80 }}>
      {step < 4 && (
        <button onClick={() => step > 0 ? setStep(step - 1) : router.back()} style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none',
          border: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0,
        }}>← {step === 0 ? 'Back' : 'Previous step'}</button>
      )}

      {step < 4 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2, 3].map(s => (
            <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: s <= step ? 'var(--accent)' : 'var(--border)', transition: 'background 0.2s' }} />
          ))}
        </div>
      )}

      {/* STEP 0: Type */}
      {step === 0 && (<>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>What kind of plan?</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>Pick a date if you already know when, or find a time that works for everyone.</p>
        {[
          { type: 'date' as const, icon: '📅', title: 'I have a date in mind', desc: 'You know the day — just need to align on time and who.' },
          { type: 'find' as const, icon: '🔍', title: 'Find a time together', desc: 'See who is around and find a window that works.' },
        ].map(opt => (
          <button key={opt.type} onClick={() => { setPlanType(opt.type); setStep(1) }} className="card" style={{
            display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left',
            border: planType === opt.type ? '1.5px solid var(--accent)' : '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 28, width: 52, height: 52, background: 'var(--surface3)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{opt.icon}</span>
            <div><p style={{ fontSize: 14, fontWeight: 700 }}>{opt.title}</p><p style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>{opt.desc}</p></div>
          </button>
        ))}
      </>)}

      {/* STEP 1: Date or Range */}
      {step === 1 && planType === 'date' && (<>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Pick a date</h2>
        {renderCalGrid()}
        {selectedDate && <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'center', marginTop: 8 }}>{fmtDate(selectedDate)}</p>}
        <button className="btn-primary" disabled={!selectedDate} onClick={() => setStep(2)}>Next →</button>
      </>)}

      {step === 1 && planType === 'find' && (<>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>When are you thinking?</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>Pick a window and we will help find the best time.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {[{ key: 'weekend', label: 'This weekend' }, { key: 'next-week', label: 'Next week' }, { key: '2-weeks', label: 'Next 2 weeks' }].map(r => (
            <button key={r.key} onClick={() => setSelectedRange(r.key)} className="chip" style={{
              padding: '12px 18px', fontSize: 13,
              borderColor: selectedRange === r.key ? 'var(--accent)' : 'var(--border)',
              background: selectedRange === r.key ? 'var(--accent-soft)' : 'var(--surface)',
              color: selectedRange === r.key ? 'var(--accent)' : 'var(--text)',
            }}>{r.label}</button>
          ))}
        </div>
        <button className="btn-primary" disabled={!selectedRange} onClick={() => setStep(2)}>Next →</button>
      </>)}

      {/* STEP 2: Invite */}
      {step === 2 && (<>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Who&apos;s joining?</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>Invite friends or share a link. Availability is based on their calendar.</p>

        {circles.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            <button className="chip" style={{ flexShrink: 0, fontSize: 12, borderColor: !selectedCircleId ? 'var(--accent)' : 'var(--border)', background: !selectedCircleId ? 'var(--accent-soft)' : 'var(--surface)', fontWeight: !selectedCircleId ? 700 : 600 }}
              onClick={() => setSelectedCircleId(null)}>All friends</button>
            {circles.map(c => (
              <button key={c.id} className="chip" style={{ flexShrink: 0, fontSize: 12, borderColor: selectedCircleId === c.id ? 'var(--accent)' : 'var(--border)', background: selectedCircleId === c.id ? 'var(--accent-soft)' : 'var(--surface)', fontWeight: selectedCircleId === c.id ? 700 : 600 }}
                onClick={() => inviteCircle(c.id)}>{c.emoji} {c.name}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
          {loadingFriends ? <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><div className="spinner" /></div>
           : allFriends.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 20 }}>No friends found. Add friends or join a circle first.</p>
           : (() => {
            // Filter by circle if selected
            const filtered = selectedCircleId
              ? allFriends.filter(m => friendCircles.get(m.id)?.has(selectedCircleId))
              : allFriends
            return filtered.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: 20 }}>No friends in this circle.</p>
              : filtered.map(m => {
              const isInvited = invitedIds.has(m.id)
              // Availability signal based on busy blocks
              const busyCount = friendBusy.get(m.id) || 0
              const signal = busyCount <= 3
                ? { label: 'looks free', color: 'var(--green)', dot: '🟢' }
                : busyCount <= 8
                ? { label: 'might be free', color: 'var(--amber)', dot: '🟡' }
                : { label: 'busy', color: 'var(--text2)', dot: '⚪' }
              return (
                <button key={m.id} onClick={() => toggleInvite(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                  background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', width: '100%', textAlign: 'left',
                }}>
                  <div className="avatar" style={{ background: m.color, color: txtOn(m.color), position: 'relative', overflow: 'hidden' }}>
                    {m.name[0]}
                    {m.avatar_url && <img src={m.avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                  </div>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                  <span style={{ color: signal.color, fontSize: 10, fontWeight: 700 }}>{signal.dot} {signal.label}</span>
                  <div style={{ width: 22, height: 22, borderRadius: 7, border: isInvited ? '2px solid var(--accent)' : '2px solid var(--border)', background: isInvited ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isInvited ? '#fff' : 'transparent', fontSize: 12 }}>✓</div>
                </button>
              )
            })
          })()}
        </div>

        <button className="btn-primary" disabled={invitedIds.size === 0} onClick={() => setStep(3)}>
          Invite {invitedIds.size} friend{invitedIds.size === 1 ? '' : 's'} →
        </button>
      </>)}

      {/* STEP 3: Availability + Details + Confirm (merged) */}
      {step === 3 && (<>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Plan details</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
          Tap the group bar to propose a time. Tap your bar to set availability.
        </p>

        {/* Calendar bars with date picker */}
        {(() => {
          const date = viewingDate || effectiveDate()
          const memberIds = [user.id, ...Array.from(invitedIds)]
          const memberInfos = [user, ...allFriends.filter(m => invitedIds.has(m.id))].map(m => ({
            id: m.id, name: m.name, color: m.color, avatar_url: m.avatar_url,
          }))
          const showDatePicker = planType === 'find' || !selectedDate
          return date ? (
            <>
              <CalendarBars
                memberIds={memberIds}
                dateStr={date}
                userId={user.id}
                editable={true}
                compact={false}
                members={memberInfos}
                onDateChange={showDatePicker ? (d) => setViewingDate(d) : undefined}
                visibilityDays={visibilityDays()}
                onGroupTap={(h) => {
                  // First tap sets start, second tap sets end
                  if (startHour === h && endHour === h + 1) {
                    // Tapping same hour — deselect
                    setStartHour(0); setEndHour(0)
                  } else if (startHour && endHour && h >= startHour && h < endHour) {
                    // Tapping within range — shrink to just this hour
                    setStartHour(h); setEndHour(h + 1)
                  } else if (!startHour && !endHour) {
                    // No selection — start fresh
                    setStartHour(h); setEndHour(h + 1)
                  } else if (h < startHour) {
                    // Extend range left
                    setStartHour(h)
                  } else {
                    // Extend range right
                    setEndHour(h + 1)
                  }
                }}
                selectedStart={startHour || undefined}
                selectedEnd={endHour || undefined}
              />
              {startHour > 0 && endHour > 0 && (
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'center', marginTop: 4 }}>
                  {fmtHour(startHour)} – {fmtHour(endHour)}
                </p>
              )}
            </>
          ) : null
        })()}

        {/* Title */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>What is the occasion? (optional)</label>
          <input className="input" type="text" placeholder="Dinner, catch up, birthday..." value={title} onChange={e => setTitle(e.target.value)} style={{ marginTop: 6 }} />
          {!title && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {titleSuggestions.map(s => <button key={s} onClick={() => setTitle(s)} className="chip" style={{ fontSize: 11 }}>{s}</button>)}
            </div>
          )}
        </div>

        {/* Location */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6, display: 'block' }}>Where? (optional)</label>
          <LocationPicker onSelect={handleLocationSelect} placeholder="Add location" />
          {groupFavs.length > 0 && !spotName && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Group favorites</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {groupFavs.map(f => <button key={f.name} onClick={() => handleLocationSelect(f.name, f.area)} className="chip" style={{ fontSize: 11 }}>{f.emoji} {f.name}</button>)}
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
            <select className="input" value={targetCalId} onChange={e => setTargetCalId(e.target.value)} style={{ marginTop: 6 }}>
              {gcals.map(cal => <option key={cal.id} value={cal.id}>{cal.summary}{cal.primary ? ' (default)' : ''}</option>)}
            </select>
          </div>
        )}

        {/* Invited summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{invitedIds.size} invited:</span>
          {[user, ...allFriends.filter(m => invitedIds.has(m.id))].map(m => (
            <div key={m.id} className="avatar" style={{ background: m.color, color: txtOn(m.color), width: 26, height: 26, fontSize: 10, position: 'relative', overflow: 'hidden' }}>
              {m.name[0]}
              {m.avatar_url && <img src={m.avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            </div>
          ))}
        </div>

        {error && <p style={{ fontSize: 13, color: 'var(--red)', textAlign: 'center' }}>{error}</p>}

        <button className="btn-primary" disabled={sending} onClick={createPlan} style={{ marginTop: 8 }}>
          {sending ? 'Creating...' : 'Propose plan'}
        </button>
      </>)}

      {/* STEP 4: Confirmed */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 0' }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(139,176,126,0.12), rgba(118,172,179,0.1))', border: '1.5px solid rgba(139,176,126,0.4)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 320 }}>
            <p style={{ fontSize: 42, marginBottom: 8 }}>🎉</p>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Plan proposed!</h2>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
              {title || `Plan for ${fmtDate(viewingDate || effectiveDate())}`}
              {spotName ? ` · 📍 ${spotName}` : ''}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>{invitedIds.size} friend{invitedIds.size === 1 ? '' : 's'} invited</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20, width: '100%', maxWidth: 320 }}>
            <button className="btn-primary" onClick={() => router.push('/plans')}>View your plans</button>
            <button onClick={() => router.push('/home')} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}>Back to home</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
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
