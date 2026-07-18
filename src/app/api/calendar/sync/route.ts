import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DAYS_AHEAD = 14

async function getAccessToken(conn: any, supabase: any) {
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

  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single()

  if (!conn) return NextResponse.json({ error: 'No calendar connected' }, { status: 400 })

  const accessToken = await getAccessToken(conn, supabase)
  if (!accessToken) return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 })

  // Parse timezone from request body (if any)
  let timezone = 'Asia/Manila'
  try {
    const body = await request.json()
    if (body?.timezone) timezone = body.timezone
  } catch {}

  // Use selected calendars, defaulting to primary
  const calendarIds: string[] = conn.selected_calendars?.length
    ? conn.selected_calendars
    : ['primary']

  // Calculate time range
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endDate = new Date(startOfToday)
  endDate.setDate(endDate.getDate() + DAYS_AHEAD)

  // Call Google Calendar freeBusy API with all selected calendars
  const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: startOfToday.toISOString(),
      timeMax: endDate.toISOString(),
      timeZone: timezone,
      items: calendarIds.map(id => ({ id })),
    }),
  })

  const freeBusy = await freeBusyRes.json()
  if (freeBusy.error) {
    return NextResponse.json({ error: freeBusy.error.message }, { status: 500 })
  }

  // Merge busy periods from all selected calendars
  const allBusy: { start: string; end: string }[] = []
  for (const calId of calendarIds) {
    const cal = freeBusy.calendars?.[calId]
    if (cal?.busy) {
      allBusy.push(...cal.busy)
    }
  }

  // Sort and merge overlapping periods
  allBusy.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const merged: { start: string; end: string }[] = []
  for (const period of allBusy) {
    const last = merged[merged.length - 1]
    if (last && new Date(period.start) <= new Date(last.end)) {
      if (new Date(period.end) > new Date(last.end)) {
        last.end = period.end
      }
    } else {
      merged.push({ ...period })
    }
  }

  // Convert to busy_blocks (hourly granularity, Manila timezone)
  const blocks: { user_id: string; date: string; start_hour: number; end_hour: number }[] = []

  for (const period of merged) {
    const start = new Date(period.start)
    const end = new Date(period.end)

    // Convert to Manila time
    const manilaStart = new Date(start.toLocaleString('en-US', { timeZone: timezone }))
    const manilaEnd = new Date(end.toLocaleString('en-US', { timeZone: timezone }))

    let current = new Date(manilaStart)
    while (current < manilaEnd) {
      const dateStr = current.getFullYear() + '-' +
        String(current.getMonth() + 1).padStart(2, '0') + '-' +
        String(current.getDate()).padStart(2, '0')

      const startHour = current.getDate() === manilaStart.getDate() &&
        current.getMonth() === manilaStart.getMonth()
        ? manilaStart.getHours()
        : 0

      const dayEnd = new Date(current)
      dayEnd.setDate(dayEnd.getDate() + 1)
      dayEnd.setHours(0, 0, 0, 0)

      const endHour = manilaEnd < dayEnd
        ? Math.ceil(manilaEnd.getHours() + manilaEnd.getMinutes() / 60)
        : 24

      if (endHour > startHour) {
        blocks.push({
          user_id: user.id,
          date: dateStr,
          start_hour: startHour,
          end_hour: endHour,
        })
      }

      current.setDate(current.getDate() + 1)
      current.setHours(0, 0, 0, 0)
    }
  }

  // Delete old google-sourced busy blocks for this user
  const startStr = startOfToday.getFullYear() + '-' +
    String(startOfToday.getMonth() + 1).padStart(2, '0') + '-' +
    String(startOfToday.getDate()).padStart(2, '0')

  await supabase.from('busy_blocks')
    .delete()
    .eq('user_id', user.id)
    .eq('source', 'google')
    .gte('date', startStr)

  if (blocks.length > 0) {
    await supabase.from('busy_blocks').insert(blocks)
  }

  return NextResponse.json({
    synced: blocks.length,
    days: DAYS_AHEAD,
    calendars: calendarIds.length,
    periods: merged.length,
  })
}
