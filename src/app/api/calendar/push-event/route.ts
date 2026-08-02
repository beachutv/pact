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

function hourToISO(date: string, hour: number): string {
  const h = Math.floor(hour)
  const m = hour % 1 === 0.5 ? '30' : '00'
  return `${date}T${String(h).padStart(2, '0')}:${m}:00`
}

/**
 * Build the Google Calendar event title.
 *
 * PROPOSED (not yet confirmed):
 *   "Proposed Pact: {occasion}" or "Proposed Pact with {names/circle}"
 *
 * CONFIRMED (pact made):
 *   "Pact Made: {occasion}" or "Pact Made with {names/circle}"
 *
 * "with" logic:
 *   - 1 other person → their name          ("Pact Made with Bea")
 *   - 2-3 other people → list names         ("Pact Made with Bea and Nicole")
 *   - 4+ people OR all circle members → circle name ("Pact Made with Sapact")
 */
function buildTitle(
  confirmed: boolean,
  occasion: string | null,
  otherNames: string[],
  circleName: string,
  totalCircleMembers: number,
  pactMemberCount: number,
): string {
  const prefix = confirmed ? 'Pact Made' : 'Proposed Pact'

  // If there's an occasion, use it
  if (occasion) {
    return `${prefix}: ${occasion}`
  }

  // Determine the "with" part
  const allIn = totalCircleMembers >= 3 && pactMemberCount >= totalCircleMembers
  const otherCount = otherNames.length

  let withPart: string
  if (allIn && circleName) {
    withPart = circleName
  } else if (otherCount === 0) {
    withPart = circleName || ''
  } else if (otherCount === 1) {
    withPart = otherNames[0]
  } else if (otherCount <= 3) {
    const last = otherNames[otherCount - 1]
    const rest = otherNames.slice(0, -1).join(', ')
    withPart = `${rest} and ${last}`
  } else {
    // 4+ people → use circle name
    withPart = circleName || otherNames.slice(0, 3).join(', ') + ` +${otherCount - 3}`
  }

  return withPart ? `${prefix} with ${withPart}` : prefix
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { pactId, occasion, spotName, otherNames, circleName, date, startHour, endHour, location, calendarId, confirmed, totalCircleMembers, pactMemberCount } = await request.json()
  if (!pactId || !date || startHour == null || endHour == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const smartTitle = buildTitle(
    !!confirmed,
    occasion || null,
    otherNames || [],
    circleName || '',
    totalCircleMembers || 0,
    pactMemberCount || 0,
  )

  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single()

  if (!conn) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 })

  const accessToken = await getAccessToken(conn, supabase)
  if (!accessToken) return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 })

  const event = {
    summary: smartTitle,
    location: location || undefined,
    description: `Created by Pact — plans that actually happen${spotName ? `\n📍 ${spotName}` : ''}`,
    start: {
      dateTime: hourToISO(date, startHour),
      timeZone: 'Asia/Manila',
    },
    end: {
      dateTime: hourToISO(date, endHour),
      timeZone: 'Asia/Manila',
    },
    extendedProperties: {
      private: { pactId },
    },
  }

  const targetCalendar = calendarId || 'primary'

  // Check if an event for this pact already exists (update instead of creating duplicate)
  let existingEventId: string | null = null
  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events?privateExtendedProperty=pactId%3D${pactId}&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const searchData = await searchRes.json()
    if (searchData.items?.length > 0) {
      existingEventId = searchData.items[0].id
    }
  } catch {}

  let gcalRes
  if (existingEventId) {
    gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events/${existingEventId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    )
  } else {
    gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    )
  }

  const gcalEvent = await gcalRes.json()
  if (gcalEvent.error) {
    if (gcalEvent.error.code === 403) {
      return NextResponse.json({
        error: 'Calendar write permission not granted. Please reconnect your calendar.',
        needsReconnect: true,
      }, { status: 403 })
    }
    return NextResponse.json({ error: gcalEvent.error.message }, { status: 500 })
  }

  // Add busy block (only for new events — updates don't need a new block)
  if (!existingEventId) {
    await supabase.from('busy_blocks').insert({
      user_id: user.id,
      date,
      start_hour: startHour,
      end_hour: endHour,
      source: 'pact',
      pact_id: pactId,
    })
  }

  return NextResponse.json({ eventId: gcalEvent.id, ok: true })
}
