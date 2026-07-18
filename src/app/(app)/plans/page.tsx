'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, fmtWin, txtOn } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import LocationPicker from '@/components/LocationPicker'

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
  status: string
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


  // Long press for quick actions
  const [longPressPactId, setLongPressPactId] = useState<string | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Share pact to chat
  const [sharePactId, setSharePactId] = useState<string | null>(null)
  const [shareThreads, setShareThreads] = useState<{ id: string; name: string }[]>([])
  const [sharing, setSharing] = useState(false)

  function onPactLongPressStart(pid: string) {
    longPressTimerRef.current = setTimeout(() => setLongPressPactId(pid), 500)
  }
  function onPactLongPressEnd() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }

  async function openShareModal(pactId: string) {
    setLongPressPactId(null)
    setSharePactId(pactId)
    // Load user's threads
    const { data: tms } = await supabase
      .from('thread_members').select('thread_id').eq('user_id', user.id)
    if (!tms) return
    const threadIds = tms.map(t => t.thread_id)
    const { data: threads } = await supabase
      .from('threads').select('id, name, circle_id').in('id', threadIds)
    if (!threads) return
    const result: { id: string; name: string }[] = []
    for (const t of threads) {
      if (t.name) {
        result.push({ id: t.id, name: t.name })
      } else {
        const { data: members } = await supabase
          .from('thread_members').select('user_id').eq('thread_id', t.id)
        const others = (members || []).filter(m => m.user_id !== user.id)
        const names = others.map(o => {
          const cm = circleMembers.find(cm => cm.id === o.user_id)
          return cm?.name?.split(' ')[0] || 'Unknown'
        })
        result.push({ id: t.id, name: names.join(', ') || 'Chat' })
      }
    }
    setShareThreads(result)
  }

  async function sharePactToThread(threadId: string) {
    if (!sharePactId) return
    setSharing(true)
    const pact = pacts.find(p => p.id === sharePactId)
    if (!pact) { setSharing(false); return }
    await supabase.from('messages').insert({
      thread_id: threadId,
      from_user: user.id,
      date_card: pact.date,
      win_start: pact.win_start,
      win_end: pact.win_end,
      spot_name: pact.spot_name !== 'TBD' ? pact.spot_name : null,
      spot_emoji: pact.spot_emoji || null,
      spot_area: pact.spot_area || null,
      text: null,
    })
    setSharing(false)
    setSharePactId(null)
    alert('Pact shared to chat!')
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
      const newMemberCount = pact.members.length + 1
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
          confirmed: false,
          totalCircleMembers: circleMembers.length,
          pactMemberCount: newMemberCount,
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
    const pact = pacts.find(p => p.id === pactId)
    const isConfirmed = pact?.status === 'confirmed'
    const msg = isConfirmed
      ? 'Cancel this confirmed pact? All members will be notified.'
      : 'Delete this plan? Everyone will be removed.'
    if (!confirm(msg)) return

    // Remove from Google Calendar
    fetch('/api/calendar/delete-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pactId }),
    }).catch(() => {})

    // If confirmed, notify all members about cancellation
    if (isConfirmed && pact) {
      const otherMembers = pact.members.filter(m => m.user_id !== user.id)
      const cancelTitle = pact.occasion || 'Pact'
      for (const m of otherMembers) {
        await supabase.from('notifications').insert({
          user_id: m.user_id,
          type: 'pact_change',
          title: `${cancelTitle} cancelled`,
          body: `${user.name?.split(' ')[0] || 'Someone'} cancelled the pact on ${fmtDate(pact.date)}`,
          link: '/plans',
        })
      }
      // Update status to 'cancelled' instead of deleting
      await supabase.from('pacts').update({ status: 'cancelled' }).eq('id', pactId)
    }

    // Delete busy blocks and pact data
    await supabase.from('busy_blocks').delete().eq('pact_id', pactId)
    await supabase.from('pact_members').delete().eq('pact_id', pactId)
    await supabase.from('pacts').delete().eq('id', pactId)
    setEditingId(null)
    setLongPressPactId(null)
    await loadPacts()
  }

  function handleEditLocationSelect(name: string, area: string) {
    setEditSpot(name)
    setEditArea(area)
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
            confirmed: false,
            totalCircleMembers: circleMembers.length,
            pactMemberCount: pact.members.length,
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
            <div key={p.id} style={{ position: 'relative' }}>
              <div
                onTouchStart={() => onPactLongPressStart(p.id)}
                onTouchEnd={onPactLongPressEnd}
                onTouchCancel={onPactLongPressEnd}
                className="card" style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  position: 'relative',
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

                  {/* Spot with autocomplete */}
                  <LocationPicker
                    onSelect={handleEditLocationSelect}
                    initialValue={editSpot}
                    placeholder="Add location"
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
                      {p.status === 'confirmed' ? 'Cancel Pact' : 'Delete'}
                    </button>
                  </div>
                </>
              ) : (
                /* ─── View mode ─── */
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 800 }}>
                        {p.occasion || (() => {
                          const others = p.members
                            .filter(m => m.user_id !== user.id)
                            .map(m => getMember(m.user_id)?.name.split(' ')[0])
                            .filter(Boolean)
                          return others.length > 0 ? `Pact with ${others.join(', ')}` : 'Pact'
                        })()}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {fmtDate(p.date)} · {fmtWin(p.win_start, p.win_end)}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {p.spot_name !== 'TBD'
                          ? `${p.spot_emoji || '📍'} ${p.spot_name}${p.spot_area ? ` — ${p.spot_area}` : ''}`
                          : '📍 To be set'}
                      </p>
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

              {/* Long press quick actions */}
              {longPressPactId === p.id && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: 0, right: 0, zIndex: 20,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 14, padding: 6, minWidth: 140,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                  }}
                >
                  {editable && (
                    <button onClick={() => { setLongPressPactId(null); startEditing(p) }} style={{
                      display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                      background: 'transparent', fontSize: 13, fontWeight: 600,
                      color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                    }}>✏️ Edit</button>
                  )}
                  <button onClick={() => { setLongPressPactId(null); router.push('/chat') }} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>💬 Discuss</button>
                  <button onClick={() => openShareModal(p.id)} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>📤 Send to chat</button>
                  <button onClick={() => { setLongPressPactId(null); deletePact(p.id) }} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--red)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>{p.status === 'confirmed' ? '🚫 Cancel Pact' : '🗑 Delete'}</button>
                  <button onClick={() => setLongPressPactId(null)} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>✕ Cancel</button>
                </div>
              )}
            </div>
            </div>
          )
        })
      )}

      {/* Share pact to chat modal */}
      {sharePactId && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setSharePactId(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: 20, width: '90%', maxWidth: 360 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Send pact to chat</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
              Pick a chat to share this pact with.
            </p>
            {shareThreads.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: '12px 0' }}>
                No chats yet. Start a chat first!
              </p>
            ) : (
              shareThreads.map(t => (
                <button
                  key={t.id}
                  onClick={() => sharePactToThread(t.id)}
                  disabled={sharing}
                  style={{
                    display: 'block', width: '100%', padding: '10px 14px', marginBottom: 6,
                    borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface2)',
                    fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  💬 {t.name}
                </button>
              ))
            )}
            <button onClick={() => setSharePactId(null)} style={{
              marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
              background: 'transparent', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
