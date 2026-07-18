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

  const { pactId } = await request.json()
  if (!pactId) {
    return NextResponse.json({ error: 'Missing pactId' }, { status: 400 })
  }

  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single()

  if (!conn) return NextResponse.json({ ok: true, skipped: true })

  const accessToken = await getAccessToken(conn, supabase)
  if (!accessToken) return NextResponse.json({ ok: true, skipped: true })

  // Find events with this pactId in extendedProperties
  const searchUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  searchUrl.searchParams.set('privateExtendedProperty', `pactId=${pactId}`)
  searchUrl.searchParams.set('maxResults', '10')

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!searchRes.ok) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const searchData = await searchRes.json()
  const events = searchData.items || []

  // Delete each matching event
  for (const event of events) {
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
  }

  return NextResponse.json({ ok: true, deleted: events.length })
}
