import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 500 })
  }

  // Pass through ?next= param so we can redirect after calendar connect
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') || ''

  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  // Store next in state param so callback can redirect correctly
  if (next) url.searchParams.set('state', next)
  // Use login_hint to skip account chooser when possible
  const hint = searchParams.get('login_hint')
  if (hint) url.searchParams.set('login_hint', hint)

  return NextResponse.redirect(url.toString())
}
