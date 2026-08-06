import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Vercel Cron: runs daily at 6 AM (Hobby plan only allows daily frequency)
// This ensures availability stays fresh even when users aren't online
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (or has the right secret)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }

  // Use service role client to bypass RLS
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Get all calendar connections
  const { data: connections, error: connError } = await supabase
    .from('calendar_connections')
    .select('id, user_id, access_token, refresh_token, token_expiry, selected_calendars, provider')
    .eq('provider', 'google')

  if (connError || !connections) {
    return NextResponse.json({ error: connError?.message || 'No connections' }, { status: 500 })
  }

  let synced = 0
  let failed = 0
  let skipped = 0
  const DAYS_AHEAD = 90

  for (const conn of connections) {
    try {
      // Skip if no calendars selected
      const calendarIds: string[] = (conn.selected_calendars && Array.isArray(conn.selected_calendars))
        ? conn.selected_calendars
        : [] // never configured — don't sync (privacy first)

      if (calendarIds.length === 0) {
        // No calendars — clear any stale data
        await supabase.from('busy_blocks').delete()
          .eq('user_id', conn.user_id).eq('source', 'google')
        skipped++
        continue
      }

      // Refresh token if needed
      let accessToken = conn.access_token
      const expiry = new Date(conn.token_expiry)
      if (expiry <= new Date(Date.now() + 5 * 60 * 1000)) {
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
        if (!tokens.access_token) {
          failed++
          continue
        }
        accessToken = tokens.access_token
        await supabase.from('calendar_connections').update({
          access_token: tokens.access_token,
          token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        }).eq('id', conn.id)
      }

      // Call Google freeBusy API
      const timeMin = new Date().toISOString()
      const timeMax = new Date(Date.now() + DAYS_AHEAD * 86400000).toISOString()
      const timezone = 'Asia/Manila'

      const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone: timezone,
          items: calendarIds.map(id => ({ id })),
        }),
      })

      const fbData = await fbRes.json()
      if (fbData.error) {
        failed++
        continue
      }

      // Merge busy periods from all calendars
      const allBusy: { start: string; end: string }[] = []
      for (const calId of calendarIds) {
        const cal = fbData.calendars?.[calId]
        if (cal?.busy) allBusy.push(...cal.busy)
      }

      // Sort and merge overlapping periods
      allBusy.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      const merged: { start: string; end: string }[] = []
      for (const period of allBusy) {
        const last = merged[merged.length - 1]
        if (last && new Date(period.start) <= new Date(last.end)) {
          if (new Date(period.end) > new Date(last.end)) last.end = period.end
        } else {
          merged.push({ ...period })
        }
      }

      // Convert to hourly blocks (iterate day-by-day for multi-day events)
      const blocks: { user_id: string; date: string; start_hour: number; end_hour: number; source: string }[] = []

      for (const period of merged) {
        const start = new Date(period.start)
        const end = new Date(period.end)

        // Convert to Manila timezone
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
            : 24 // cap at 24 — DB constraint

          if (endHour > startHour) {
            blocks.push({
              user_id: conn.user_id,
              date: dateStr,
              start_hour: startHour,
              end_hour: endHour,
              source: 'google',
            })
          }

          current.setDate(current.getDate() + 1)
          current.setHours(0, 0, 0, 0)
        }
      }

      // Delete old google blocks and insert new ones
      await supabase.from('busy_blocks').delete()
        .eq('user_id', conn.user_id).eq('source', 'google')

      if (blocks.length > 0) {
        // Insert in chunks of 500
        for (let i = 0; i < blocks.length; i += 500) {
          await supabase.from('busy_blocks').insert(blocks.slice(i, i + 500))
        }
      }

      synced++
    } catch (e) {
      console.error(`Cron sync failed for user ${conn.user_id}:`, e)
      failed++
    }
  }

  return NextResponse.json({
    total: connections.length,
    synced,
    failed,
    skipped,
    timestamp: new Date().toISOString(),
  })
}
