'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCircle } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { fmtDate, fmtHour, fmtWin, txtOn } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { sendPushNotification } from '@/lib/push'
import LocationPicker from '@/components/LocationPicker'
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
  circle_id: string | null
  created_by: string | null
  status: string
  members: { user_id: string }[]
  declines: { user_id: string }[]
}

type MemberInfo = { id: string; name: string; color: string }

type PactComment = {
  id: string
  pact_id: string
  user_id: string
  text: string
  created_at: string
}

type PactResponse = {
  pact_id: string
  user_id: string
  response: 'yes' | 'maybe' | 'no'
}

export default function PlansPage() {
  const { user, activeCircle, circleMembers, circleFilter, circles } = useCircle()
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pacts, setPacts] = useState<Pact[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingToCalendar, setAddingToCalendar] = useState<string | null>(null)

  // Comments
  const [comments, setComments] = useState<Record<string, PactComment[]>>({})
  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  // Voting / responses
  const [responses, setResponses] = useState<Record<string, PactResponse[]>>({})

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



  // Expandable pact cards
  const [expandedPactId, setExpandedPactId] = useState<string | null>(null)

  // Plan tabs
  const [planTab, setPlanTab] = useState<'active' | 'upcoming' | 'past'>('active')
  
  // Track locally declined pacts (user tapped "Can't make it")
  const [declinedPacts, setDeclinedPacts] = useState<Set<string>>(new Set())

  // Cache of all member profiles seen across all loaded pacts
  const [allMembersCache, setAllMembersCache] = useState<Map<string, MemberInfo>>(new Map())

  // Invite more friends to a pact
  const [invitingPactId, setInvitingPactId] = useState<string | null>(null)
  const [availableFriends, setAvailableFriends] = useState<MemberInfo[]>([])
  const [selectedInvites, setSelectedInvites] = useState<Set<string>>(new Set())
  const [loadingInviteFriends, setLoadingInviteFriends] = useState(false)

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
        link: `/plans?pact=${breakPactId}`,
      })
    }

    // Push notification
    sendPushNotification({
      userIds: otherMembers.map(m => m.user_id),
      title: `${user.name?.split(' ')[0] || 'Someone'} broke their pact`,
      body: `They left the pact for ${pactTitle}`,
      url: `/plans?pact=${breakPactId}`,
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
          link: `/plans?pact=${breakPactId}`,
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

  const onRefresh = useCallback(async () => {
    await loadPacts()
  }, [circleFilter, circles.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const { containerRef: pullRef, refreshing: pullRefreshing, pullY, indicatorText, touchHandlers } = usePullToRefresh(onRefresh)

  useEffect(() => {
    loadPacts()
  }, [circleFilter, circles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPacts() {
    const today = new Date().toISOString().slice(0, 10)
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 30)
    const pastDateStr = pastDate.toISOString().slice(0, 10)

    // Build queries
    let upcomingQuery = supabase
      .from('pacts')
      .select('*, members:pact_members(user_id), declines:pact_declines(user_id)')
      .gte('date', today)
      .order('date', { ascending: true })

    let pastQuery = supabase
      .from('pacts')
      .select('*, members:pact_members(user_id), declines:pact_declines(user_id)')
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(20)
      .gte('date', pastDateStr)

    if (circleFilter) {
      upcomingQuery = upcomingQuery.eq('circle_id', circleFilter)
      pastQuery = pastQuery.eq('circle_id', circleFilter)
    }

    // Fetch upcoming + past in parallel
    const [{ data: upcoming }, { data: past }] = await Promise.all([upcomingQuery, pastQuery])
    const all = [...(upcoming || []), ...(past || [])]
    setPacts(all.map(p => ({ ...p, declines: p.declines || [] })))

    // Build member cache + load comments + responses in parallel
    const pactIds = all.map(p => p.id)
    const mIds = new Set<string>()
    all.forEach(p => {
      p.members?.forEach((m: any) => mIds.add(m.user_id))
      p.declines?.forEach((d: any) => mIds.add(d.user_id))
      if (p.created_by) mIds.add(p.created_by)
    })
    const unknownIds = [...mIds].filter(id => !circleMembers.find(m => m.id === id) && id !== user.id)

    // Run all secondary queries in parallel
    const promises: Promise<void>[] = []
    if (unknownIds.length > 0) {
      promises.push(Promise.resolve(
        supabase.from('users').select('id, name, color, avatar_url').in('id', unknownIds)
      ).then(({ data: profiles }) => {
        if (profiles) {
          setAllMembersCache(prev => {
            const next = new Map(prev)
            profiles.forEach((p: any) => next.set(p.id, { id: p.id, name: p.name, color: p.color }))
            return next
          })
        }
      }))
    }
    if (pactIds.length > 0) {
      promises.push(Promise.resolve(
        supabase.from('pact_comments').select('*').in('pact_id', pactIds)
          .order('created_at', { ascending: true })
      ).then(({ data: cmts }) => {
        if (cmts) {
          const grouped: Record<string, PactComment[]> = {}
          cmts.forEach((c: PactComment) => {
            if (!grouped[c.pact_id]) grouped[c.pact_id] = []
            grouped[c.pact_id].push(c)
          })
          setComments(grouped)
        }
      }))
      promises.push(Promise.resolve(
        supabase.from('pact_responses').select('*').in('pact_id', pactIds)
      ).then(({ data: resps }) => {
        if (resps) {
          const groupedR: Record<string, PactResponse[]> = {}
          resps.forEach((r: PactResponse) => {
            if (!groupedR[r.pact_id]) groupedR[r.pact_id] = []
            groupedR[r.pact_id].push(r)
          })
          setResponses(groupedR)
        }
      }))
    }
    await Promise.all(promises)
    setLoading(false)
  }

  // Auto-expand a specific plan if linked via ?pact=<id>
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (loading || deepLinkHandled.current) return
    const targetPact = searchParams.get('pact')
    if (targetPact && pacts.some(p => p.id === targetPact)) {
      setExpandedPactId(targetPact)
      deepLinkHandled.current = true
      // Clean up the URL without re-rendering
      window.history.replaceState({}, '', '/plans')
      // Scroll to the card after a tick
      setTimeout(() => {
        document.getElementById(`pact-${targetPact}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [loading, pacts, searchParams])

  async function addToCalendar(p: Pact) {
    setAddingToCalendar(p.id)
    try {
      const confirmedOthers = p.members
        .filter(m => m.user_id !== user.id)
        .map(m => getMember(m.user_id)?.name.split(' ')[0])
        .filter(Boolean) as string[]
      const res = await fetch('/api/calendar/push-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pactId: p.id,
          occasion: p.occasion || null,
          spotName: p.spot_name !== 'TBD' ? p.spot_name : null,
          otherNames: confirmedOthers,
          circleName: circles.find(c => c.id === p.circle_id)?.name || '',
          date: p.date,
          startHour: p.win_start,
          endHour: p.win_end,
          location: p.spot_name !== 'TBD' && p.spot_area
            ? `${p.spot_name}, ${p.spot_area}`
            : p.spot_name !== 'TBD' ? p.spot_name : undefined,
          confirmed: p.status === 'confirmed',
          totalCircleMembers: circleMembers.length,
          pactMemberCount: p.members.length,
        }),
      })
      const data = await res.json()
      if (data.needsReconnect) {
        showToast('Calendar session expired — reconnect in Settings')
      } else if (data.ok) {
        showToast('Added to your calendar')
      } else if (data.error === 'No calendar connected') {
        showToast('Connect your calendar in Settings first')
      } else {
        showToast('Could not add to calendar')
      }
    } catch {
      showToast('Could not add to calendar')
    }
    setAddingToCalendar(null)
  }

  async function votePact(pactId: string, vote: 'yes' | 'maybe' | 'no') {
    // Optimistic update
    setResponses(prev => {
      const existing = (prev[pactId] || []).filter(r => r.user_id !== user.id)
      return { ...prev, [pactId]: [...existing, { pact_id: pactId, user_id: user.id, response: vote }] }
    })
    await supabase.from('pact_responses').upsert(
      { pact_id: pactId, user_id: user.id, response: vote },
      { onConflict: 'pact_id,user_id' }
    )
  }

  async function addComment(pactId: string) {
    const text = commentText.trim()
    if (!text) return
    setSendingComment(true)
    const { data, error } = await supabase
      .from('pact_comments')
      .insert({ pact_id: pactId, user_id: user.id, text })
      .select()
      .single()
    if (data) {
      setComments(prev => ({
        ...prev,
        [pactId]: [...(prev[pactId] || []), data as PactComment],
      }))
      setCommentText('')
    }
    setSendingComment(false)
  }

  async function deleteComment(commentId: string, pactId: string) {
    await supabase.from('pact_comments').delete().eq('id', commentId)
    setComments(prev => ({
      ...prev,
      [pactId]: (prev[pactId] || []).filter(c => c.id !== commentId),
    }))
  }

  function getMember(uid: string): MemberInfo | undefined {
    return circleMembers.find(m => m.id === uid) || allMembersCache.get(uid) || (uid === user.id ? { id: user.id, name: user.name, color: user.color } : undefined)
  }

  function canEdit(pact: Pact): boolean {
    return pact.created_by === user.id
  }

  async function openInviteMore(pact: Pact) {
    setInvitingPactId(pact.id)
    setSelectedInvites(new Set())
    setLoadingInviteFriends(true)
    // Load all friends, filter out those already in the pact
    const existingIds = new Set(pact.members.map(m => m.user_id))
    const friends: MemberInfo[] = []
    const seen = new Set<string>()
    // From circles
    const cIds = circles.map(c => c.id)
    if (cIds.length > 0) {
      const { data: cms } = await supabase
        .from('circle_members').select('user_id, users!user_id(id, name, color, avatar_url)').in('circle_id', cIds)
      if (cms) cms.forEach((cm: any) => {
        if (cm.users && cm.users.id !== user.id && !existingIds.has(cm.users.id) && !seen.has(cm.users.id)) {
          seen.add(cm.users.id); friends.push(cm.users)
        }
      })
    }
    // From friendships
    const { data: fships } = await supabase
      .from('friendships').select('requester_id, addressee_id')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).eq('status', 'accepted')
    if (fships) {
      const fIds = fships.map(f => f.requester_id === user.id ? f.addressee_id : f.requester_id)
        .filter(id => !seen.has(id) && !existingIds.has(id))
      if (fIds.length > 0) {
        const { data: profiles } = await supabase.from('users').select('id, name, color, avatar_url').in('id', fIds)
        if (profiles) profiles.forEach((p: any) => { if (!seen.has(p.id)) { seen.add(p.id); friends.push(p) } })
      }
    }
    setAvailableFriends(friends.sort((a, b) => a.name.localeCompare(b.name)))
    setLoadingInviteFriends(false)
  }

  async function sendInvites(pactId: string) {
    if (selectedInvites.size === 0) return
    const pact = pacts.find(p => p.id === pactId)
    const pactTitle = pact?.occasion || (pact ? fmtDate(pact.date) : 'a plan')
    const targets = Array.from(selectedInvites)
    // Add as pact members
    for (const uid of targets) {
      await supabase.from('pact_members').upsert(
        { pact_id: pactId, user_id: uid },
        { onConflict: 'pact_id,user_id' }
      )
      await supabase.from('notifications').insert({
        user_id: uid, type: 'pact_new', title: 'You\'ve been invited',
        body: `${user.name?.split(' ')[0] || 'Someone'} invited you to: ${pactTitle}`,
        link: `/plans?pact=${pactId}`,
      })
    }
    sendPushNotification({
      userIds: targets, title: 'You\'ve been invited',
      body: `${user.name?.split(' ')[0] || 'Someone'} invited you to: ${pactTitle}`,
      url: `/plans?pact=${pactId}`,
    }).catch(() => {})
    setInvitingPactId(null)
    setSelectedInvites(new Set())
    showToast(`Invited ${targets.length} friend${targets.length === 1 ? '' : 's'}`)
    loadPacts()
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
            link: `/plans?pact=${pactId}`,
          })
        }
        sendPushNotification({
          userIds: allOtherIds,
          title: notifTitle,
          body: notifBody,
          url: `/plans?pact=${pactId}`,
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
          link: `/plans?pact=${pactId}`,
        })
      }
      // Update status to 'cancelled' instead of deleting
      await supabase.from('pacts').update({ status: 'cancelled' }).eq('id', pactId)

      // Push notification to all members about cancellation
      sendPushNotification({
        userIds: otherMembers.map(m => m.user_id),
        title: `${cancelTitle} cancelled`,
        body: `${user.name?.split(' ')[0] || 'Someone'} cancelled the pact on ${fmtDate(pact.date)}`,
        url: `/plans?pact=${pactId}`,
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

      {/* Plan tabs */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        {(['active', 'upcoming', 'past'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setPlanTab(tab)}
            style={{
              padding: '7px 14px', borderRadius: 18, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              border: planTab === tab ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
              background: planTab === tab ? 'var(--accent-soft)' : 'var(--surface)',
              color: planTab === tab ? 'var(--accent)' : 'var(--text2)',
            }}
          >
            {tab === 'active' ? 'Active' : tab === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>

      {(() => {
        const today = new Date().toISOString().slice(0, 10)
        const filtered = pacts.filter(p => {
          if (planTab === 'active') return p.date >= today && p.status === 'pending'
          if (planTab === 'upcoming') return p.date >= today && p.status === 'confirmed'
          return p.date < today // past
        })

        if (filtered.length === 0) return (
          <div style={{ textAlign: 'center', marginTop: 30, color: 'var(--text2)' }}>
            <p style={{ fontSize: 13 }}>
              {planTab === 'active' ? 'No active plans. Start one with + New plan!'
                : planTab === 'upcoming' ? 'Nothing locked in yet.'
                : 'No past plans yet — they show up here after the event.'}
            </p>
          </div>
        )

        return filtered.map(p => {
          const isIn = p.members.some(m => m.user_id === user.id)
          const isEditing = editingId === p.id
          const editable = canEdit(p)

          return (
            <div key={p.id} id={`pact-${p.id}`} style={{ position: 'relative' }}>
              <div
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
                /* ─── View mode — compact card, tap to open detail modal ─── */
                <>
                  <div
                    onClick={() => setExpandedPactId(p.id)}
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
                          📅 {fmtDate(p.date)} · {fmtWin(p.win_start, p.win_end)}
                        </p>
                        {p.spot_name !== 'TBD' && (
                          <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                            📍 {p.spot_name}{p.spot_area ? ` — ${p.spot_area}` : ''}
                          </p>
                        )}
                        <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                          Created by {getMember(p.created_by || '')?.name?.split(' ')[0] || 'someone'}
                        </p>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
                        textTransform: 'uppercase', letterSpacing: '.4px',
                        background: p.status === 'confirmed' ? 'var(--green-soft)' : 'var(--amber-soft)',
                        color: p.status === 'confirmed' ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {p.status === 'confirmed' ? 'locked' : 'open'}
                      </span>
                    </div>

                    {/* Who's in — always visible */}
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
                          <span style={{ color: 'var(--red)', marginLeft: 4 }}>· {p.declines.length} out</span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}

            </div>
            </div>
          )
        })
      })()}

      {/* ─── Plan Detail Modal ─── */}
      {expandedPactId && (() => {
        const p = pacts.find(x => x.id === expandedPactId)
        if (!p) return null
        const isIn = p.members.some(m => m.user_id === user.id)
        const editable = canEdit(p)
        const pactComments = comments[p.id] || []
        const pactResponses = responses[p.id] || []
        const getVote = (uid: string) => pactResponses.find(r => r.user_id === uid)?.response || null
        const isPending = p.status === 'pending'

        return (
          <div
            onClick={e => { if (e.target === e.currentTarget) setExpandedPactId(null) }}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24,
            }}
          >
            <div style={{
              background: 'var(--surface2)', borderRadius: 20, padding: 22,
              width: '100%', maxWidth: 360, maxHeight: '80vh', overflowY: 'auto',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  {p.occasion || (() => {
                    const others = p.members
                      .filter(m => m.user_id !== user.id)
                      .map(m => getMember(m.user_id)?.name.split(' ')[0])
                      .filter(Boolean)
                    return others.length > 0 ? `Pact with ${others.join(', ')}` : 'Pact'
                  })()}
                </h3>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 12,
                  textTransform: 'uppercase', letterSpacing: '.4px',
                  background: p.status === 'confirmed' ? 'var(--green-soft)' : 'var(--amber-soft)',
                  color: p.status === 'confirmed' ? 'var(--green)' : 'var(--amber)',
                }}>
                  {p.status === 'confirmed' ? 'locked' : p.status === 'cancelled' ? 'cancelled' : 'scheduling'}
                </span>
              </div>

              {/* When + where */}
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 13, color: 'var(--text2)' }}>📅 {fmtDate(p.date)} · {fmtWin(p.win_start, p.win_end)}</p>
                {p.spot_name !== 'TBD' && (
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                    📍 {p.spot_name}{p.spot_area ? ` — ${p.spot_area}` : ''}
                  </p>
                )}
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  Created by {getMember(p.created_by || '')?.name?.split(' ')[0] || 'someone'}
                </p>
              </div>

              {/* Who's in */}
              <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 16, marginBottom: 8 }}>
                Who&apos;s in ({p.members.length})
              </p>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.members.map(pm => {
                  const m = getMember(pm.user_id)
                  if (!m) return null
                  return (
                    <div key={m.id} style={{
                      width: 28, height: 28, borderRadius: '50%', background: m.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 800, color: txtOn(m.color),
                    }}>{m.name[0]}</div>
                  )
                })}
                <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 8 }}>
                  {p.members.map(pm => getMember(pm.user_id)?.name.split(' ')[0]).filter(Boolean).join(', ')}
                </span>
              </div>

              {/* Availability */}
              <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 16, marginBottom: 8 }}>
                Availability
              </p>
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
                pactId={p.id}
                createdBy={p.created_by || undefined}
                members={[
                  ...p.members.map(m => m.user_id),
                  ...(p.declines || []).map(d => d.user_id),
                ].filter((v, i, a) => a.indexOf(v) === i).map(uid => {
                  const m = getMember(uid)
                  return m ? { id: m.id, name: m.name, color: m.color, avatar_url: (m as any).avatar_url } : { id: uid, name: '?', color: '#999' }
                })}
              />

              {/* Voting buttons — for pending plans where user hasn't committed */}
              {isPending && !isIn && !declinedPacts.has(p.id) && !p.declines?.some(d => d.user_id === user.id) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  {([
                    { key: 'yes' as const, label: '✓ works', border: 'var(--green)', bg: 'var(--green-soft)', color: 'var(--green)' },
                    { key: 'maybe' as const, label: '~ maybe', border: 'var(--amber)', bg: 'var(--amber-soft)', color: 'var(--amber)' },
                    { key: 'no' as const, label: "✕ can't", border: 'var(--red)', bg: 'var(--red-soft)', color: 'var(--red)' },
                  ] as const).map(opt => {
                    const myVote = getVote(user.id)
                    const isSelected = myVote === opt.key
                    return (
                      <button key={opt.key} onClick={() => votePact(p.id, opt.key)} style={{
                        flex: 1, padding: '6px 0', borderRadius: 10,
                        border: isSelected ? `1.5px solid ${opt.border}` : '1.5px solid var(--border)',
                        background: isSelected ? opt.bg : 'var(--surface)',
                        color: isSelected ? opt.color : 'var(--text2)',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>{opt.label}</button>
                    )
                  })}
                </div>
              )}

              {/* Comments */}
              {pactComments.length > 0 && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 16, marginBottom: 8 }}>
                    Comments
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pactComments.map(c => {
                      const m = getMember(c.user_id)
                      return (
                        <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: '50%', background: m?.color || '#999',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 800, color: '#fff', flexShrink: 0,
                          }}>{m?.name?.[0] || '?'}</div>
                          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '8px 12px', flex: 1 }}>
                            <p style={{ fontSize: 11, fontWeight: 700 }}>{m?.name || 'Unknown'}</p>
                            <p style={{ fontSize: 12, color: 'var(--text)', marginTop: 2 }}>{c.text}</p>
                          </div>
                          {c.user_id === user.id && (
                            <button onClick={() => deleteComment(c.id, p.id)} style={{
                              background: 'none', border: 'none', color: 'var(--text2)',
                              fontSize: 12, cursor: 'pointer', opacity: 0.4, padding: '4px',
                            }}>✕</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Comment input */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <input type="text" placeholder="Add a comment…" value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addComment(p.id) }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5, outline: 'none' }}
                />
                <button onClick={() => addComment(p.id)} disabled={sendingComment || !commentText.trim()} style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: commentText.trim() ? 'var(--accent)' : 'var(--surface3)',
                  color: '#fff', fontSize: 14, cursor: 'pointer', flexShrink: 0, opacity: sendingComment ? 0.5 : 1,
                }}>➤</button>
              </div>

              {/* ─── Stacked action buttons (prototype style) ─── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                {isIn && (
                  <button onClick={() => addToCalendar(p)} disabled={addingToCalendar === p.id} style={{
                    width: '100%', padding: 12, borderRadius: 12, border: 'none',
                    background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    opacity: addingToCalendar === p.id ? 0.6 : 1,
                  }}>{addingToCalendar === p.id ? 'Adding...' : 'Add to calendar'}</button>
                )}
                <button onClick={() => openInviteMore(p)} style={{
                  width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  Invite friends
                </button>
                {/* Inline invite flow */}
                {invitingPactId === p.id && (
                  <div style={{
                    padding: 12, borderRadius: 12, background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                  }}>
                    {loadingInviteFriends ? (
                      <div style={{ textAlign: 'center', padding: 12 }}><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, margin: '0 auto' }} /></div>
                    ) : availableFriends.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: 8 }}>All your friends are already in this plan</p>
                    ) : (
                      <>
                        <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                          Add to this plan
                        </p>
                        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {availableFriends.map(f => {
                            const isSel = selectedInvites.has(f.id)
                            return (
                              <button key={f.id} onClick={() => {
                                setSelectedInvites(prev => { const n = new Set(prev); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })
                              }} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                                background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', width: '100%', textAlign: 'left',
                              }}>
                                <div className="avatar" style={{ background: f.color, color: '#fff', width: 26, height: 26, fontSize: 10, position: 'relative', overflow: 'hidden' }}>
                                  {f.name[0]}
                                  {(f as any).avatar_url && <img src={(f as any).avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                                </div>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                                <div style={{
                                  width: 20, height: 20, borderRadius: 6,
                                  border: isSel ? '2px solid var(--accent)' : '2px solid var(--border)',
                                  background: isSel ? 'var(--accent)' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: isSel ? '#fff' : 'transparent', fontSize: 11,
                                }}>✓</div>
                              </button>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button onClick={() => setInvitingPactId(null)} style={{
                            flex: 1, padding: 8, borderRadius: 10, border: '1px solid var(--border)',
                            background: 'var(--surface)', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}>Cancel</button>
                          <button onClick={() => sendInvites(p.id)} disabled={selectedInvites.size === 0} style={{
                            flex: 1, padding: 8, borderRadius: 10, border: 'none',
                            background: selectedInvites.size ? 'var(--accent)' : 'var(--surface3)',
                            color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}>Invite {selectedInvites.size || ''}</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <button onClick={() => {
                  const pactTitle = p.occasion || fmtDate(p.date)
                  const shareUrl = `${window.location.origin}/plans/invite/${p.id}`
                  const shareText = `${pactTitle} — ${fmtDate(p.date)}, ${fmtWin(p.win_start, p.win_end)}`
                  if (navigator.share) {
                    navigator.share({ title: pactTitle, text: shareText, url: shareUrl }).catch(() => {})
                  } else { navigator.clipboard.writeText(`${shareText}\n${shareUrl}`); showToast('Copied to clipboard') }
                }} style={{
                  width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>Share link</button>
                {editable && (
                  <button onClick={() => { setExpandedPactId(null); startEditing(p) }} style={{
                    width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}>Edit plan</button>
                )}
                {isIn ? (
                  <button onClick={() => { setExpandedPactId(null); startHoldBreak(p.id) }} style={{
                    width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--red)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}>Opt out</button>
                ) : !declinedPacts.has(p.id) && !p.declines?.some(d => d.user_id === user.id) ? (
                  <>
                    <button onClick={async () => { await joinPact(p.id); showToast("You're in!") }} style={{
                      width: '100%', padding: 12, borderRadius: 12, border: 'none',
                      background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>I&apos;m in</button>
                    <button onClick={async () => {
                      const pactTitle = p.occasion || fmtDate(p.date)
                      const allOtherIds = p.members.map(m => m.user_id).filter(id => id !== user.id)
                      if (p.created_by && !allOtherIds.includes(p.created_by) && p.created_by !== user.id) allOtherIds.push(p.created_by)
                      await supabase.from('pact_declines').upsert({ pact_id: p.id, user_id: user.id }, { onConflict: 'pact_id,user_id' })
                      fetch('/api/calendar/delete-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pactId: p.id }) }).catch(() => {})
                      await supabase.from('busy_blocks').delete().eq('pact_id', p.id).eq('user_id', user.id)
                      setDeclinedPacts(prev => new Set([...prev, p.id]))
                      for (const uid of allOtherIds) { await supabase.from('notifications').insert({ user_id: uid, type: 'pact_change', title: `${user.name?.split(' ')[0] || 'Someone'} can't make it`, body: `Declined ${pactTitle}`, link: `/plans?pact=${p.id}` }) }
                      if (allOtherIds.length > 0) { sendPushNotification({ userIds: allOtherIds, title: `${user.name?.split(' ')[0] || 'Someone'} can't make it`, body: `Declined ${pactTitle}`, url: `/plans?pact=${p.id}`, tag: `decline-${p.id}` }) }
                      await loadPacts(); showToast('The group has been informed'); setExpandedPactId(null)
                    }} style={{
                      width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--red)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>Opt out</button>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <p style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>You declined this pact</p>
                    <button onClick={async () => {
                      setDeclinedPacts(prev => { const n = new Set(prev); n.delete(p.id); return n })
                      await supabase.from('pact_declines').delete().eq('pact_id', p.id).eq('user_id', user.id)
                      await loadPacts()
                    }} style={{
                      marginTop: 6, padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}>Changed my mind</button>
                  </div>
                )}
              </div>

              {/* Close button */}
              <button onClick={() => setExpandedPactId(null)} style={{
                marginTop: 16, width: '100%', padding: 12, borderRadius: 12,
                border: '1px solid var(--border)', background: 'none',
                color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Close</button>
            </div>
          </div>
        )
      })()}
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
