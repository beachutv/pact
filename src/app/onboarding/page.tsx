'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
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
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track validated username so we know if current value has been confirmed available
  const [validatedUsername, setValidatedUsername] = useState('')

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
    if (!clean) { setUsernameError(''); setValidatedUsername(''); return false }
    if (clean.length < 3) { setUsernameError('At least 3 characters'); setValidatedUsername(''); return false }
    setCheckingUsername(true)
    const { data } = await supabase
      .from('users')
      .select('id')
      .ilike('username', clean)
      .limit(1)
    setCheckingUsername(false)
    if (data && data.length > 0) {
      setUsernameError('Already taken')
      setValidatedUsername('')
      return false
    }
    setUsernameError('')
    setValidatedUsername(clean)
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
      const finalDest = nextUrl || '/home'
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
              <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5, maxWidth: 300 }}>
                Plans that actually happen.<br/>Connect your Google Calendar to get started — we only read busy/free times, never event details.
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
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  background: '#fff', color: '#333', border: '1.5px solid var(--border)', fontWeight: 600,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
              <span style={{ width: 24, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
            </div>
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
            <p style={{
              fontSize: 11, fontWeight: 700, color: 'var(--accent)',
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16,
            }}>
              Step {step} of 3
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
              {step === 1 ? 'What should we call you?' : step === 2 ? 'Where are you based?' : "When's your birthday? 🎂"}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
              {step === 1 ? 'This is how friends will see you in the app.'
                : step === 2 ? 'Helps find spots that work for your group.'
                : 'So friends get a reminder. Only the date is visible, not your age.'}
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
                        setValidatedUsername('')
                        // Debounce: check availability as user types
                        if (usernameTimer.current) clearTimeout(usernameTimer.current)
                        if (v.length >= 3) {
                          usernameTimer.current = setTimeout(() => validateUsername(v), 300)
                        }
                      }}
                      style={{ paddingLeft: 30 }}
                    />
                  </div>
                  {usernameError && (
                    <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{usernameError}</p>
                  )}
                  {!usernameError && validatedUsername && validatedUsername === formatUsername(username) && !checkingUsername && (
                    <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>✓ Available</p>
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
                  onClick={() => {
                    if (!name.trim()) return
                    const clean = formatUsername(username)
                    // If username is entered, it must be validated and available
                    if (clean.length > 0 && clean.length < 3) { setUsernameError('At least 3 characters'); return }
                    if (clean.length >= 3 && validatedUsername !== clean) {
                      // Force a check now
                      validateUsername(clean).then(ok => { if (ok) setStep(2) })
                      return
                    }
                    if (usernameError) return
                    setStep(2)
                  }}
                  disabled={!name.trim() || checkingUsername || !!usernameError || (formatUsername(username).length >= 3 && validatedUsername !== formatUsername(username))}
                >
                  {checkingUsername ? 'Checking...' : 'Next'}
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
                    {loading ? 'Saving...' : "Let's go →"}
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
