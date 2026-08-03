import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccessToken } from '@/lib/google-auth'

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
