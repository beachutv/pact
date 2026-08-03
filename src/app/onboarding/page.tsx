'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AREAS, AVATAR_COLORS, txtOn } from '@/lib/utils'
import LocationPicker from '@/components/LocationPicker'

const areaNames = Object.keys(AREAS)

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  )
}

function OnboardingInner() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const nextUrl = searchParams.get('next')
  const calError = searchParams.get('error')

  // Steps: 0 = calendar connect, 1 = name + username, 2 = area, 3 = birthday
  const [step, setStep] = useState(0)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [checkingCalendar, setCheckingCalendar] = useState(true)
  const [calDenied, setCalDenied] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [color, setColor] = useState(AVATAR_COLORS[0])
  const [customColor, setCustomColor] = useState('')
  const [homeArea, setHomeArea] = useState('')
  const [shareHomeArea, setShareHomeArea] = useState('circles')
  const [birthday, setBirthday] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeColor = customColor || color

  // On mount: check if calendar is already connected, and handle OAuth errors
  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email || '')
        const { data } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
        if (data && data.length > 0) {
          setCalendarConnected(true)
          setStep(1)
        }
      }
      // Check if redirected back with a calendar error
      if (calError === 'calendar-denied' || calError === 'token-exchange') {
        setCalDenied(true)
      }
      setCheckingCalendar(false)
    }
    check()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnectCalendar() {
    const { data: { user } } = await supabase.auth.getUser()
    const loginHint = user?.email ? `&login_hint=${encodeURIComponent(user.email)}` : ''
    // After calendar connect, redirect back to onboarding (with next param preserved)
    const onboardingReturn = nextUrl ? `/onboarding?next=${encodeURIComponent(nextUrl)}` : '/onboarding'
    window.location.href = `/api/calendar/connect?next=${encodeURIComponent(onboardingReturn)}${loginHint}`
  }

  async function handleCopyEmail() {
    if (userEmail) {
      try {
        await navigator.clipboard.writeText(userEmail)
        setError('Copied!')
        setTimeout(() => setError(''), 1500)
      } catch {
        // Fallback
        setError(userEmail)
      }
    }
  }

  function formatUsername(val: string) {
    return val.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
  }

  async function validateUsername(val: string): Promise<boolean> {
    const clean = formatUsername(val)
    if (!clean) { setUsernameError(''); return false }
    if (clean.length < 3) { setUsernameError('At least 3 characters'); return false }
    setCheckingUsername(true)
    const { data } = await supabase
      .from('users')
      .select('id')
      .ilike('username', clean)
      .limit(1)
    setCheckingUsername(false)
    if (data && data.length > 0) {
      setUsernameError('Already taken')
      return false
    }
    setUsernameError('')
    return true
  }

  async function handleSave() {
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not signed in'); setLoading(false); return }

      // Validate username if provided
      const cleanUsername = formatUsername(username)
      if (cleanUsername && cleanUsername.length >= 3) {
        const valid = await validateUsername(cleanUsername)
        if (!valid) { setLoading(false); return }
      }

      const area = homeArea || 'Metro Manila'
      const exactMatch = AREAS[area]
      const fuzzyMatch = !exactMatch && areaNames.find(a => area.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(area.toLowerCase()))
      const coords = exactMatch || (fuzzyMatch ? AREAS[fuzzyMatch] : { x: 4.5, y: 5.5 })

      const { error: updateError } = await supabase.from('users').update({
        name: name || 'User',
        username: cleanUsername || null,
        color: activeColor,
        home_area: area,
        home_x: coords.x,
        home_y: coords.y,
        birthday: birthday || null,
        share_address: shareHomeArea,
      }).eq('id', user.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      // Calendar is already connected — go to the app
      const finalDest = nextUrl || '/calendar'
      window.location.href = finalDest
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      setLoading(false)
    }
  }

  if (checkingCalendar) {
    return (
      <div id="app-shell" style={{ justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ maxWidth: 340, width: '100%', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div id="app-shell" style={{ justifyContent: 'center', padding: '0 24px' }}>
      <div style={{ maxWidth: 340, width: '100%', margin: '0 auto' }}>

        {/* Step 0: Calendar Connect (or denied screen) */}
        {step === 0 && !calDenied && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>
                Pact<span style={{ color: 'var(--accent)' }}>.</span>
              </h1>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                plans that actually happen
              </p>
            </div>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '20px 18px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 800, color: '#4285F4', flexShrink: 0,
                }}>G</div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>Connect Google Calendar</p>
                  <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    We only read busy/free times — never event details.
                  </p>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={handleConnectCalendar}
                style={{ width: '100%' }}
              >
                Connect Calendar →
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.5 }}>
              Pact needs calendar access to find times when your friend group is free. You&apos;ll set up your profile next.
            </p>
          </>
        )}

        {/* Step 0 — Calendar denied / not in test users */}
        {step === 0 && calDenied && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>
                Pact<span style={{ color: 'var(--accent)' }}>.</span>
              </h1>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                almost there!
              </p>
            </div>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '20px 18px', marginBottom: 16,
            }}>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                Your Google account needs to be approved for testing 🔐
              </p>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
                Pact is still in testing mode with Google. Send your Gmail address to Bea and she&apos;ll add you — usually takes a few minutes.
              </p>
              {userEmail && (
                <button
                  onClick={handleCopyEmail}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    marginBottom: 12,
                  }}
                >
                  📋 Copy my email: {userEmail}
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() => setCalDenied(false)}
                style={{ width: '100%' }}
              >
                Try again
              </button>
            </div>
            {error && (
              <p style={{ fontSize: 12, color: 'var(--green)', textAlign: 'center' }}>
                {error}
              </p>
            )}
          </>
        )}

        {/* Steps 1-3: Profile setup (only after calendar connected) */}
        {step >= 1 && (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
              {step === 1 ? 'Hey! Who are you?' : step === 2 ? 'Where are you based?' : 'When\'s your birthday?'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24 }}>
              Step {step} of 3
            </p>

            {error && step >= 1 && (
              <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 8 }}>
                {error}
              </p>
            )}

            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <input
                  className="input"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
                    Pick a username
                  </p>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 14, color: 'var(--text2)', fontWeight: 600, pointerEvents: 'none',
                    }}>@</span>
                    <input
                      className="input"
                      placeholder="username"
                      value={username}
                      onChange={e => {
                        const v = formatUsername(e.target.value)
                        setUsername(v)
                        setUsernameError('')
                      }}
                      onBlur={() => { if (username.length >= 3) validateUsername(username) }}
                      style={{ paddingLeft: 30 }}
                    />
                  </div>
                  {usernameError && (
                    <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{usernameError}</p>
                  )}
                  {!usernameError && username.length >= 3 && !checkingUsername && (
                    <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>Available!</p>
                  )}
                  {checkingUsername && (
                    <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Checking...</p>
                  )}
                  <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                    Friends can find you by your username. Letters, numbers, and underscores only.
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
                    Pick your color
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {AVATAR_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => { setColor(c); setCustomColor('') }}
                        style={{
                          width: 36, height: 36, borderRadius: '50%',
                          background: c, border: c === activeColor ? '3px solid var(--text)' : '3px solid transparent',
                          cursor: 'pointer', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 14, fontWeight: 800,
                          color: txtOn(c),
                        }}
                      >
                        {c === activeColor && name ? name[0] : ''}
                      </button>
                    ))}
                    <label style={{ position: 'relative', width: 36, height: 36, cursor: 'pointer' }}>
                      <input
                        type="color"
                        value={customColor || '#76ACB3'}
                        onChange={e => { setCustomColor(e.target.value); setColor('') }}
                        style={{
                          position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
                          width: '100%', height: '100%',
                        }}
                      />
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: customColor ? customColor : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                        border: customColor ? '3px solid var(--text)' : '3px solid transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800,
                        color: customColor ? txtOn(customColor) : '#fff',
                      }}>
                        {customColor && name ? name[0] : ''}
                      </div>
                    </label>
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => { if (name.trim()) setStep(2) }}
                  disabled={!name.trim()}
                >
                  Next
                </button>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                  This helps us find spots that are convenient for your group.
                </p>
                <LocationPicker
                  onSelect={(name) => setHomeArea(name)}
                  initialValue={homeArea}
                  placeholder="Search your area (e.g. BGC, Makati)"
                />

                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
                    Show this on your profile?
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['nobody', 'circles'].map(v => (
                      <button key={v} onClick={() => setShareHomeArea(v)} style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                        background: shareHomeArea === v ? 'var(--accent)' : 'var(--surface2)',
                        color: shareHomeArea === v ? '#fff' : 'var(--text2)',
                        border: 'none', fontWeight: 600,
                      }}>
                        {v === 'nobody' ? '🔒 Hidden' : '👥 Circle mates'}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setStep(1)} style={{ flex: 1 }}>
                    Back
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => { if (homeArea) setStep(3) }}
                    disabled={!homeArea}
                    style={{ flex: 2 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--text2)' }}>
                  So your friends get a reminder when it&apos;s coming up. Optional!
                </p>
                <input
                  className="input"
                  type="date"
                  value={birthday}
                  onChange={e => setBirthday(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setStep(2)} style={{ flex: 1 }}>
                    Back
                  </button>
                  <button className="btn-primary" onClick={handleSave} disabled={loading} style={{ flex: 2 }}>
                    {loading ? 'Saving...' : 'Finish setup →'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
