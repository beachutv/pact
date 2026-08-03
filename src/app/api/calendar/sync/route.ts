import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccessToken } from '@/lib/google-auth'

const DAYS_AHEAD = 90

// Fetch events from Google Calendar to get locations
async function fetchEventLocations(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
  timezone: string,
): Promise<Map<string, string>> {
  // Map: "YYYY-MM-DD|startHour|endHour" -> location
  const locationMap = new Map<string, string>()

  for (const calId of calendarIds) {
    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        timeZone: timezone,
        singleEvents: 'true',
        maxResults: '500',
        fields: 'items(start,end,location)',
      })
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const event of data.items || []) {
        if (!event.location) continue
        const start = new Date(event.start?.dateTime || event.start?.date)
        const end = new Date(event.end?.dateTime || event.end?.date)
        // Convert to Manila time
        const mStart = new Date(start.toLocaleString('en-US', { timeZone: timezone }))
        const mEnd = new Date(end.toLocaleString('en-US', { timeZone: timezone }))

        // Store location keyed by date + hour range
        const dateStr = mStart.getFullYear() + '-' +
          String(mStart.getMonth() + 1).padStart(2, '0') + '-' +
          String(mStart.getDate()).padStart(2, '0')
        const startHour = mStart.getHours()
        const endHour = mEnd.getDate() !== mStart.getDate()
          ? 26 // matches DAY_END — covers past midnight
          : Math.ceil(mEnd.getHours() + mEnd.getMinutes() / 60)

        // Store for each hour this event covers
        for (let h = startHour; h < endHour && h < 26; h++) {
          const key = `${dateStr}|${h}`
          // Later events overwrite earlier ones for the same hour — that's fine
          locationMap.set(key, event.location)
        }
      }
    } catch (e) {
      console.warn(`[CalSync] Failed to fetch events for ${calId}:`, e)
    }
  }

  return locationMap
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

  // Only sync calendars the user has explicitly selected — never default to primary
  const calendarIds: string[] = (conn.selected_calendars && Array.isArray(conn.selected_calendars))
    ? conn.selected_calendars
    : [] // never configured — don't sync anything (privacy first)

  // If user deselected all calendars, clear their busy blocks
  if (calendarIds.length === 0) {
    await supabase.from('busy_blocks').delete().eq('user_id', user.id)
    return NextResponse.json({ synced: 0, message: 'No calendars selected — busy blocks cleared' })
  }

  // Calculate time range
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endDate = new Date(startOfToday)
  endDate.setDate(endDate.getDate() + DAYS_AHEAD)

  // Fetch freeBusy and event locations in parallel
  const [freeBusyRes, locationMap] = await Promise.all([
    fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
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
    }),
    fetchEventLocations(accessToken, calendarIds, startOfToday.toISOString(), endDate.toISOString(), timezone),
  ])

  const freeBusy = await freeBusyRes.json()
  if (freeBusy.error) {
    return NextResponse.json({ error: freeBusy.error.message }, { status: 500 })
  }

  // Merge busy periods from all selected calendars
  const allBusy: { start: string; end: string }[] = []
  const calDetails: Record<string, number> = {}
  for (const calId of calendarIds) {
    const cal = freeBusy.calendars?.[calId]
    if (cal?.errors) {
      console.warn(`[CalSync] Calendar ${calId} errors:`, cal.errors)
    }
    if (cal?.busy) {
      calDetails[calId] = cal.busy.length
      allBusy.push(...cal.busy)
    } else {
      calDetails[calId] = 0
    }
  }
  console.log(`[CalSync] Calendar busy counts:`, calDetails, `Total: ${allBusy.length}, Locations: ${locationMap.size}`)

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
  const blocks: { user_id: string; date: string; start_hour: number; end_hour: number; location: string | null; source: string }[] = []

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
        : 26 // extends to 2 AM next day — matches DAY_END in the calendar UI

      if (endHour > startHour) {
        // Find location for this block — check the last hour of the block
        let blockLocation: string | null = null
        for (let h = endHour - 1; h >= startHour; h--) {
          const loc = locationMap.get(`${dateStr}|${h}`)
          if (loc) { blockLocation = loc; break }
        }

        blocks.push({
          user_id: user.id,
          date: dateStr,
          start_hour: startHour,
          end_hour: endHour,
          location: blockLocation,
          source: 'google',
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
    locationsFound: locationMap.size,
  })
}
