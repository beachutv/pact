'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, fmtWin, txtOn } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { sendPushNotification } from '@/lib/push'
import LocationPicker from '@/components/LocationPicker'
import SlideToConfirm from '@/components/SlideToConfirm'
import CalendarBars from '@/components/CalendarBars'

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
  declines: { user_id: string }[]
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

  // Toast
  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }


  // Long press for quick actions
  const [longPressPactId, setLongPressPactId] = useState<string | null>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Share pact to chat
  const [sharePactId, setSharePactId] = useState<string | null>(null)
  const [shareThreads, setShareThreads] = useState<{ id: string; name: string }[]>([])
  const [sharing, setSharing] = useState(false)

  // Expandable pact cards
  const [expandedPactId, setExpandedPactId] = useState<string | null>(null)
  
  // Track locally declined pacts (user tapped "Can't make it")
  const [declinedPacts, setDeclinedPacts] = useState<Set<string>>(new Set())

  // Hold-to-break pact
  const [breakPactId, setBreakPactId] = useState<string | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const holdTimer = useRef<NodeJS.Timeout | null>(null)
  const holdStart = useRef<number>(0)
  const holdRaf = useRef<number>(0)

  function startHoldBreak(pactId: string) {
    setBreakPactId(pactId)
    setHoldProgress(0)
  }

  function onHoldPointerDown() {
    holdStart.current = Date.now()
    const tick = () => {
      const elapsed = Date.now() - holdStart.current
      const pct = Math.min(elapsed / 2000, 1)
      setHoldProgress(pct)
      if (pct >= 1) {
        // Complete
        try { navigator.vibrate?.(50) } catch {}
        doBreakPact()
        return
      }
      holdRaf.current = requestAnimationFrame(tick)
    }
    holdRaf.current = requestAnimationFrame(tick)
  }

  function onHoldPointerUp() {
    cancelAnimationFrame(holdRaf.current)
    if (holdProgress < 1) setHoldProgress(0)
  }

  async function doBreakPact() {
    if (!breakPactId) return
    const pact = pacts.find(p => p.id === breakPactId)
    setBreakPactId(null)
    setHoldProgress(0)
    if (!pact) return

    // Remove self from pact
    await supabase.from('pact_members').delete().eq('pact_id', breakPactId).eq('user_id', user.id)
    await supabase.from('busy_blocks').delete().eq('pact_id', breakPactId).eq('user_id', user.id)
    fetch('/api/calendar/delete-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pactId: breakPactId }),
    }).catch(() => {})

    // Notify remaining members
    const otherMembers = pact.members.filter(m => m.user_id !== user.id)
    const pactTitle = pact.occasion || fmtDate(pact.date)
    for (const m of otherMembers) {
      await supabase.from('notifications').insert({
        user_id: m.user_id,
        type: 'pact_change',
        title: `${user.name?.split(' ')[0] || 'Someone'} broke their pact`,
        body: `They left the pact for ${pactTitle}`,
        link: '/plans',
      })
    }

    // Push notification
    sendPushNotification({
      userIds: otherMembers.map(m => m.user_id),
      title: `${user.name?.split(' ')[0] || 'Someone'} broke their pact`,
      body: `They left the pact for ${pactTitle}`,
      url: '/plans',
      tag: `break-${breakPactId}`,
    })

    // If only 1 member left, auto-cancel
    if (otherMembers.length <= 1) {
      if (otherMembers.length === 1) {
        await supabase.from('notifications').insert({
          user_id: otherMembers[0].user_id,
          type: 'pact_change',
          title: 'Pact cancelled',
          body: `The pact for ${pactTitle} was auto-cancelled — not enough people left`,
          link: '/plans',
        })
      }
      await supabase.from('busy_blocks').delete().eq('pact_id', breakPactId)
      await supabase.from('pact_members').delete().eq('pact_id', breakPactId)
      await supabase.from('pacts').delete().eq('id', breakPactId)
    }

    await loadPacts()
  }

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
      text: `pact:${pact.id}`,
    })
    setSharing(false)
    setSharePactId(null)
    showToast('Pact shared to chat')
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
      .select('*, members:pact_members(user_id), declines:pact_declines(user_id)')
      .eq('circle_id', activeCircle!.id)
      .gte('date', today)
      .order('date', { ascending: true })
    if (data) setPacts(data.map(p => ({ ...p, declines: p.declines || [] })))
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
    const pact = pacts.find(p => p.id === pactId)
    if (pact) {
      // Members who confirmed BEFORE this user (excluding self)
      const confirmedOthers = pact.members
        .filter(m => m.user_id !== user.id)
        .map(m => getMember(m.user_id)?.name.split(' ')[0])
        .filter(Boolean) as string[]
      const newMemberCount = pact.members.length + 1
      const declinedCount = (pact.declines || []).length
      const eligibleCount = circleMembers.length - declinedCount
      const isNowConfirmed = newMemberCount >= eligibleCount && eligibleCount >= 2

      if (isNowConfirmed) {
        await supabase.from('pacts').update({ status: 'confirmed' }).eq('id', pactId)
      }

      // Push/update event on THIS user's Google Calendar
      // otherNames = people confirmed OTHER than me
      fetch('/api/calendar/push-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pactId,
          occasion: pact.occasion || null,
          spotName: pact.spot_name !== 'TBD' ? pact.spot_name : null,
          otherNames: confirmedOthers,
          circleName: activeCircle?.name,
          date: pact.date,
          startHour: pact.win_start,
          endHour: pact.win_end,
          location: pact.spot_name !== 'TBD' && pact.spot_area
            ? `${pact.spot_name}, ${pact.spot_area}`
            : pact.spot_name !== 'TBD' ? pact.spot_name : undefined,
          confirmed: isNowConfirmed,
          totalCircleMembers: circleMembers.length,
          pactMemberCount: newMemberCount,
        }),
      }).catch(() => {})

      // If pact is now confirmed, update ALL other members' calendar events too
      if (isNowConfirmed) {
        for (const pm of pact.members) {
          if (pm.user_id === user.id) continue
          // Each member's "otherNames" = everyone confirmed EXCEPT themselves
          const theirOthers = [
            ...confirmedOthers.filter(n => n !== getMember(pm.user_id)?.name.split(' ')[0]),
            user.name?.split(' ')[0],
          ].filter(Boolean) as string[]
          // We can't push to their calendar from our session — but the API
          // uses auth.getUser() which is the CURRENT user. So we rely on
          // the notification to tell them it's confirmed, and their calendar
          // will update next time they open plans or sync.
          // For now, skip cross-user calendar updates.
        }
      }

      // Notify ALL existing pact members
      const pactTitle = pact.occasion || fmtDate(pact.date)
      const allOtherIds = pact.members.filter(m => m.user_id !== user.id).map(m => m.user_id)
      if (allOtherIds.length > 0) {
        const notifTitle = isNowConfirmed
          ? 'It\'s a pact! 📌'
          : `${user.name?.split(' ')[0] || 'Someone'} is in`
        const notifBody = isNowConfirmed
          ? `Everyone's in for ${pactTitle} — it's locked!`
          : `Committed to ${pactTitle}`
        for (const uid of allOtherIds) {
          await supabase.from('notifications').insert({
            user_id: uid,
            type: 'pact_change',
            title: notifTitle,
            body: notifBody,
            link: '/plans',
          })
        }
        sendPushNotification({
          userIds: allOtherIds,
          title: notifTitle,
          body: notifBody,
          url: '/plans',
          tag: `join-${pactId}`,
        })
      }
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

      // Push notification to all members about cancellation
      sendPushNotification({
        userIds: otherMembers.map(m => m.user_id),
        title: `${cancelTitle} cancelled`,
        body: `${user.name?.split(' ')[0] || 'Someone'} cancelled the pact on ${fmtDate(pact.date)}`,
        url: '/plans',
        tag: `pact-cancel-${pactId}`,
      })
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
    return <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '24px 16px', textAlign: 'center',
      }}>
        <p style={{ fontSize: 36, marginBottom: 8 }}>📌</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Plans</p>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 16 }}>
          Once everyone taps &quot;I&apos;m in&quot; on a proposal, it lands here — date, time, spot, and who&apos;s coming. No more &quot;so tuloy ba?&quot;
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={() => router.push('/circles/new')}
            style={{
              padding: '9px 16px', borderRadius: 12, border: 'none',
              background: 'var(--accent)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >+ Create circle</button>
          <button
            onClick={() => router.push('/circles/new')}
            style={{
              padding: '9px 16px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >+ Circle</button>
        </div>
      </div>
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
        <p style={{ fontSize: 18, fontWeight: 800 }}>Plans</p>
        <button
          onClick={() => router.push('/plans/new')}
          style={{
            background: 'var(--accent)', border: 'none', borderRadius: 20,
            padding: '6px 14px', fontSize: 12, fontWeight: 700,
            color: '#fff', cursor: 'pointer',
          }}
        >
          + New plan
        </button>
      </div>

      {pacts.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: 30, color: 'var(--text2)' }}>
          <p style={{ marginBottom: 8 }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></p>
          <p style={{ fontSize: 13 }}>
            No plans yet. Tap + New plan to propose one!
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
                  <div
                    onClick={() => setExpandedPactId(expandedPactId === p.id ? null : p.id)}
                    style={{ cursor: 'pointer' }}
                  >
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
                            : 'To be set'}
                        </p>
                      </div>
                      {editable && (
                        <button onClick={(e) => { e.stopPropagation(); startEditing(p) }}
                          style={{
                            background: 'var(--surface2)', border: 'none', borderRadius: 8,
                            padding: '4px 10px', fontSize: 11, fontWeight: 700,
                            color: 'var(--text2)', cursor: 'pointer',
                          }}>
                          Edit
                        </button>
                      )}
                    </div>

                    {/* Who's in + who's out — always visible */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
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
                      {/* Show declined members with red X */}
                      {(p.declines || []).map(d => {
                        const m = getMember(d.user_id)
                        if (!m) return null
                        return (
                          <div key={`out-${m.id}`} style={{ position: 'relative' }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: '50%', background: m.color,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 800, color: txtOn(m.color), opacity: 0.4,
                            }}>
                              {m.name[0]}
                            </div>
                            <span style={{
                              position: 'absolute', top: -3, right: -3,
                              width: 14, height: 14, borderRadius: '50%',
                              background: 'var(--red)', color: '#fff',
                              fontSize: 8, fontWeight: 800,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>✕</span>
                          </div>
                        )
                      })}
                      <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 4 }}>
                        {p.members.length} in
                        {(p.declines || []).length > 0 && (
                          <span style={{ color: 'var(--red)', marginLeft: 4 }}>
                            · {p.declines.length} out
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>
                        {expandedPactId === p.id ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedPactId === p.id && (
                    <div style={{
                      marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                      {/* Calendar bars — group + your availability */}
                      <CalendarBars
                        memberIds={[
                          ...p.members.map(m => m.user_id),
                          ...(p.declines || []).filter(d => !p.members.some(m => m.user_id === d.user_id)).map(d => d.user_id),
                        ].filter((v, i, a) => a.indexOf(v) === i)}
                        dateStr={p.date}
                        userId={user.id}
                        editable={true}
                        pactStart={p.win_start}
                        pactEnd={p.win_end}
                        compact={true}
                      />

                      {/* Member list with names + declined */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {p.members.map(pm => {
                          const m = getMember(pm.user_id)
                          if (!m) return null
                          return (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                              <div style={{
                                width: 20, height: 20, borderRadius: '50%', background: m.color,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 8, fontWeight: 800, color: txtOn(m.color), flexShrink: 0,
                              }}>
                                {m.name[0]}
                              </div>
                              <span style={{ fontWeight: 600 }}>{m.name}{m.id === user.id ? ' (you)' : ''}</span>
                              <span style={{ color: 'var(--green)', marginLeft: 'auto', fontSize: 11, fontWeight: 700 }}>✓ In</span>
                            </div>
                          )
                        })}
                        {(p.declines || []).map(d => {
                          const m = getMember(d.user_id)
                          if (!m) return null
                          return (
                            <div key={`out-${m.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.6 }}>
                              <div style={{
                                width: 20, height: 20, borderRadius: '50%', background: m.color,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 8, fontWeight: 800, color: txtOn(m.color), flexShrink: 0,
                              }}>
                                {m.name[0]}
                              </div>
                              <span style={{ fontWeight: 600 }}>{m.name}{m.id === user.id ? ' (you)' : ''}</span>
                              <span style={{ color: 'var(--red)', marginLeft: 'auto', fontSize: 11, fontWeight: 700 }}>✕ Out</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button
                          onClick={() => openShareModal(p.id)}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 10,
                            border: '1px solid var(--border)', background: 'var(--surface2)',
                            color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          Send to Chat
                        </button>
                        {isIn && (
                          <button
                            onClick={() => startHoldBreak(p.id)}
                            style={{
                              flex: 1, padding: '8px 0', borderRadius: 10,
                              border: '1px solid var(--border)', background: 'var(--red-soft)',
                              color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            }}
                          >
                            I&apos;m out
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Slide to commit / Decline — only if not already in */}
                  {!isIn && (declinedPacts.has(p.id) || p.declines?.some(d => d.user_id === user.id)) && (
                    <div style={{
                      marginTop: 8, padding: '10px 14px', borderRadius: 10,
                      background: 'var(--surface2)', textAlign: 'center',
                    }}>
                      <p style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>
                        You declined this pact
                      </p>
                      <button
                        onClick={async () => {
                          setDeclinedPacts(prev => { const n = new Set(prev); n.delete(p.id); return n })
                          await supabase.from('pact_declines').delete()
                            .eq('pact_id', p.id).eq('user_id', user.id)
                          await loadPacts()
                        }}
                        style={{
                          marginTop: 6, padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
                          background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        Changed my mind
                      </button>
                    </div>
                  )}
                  {!isIn && !declinedPacts.has(p.id) && !p.declines?.some(d => d.user_id === user.id) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      <SlideToConfirm
                        label="Slide to lock in"
                        onConfirm={() => joinPact(p.id)}
                        height={44}
                      />
                      <button
                        onClick={async () => {
                          const pactTitle = p.occasion || fmtDate(p.date)
                          const allOtherIds = p.members.map(m => m.user_id).filter(id => id !== user.id)
                          if (p.created_by && !allOtherIds.includes(p.created_by) && p.created_by !== user.id) {
                            allOtherIds.push(p.created_by)
                          }
                          // Persist decline in DB
                          await supabase.from('pact_declines').upsert({
                            pact_id: p.id,
                            user_id: user.id,
                          }, { onConflict: 'pact_id,user_id' })
                          // Remove from own Google Calendar
                          fetch('/api/calendar/delete-event', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pactId: p.id }),
                          }).catch(() => {})
                          // Also remove pact busy block
                          await supabase.from('busy_blocks').delete()
                            .eq('pact_id', p.id).eq('user_id', user.id)
                          // Mark as declined locally
                          setDeclinedPacts(prev => new Set([...prev, p.id]))
                          for (const uid of allOtherIds) {
                            await supabase.from('notifications').insert({
                              user_id: uid,
                              type: 'pact_change',
                              title: `${user.name?.split(' ')[0] || 'Someone'} can't make it`,
                              body: `Declined ${pactTitle}`,
                              link: '/plans',
                            })
                          }
                          if (allOtherIds.length > 0) {
                            sendPushNotification({
                              userIds: allOtherIds,
                              title: `${user.name?.split(' ')[0] || 'Someone'} can't make it`,
                              body: `Declined ${pactTitle}`,
                              url: '/plans',
                              tag: `decline-${p.id}`,
                            })
                          }
                          await loadPacts()
                          showToast('The group has been informed')
                        }}
                        style={{
                          padding: '10px 0', borderRadius: 10, width: '100%',
                          border: '1px solid var(--border)', background: 'transparent',
                          color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Can&apos;t make it
                      </button>
                    </div>
                  )}
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
                    }}>Edit</button>
                  )}
                  <button onClick={() => {
                    setLongPressPactId(null)
                    if (navigator.share) {
                      const pact = pacts.find(x => x.id === p.id)
                      navigator.share({
                        title: pact?.occasion || 'Pact plan',
                        text: `${fmtDate(p.date)} · ${fmtHour(p.win_start)}-${fmtHour(p.win_end)}`,
                        url: window.location.origin + '/plans',
                      }).catch(() => {})
                    }
                  }} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>Share</button>
                  <button onClick={() => { setLongPressPactId(null); deletePact(p.id) }} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--red)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>{p.status === 'confirmed' ? 'Cancel Pact' : 'Delete'}</button>
                  <button onClick={() => setLongPressPactId(null)} style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', fontSize: 13, fontWeight: 600,
                    color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 10,
                  }}>Cancel</button>
                </div>
              )}
            </div>
            </div>
          )
        })
      )}

      {/* Hold-to-break pact modal */}
      {breakPactId && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setBreakPactId(null); setHoldProgress(0) } }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface2)', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 440,
          }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Break this pact?</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 20 }}>
              Everyone in this pact will be notified that you left. Hold the button below for 2 seconds to confirm.
            </p>
            <div
              onPointerDown={onHoldPointerDown}
              onPointerUp={onHoldPointerUp}
              onPointerCancel={onHoldPointerUp}
              onPointerLeave={onHoldPointerUp}
              style={{
                position: 'relative', width: '100%', height: 48, borderRadius: 12,
                background: 'var(--surface)', border: '1px solid var(--border)',
                overflow: 'hidden', cursor: 'pointer', touchAction: 'none', userSelect: 'none',
              }}
            >
              {/* Progress fill */}
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0,
                width: `${holdProgress * 100}%`,
                background: holdProgress >= 1 ? 'var(--red)' : 'var(--red-soft)',
                transition: holdProgress === 0 ? 'width 0.2s' : 'none',
              }} />
              {/* Label */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: holdProgress > 0.5 ? 'var(--red)' : 'var(--text2)',
                pointerEvents: 'none',
              }}>
                {holdProgress >= 1 ? 'Breaking...' : 'Hold to break pact'}
              </div>
            </div>
            <button
              onClick={() => { setBreakPactId(null); setHoldProgress(0) }}
              style={{
                marginTop: 12, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                background: 'transparent', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Never mind
            </button>
          </div>
        </div>
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
                  {t.name}
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

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '38%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)',
          padding: '10px 18px', borderRadius: 24, fontSize: 13, fontWeight: 600, zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
