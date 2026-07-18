import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
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
    if (!tokens.access_token) return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 })
    accessToken = tokens.access_token
    await supabase.from('calendar_connections').update({
      access_token: tokens.access_token,
      token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }).eq('id', conn.id)
  }

  // Fetch calendar list from Google
  const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const calData = await calRes.json()

  if (calData.error) {
    return NextResponse.json({ error: calData.error.message }, { status: 500 })
  }

  const calendars = (calData.items || []).map((c: any) => ({
    id: c.id,
    summary: c.summary || c.id,
    description: c.description || '',
    primary: c.primary || false,
    backgroundColor: c.backgroundColor || '#7c5cff',
    accessRole: c.accessRole,
  }))

  // Return current selection too
  const selectedIds = conn.selected_calendars || ['primary']

  return NextResponse.json({ calendars, selectedIds })
}

// Save selected calendars
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { selectedIds } = await req.json()
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one calendar' }, { status: 400 })
  }

  await supabase.from('calendar_connections')
    .update({ selected_calendars: selectedIds })
    .eq('user_id', user.id)
    .eq('provider', 'google')

  return NextResponse.json({ ok: true })
}
