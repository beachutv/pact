'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtTiny } from '@/lib/utils'

type BusyBlock = {
  user_id: string
  start_hour: number
  end_hour: number
  flexibility: string | null
  source: string | null
  pact_id: string | null
}

type TimeProposal = {
  id: string
  pact_id: string
  user_id: string
  hour: number
}

type MemberInfo = {
  id: string
  name: string
  color: string
  avatar_url?: string | null
}

type Props = {
  memberIds: string[]
  dateStr: string
  userId: string
  editable?: boolean
  pactStart?: number
  pactEnd?: number
  compact?: boolean
  pactId?: string
  members?: MemberInfo[]
  onDateChange?: (date: string) => void
  visibilityDays?: number
  createdBy?: string  // user ID of plan creator — shows avatar on set time blocks
  onGroupTap?: (hour: number) => void  // for new plan flow — tap to set time range
  selectedStart?: number  // highlight selected range on group bar
  selectedEnd?: number
}

const VIS_START = 8
const VIS_END = 23

export default function CalendarBars({
  memberIds, dateStr, userId, editable = true, pactStart, pactEnd, compact = false,
  pactId, members = [], onDateChange, visibilityDays = 7, createdBy,
  onGroupTap, selectedStart, selectedEnd,
}: Props) {
  const supabase = createClient()
  const [blocks, setBlocks] = useState<BusyBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [localOverrides, setLocalOverrides] = useState<Map<number, number>>(new Map())
  const [proposals, setProposals] = useState<TimeProposal[]>([])

  // Load busy blocks
  useEffect(() => {
    if (!memberIds.length || !dateStr) return
    // Only show loading spinner on first load — subsequent date switches keep old data visible
    if (!initialLoaded) setLoading(true)
    setLocalOverrides(new Map())
    supabase
      .from('busy_blocks')
      .select('user_id, start_hour, end_hour, flexibility, source, pact_id')
      .in('user_id', memberIds)
      .eq('date', dateStr)
      .then(({ data }) => {
        setBlocks((data || []) as BusyBlock[])
        setLoading(false)
        setInitialLoaded(true)
      })
  }, [memberIds.join(','), dateStr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load time proposals + realtime subscription
  useEffect(() => {
    if (!pactId) return
    supabase
      .from('time_proposals')
      .select('id, pact_id, user_id, hour')
      .eq('pact_id', pactId)
      .then(({ data }) => {
        if (data) setProposals(data)
      })

    // Realtime subscription
    const channel = supabase
      .channel(`proposals-${pactId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'time_proposals',
        filter: `pact_id=eq.${pactId}`,
      }, () => {
        // Reload on any change
        supabase
          .from('time_proposals')
          .select('id, pact_id, user_id, hour')
          .eq('pact_id', pactId)
          .then(({ data }) => {
            if (data) setProposals(data)
          })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [pactId]) // eslint-disable-line react-hooks/exhaustive-deps

  function userStatusAt(uid: string, h: number): number {
    if (uid === userId && localOverrides.has(h)) return localOverrides.get(h)!
    const hit = blocks.find(b =>
      b.user_id === uid && b.start_hour <= h && b.end_hour > h
    )
    if (!hit) return 0
    return hit.flexibility === 'soft' ? 1 : 2
  }

  // Check if a user's busy block at hour h is from a pact
  function isPactBlockAt(uid: string, h: number): boolean {
    if (uid === userId && localOverrides.has(h)) return false
    const hit = blocks.find(b =>
      b.user_id === uid && b.start_hour <= h && b.end_hour > h
    )
    return hit?.source === 'pact'
  }

  // Check if a specific pact owns the busy block at this hour
  function isThisPactBlockAt(uid: string, h: number): boolean {
    if (!pactId) return false
    const hit = blocks.find(b =>
      b.user_id === uid && b.start_hour <= h && b.end_hour > h
    )
    return hit?.pact_id === pactId
  }

  function groupAt(h: number): 'free' | 'soft' | 'busy' {
    const states = memberIds.map(id => {
      // If a member's busy block at this hour is from THIS pact, treat as free
      // (pact's own time shouldn't show as busy on the group bar)
      if (isThisPactBlockAt(id, h)) return 0
      return userStatusAt(id, h)
    })
    if (states.every(s => s === 0)) return 'free'
    if (states.some(s => s === 2)) return 'busy'
    return 'soft'
  }

  // Get proposals at a given hour
  function proposalsAt(h: number): TimeProposal[] {
    return proposals.filter(p => p.hour === h)
  }

  // Toggle time proposal on group bar
  async function tapGroupSlot(h: number) {
    if (!pactId || !editable) return
    // If this is within the pact's set time and user is the creator, don't allow toggling
    // (the creator already proposed this time by creating the plan)
    if (pactStart !== undefined && pactEnd !== undefined && h >= pactStart && h < pactEnd && createdBy === userId) return

    const existing = proposals.find(p => p.user_id === userId && p.hour === h)
    if (existing) {
      // Remove proposal
      setProposals(prev => prev.filter(p => p.id !== existing.id))
      await supabase.from('time_proposals').delete().eq('id', existing.id)
    } else {
      // Add proposal
      const tempId = crypto.randomUUID()
      const newP: TimeProposal = { id: tempId, pact_id: pactId, user_id: userId, hour: h }
      setProposals(prev => [...prev, newP])
      const { data } = await supabase.from('time_proposals').insert({
        pact_id: pactId, user_id: userId, hour: h,
      }).select('id').single()
      if (data) {
        setProposals(prev => prev.map(p => p.id === tempId ? { ...p, id: data.id } : p))
      }
    }
  }

  // Toggle own busy slot
  async function tapMySlot(h: number) {
    if (!editable) return
    const cur = userStatusAt(userId, h)
    const next = (cur + 1) % 3
    setLocalOverrides(prev => { const m = new Map(prev); m.set(h, next); return m })

    if (next === 0) {
      await supabase.from('busy_blocks').delete()
        .eq('user_id', userId).eq('date', dateStr)
        .lte('start_hour', h).gt('end_hour', h)
    } else {
      const existing = blocks.find(b =>
        b.user_id === userId && b.start_hour <= h && b.end_hour > h
      )
      if (existing) {
        await supabase.from('busy_blocks').update({
          flexibility: next === 1 ? 'soft' : 'hard',
        }).eq('user_id', userId).eq('date', dateStr)
          .lte('start_hour', h).gt('end_hour', h)
      } else {
        await supabase.from('busy_blocks').insert({
          user_id: userId, date: dateStr,
          start_hour: h, end_hour: h + 1,
          source: 'manual',
          flexibility: next === 1 ? 'soft' : 'hard',
        })
      }
    }
  }

  function getMemberInfo(uid: string): MemberInfo | undefined {
    return members.find(m => m.id === uid)
  }

  const hours: number[] = []
  for (let h = VIS_START; h < VIS_END; h++) hours.push(h)

  if (loading) {
    return (
      <div style={{ padding: '12px 0', textAlign: 'center' }}>
        <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, margin: '0 auto' }} />
      </div>
    )
  }

  const barHeight = compact ? 24 : 32

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Date picker */}
      {onDateChange && (
        <div style={{
          display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 6,
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {Array.from({ length: visibilityDays }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() + i)
            const ds = d.toISOString().slice(0, 10)
            const isActive = ds === dateStr
            const dayName = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' })
            return (
              <button key={ds} onClick={() => onDateChange(ds)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                padding: '4px 10px', borderRadius: 10, flexShrink: 0, minWidth: 42,
                border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: isActive ? 'var(--accent-soft)' : 'var(--surface2)',
                color: isActive ? 'var(--accent)' : 'var(--text2)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}>
                <span>{dayName}</span>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{d.getDate()}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Group bar label */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <b style={{ color: 'var(--text)' }}>Group</b>
        {pactId && <span style={{ fontSize: 10 }}> — tap to propose a time</span>}
        {onGroupTap && <span style={{ fontSize: 10 }}> — tap to set time</span>}
        {!pactId && !onGroupTap && pactStart !== undefined && <span style={{ fontSize: 10 }}> — set time highlighted</span>}
      </div>

      {/* Group bar with proposal avatars */}
      <div style={{ display: 'flex', gap: 2, borderRadius: 8, overflow: 'visible', position: 'relative' }}>
        {hours.map(h => {
          const st = groupAt(h)
          const inPact = pactStart !== undefined && pactEnd !== undefined && h >= pactStart && h < pactEnd
          const inSelected = selectedStart !== undefined && selectedEnd !== undefined && h >= selectedStart && h < selectedEnd
          const blocked = st === 'busy' && !inPact && !inSelected
          const hourProposals = proposalsAt(h)
          // If user is busy at a proposed hour, show busy instead of proposed
          const userBusy = userStatusAt(userId, h) === 2
          const iProposed = hourProposals.some(p => p.user_id === userId) && !userBusy
          const hasProposals = hourProposals.length > 0 && !userBusy

          return (
            <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              {/* Mini avatars above the slot */}
              {hasProposals && (
                <div style={{
                  display: 'flex', justifyContent: 'center', minHeight: 14,
                  flexWrap: 'wrap', gap: 0,
                }}>
                  {hourProposals.slice(0, 3).map((pr, i) => {
                    const m = getMemberInfo(pr.user_id)
                    if (!m) return <div key={pr.id} style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--surface3)', marginLeft: i > 0 ? -4 : 0, border: '1px solid var(--surface)' }} />
                    return (
                      <div key={pr.id} style={{
                        width: 14, height: 14, borderRadius: '50%', background: m.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 6, fontWeight: 800, color: '#fff',
                        marginLeft: i > 0 ? -4 : 0, border: '1.5px solid var(--surface)',
                        position: 'relative', overflow: 'hidden', flexShrink: 0,
                      }}>
                        {m.name[0]}
                        {m.avatar_url && (
                          <img src={m.avatar_url} alt="" style={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            objectFit: 'cover', borderRadius: '50%',
                          }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        )}
                      </div>
                    )
                  })}
                  {hourProposals.length > 3 && (
                    <span style={{ fontSize: 6, color: 'var(--text2)', marginLeft: 1 }}>+{hourProposals.length - 3}</span>
                  )}
                </div>
              )}
              {/* Creator avatar on set time blocks (when no proposals yet) */}
              {!hasProposals && inPact && createdBy && (() => {
                const creator = getMemberInfo(createdBy)
                if (!creator) return <div style={{ minHeight: 14 }} />
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', minHeight: 14 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', background: creator.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 6, fontWeight: 800, color: '#fff',
                      border: '1.5px solid var(--accent)', position: 'relative', overflow: 'hidden',
                    }}>
                      {creator.name[0]}
                      {creator.avatar_url && (
                        <img src={creator.avatar_url} alt="" style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', borderRadius: '50%',
                        }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </div>
                  </div>
                )
              })()}
              {!hasProposals && !inPact && pactId && <div style={{ minHeight: 14 }} />}

              {/* The slot itself */}
              <div
                onClick={() => pactId ? tapGroupSlot(h) : onGroupTap ? onGroupTap(h) : undefined}
                style={{
                  width: '100%', height: barHeight, borderRadius: 4,
                  background: userBusy && (hasProposals || hourProposals.length > 0) ? 'var(--red-soft)'
                    : iProposed ? 'var(--accent-soft)'
                    : inSelected ? 'var(--accent-soft)'
                    : inPact ? 'var(--accent-soft)'
                    : st === 'free' ? 'var(--green-soft)'
                    : st === 'soft' ? 'var(--amber-soft)'
                    : 'var(--red-soft)',
                  border: userBusy && (hasProposals || hourProposals.length > 0) ? '1.5px solid rgba(231,118,93,0.5)'
                    : iProposed ? '2px solid var(--accent)'
                    : inSelected ? '2px solid var(--accent)'
                    : inPact ? '1.5px solid var(--accent)'
                    : st === 'free' ? '1px solid rgba(139,176,126,0.3)'
                    : st === 'soft' ? '1px solid rgba(255,184,84,0.35)'
                    : '1px solid rgba(231,118,93,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 800,
                  color: userBusy && hourProposals.length > 0 ? 'var(--red)'
                    : iProposed ? 'var(--accent)' : inSelected ? 'var(--accent)' : inPact ? 'var(--accent)' : blocked ? 'var(--red)' : st === 'soft' ? 'var(--amber)' : 'transparent',
                  opacity: blocked && !pactId && !onGroupTap ? 0.5 : 1,
                  cursor: (pactId || onGroupTap) && editable ? 'pointer' : blocked ? 'not-allowed' : 'default',
                  userSelect: 'none',
                  transition: 'transform 0.1s',
                }}
                onPointerDown={e => { if ((pactId || onGroupTap) && editable) (e.target as HTMLElement).style.transform = 'scale(0.88)' }}
                onPointerUp={e => { (e.target as HTMLElement).style.transform = '' }}
                onPointerLeave={e => { (e.target as HTMLElement).style.transform = '' }}
              >
                {userBusy && hourProposals.length > 0 ? '✕' : hasProposals ? '▼' : inSelected ? '▼' : inPact ? '▼' : blocked ? '✕' : st === 'soft' ? '~' : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hour labels for group */}
      <div style={{ display: 'flex', gap: 2 }}>
        {hours.map(h => (
          <span key={`g-${h}`} style={{ flex: 1, fontSize: 7, color: 'var(--text2)', textAlign: 'center', fontWeight: 600, opacity: 0.7 }}>
            {(h - VIS_START) % 2 === 0 ? fmtTiny(h) : ''}
          </span>
        ))}
      </div>

      {/* Your bar label */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <b style={{ color: 'var(--text)' }}>You</b>
        {editable && <span style={{ fontSize: 10 }}> — tap to set availability</span>}
      </div>

      {/* Your bar */}
      <div style={{ display: 'flex', gap: 2 }}>
        {hours.map(h => {
          const st = userStatusAt(userId, h)
          const isPact = isPactBlockAt(userId, h)
          const isThisPact = isThisPactBlockAt(userId, h)
          return (
            <div
              key={h}
              onClick={() => editable && !isThisPact && tapMySlot(h)}
              style={{
                flex: 1, height: barHeight, borderRadius: 4,
                background: isThisPact ? 'var(--accent-soft)'
                  : isPact ? 'var(--accent-soft)'
                  : st === 0 ? 'var(--green-soft)' : st === 1 ? 'var(--amber-soft)' : 'var(--red-soft)',
                border: isThisPact ? '1.5px solid var(--accent)'
                  : isPact ? '1px solid rgba(118,172,179,0.4)'
                  : st === 0 ? '1px solid rgba(139,176,126,0.3)'
                  : st === 1 ? '1px solid rgba(255,184,84,0.35)'
                  : '1px solid rgba(231,118,93,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800,
                color: isThisPact ? 'var(--accent)'
                  : isPact ? 'var(--accent)'
                  : st === 1 ? 'var(--amber)' : st === 2 ? 'var(--red)' : 'transparent',
                cursor: isThisPact ? 'default' : editable ? 'pointer' : 'default',
                userSelect: 'none',
                transition: 'transform 0.1s',
              }}
              onPointerDown={e => { if (editable && !isThisPact) (e.target as HTMLElement).style.transform = 'scale(0.88)' }}
              onPointerUp={e => { (e.target as HTMLElement).style.transform = '' }}
              onPointerLeave={e => { (e.target as HTMLElement).style.transform = '' }}
            >
              {(isThisPact || isPact) ? '📌' : st === 1 ? '~' : st === 2 ? '✕' : ''}
            </div>
          )
        })}
      </div>

      {/* Hour labels for you */}
      <div style={{ display: 'flex', gap: 2 }}>
        {hours.map(h => (
          <span key={`y-${h}`} style={{ flex: 1, fontSize: 7.5, color: 'var(--text2)', textAlign: 'center', fontWeight: 600 }}>
            {(h - VIS_START) % 2 === 0 ? fmtTiny(h) : ''}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {[
          { bg: 'var(--green-soft)', border: 'rgba(139,176,126,0.3)', label: 'free' },
          { bg: 'var(--amber-soft)', border: 'rgba(255,184,84,0.35)', label: 'flexible' },
          { bg: 'var(--red-soft)', border: 'rgba(231,118,93,0.3)', label: 'busy' },
          { bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'pact' },
          ...(pactId ? [{ bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'proposed' }] : []),
          ...(onGroupTap && selectedStart !== undefined ? [{ bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'selected' }] : []),
        ].map(l => (
          <span key={l.label} style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 3, display: 'inline-block',
              background: l.bg, border: `1px solid ${l.border}`,
            }} />
            {l.label}
          </span>
        ))}
      </div>

      {/* Proposal summaries per user */}
      {pactId && (() => {
        // Group proposals by user and find their contiguous time ranges
        const byUser = new Map<string, number[]>()
        proposals.forEach(p => {
          if (!byUser.has(p.user_id)) byUser.set(p.user_id, [])
          byUser.get(p.user_id)!.push(p.hour)
        })

        // Include creator's set time (win_start–win_end) as their "proposal"
        // even if they haven't added explicit time_proposals
        if (createdBy && pactStart !== undefined && pactEnd !== undefined) {
          if (!byUser.has(createdBy)) byUser.set(createdBy, [])
          const creatorHours = byUser.get(createdBy)!
          for (let h = pactStart; h < pactEnd; h++) {
            if (!creatorHours.includes(h)) creatorHours.push(h)
          }
        }

        const summaries: { uid: string; name: string; color: string; avatar_url?: string | null; ranges: string; isCreator: boolean }[] = []
        byUser.forEach((hours, uid) => {
          const m = getMemberInfo(uid)
          if (!m) return
          const sorted = [...hours].sort((a, b) => a - b)
          // Build contiguous ranges
          const ranges: [number, number][] = []
          let rStart = sorted[0], rEnd = sorted[0]
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === rEnd + 1) {
              rEnd = sorted[i]
            } else {
              ranges.push([rStart, rEnd + 1])
              rStart = sorted[i]; rEnd = sorted[i]
            }
          }
          ranges.push([rStart, rEnd + 1])
          const rangeStr = ranges.map(([s, e]) => `${fmtTiny(s)}–${fmtTiny(e)}`).join(', ')
          summaries.push({ uid, name: m.name.split(' ')[0], color: m.color, avatar_url: m.avatar_url, ranges: rangeStr, isCreator: uid === createdBy })
        })

        // Sort: creator first
        summaries.sort((a, b) => (a.isCreator ? -1 : 0) - (b.isCreator ? -1 : 0))

        if (summaries.length === 0) return null

        return (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
              Proposed times
            </p>
            {summaries.map(s => (
              <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: s.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 800, color: '#fff', flexShrink: 0,
                  position: 'relative', overflow: 'hidden',
                }}>
                  {s.name[0]}
                  {s.avatar_url && (
                    <img src={s.avatar_url} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      objectFit: 'cover', borderRadius: '50%',
                    }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                </div>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{s.name}</span>
                {s.isCreator && <span style={{ fontSize: 9, color: 'var(--text2)', fontWeight: 600 }}>(proposed)</span>}
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{s.ranges}</span>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
