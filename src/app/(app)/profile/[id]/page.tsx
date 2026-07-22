'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { txtOn, bdaySoon, AVATAR_COLORS, AREAS } from '@/lib/utils'
import { useCircle } from '@/components/AppShell'
import { useLocationUpdate } from '@/lib/useLocationUpdate'

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

type GCal = { id: string; summary: string; primary: boolean; backgroundColor: string }

const areaNames = Object.keys(AREAS)

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
  const [showCalModal, setShowCalModal] = useState(false)
  const [gcals, setGcals] = useState<GCal[]>([])
  const [selectedCals, setSelectedCals] = useState<string[]>([])
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
  const [areaSearch, setAreaSearch] = useState('')
  const [showAreaPicker, setShowAreaPicker] = useState(false)

  // Account actions
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const isOwn = id === user.id

  const filteredAreas = areaSearch.trim()
    ? areaNames.filter(a => a.toLowerCase().includes(areaSearch.toLowerCase()))
    : areaNames

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

  async function loadCalendars() {
    const res = await fetch('/api/calendar/list')
    if (res.ok) {
      const data = await res.json()
      setGcals(data.calendars)
      setSelectedCals(data.selectedIds)
      setShowCalModal(true)
    }
  }

  async function saveCalendarSelection() {
    await fetch('/api/calendar/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds: selectedCals }),
    })
    setShowCalModal(false)
    syncCalendar()
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

  async function disconnectCalendar() {
    if (!confirm('Disconnect Google Calendar? You can reconnect anytime.')) return
    await supabase.from('calendar_connections').delete().eq('user_id', user.id).eq('provider', 'google')
    await supabase.from('busy_blocks').delete().eq('user_id', user.id).eq('source', 'google')
    setCalConnected(false)
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
    const coords = AREAS[editHomeArea] || AREAS[profile?.home_area || ''] || { x: 14.55, y: 121.0 }
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
    await supabase.from('circle_members').delete()
      .eq('circle_id', activeCircle.id)
      .eq('user_id', user.id)
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
      await supabase.auth.signOut()
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
                {v === 'nobody' ? '🔒 Hidden' : '👥 Circle mates'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Home area</label>
          <div style={{ position: 'relative', marginTop: 4 }}>
            <button
              onClick={() => setShowAreaPicker(!showAreaPicker)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 12, border: 'none',
                background: 'var(--surface2)', color: 'var(--text)', fontSize: 14,
                textAlign: 'left', cursor: 'pointer',
              }}
            >
              📍 {editHomeArea || 'Select area'}
            </button>
            {showAreaPicker && (
              <div style={{
                position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                maxHeight: 220, overflowY: 'auto',
              }}>
                <input
                  className="input"
                  value={areaSearch}
                  onChange={e => setAreaSearch(e.target.value)}
                  placeholder="Search areas..."
                  autoFocus
                  style={{ margin: 8, width: 'calc(100% - 16px)', fontSize: 13 }}
                />
                {filteredAreas.map(a => (
                  <button key={a} onClick={() => { setEditHomeArea(a); setShowAreaPicker(false); setAreaSearch('') }} style={{
                    display: 'block', width: '100%', padding: '8px 14px', border: 'none',
                    background: a === editHomeArea ? 'var(--accent-soft)' : 'transparent',
                    color: a === editHomeArea ? 'var(--accent)' : 'var(--text)',
                    fontSize: 13, textAlign: 'left', cursor: 'pointer', fontWeight: a === editHomeArea ? 700 : 400,
                  }}>
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Home address</label>
          <input className="input" value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Your address" style={{ marginTop: 4 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {['nobody', 'circles'].map(v => (
              <button key={v} onClick={() => setEditShareAddress(v)} style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: editShareAddress === v ? 'var(--accent)' : 'var(--surface2)',
                color: editShareAddress === v ? '#fff' : 'var(--text2)',
                border: 'none', fontWeight: 600,
              }}>
                {v === 'nobody' ? '🔒 Hidden' : '👥 Circle mates'}
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
        <p style={{ fontSize: 12, color: 'var(--text2)' }}>📍 {profile.home_area}</p>

        {profile.birthday && bday >= 0 && (
          <p style={{ fontSize: 12, color: 'var(--amber)' }}>
            🎂 Birthday {bday === 0 ? 'today!' : bday === 1 ? 'tomorrow' : `in ${bday} days`}
          </p>
        )}

        {canSeePhone && profile.phone && (
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>📱 {profile.phone}</p>
        )}

        {canSeeAddress && profile.address && (
          <p style={{
            fontSize: 12, color: 'var(--text2)', textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }} title={profile.address}>🏠 {profile.address}</p>
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

      {/* Calendar settings — own profile only */}
      {isOwn && calConnected !== null && (
        <div style={{ width: '100%', maxWidth: 280, marginTop: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            📅 Calendar
          </p>
          {calConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn-secondary" onClick={loadCalendars} style={{ width: '100%' }}>
                🔗 My Calendars
              </button>
              <button className="btn-secondary" onClick={syncCalendar} disabled={syncing} style={{ width: '100%' }}>
                {syncing ? '⟳ Syncing...' : '⟳ Sync now'}
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => window.location.href = '/api/calendar/connect'} style={{ width: '100%' }}>
              Connect Google Calendar
            </button>
          )}
        </div>
      )}

      {/* Calendar selection modal */}
      {showCalModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCalModal(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--surface)', borderRadius: 20, padding: 20,
            width: '90%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>My calendars</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
              Pick which calendars Pact checks for busy times.
            </p>
            {gcals.map(cal => {
              const on = selectedCals.includes(cal.id)
              return (
                <div
                  key={cal.id}
                  onClick={() => {
                    setSelectedCals(prev =>
                      prev.includes(cal.id)
                        ? prev.filter(cid => cid !== cal.id)
                        : [...prev, cal.id]
                    )
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12, marginBottom: 6,
                    background: on ? 'var(--accent-soft)' : 'var(--surface2)',
                    cursor: 'pointer', border: on ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                  }}
                >
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: cal.backgroundColor }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cal.summary}</div>
                    {cal.primary && <div style={{ fontSize: 10, color: 'var(--text2)' }}>Primary</div>}
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: 6,
                    border: on ? 'none' : '2px solid var(--border)',
                    background: on ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 800,
                  }}>
                    {on ? '✓' : ''}
                  </div>
                </div>
              )
            })}
            <button
              onClick={saveCalendarSelection}
              disabled={selectedCals.length === 0}
              style={{
                marginTop: 12, width: '100%', padding: 12, border: 'none', borderRadius: 12,
                background: selectedCals.length > 0 ? 'var(--accent)' : 'var(--surface3)',
                color: selectedCals.length > 0 ? '#fff' : 'var(--text2)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Save & sync
            </button>
            <button
              onClick={() => { setShowCalModal(false); disconnectCalendar() }}
              style={{
                marginTop: 8, width: '100%', padding: 10, border: 'none', borderRadius: 12,
                background: 'transparent', color: 'var(--red)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Disconnect Google Calendar
            </button>
          </div>
        </div>
      )}

      {/* Account actions — own profile only */}
      {isOwn && (
        <div style={{ width: '100%', maxWidth: 280, marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>
            Account
          </p>

          <button
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: 'none',
              background: 'var(--surface2)', color: 'var(--text)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>

          {activeCircle && (
            <button
              onClick={handleLeaveCircle}
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: 'none',
                background: 'var(--surface2)', color: 'var(--red)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Leave {activeCircle.name}
            </button>
          )}

          <button
            onClick={handleDeleteAccount}
            disabled={deletingAccount}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: 'none',
              background: confirmDeleteAccount ? 'var(--red)' : 'transparent',
              color: confirmDeleteAccount ? '#fff' : 'var(--red)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {deletingAccount ? 'Deleting...' : confirmDeleteAccount ? 'Tap again to confirm delete' : 'Delete account'}
          </button>
        </div>
      )}
    </div>
  )
}
