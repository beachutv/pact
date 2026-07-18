'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, fmtWin, txtOn } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

type Pact = {
  id: string
  date: string
  win_start: number
  win_end: number
  spot_name: string
  spot_emoji: string
  spot_area: string
  occasion: string | null
  circle_id: string
  created_by: string | null
  members: { user_id: string }[]
}

type MemberInfo = { id: string; name: string; color: string }

export default function PlansPage() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const [pacts, setPacts] = useState<Pact[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Edit form state
  const [editDate, setEditDate] = useState('')
  const [editStart, setEditStart] = useState(12)
  const [editEnd, setEditEnd] = useState(14)
  const [editTitle, setEditTitle] = useState('')
  const [editSpot, setEditSpot] = useState('')
  const [editArea, setEditArea] = useState('')
  const [saving, setSaving] = useState(false)

  // Swipe to delete
  const [swipedPactId, setSwipedPactId] = useState<string | null>(null)
  const pactSwipeStartX = useRef(0)
  const pactSwipeCurrentX = useRef(0)

  function onPactSwipeStart(e: React.TouchEvent) {
    pactSwipeStartX.current = e.touches[0].clientX
    pactSwipeCurrentX.current = e.touches[0].clientX
  }
  function onPactSwipeMove(e: React.TouchEvent, pid: string) {
    pactSwipeCurrentX.current = e.touches[0].clientX
    const dx = pactSwipeCurrentX.current - pactSwipeStartX.current
    if (dx < -20) setSwipedPactId(pid)
  }
  function onPactSwipeEnd(pid: string) {
    const dx = pactSwipeCurrentX.current - pactSwipeStartX.current
    if (dx > -80) setSwipedPactId(null)
  }

  const onRefresh = useCallback(async () => {
    if (activeCircle) await loadPacts()
  }, [activeCircle?.id])
  const { containerRef: pullRef, refreshing: pullRefreshing, pullY, indicatorText, touchHandlers } = usePullToRefresh(onRefresh)

  useEffect(() => {
    if (!activeCircle) { setLoading(false); return }
    loadPacts()
  }, [activeCircle?.id])

  async function loadPacts() {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('pacts')
      .select('*, members:pact_members(user_id)')
      .eq('circle_id', activeCircle!.id)
      .gte('date', today)
      .order('date', { ascending: true })
    if (data) setPacts(data)
    setLoading(false)
  }

  function getMember(uid: string): MemberInfo | undefined {
    return circleMembers.find(m => m.id === uid)
  }

  function canEdit(pact: Pact): boolean {
    return pact.created_by === user.id
  }

  async function joinPact(pactId: string) {
    await supabase.from('pact_members').insert({ pact_id: pactId, user_id: user.id })
    // Push event to Google Calendar with smart title
    const pact = pacts.find(p => p.id === pactId)
    if (pact) {
      const otherMembers = pact.members
        .filter(m => m.user_id !== user.id)
        .map(m => getMember(m.user_id)?.name.split(' ')[0])
        .filter(Boolean)
      fetch('/api/calendar/push-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pactId,
          occasion: pact.occasion || null,
          spotName: pact.spot_name !== 'TBD' ? pact.spot_name : null,
          otherNames: otherMembers,
          circleName: activeCircle?.name,
          date: pact.date,
          startHour: pact.win_start,
          endHour: pact.win_end,
          location: pact.spot_name !== 'TBD' && pact.spot_area
            ? `${pact.spot_name}, ${pact.spot_area}`
            : pact.spot_name !== 'TBD' ? pact.spot_name : undefined,
        }),
      }).catch(() => {})
    }
    await loadPacts()
  }

  async function leavePact(pactId: string) {
    await supabase.from('pact_members').delete().eq('pact_id', pactId).eq('user_id', user.id)
    // Also delete the pact busy block
    await supabase.from('busy_blocks').delete().eq('pact_id', pactId).eq('user_id', user.id)
    // Remove from Google Calendar
    fetch('/api/calendar/delete-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pactId }),
    }).catch(() => {})
    await loadPacts()
  }

  async function deletePact(pactId: string) {
    if (!confirm('Delete this plan? Everyone will be removed.')) return
    // Remove from Google Calendar for all members who have it
    // (each member's events are tied to their own calendar, but we can at least remove our own)
    fetch('/api/calendar/delete-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pactId }),
    }).catch(() => {})
    // Delete all pact busy blocks
    await supabase.from('busy_blocks').delete().eq('pact_id', pactId)
    // Delete pact members first (cascade should handle this, but be safe)
    await supabase.from('pact_members').delete().eq('pact_id', pactId)
    await supabase.from('pacts').delete().eq('id', pactId)
    setEditingId(null)
    await loadPacts()
  }

  function startEditing(pact: Pact) {
    setEditingId(pact.id)
    setEditDate(pact.date)
    setEditStart(pact.win_start)
    setEditEnd(pact.win_end)
    setEditTitle(pact.occasion || '')
    setEditSpot(pact.spot_name === 'TBD' ? '' : pact.spot_name)
    setEditArea(pact.spot_area)
  }

  async function saveEdit(pactId: string) {
    setSaving(true)
    const { error } = await supabase.from('pacts').update({
      date: editDate,
      win_start: editStart,
      win_end: editEnd,
      occasion: editTitle || null,
      spot_name: editSpot || 'TBD',
      spot_area: editArea,
    }).eq('id', pactId)

    if (error) {
      alert('Failed to save: ' + error.message)
    } else {
      // Auto-sync: delete old calendar event, push updated one
      const pact = pacts.find(p => p.id === pactId)
      if (pact) {
        // Delete old event first
        await fetch('/api/calendar/delete-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pactId }),
        }).catch(() => {})

        // Push updated event with smart title
        const otherMembers = pact.members
          .filter(m => m.user_id !== user.id)
          .map(m => getMember(m.user_id)?.name.split(' ')[0])
          .filter(Boolean)
        fetch('/api/calendar/push-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pactId,
            occasion: editTitle || null,
            spotName: editSpot || null,
            otherNames: otherMembers,
            circleName: activeCircle?.name,
            date: editDate,
            startHour: editStart,
            endHour: editEnd,
            location: editSpot && editArea ? `${editSpot}, ${editArea}` : editSpot || undefined,
          }),
        }).catch(() => {})
      }

      setEditingId(null)
      await loadPacts()
    }
    setSaving(false)
  }

  if (!activeCircle) {
    return <div style={{ padding: 20, textAlign: 'center', marginTop: 40, color: 'var(--text2)' }}>
      <p style={{ fontSize: 40, marginBottom: 8 }}>📌</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Plans</p>
      <p style={{ fontSize: 13 }}>Join a circle first.</p>
    </div>
  }

  if (loading) return <div style={{ padding: 20 }}><div className="spinner" /></div>

  return (
    <div
      ref={pullRef}
      {...touchHandlers}
      style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}
    >
      {(pullY > 0 || pullRefreshing) && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', padding: '6px 0',
          transform: `translateY(${pullY > 0 ? pullY - 30 : 0}px)`,
          transition: pullY === 0 ? 'transform 0.2s' : 'none',
        }}>
          {indicatorText}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 15, fontWeight: 800 }}>{activeCircle.emoji} Plans</p>
        <button
          onClick={() => router.push('/calendar')}
          style={{
            background: 'var(--accent)', border: 'none', borderRadius: 20,
            padding: '6px 14px', fontSize: 12, fontWeight: 700,
            color: '#fff', cursor: 'pointer',
          }}
        >
          + New
        </button>
      </div>

      {pacts.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: 30, color: 'var(--text2)' }}>
          <p style={{ fontSize: 40, marginBottom: 8 }}>📌</p>
          <p style={{ fontSize: 13 }}>
            No plans yet. Tap a free slot in the Calendar to propose one!
          </p>
        </div>
      ) : (
        pacts.map(p => {
          const isIn = p.members.some(m => m.user_id === user.id)
          const isEditing = editingId === p.id
          const editable = canEdit(p)

          return (
            <div key={p.id} style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius)' }}>
              {/* Swipe delete button */}
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: 80, background: 'var(--red)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', borderRadius: '0 var(--radius) var(--radius) 0',
              }}>
                <button onClick={() => deletePact(p.id)} style={{
                  background: 'none', border: 'none', color: '#fff',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>Delete</button>
              </div>
              <div
                onTouchStart={onPactSwipeStart}
                onTouchMove={e => onPactSwipeMove(e, p.id)}
                onTouchEnd={() => onPactSwipeEnd(p.id)}
                className="card" style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  transform: swipedPactId === p.id ? 'translateX(-80px)' : 'translateX(0)',
                  transition: 'transform 0.2s ease', position: 'relative', zIndex: 1,
                }}>
              {isEditing ? (
                /* ─── Edit mode ─── */
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800 }}>Edit Plan</p>
                    <button onClick={() => setEditingId(null)} style={{
                      background: 'none', border: 'none', fontSize: 14,
                      cursor: 'pointer', color: 'var(--text2)', padding: '2px 6px',
                    }}>✕</button>
                  </div>

                  {/* Date */}
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: 'var(--surface2)', border: 'none',
                      color: 'var(--text)', fontSize: 13,
                    }}
                  />

                  {/* Time */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={editStart} onChange={e => setEditStart(Number(e.target.value))}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: 'var(--surface2)', border: 'none', color: 'var(--text)', fontSize: 13 }}>
                      {Array.from({ length: 15 }, (_, i) => i + 8).map(h => (
                        <option key={h} value={h}>{fmtHour(h)}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>to</span>
                    <select value={editEnd} onChange={e => setEditEnd(Number(e.target.value))}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: 'var(--surface2)', border: 'none', color: 'var(--text)', fontSize: 13 }}>
                      {Array.from({ length: 15 }, (_, i) => i + 9).map(h => (
                        <option key={h} value={h} disabled={h <= editStart}>{fmtHour(h)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Title */}
                  <input
                    type="text" placeholder="Occasion (optional)"
                    value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)', border: 'none', color: 'var(--text)', fontSize: 13 }}
                  />

                  {/* Spot */}
                  <input
                    type="text" placeholder="Where? (optional)"
                    value={editSpot} onChange={e => setEditSpot(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)', border: 'none', color: 'var(--text)', fontSize: 13 }}
                  />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={() => saveEdit(p.id)} disabled={saving}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                        background: 'var(--accent)', color: '#fff',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={() => deletePact(p.id)}
                      style={{
                        padding: '10px 14px', borderRadius: 10, border: 'none',
                        background: 'var(--red-soft)', color: 'var(--red)',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                /* ─── View mode ─── */
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 800 }}>
                        {p.occasion || p.spot_name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {fmtDate(p.date)} · {fmtWin(p.win_start, p.win_end)}
                      </p>
                      {p.spot_name !== 'TBD' && p.occasion && (
                        <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                          {p.spot_emoji} {p.spot_name}{p.spot_area ? ` — ${p.spot_area}` : ''}
                        </p>
                      )}
                    </div>
                    {editable && (
                      <button onClick={() => startEditing(p)}
                        style={{
                          background: 'var(--surface2)', border: 'none', borderRadius: 8,
                          padding: '4px 10px', fontSize: 11, fontWeight: 700,
                          color: 'var(--text2)', cursor: 'pointer',
                        }}>
                        ✏️ Edit
                      </button>
                    )}
                  </div>

                  {/* Who's in */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {p.members.map(pm => {
                      const m = getMember(pm.user_id)
                      if (!m) return null
                      return (
                        <div key={m.id} style={{
                          width: 26, height: 26, borderRadius: '50%', background: m.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 800, color: txtOn(m.color),
                        }}>
                          {m.name[0]}
                        </div>
                      )
                    })}
                    <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 4 }}>
                      {p.members.length}/{circleMembers.length} in
                    </span>
                  </div>

                  {/* RSVP button */}
                  <button
                    onClick={() => isIn ? leavePact(p.id) : joinPact(p.id)}
                    style={{
                      padding: '8px 0', borderRadius: 10, border: 'none',
                      background: isIn ? 'var(--surface2)' : 'var(--accent)',
                      color: isIn ? 'var(--text2)' : '#fff',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {isIn ? "I'm out" : "I'm in!"}
                  </button>
                </>
              )}
            </div>
            </div>
          )
        })
      )}
    </div>
  )
}
