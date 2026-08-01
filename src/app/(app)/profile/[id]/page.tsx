'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { txtOn, bdaySoon, AVATAR_COLORS, AREAS } from '@/lib/utils'
import { useCircle } from '@/components/AppShell'
import { useLocationUpdate } from '@/lib/useLocationUpdate'
import LocationPicker from '@/components/LocationPicker'

type FullProfile = {
  id: string
  name: string
  email: string
  color: string
  home_area: string
  birthday: string | null
  phone: string | null
  address: string | null
  share_phone: string
  share_address: string
  avatar_url: string | null
}


const areaNames = Object.keys(AREAS) // kept for coordinate lookup fallback

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { user, updateUser, circles, activeCircle } = useCircle()

  // Update own location when viewing own profile
  const isMe = id === user.id
  useLocationUpdate(isMe ? user.id : '', 'profile')

  const [profile, setProfile] = useState<FullProfile | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [calConnected, setCalConnected] = useState<boolean | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editSharePhone, setEditSharePhone] = useState('nobody')
  const [editShareAddress, setEditShareAddress] = useState('nobody')
  const [editHomeArea, setEditHomeArea] = useState('')

  // Account actions
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const isOwn = id === user.id

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('users').select('*').eq('id', id).single()
      if (data) {
        const p = data as FullProfile
        setProfile(p)
        setEditName(p.name)
        setEditColor(p.color)
        setEditPhone(p.phone || '')
        setEditAddress(p.address || '')
        setEditSharePhone(p.share_phone || 'nobody')
        setEditShareAddress(p.share_address || 'nobody')
        setEditHomeArea(p.home_area || '')
      }
    }
    load()
  }, [id])

  // Check calendar connection for own profile
  useEffect(() => {
    if (!isOwn) return
    async function checkCal() {
      const { data: conn } = await supabase
        .from('calendar_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'google')
        .single()
      setCalConnected(!!conn)
    }
    checkCal()
  }, [isOwn, user.id])

  function openCalendarModal() {
    window.dispatchEvent(new CustomEvent('pact-open-cal-selector'))
  }

  async function syncCalendar() {
    setSyncing(true)
    try {
      await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
    } catch {}
    setSyncing(false)
  }


  async function uploadAvatar(file: File) {
    setUploading(true)
    try {
      // Always use consistent path to avoid stale files from different extensions
      const path = `${user.id}/avatar`

      // Remove old file first (ignore errors if it doesn't exist)
      await supabase.storage.from('avatars').remove([path])

      // Upload directly via client-side Supabase (proper auth context)
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { contentType: file.type, upsert: true })

      if (upErr) {
        console.error('Upload error:', upErr)
        alert('Photo upload failed. Please try again.')
        setUploading(false)
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path)

      // Cache-bust to force browsers to reload the image
      const avatarUrl = `${publicUrl}?v=${Date.now()}`

      // Update DB and verify it succeeded
      const { error: dbErr } = await supabase.from('users').update({ avatar_url: avatarUrl }).eq('id', user.id)
      if (dbErr) {
        console.error('DB update error:', dbErr)
        alert('Failed to save photo. Please try again.')
        setUploading(false)
        return
      }

      setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev)
      updateUser({ avatar_url: avatarUrl })
    } catch (e) {
      console.error('Avatar upload failed:', e)
      alert('Photo upload failed. Please try again.')
    }
    setUploading(false)
  }

  async function handleSave() {
    setSaving(true)
    // Try exact match, then fuzzy match on AREAS for coordinate lookup
    const areaKey = editHomeArea || profile?.home_area || ''
    const exactMatch = AREAS[areaKey]
    const fuzzyMatch = !exactMatch && areaNames.find(a => areaKey.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(areaKey.toLowerCase()))
    const coords = exactMatch || (fuzzyMatch ? AREAS[fuzzyMatch] : { x: 14.55, y: 121.0 })
    await supabase.from('users').update({
      name: editName,
      color: editColor,
      phone: editPhone || null,
      address: editAddress || null,
      share_phone: editSharePhone,
      share_address: editShareAddress,
      home_area: editHomeArea || profile?.home_area,
      home_x: coords.x,
      home_y: coords.y,
    }).eq('id', user.id)
    // Refresh
    const { data } = await supabase.from('users').select('*').eq('id', id).single()
    if (data) {
      setProfile(data as FullProfile)
      updateUser({ name: editName, color: editColor, home_area: editHomeArea || data.home_area })
    }
    setSaving(false)
    setEditing(false)
  }

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  async function handleLeaveCircle() {
    if (!activeCircle) return
    if (!confirm(`Leave ${activeCircle.name}? You'll need a new invite to rejoin.`)) return
    const { error } = await supabase.rpc('remove_circle_member', {
      p_circle_id: activeCircle.id,
      p_user_id: user.id,
    })
    if (error) {
      console.error('Leave circle error:', error)
      alert('Failed to leave circle. Please try again.')
      return
    }
    window.location.href = '/calendar'
  }

  async function handleDeleteAccount() {
    if (!confirmDeleteAccount) {
      setConfirmDeleteAccount(true)
      return
    }
    setDeletingAccount(true)
    try {
      // Use the SECURITY DEFINER function to clean up all user data
      const { error } = await supabase.rpc('delete_user_account')
      if (error) {
        console.error('Delete account error:', error)
        alert('Failed to delete account. Please try again.')
        setDeletingAccount(false)
        setConfirmDeleteAccount(false)
        return
      }
      // Auth user is already deleted by the RPC — signOut may fail, that's fine
      try { await supabase.auth.signOut() } catch {}
      // Clear all local storage so no stale state remains
      localStorage.clear()
      window.location.href = '/'
    } catch (e) {
      console.error('Delete account error:', e)
      alert('Failed to delete account.')
      setDeletingAccount(false)
      setConfirmDeleteAccount(false)
    }
  }

  if (!profile) return <div style={{ padding: 20 }}><div className="spinner" /></div>

  const bday = profile.birthday ? bdaySoon(profile.birthday, 365) : -1
  // Privacy: show phone/address to circle mates only if sharing is enabled
  const canSeePhone = isOwn || profile.share_phone === 'circles'
  const canSeeAddress = isOwn || profile.share_address === 'circles'

  if (editing && isOwn) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button onClick={() => setEditing(false)} style={{
          alignSelf: 'flex-start', background: 'none', border: 'none',
          color: 'var(--accent)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          ← Cancel
        </button>

        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Edit profile</h2>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Name</label>
          <input className="input" value={editName} onChange={e => setEditName(e.target.value)} style={{ marginTop: 4 }} />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => setEditColor(c)} style={{
                width: 32, height: 32, borderRadius: '50%', background: c,
                border: c === editColor ? '3px solid var(--text)' : '3px solid transparent',
                cursor: 'pointer',
              }} />
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Phone number</label>
          <input className="input" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+63 9XX XXX XXXX" style={{ marginTop: 4 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {['nobody', 'circles'].map(v => (
              <button key={v} onClick={() => setEditSharePhone(v)} style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: editSharePhone === v ? 'var(--accent)' : 'var(--surface2)',
                color: editSharePhone === v ? '#fff' : 'var(--text2)',
                border: 'none', fontWeight: 600,
              }}>
                {v === 'nobody' ? 'Hidden' : 'Circle mates'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Home area</label>
          <div style={{ marginTop: 4 }}>
            <LocationPicker
              onSelect={(name) => setEditHomeArea(name)}
              initialValue={editHomeArea}
              placeholder="Search area (e.g. BGC, Makati)"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {['nobody', 'circles'].map(v => (
              <button key={v} onClick={() => setEditShareAddress(v)} style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: editShareAddress === v ? 'var(--accent)' : 'var(--surface2)',
                color: editShareAddress === v ? '#fff' : 'var(--text2)',
                border: 'none', fontWeight: 600,
              }}>
                {v === 'nobody' ? 'Hidden' : 'Circle mates'}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <button onClick={() => router.back()} style={{
        alignSelf: 'flex-start', background: 'none', border: 'none',
        color: 'var(--accent)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
      }}>
        ← Back
      </button>

      <div style={{ position: 'relative' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', fontSize: 28,
          background: profile.avatar_url ? `url(${profile.avatar_url}) center/cover` : profile.color,
          color: txtOn(profile.color),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800,
        }}>
          {!profile.avatar_url && profile.name[0]}
        </div>
        {isOwn && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--surface2)', border: '2px solid var(--bg)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {uploading ? <span style={{ fontSize: 12 }}>⟳</span> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadAvatar(file)
            e.target.value = ''
          }}
        />
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 800 }}>{profile.name}</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', maxWidth: 280 }}>
        <p style={{ fontSize: 12, color: 'var(--text2)' }}>{profile.home_area}</p>

        {profile.birthday && bday >= 0 && (
          <p style={{ fontSize: 12, color: 'var(--amber)' }}>
            Birthday {bday === 0 ? 'today!' : bday === 1 ? 'tomorrow' : `in ${bday} days`}
          </p>
        )}

        {canSeePhone && profile.phone && (
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>{profile.phone}</p>
        )}

        {!isOwn && !canSeePhone && (
          <p style={{ fontSize: 11, color: 'var(--text2)', fontStyle: 'italic' }}>Phone hidden</p>
        )}
      </div>

      {isOwn && (
        <button className="btn-secondary" onClick={() => setEditing(true)} style={{ marginTop: 8, width: '100%', maxWidth: 280 }}>
          Edit profile
        </button>
      )}

      {/* Shared circles — shown on other people's profiles */}
      {!isOwn && <SharedCircles userId={profile.id} circles={circles} />}

      {/* Calendar settings — own profile only */}
      {isOwn && calConnected !== null && (
        <div style={{ width: '100%', maxWidth: 280, marginTop: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Calendar
          </p>
          {calConnected ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={openCalendarModal} style={{ flex: 1 }}>
                My Calendars
              </button>
              <button className="btn-secondary" onClick={syncCalendar} disabled={syncing} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                {syncing ? 'Syncing' : 'Sync'}
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => window.location.href = '/api/calendar/connect'} style={{ width: '100%' }}>
              Connect Google Calendar
            </button>
          )}
        </div>
      )}

      {/* Calendar modal is now handled by AppShell via pact-open-cal-selector event */}

      {/* Link to full settings */}
      {isOwn && (
        <button
          onClick={() => router.push('/settings')}
          style={{
            width: '100%', maxWidth: 280, marginTop: 16, padding: 12, borderRadius: 12,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          All settings
          <span style={{ color: 'var(--text2)' }}>›</span>
        </button>
      )}
    </div>
  )
}

function SharedCircles({ userId, circles }: { userId: string; circles: { id: string; name: string; emoji: string }[] }) {
  const [shared, setShared] = useState<{ id: string; name: string; emoji: string }[]>([])
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      // For each of the current user's circles, check if this profile user is also a member
      const results: typeof circles = []
      for (const c of circles) {
        const { data } = await supabase
          .from('circle_members')
          .select('user_id')
          .eq('circle_id', c.id)
          .eq('user_id', userId)
          .single()
        if (data) results.push(c)
      }
      setShared(results)
    }
    load()
  }, [userId, circles.length])

  if (shared.length === 0) return null

  return (
    <div style={{ width: '100%', maxWidth: 280, marginTop: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
        Circles you share
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shared.map(c => (
          <button
            key={c.id}
            onClick={() => {
              localStorage.setItem('pact_active_circle', c.id)
              window.location.href = '/calendar'
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <span style={{ fontSize: 16 }}>{c.emoji || '👥'}</span>
            <span style={{ flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>Plan →</span>
          </button>
        ))}
      </div>
    </div>
  )
}
