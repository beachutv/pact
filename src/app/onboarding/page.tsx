'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AREAS, AVATAR_COLORS, txtOn } from '@/lib/utils'

const areaNames = Object.keys(AREAS)

export default function OnboardingPage() {
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [color, setColor] = useState(AVATAR_COLORS[0])
  const [customColor, setCustomColor] = useState('')
  const [areaSearch, setAreaSearch] = useState('')
  const [homeArea, setHomeArea] = useState('')
  const [birthday, setBirthday] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const filteredAreas = useMemo(() => {
    if (!areaSearch.trim()) return areaNames
    const q = areaSearch.toLowerCase()
    return areaNames.filter(a => a.toLowerCase().includes(q))
  }, [areaSearch])

  const activeColor = customColor || color

  async function handleSave() {
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not signed in'); setLoading(false); return }

      const area = homeArea || areaNames[0]
      const coords = AREAS[area]
      const { error: updateError } = await supabase.from('users').update({
        name: name || 'User',
        color: activeColor,
        home_area: area,
        home_x: coords.x,
        home_y: coords.y,
        birthday: birthday || null,
      }).eq('id', user.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      // Full page load to ensure server components get fresh data
      window.location.href = '/home'
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div id="app-shell" style={{ justifyContent: 'center', padding: '0 24px' }}>
      <div style={{ maxWidth: 340, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
          {step === 1 ? 'Hey! Who are you?' : step === 2 ? 'Where are you based?' : 'When\'s your birthday?'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24 }}>
          Step {step} of 3
        </p>

        {error && (
          <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
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
                {/* Custom color picker */}
                <label style={{ position: 'relative', width: 36, height: 36, cursor: 'pointer' }}>
                  <input
                    type="color"
                    value={customColor || '#7c5cff'}
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
            <input
              className="input"
              placeholder="Search areas..."
              value={areaSearch}
              onChange={e => setAreaSearch(e.target.value)}
              autoFocus
            />
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxHeight: 240, overflowY: 'auto', padding: '4px 0',
            }}>
              {filteredAreas.map(a => (
                <button
                  key={a}
                  onClick={() => setHomeArea(a)}
                  style={{
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    border: 'none', textAlign: 'left', fontSize: 14,
                    background: a === homeArea ? 'var(--accent)' : 'var(--surface2)',
                    color: a === homeArea ? '#fff' : 'var(--text)',
                    fontWeight: a === homeArea ? 700 : 400,
                  }}
                >
                  {a}
                </button>
              ))}
              {filteredAreas.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text2)', padding: '8px 14px' }}>
                  No areas match. Try a different search.
                </p>
              )}
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
              So your friends get a reminder when it's coming up. Optional!
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
                {loading ? 'Saving...' : 'Done'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
