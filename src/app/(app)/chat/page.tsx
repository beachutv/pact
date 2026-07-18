'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useCircle, type UserProfile } from '@/components/AppShell'
import { createClient } from '@/lib/supabase/client'
import { txtOn, fmtDate, fmtHour, AVATAR_COLORS } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

type Thread = {
  id: string
  name: string | null
  circle_id: string | null
  color: string | null
  member_ids: string[]
  last_message_at: string | null
  last_message_preview: string | null
}

type Message = {
  id: string
  thread_id: string
  from_user: string
  text: string | null
  date_card: string | null
  win_start: number | null
  win_end: number | null
  spot_name: string | null
  spot_emoji: string | null
  spot_area: string | null
  spot_avg_travel: number | null
  with_user_ids: string[] | null
  group_n: number | null
  free_n: number | null
  confirmed: boolean
  created_at: string
  rsvps: { user_id: string; response: string }[]
}

export default function ChatPage() {
  const { user, activeCircle, circleMembers } = useCircle()
  const supabase = createClient()

  const [threads, setThreads] = useState<Thread[]>([])
  const [threadReads, setThreadReads] = useState<Record<string, string>>({})
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [newChatSelected, setNewChatSelected] = useState<Set<string>>(new Set())

  // Group settings
  const [showSettings, setShowSettings] = useState(false)
  const [editGroupName, setEditGroupName] = useState('')
  const [editGroupColor, setEditGroupColor] = useState('')
  const [addMemberPick, setAddMemberPick] = useState<Set<string>>(new Set())

  // Multi-select
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Swipe state
  const [swipedThreadId, setSwipedThreadId] = useState<string | null>(null)
  const swipeStartX = useRef(0)
  const swipeCurrentX = useRef(0)
  const swipingRef = useRef(false)

  // Long-press preview
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onChatRefresh = useCallback(async () => { await loadThreads() }, [activeCircle?.id])
  const { containerRef: chatPullRef, refreshing: chatPullRefreshing, pullY: chatPullY, indicatorText: chatIndicator, touchHandlers: chatTouchHandlers } = usePullToRefresh(onChatRefresh)

  // ─── Load threads ───
  useEffect(() => {
    if (!activeCircle) { setLoading(false); return }
    loadThreads()
  }, [activeCircle?.id])

  async function loadThreads() {
    const { data: tms } = await supabase
      .from('thread_members').select('thread_id').eq('user_id', user.id)
    if (!tms || tms.length === 0) { setThreads([]); setLoading(false); return }

    const threadIds = tms.map(t => t.thread_id)
    const { data: threadData } = await supabase
      .from('threads').select('*').in('id', threadIds)
    if (!threadData) { setLoading(false); return }

    const { data: reads } = await supabase
      .from('thread_reads').select('thread_id, last_read_at').eq('user_id', user.id)
    const readMap: Record<string, string> = {}
    if (reads) reads.forEach(r => { readMap[r.thread_id] = r.last_read_at })
    setThreadReads(readMap)

    const result: Thread[] = []
    for (const t of threadData) {
      if (t.circle_id && t.circle_id !== activeCircle?.id) continue
      const { data: members } = await supabase
        .from('thread_members').select('user_id').eq('thread_id', t.id)
      result.push({ ...t, member_ids: members?.map(m => m.user_id) || [] })
    }

    result.sort((a, b) => {
      const aT = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bT = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bT - aT
    })

    setThreads(result)
    setLoading(false)
  }

  // ─── Load messages ───
  useEffect(() => {
    if (!activeThreadId) return
    loadMessages(activeThreadId)
    markAsRead(activeThreadId)

    const channel = supabase
      .channel(`messages:${activeThreadId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `thread_id=eq.${activeThreadId}`,
      }, (payload) => {
        const newMsg = payload.new as any
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev
          return [...prev, { ...newMsg, rsvps: [] }]
        })
        scrollToBottom()
        markAsRead(activeThreadId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps' }, () => {
        loadMessages(activeThreadId)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeThreadId])

  async function loadMessages(threadId: string) {
    const { data: msgs } = await supabase
      .from('messages').select('*').eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    if (!msgs) return

    const dateCardMsgIds = msgs.filter(m => m.date_card).map(m => m.id)
    let rsvpMap: Record<string, { user_id: string; response: string }[]> = {}
    if (dateCardMsgIds.length > 0) {
      const { data: rsvps } = await supabase
        .from('rsvps').select('message_id, user_id, response').in('message_id', dateCardMsgIds)
      if (rsvps) for (const r of rsvps) {
        if (!rsvpMap[r.message_id]) rsvpMap[r.message_id] = []
        rsvpMap[r.message_id].push({ user_id: r.user_id, response: r.response })
      }
    }

    setMessages(msgs.map(m => ({ ...m, rsvps: rsvpMap[m.id] || [] })))
    scrollToBottom()
  }

  async function markAsRead(threadId: string) {
    const now = new Date().toISOString()
    await supabase.from('thread_reads').upsert(
      { thread_id: threadId, user_id: user.id, last_read_at: now },
      { onConflict: 'thread_id,user_id' }
    )
    setThreadReads(prev => ({ ...prev, [threadId]: now }))
  }

  async function markAsUnread(threadId: string) {
    // Set last_read_at to epoch to make it appear unread
    await supabase.from('thread_reads').upsert(
      { thread_id: threadId, user_id: user.id, last_read_at: '2000-01-01T00:00:00Z' },
      { onConflict: 'thread_id,user_id' }
    )
    setThreadReads(prev => ({ ...prev, [threadId]: '2000-01-01T00:00:00Z' }))
  }

  function scrollToBottom() {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 100)
  }

  function getMember(uid: string): UserProfile | undefined {
    return circleMembers.find(m => m.id === uid)
  }

  function isUnread(t: Thread): boolean {
    if (!t.last_message_at) return false
    const readAt = threadReads[t.id]
    if (!readAt) return true
    return new Date(t.last_message_at) > new Date(readAt)
  }

  function threadDisplayName(t: Thread): string {
    if (t.name) return t.name
    if (t.circle_id) return activeCircle?.name || 'Group'
    const others = t.member_ids.filter(id => id !== user.id)
    return others.map(id => getMember(id)?.name || 'Unknown').join(', ')
  }

  function threadAvatar(t: Thread): { color: string; initial: string; avatarUrl?: string } {
    if (t.color) return { color: t.color, initial: (t.name || 'G')[0] }
    if (t.circle_id) return { color: '#7c5cff', initial: activeCircle?.emoji || 'G' }
    const others = t.member_ids.filter(id => id !== user.id)
    if (others.length === 1) {
      const m = getMember(others[0])
      return { color: m?.color || '#666', initial: m?.name[0] || '?', avatarUrl: m?.avatar_url || undefined }
    }
    return { color: '#636a80', initial: `${others.length}` }
  }

  function relativeTime(ts: string | null): string {
    if (!ts) return ''
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d`
    return `${Math.floor(days / 7)}w`
  }

  // ─── Send message ───
  async function sendMessage() {
    if (!inputText.trim() || !activeThreadId || sending) return
    setSending(true)
    const text = inputText.trim()
    setInputText('')
    await supabase.from('messages').insert({ thread_id: activeThreadId, from_user: user.id, text })
    setSending(false)
    inputRef.current?.focus()
  }

  async function handleRsvp(messageId: string) {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    const existing = msg.rsvps.find(r => r.user_id === user.id)
    if (existing) {
      await supabase.from('rsvps').delete().eq('message_id', messageId).eq('user_id', user.id)
    } else {
      await supabase.from('rsvps').upsert({ message_id: messageId, user_id: user.id, response: 'in' })
    }
    await loadMessages(activeThreadId!)
  }

  // ─── Create new chat (with dedup) ───
  async function createNewChat() {
    if (newChatSelected.size === 0) return
    const memberIds = [user.id, ...Array.from(newChatSelected)].sort()

    const { data: myThreads } = await supabase
      .from('thread_members').select('thread_id').eq('user_id', user.id)
    if (myThreads) {
      for (const { thread_id } of myThreads) {
        const { data: tms } = await supabase
          .from('thread_members').select('user_id').eq('thread_id', thread_id)
        if (tms) {
          const existing = tms.map(t => t.user_id).sort()
          if (existing.length === memberIds.length && existing.every((id, i) => id === memberIds[i])) {
            setActiveThreadId(thread_id)
            setShowNewChat(false)
            setNewChatSelected(new Set())
            return
          }
        }
      }
    }

    const isGroup = memberIds.length > 2
    const threadId = crypto.randomUUID()
    await supabase.from('threads').insert({
      id: threadId, name: isGroup ? null : null,
      circle_id: isGroup ? activeCircle?.id : null,
    })
    await supabase.from('thread_members').insert(
      memberIds.map(uid => ({ thread_id: threadId, user_id: uid }))
    )

    setShowNewChat(false)
    setNewChatSelected(new Set())
    await loadThreads()
    setActiveThreadId(threadId)
  }

  async function createGroupChat() {
    if (!activeCircle) return
    const existing = threads.find(t => t.circle_id === activeCircle.id)
    if (existing) { setActiveThreadId(existing.id); return }

    const threadId = crypto.randomUUID()
    await supabase.from('threads').insert({
      id: threadId, name: activeCircle.name, circle_id: activeCircle.id,
    })
    await supabase.from('thread_members').insert(
      circleMembers.map(m => ({ thread_id: threadId, user_id: m.id }))
    )
    await loadThreads()
    setActiveThreadId(threadId)
  }

  // ─── Delete thread (CASCADE handles children) ───
  async function deleteThread(threadId?: string) {
    const tid = threadId || activeThreadId
    if (!tid) return
    if (!threadId && !confirm('Delete this chat? All messages will be lost.')) return
    await supabase.from('threads').delete().eq('id', tid)
    if (tid === activeThreadId) setActiveThreadId(null)
    setShowSettings(false)
    setThreads(prev => prev.filter(t => t.id !== tid))
  }

  // ─── Bulk actions ───
  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} chat${selected.size > 1 ? 's' : ''}?`)) return
    for (const tid of selected) {
      await supabase.from('threads').delete().eq('id', tid)
    }
    setThreads(prev => prev.filter(t => !selected.has(t.id)))
    setSelected(new Set())
    setSelectMode(false)
  }

  async function bulkMarkRead() {
    for (const tid of selected) await markAsRead(tid)
    setSelected(new Set())
    setSelectMode(false)
  }

  async function bulkMarkUnread() {
    for (const tid of selected) await markAsUnread(tid)
    setSelected(new Set())
    setSelectMode(false)
  }

  function toggleSelect(tid: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tid)) next.delete(tid); else next.add(tid)
      return next
    })
  }

  // ─── Swipe handlers ───
  function onSwipeStart(e: React.TouchEvent, tid: string) {
    swipeStartX.current = e.touches[0].clientX
    swipeCurrentX.current = e.touches[0].clientX
    swipingRef.current = false
  }

  function onSwipeMove(e: React.TouchEvent, tid: string) {
    const dx = e.touches[0].clientX - swipeStartX.current
    swipeCurrentX.current = e.touches[0].clientX
    if (dx < -20) {
      swipingRef.current = true
      setSwipedThreadId(tid)
    }
  }

  function onSwipeEnd(tid: string) {
    const dx = swipeCurrentX.current - swipeStartX.current
    if (dx < -80) {
      // Swiped far enough — keep delete button visible
      setSwipedThreadId(tid)
    } else {
      setSwipedThreadId(null)
    }
  }

  // ─── Group settings ───
  function openSettings() {
    const t = threads.find(t => t.id === activeThreadId)
    if (!t) return
    setEditGroupName(t.name || '')
    setEditGroupColor(t.color || '')
    setAddMemberPick(new Set())
    setShowSettings(true)
  }

  async function saveGroupSettings() {
    if (!activeThreadId) return
    await supabase.from('threads').update({
      name: editGroupName || null, color: editGroupColor || null,
    }).eq('id', activeThreadId)

    if (addMemberPick.size > 0) {
      await supabase.from('thread_members').insert(
        Array.from(addMemberPick).map(uid => ({ thread_id: activeThreadId, user_id: uid }))
      )
    }

    setShowSettings(false)
    await loadThreads()
  }

  // ─── Long press ───
  function onMsgTouchStart(msg: Message) {
    longPressTimer.current = setTimeout(() => setPreviewMsg(msg), 500)
  }
  function onMsgTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  // ─── Render: no circle ───
  if (!activeCircle) {
    return (
      <div style={{ padding: 20, textAlign: 'center', marginTop: 40, color: 'var(--text2)' }}>
        <p style={{ fontSize: 40, marginBottom: 8 }}>💬</p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Chat</p>
        <p style={{ fontSize: 13 }}>Join a circle to start chatting.</p>
      </div>
    )
  }

  if (loading) return <div style={{ padding: 20 }}><div className="spinner" /></div>

  // ─── No threads ───
  if (threads.length === 0 && !activeThreadId) {
    return (
      <div style={{ padding: 20, textAlign: 'center', marginTop: 40 }}>
        <p style={{ fontSize: 40, marginBottom: 8 }}>💬</p>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Start chatting</p>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
          Create the group chat for {activeCircle.name} or message someone directly.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 260, margin: '0 auto' }}>
          <button className="btn-primary" onClick={createGroupChat}>💬 Create group chat</button>
          <button className="btn-secondary" onClick={() => setShowNewChat(true)}>+ New message</button>
        </div>
        {renderNewChatModal()}
      </div>
    )
  }

  const activeThread = threads.find(t => t.id === activeThreadId)

  // ─── Thread list view ───
  if (!activeThreadId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {renderThreadList()}
        {renderNewChatModal()}
      </div>
    )
  }

  // ─── Render helpers ───
  function renderThreadList() {
    return (
      <div ref={chatPullRef} {...chatTouchHandlers} style={{ flex: 1, overflowY: 'auto' }}>
        {(chatPullY > 0 || chatPullRefreshing) && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', padding: '6px 0',
            transform: `translateY(${chatPullY > 0 ? chatPullY - 30 : 0}px)`,
            transition: chatPullY === 0 ? 'transform 0.2s' : 'none',
          }}>
            {chatIndicator}
          </div>
        )}
        {/* Header */}
        <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 800 }}>Messages</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {selectMode ? (
              <>
                <button onClick={bulkMarkRead} disabled={selected.size === 0} style={{
                  background: 'var(--surface2)', border: 'none', borderRadius: 16,
                  padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', cursor: 'pointer',
                }}>Read</button>
                <button onClick={bulkMarkUnread} disabled={selected.size === 0} style={{
                  background: 'var(--surface2)', border: 'none', borderRadius: 16,
                  padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', cursor: 'pointer',
                }}>Unread</button>
                <button onClick={bulkDelete} disabled={selected.size === 0} style={{
                  background: 'var(--red-soft)', border: 'none', borderRadius: 16,
                  padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--red)', cursor: 'pointer',
                }}>Delete</button>
                <button onClick={() => { setSelectMode(false); setSelected(new Set()) }} style={{
                  background: 'none', border: 'none', fontSize: 11, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer',
                }}>Done</button>
              </>
            ) : (
              <>
                <button onClick={() => setSelectMode(true)} style={{
                  background: 'var(--surface2)', border: 'none', borderRadius: 16,
                  padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', cursor: 'pointer',
                }}>Select</button>
                <button onClick={() => setShowNewChat(true)} style={{
                  background: 'var(--accent)', border: 'none', borderRadius: 20,
                  padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer',
                }}>+ New</button>
              </>
            )}
          </div>
        </div>

        {/* Thread rows */}
        {threads.map(t => {
          const av = threadAvatar(t)
          const unread = isUnread(t)
          const isSwiped = swipedThreadId === t.id

          return (
            <div key={t.id} style={{ position: 'relative', overflow: 'hidden' }}>
              {/* Delete button behind */}
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: 80, background: 'var(--red)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <button onClick={() => deleteThread(t.id)} style={{
                  background: 'none', border: 'none', color: '#fff',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>Delete</button>
              </div>

              {/* Swipeable row */}
              <div
                onTouchStart={e => onSwipeStart(e, t.id)}
                onTouchMove={e => onSwipeMove(e, t.id)}
                onTouchEnd={() => onSwipeEnd(t.id)}
                onClick={() => {
                  if (swipingRef.current) return
                  if (selectMode) { toggleSelect(t.id); return }
                  setActiveThreadId(t.id)
                  markAsRead(t.id)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', cursor: 'pointer',
                  background: selected.has(t.id) ? 'var(--accent-soft)' : 'var(--bg)',
                  transform: isSwiped ? 'translateX(-80px)' : 'translateX(0)',
                  transition: 'transform 0.2s ease',
                  position: 'relative', zIndex: 1,
                }}
              >
                {/* Select checkbox */}
                {selectMode && (
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    border: selected.has(t.id) ? 'none' : '2px solid var(--border)',
                    background: selected.has(t.id) ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 800,
                  }}>
                    {selected.has(t.id) && '✓'}
                  </div>
                )}

                {/* Avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                  background: av.avatarUrl ? `url(${av.avatarUrl}) center/cover` : av.color,
                  color: txtOn(av.color), display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: av.avatarUrl ? 0 : 18, fontWeight: 800,
                }}>
                  {!av.avatarUrl && av.initial}
                </div>

                {/* Name + preview */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: 14, fontWeight: unread ? 800 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {threadDisplayName(t)}
                    </p>
                    <span style={{ fontSize: 11, color: unread ? 'var(--accent)' : 'var(--text2)', flexShrink: 0, marginLeft: 8 }}>
                      {relativeTime(t.last_message_at)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <p style={{
                      fontSize: 13, color: unread ? 'var(--text)' : 'var(--text2)',
                      fontWeight: unread ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.last_message_preview || 'No messages yet'}
                    </p>
                    {unread && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: 'var(--accent)', flexShrink: 0,
                      }} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderNewChatModal() {
    if (!showNewChat) return null
    return (
      <div
        onClick={e => { if (e.target === e.currentTarget) setShowNewChat(false) }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ background: 'var(--surface)', borderRadius: 20, padding: 20, width: '90%', maxWidth: 360 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>New chat</h3>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
            Pick one friend for a DM, or several for a group.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {circleMembers.filter(m => m.id !== user.id).map(m => {
              const on = newChatSelected.has(m.id)
              return (
                <button key={m.id} onClick={() => {
                  setNewChatSelected(prev => {
                    const next = new Set(prev)
                    if (next.has(m.id)) next.delete(m.id); else next.add(m.id)
                    return next
                  })
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 20, border: 'none',
                  background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                  color: on ? 'var(--text)' : 'var(--text2)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', background: m.color,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800, color: txtOn(m.color),
                  }}>{m.name[0]}</span>
                  {m.name}
                </button>
              )
            })}
          </div>
          <button className="btn-primary" onClick={createNewChat} disabled={newChatSelected.size === 0} style={{ width: '100%' }}>
            Start chat
          </button>
          <button onClick={() => { setShowNewChat(false); setNewChatSelected(new Set()) }} style={{
            marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
            background: 'transparent', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    )
  }

  function renderSettingsModal() {
    if (!showSettings || !activeThread) return null
    const currentMemberIds = new Set(activeThread.member_ids)
    const addable = circleMembers.filter(m => !currentMemberIds.has(m.id))
    return (
      <div
        onClick={e => { if (e.target === e.currentTarget) setShowSettings(false) }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ background: 'var(--surface)', borderRadius: 20, padding: 20, width: '90%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Chat settings</h3>

          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Chat name</label>
          <input
            value={editGroupName} onChange={e => setEditGroupName(e.target.value)}
            placeholder={threadDisplayName(activeThread)}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 12, marginTop: 4, marginBottom: 12,
              background: 'var(--surface2)', border: 'none', color: 'var(--text)', fontSize: 14,
            }}
          />

          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, marginBottom: 12 }}>
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => setEditGroupColor(c)} style={{
                width: 28, height: 28, borderRadius: '50%', background: c,
                border: c === editGroupColor ? '3px solid var(--text)' : '3px solid transparent',
                cursor: 'pointer',
              }} />
            ))}
          </div>

          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Members ({activeThread.member_ids.length})</label>
          <div style={{ marginTop: 4, marginBottom: 8 }}>
            {activeThread.member_ids.map(uid => {
              const m = getMember(uid)
              return (
                <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', background: m?.color || '#666',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: txtOn(m?.color || '#666'),
                  }}>{m?.name[0] || '?'}</div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m?.name || 'Unknown'}{uid === user.id ? ' (you)' : ''}</span>
                </div>
              )
            })}
          </div>

          {addable.length > 0 && (
            <>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Add members</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 12 }}>
                {addable.map(m => {
                  const on = addMemberPick.has(m.id)
                  return (
                    <button key={m.id} onClick={() => {
                      setAddMemberPick(prev => {
                        const next = new Set(prev)
                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id)
                        return next
                      })
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 16, border: 'none', fontSize: 12, fontWeight: 600,
                      background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                      color: on ? 'var(--text)' : 'var(--text2)', cursor: 'pointer',
                    }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%', background: m.color,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 800, color: txtOn(m.color),
                      }}>{m.name[0]}</span>
                      {m.name.split(' ')[0]}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <button className="btn-primary" onClick={saveGroupSettings} style={{ width: '100%' }}>Save</button>
          <button onClick={() => deleteThread()} style={{
            marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
            background: 'transparent', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Delete chat</button>
          <button onClick={() => setShowSettings(false)} style={{
            marginTop: 4, width: '100%', padding: 10, border: 'none', borderRadius: 12,
            background: 'transparent', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    )
  }

  // ─── Main chat view ───
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={() => setActiveThreadId(null)} style={{
          background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text)', padding: '2px 4px',
        }}>←</button>
        {(() => {
          const av = threadAvatar(activeThread!)
          return (
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: av.avatarUrl ? `url(${av.avatarUrl}) center/cover` : av.color,
              color: txtOn(av.color), display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: av.avatarUrl ? 0 : 13, fontWeight: 800,
            }}>
              {!av.avatarUrl && av.initial}
            </div>
          )
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {threadDisplayName(activeThread!)}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text2)' }}>
            {activeThread!.member_ids.length} members
          </p>
        </div>
        <button onClick={openSettings} style={{
          background: 'var(--surface2)', border: 'none', borderRadius: 10,
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, cursor: 'pointer',
        }}>⚙️</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13, marginTop: 20 }}>
            No messages yet. Say something!
          </div>
        )}

        {messages.map(msg => {
          const sender = getMember(msg.from_user)
          const isMe = msg.from_user === user.id

          if (msg.date_card) {
            const myRsvp = msg.rsvps.find(r => r.user_id === user.id)
            const inCount = msg.rsvps.filter(r => r.response === 'in').length
            return (
              <div key={msg.id} style={{
                display: 'flex', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end',
              }}>
                <div className="avatar" style={{
                  background: sender?.avatar_url ? `url(${sender.avatar_url}) center/cover` : (sender?.color || 'var(--surface2)'),
                  color: txtOn(sender?.color || '#666'), width: 28, height: 28, fontSize: 10, flexShrink: 0,
                }}>{!sender?.avatar_url && (sender?.name[0] || '?')}</div>
                <div style={{ maxWidth: '80%' }}>
                  {!isMe && <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 3, fontWeight: 600 }}>{sender?.name || 'Unknown'}</div>}
                  <div style={{ background: 'var(--surface)', border: '1.5px solid var(--accent)', borderRadius: 16, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.5 }}>📅 Proposed hangout</div>
                    <div style={{ fontSize: 15, fontWeight: 800, marginTop: 6 }}>{fmtDate(msg.date_card)}</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>⏰ {fmtHour(msg.win_start!)} – {fmtHour(msg.win_end!)}</div>
                    {msg.spot_name && <div style={{ fontSize: 13, marginTop: 4 }}>{msg.spot_emoji || '📍'} <b>{msg.spot_name}</b>{msg.spot_area && ` · ${msg.spot_area}`}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>{inCount} in so far</div>
                    <button onClick={() => handleRsvp(msg.id)} style={{
                      marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 10, border: 'none',
                      background: myRsvp ? 'var(--accent)' : 'var(--surface2)',
                      color: myRsvp ? '#fff' : 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>{myRsvp ? "✓ You're in" : "👍 I'm in"}</button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div
              key={msg.id}
              onTouchStart={() => onMsgTouchStart(msg)}
              onTouchEnd={onMsgTouchEnd}
              onMouseDown={() => onMsgTouchStart(msg)}
              onMouseUp={onMsgTouchEnd}
              onMouseLeave={onMsgTouchEnd}
              style={{
                display: 'flex', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end',
              }}
            >
              <div className="avatar" style={{
                background: sender?.avatar_url ? `url(${sender.avatar_url}) center/cover` : (sender?.color || 'var(--surface2)'),
                color: txtOn(sender?.color || '#666'), width: 28, height: 28, fontSize: 10, flexShrink: 0,
              }}>{!sender?.avatar_url && (sender?.name[0] || '?')}</div>
              <div style={{ maxWidth: '75%' }}>
                {!isMe && <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 3, fontWeight: 600 }}>{sender?.name || 'Unknown'}</div>}
                <div style={{
                  background: isMe ? 'var(--accent)' : 'var(--surface)',
                  color: isMe ? '#fff' : 'var(--text)',
                  borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  padding: '9px 13px', fontSize: 14, lineHeight: 1.45,
                }}>{msg.text}</div>
                <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, textAlign: isMe ? 'right' : 'left' }}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input row */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 16px',
        borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg)',
      }}>
        <input
          ref={inputRef} type="text" value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder={activeThread?.circle_id ? 'Message the group...' : 'Message...'}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 20,
            background: 'var(--surface2)', border: 'none',
            color: 'var(--text)', outline: 'none',
          }}
        />
        <button onClick={sendMessage} disabled={!inputText.trim() || sending} style={{
          width: 38, height: 38, borderRadius: '50%',
          background: inputText.trim() ? 'var(--accent)' : 'var(--surface2)',
          border: 'none', color: inputText.trim() ? '#fff' : 'var(--text2)',
          fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>➤</button>
      </div>

      {/* Long-press preview */}
      {previewMsg && (
        <div
          onClick={() => setPreviewMsg(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface)', borderRadius: 16, padding: 16,
            maxWidth: '85%', maxHeight: '60%', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
              {getMember(previewMsg.from_user)?.name || 'Unknown'} · {new Date(previewMsg.created_at).toLocaleString()}
            </div>
            <p style={{ fontSize: 14 }}>{previewMsg.text || (previewMsg.date_card ? `📅 Proposed hangout on ${fmtDate(previewMsg.date_card)}` : '')}</p>
          </div>
        </div>
      )}

      {renderNewChatModal()}
      {renderSettingsModal()}
    </div>
  )
}
