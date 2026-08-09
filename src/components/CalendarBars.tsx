'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtTiny } from '@/lib/utils'

type BusyBlock = {
  user_id: string
  start_hour: number
  end_hour: number
  flexibility: string | null
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
}

const VIS_START = 8
const VIS_END = 23

export default function CalendarBars({
  memberIds, dateStr, userId, editable = true, pactStart, pactEnd, compact = false,
  pactId, members = [], onDateChange, visibilityDays = 7, createdBy,
}: Props) {
  const supabase = createClient()
  const [blocks, setBlocks] = useState<BusyBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [localOverrides, setLocalOverrides] = useState<Map<number, number>>(new Map())
  const [proposals, setProposals] = useState<TimeProposal[]>([])

  // Load busy blocks
  useEffect(() => {
    if (!memberIds.length || !dateStr) return
    setLoading(true)
    setLocalOverrides(new Map())
    supabase
      .from('busy_blocks')
      .select('user_id, start_hour, end_hour, flexibility')
      .in('user_id', memberIds)
      .eq('date', dateStr)
      .then(({ data }) => {
        setBlocks((data || []) as BusyBlock[])
        setLoading(false)
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

  function groupAt(h: number): 'free' | 'soft' | 'busy' {
    const states = memberIds.map(id => userStatusAt(id, h))
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
        {!pactId && pactStart !== undefined && <span style={{ fontSize: 10 }}> — set time highlighted</span>}
      </div>

      {/* Group bar with proposal avatars */}
      <div style={{ display: 'flex', gap: 2, borderRadius: 8, overflow: 'visible', position: 'relative' }}>
        {hours.map(h => {
          const st = groupAt(h)
          const inPact = pactStart !== undefined && pactEnd !== undefined && h >= pactStart && h < pactEnd
          const blocked = st === 'busy' && !inPact
          const hourProposals = proposalsAt(h)
          const iProposed = hourProposals.some(p => p.user_id === userId)
          const hasProposals = hourProposals.length > 0

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
                onClick={() => pactId ? tapGroupSlot(h) : undefined}
                style={{
                  width: '100%', height: barHeight, borderRadius: 4,
                  background: iProposed ? 'var(--accent-soft)'
                    : inPact ? 'var(--accent-soft)'
                    : st === 'free' ? 'var(--green-soft)'
                    : st === 'soft' ? 'var(--amber-soft)'
                    : 'var(--red-soft)',
                  border: iProposed ? '2px solid var(--accent)'
                    : inPact ? '1.5px solid var(--accent)'
                    : st === 'free' ? '1px solid rgba(139,176,126,0.3)'
                    : st === 'soft' ? '1px solid rgba(255,184,84,0.35)'
                    : '1px solid rgba(231,118,93,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 800,
                  color: iProposed ? 'var(--accent)' : inPact ? 'var(--accent)' : blocked ? 'var(--red)' : st === 'soft' ? 'var(--amber)' : 'transparent',
                  opacity: blocked && !pactId ? 0.5 : 1,
                  cursor: pactId && editable ? 'pointer' : blocked ? 'not-allowed' : 'default',
                  userSelect: 'none',
                  transition: 'transform 0.1s',
                }}
                onPointerDown={e => { if (pactId && editable) (e.target as HTMLElement).style.transform = 'scale(0.88)' }}
                onPointerUp={e => { (e.target as HTMLElement).style.transform = '' }}
                onPointerLeave={e => { (e.target as HTMLElement).style.transform = '' }}
              >
                {iProposed ? '✓' : inPact ? '▼' : blocked ? '✕' : st === 'soft' ? '~' : ''}
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
          return (
            <div
              key={h}
              onClick={() => editable && tapMySlot(h)}
              style={{
                flex: 1, height: barHeight, borderRadius: 4,
                background: st === 0 ? 'var(--green-soft)' : st === 1 ? 'var(--amber-soft)' : 'var(--red-soft)',
                border: st === 0 ? '1px solid rgba(139,176,126,0.3)'
                  : st === 1 ? '1px solid rgba(255,184,84,0.35)'
                  : '1px solid rgba(231,118,93,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800,
                color: st === 1 ? 'var(--amber)' : st === 2 ? 'var(--red)' : 'transparent',
                cursor: editable ? 'pointer' : 'default',
                userSelect: 'none',
                transition: 'transform 0.1s',
              }}
              onPointerDown={e => { if (editable) (e.target as HTMLElement).style.transform = 'scale(0.88)' }}
              onPointerUp={e => { (e.target as HTMLElement).style.transform = '' }}
              onPointerLeave={e => { (e.target as HTMLElement).style.transform = '' }}
            >
              {st === 1 ? '~' : st === 2 ? '✕' : ''}
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
          ...(pactId ? [{ bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'proposed' }] : []),
          ...(pactStart !== undefined && !pactId ? [{ bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'locked' }] : []),
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
    </div>
  )
}
