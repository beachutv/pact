'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtTiny, DAY_START, DAY_END } from '@/lib/utils'

type BusyBlock = {
  user_id: string
  start_hour: number
  end_hour: number
  flexibility: string | null
}

type Props = {
  memberIds: string[]
  dateStr: string
  userId: string
  editable?: boolean
  pactStart?: number
  pactEnd?: number
  compact?: boolean
}

// Visible range: 8 AM to 11 PM (compact enough for mobile)
const VIS_START = 8
const VIS_END = 23

export default function CalendarBars({
  memberIds, dateStr, userId, editable = true, pactStart, pactEnd, compact = false,
}: Props) {
  const supabase = createClient()
  const [blocks, setBlocks] = useState<BusyBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [localOverrides, setLocalOverrides] = useState<Map<number, number>>(new Map())

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
  }, [memberIds.join(','), dateStr])

  // Get status for a specific user at a specific hour
  function userStatusAt(uid: string, h: number): number {
    // 0=free, 1=soft, 2=hard
    if (uid === userId && localOverrides.has(h)) return localOverrides.get(h)!
    const hit = blocks.find(b =>
      b.user_id === uid && b.start_hour <= h && b.end_hour > h
    )
    if (!hit) return 0
    return hit.flexibility === 'soft' ? 1 : 2
  }

  // Merged group status at a given hour
  function groupAt(h: number): 'free' | 'soft' | 'busy' {
    const states = memberIds.map(id => userStatusAt(id, h))
    if (states.every(s => s === 0)) return 'free'
    if (states.some(s => s === 2)) return 'busy'
    return 'soft'
  }

  // Toggle own slot: free → soft → hard → free
  async function tapMySlot(h: number) {
    if (!editable) return
    const cur = userStatusAt(userId, h)
    const next = (cur + 1) % 3
    setLocalOverrides(prev => {
      const m = new Map(prev)
      m.set(h, next)
      return m
    })

    // Persist: if free, delete any block at this hour. If soft/hard, upsert.
    if (next === 0) {
      await supabase.from('busy_blocks').delete()
        .eq('user_id', userId).eq('date', dateStr)
        .lte('start_hour', h).gt('end_hour', h)
    } else {
      // Check if a block exists at this hour
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
  const fontSize = compact ? 7 : 8

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Group bar */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <b style={{ color: 'var(--text)' }}>Group</b>
        {pactStart !== undefined && <span style={{ fontSize: 10 }}> — locked time highlighted</span>}
      </div>
      <div style={{ display: 'flex', gap: 2, borderRadius: 8, overflow: 'hidden' }}>
        {hours.map(h => {
          const st = groupAt(h)
          const inPact = pactStart !== undefined && pactEnd !== undefined && h >= pactStart && h < pactEnd
          const blocked = st === 'busy' && !inPact
          return (
            <div key={h} style={{
              flex: 1, height: barHeight, borderRadius: 4,
              background: inPact ? 'var(--accent-soft)'
                : st === 'free' ? 'var(--green-soft)'
                : st === 'soft' ? 'var(--amber-soft)'
                : 'var(--red-soft)',
              border: inPact ? '1.5px solid var(--accent)'
                : st === 'free' ? '1px solid rgba(139,176,126,0.3)'
                : st === 'soft' ? '1px solid rgba(255,184,84,0.35)'
                : '1px solid rgba(231,118,93,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize, fontWeight: 800,
              color: inPact ? 'var(--accent)' : blocked ? 'var(--red)' : st === 'soft' ? 'var(--amber)' : 'transparent',
              opacity: blocked ? 0.5 : 1,
              cursor: blocked ? 'not-allowed' : 'default',
            }}>
              {inPact ? '▼' : blocked ? '✕' : st === 'soft' ? '~' : ''}
            </div>
          )
        })}
      </div>

      {/* Your bar */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <b style={{ color: 'var(--text)' }}>You</b>
        {editable && <span style={{ fontSize: 10 }}> — tap to adjust</span>}
      </div>
      <div style={{ display: 'flex', gap: 2, borderRadius: 8, overflow: 'hidden' }}>
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
                fontSize, fontWeight: 800,
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

      {/* Time axis — show every 2nd hour label */}
      <div style={{ display: 'flex', gap: 2 }}>
        {hours.map(h => (
          <span key={h} style={{
            flex: 1, fontSize: 7.5, color: 'var(--text2)', textAlign: 'center', fontWeight: 600,
          }}>
            {(h - VIS_START) % 2 === 0 ? fmtTiny(h) : ''}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        {[
          { bg: 'var(--green-soft)', border: 'rgba(139,176,126,0.3)', label: 'free' },
          { bg: 'var(--amber-soft)', border: 'rgba(255,184,84,0.35)', label: 'flexible' },
          { bg: 'var(--red-soft)', border: 'rgba(231,118,93,0.3)', label: 'busy' },
          ...(pactStart !== undefined ? [{ bg: 'var(--accent-soft)', border: 'var(--accent)', label: 'locked' }] : []),
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
