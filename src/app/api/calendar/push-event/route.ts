import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function getAccessToken(conn: any, supabase: any): Promise<string | null> {
  const expiry = new Date(conn.token_expiry)
  if (expiry > new Date(Date.now() + 5 * 60 * 1000)) {
    return conn.access_token
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await res.json()
  if (!tokens.access_token) return null

  await supabase.from('calendar_connections').update({
    access_token: tokens.access_token,
    token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('id', conn.id)

  return tokens.access_token
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { pactId, occasion, spotName, otherNames, circleName, title, date, startHour, endHour, location, calendarId, confirmed, totalCircleMembers, pactMemberCount } = await request.json()
  if (!pactId || !date || startHour == null || endHour == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Determine the "with" part: use circle name ONLY if ALL members (3+) in circle are in the pact
  const allCircleInPact = totalCircleMembers && pactMemberCount && totalCircleMembers >= 3 && pactMemberCount >= totalCircleMembers
  const namesPart = allCircleInPact && circleName
    ? circleName
    : otherNames?.length > 0
      ? otherNames.join(', ')
      : circleName || ''

  let smartTitle: string
  if (confirmed) {
    // Confirmed: "(occasion)" if set, otherwise "Pact with (other user)"
    if (occasion && namesPart) {
      smartTitle = `${occasion} with ${namesPart}`
    } else if (occasion) {
      smartTitle = occasion
    } else if (namesPart) {
      smartTitle = `Pact with ${namesPart}`
    } else {
      smartTitle = title || 'Pact'
    }
  } else {
    // Unfinalized: "‼️ Finalize Proposed Pact with (other user)"
    if (namesPart) {
      smartTitle = `‼️ Finalize Proposed Pact with ${namesPart}`
    } else {
      smartTitle = `‼️ Finalize Proposed Pact`
    }
  }

  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single()

  if (!conn) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 })

  const accessToken = await getAccessToken(conn, supabase)
  if (!accessToken) return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 })

  // Create Google Calendar event
  const event = {
    summary: smartTitle,
    location: location || undefined,
    description: 'Created by Pact — plans that actually happen',
    start: {
      dateTime: `${date}T${String(startHour).padStart(2, '0')}:00:00`,
      timeZone: 'Asia/Manila',
    },
    end: {
      dateTime: `${date}T${String(endHour).padStart(2, '0')}:00:00`,
      timeZone: 'Asia/Manila',
    },
    extendedProperties: {
      private: { pactId },
    },
  }

  const targetCalendar = calendarId || 'primary'
  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  )

  const gcalEvent = await gcalRes.json()
  if (gcalEvent.error) {
    // If scope not granted yet, return specific error
    if (gcalEvent.error.code === 403) {
      return NextResponse.json({
        error: 'Calendar write permission not granted. Please reconnect your calendar.',
        needsReconnect: true,
      }, { status: 403 })
    }
    return NextResponse.json({ error: gcalEvent.error.message }, { status: 500 })
  }

  // Also add a busy block with source='pact'
  await supabase.from('busy_blocks').insert({
    user_id: user.id,
    date,
    start_hour: startHour,
    end_hour: endHour,
    source: 'pact',
    pact_id: pactId,
  })

  return NextResponse.json({ eventId: gcalEvent.id, ok: true })
}
