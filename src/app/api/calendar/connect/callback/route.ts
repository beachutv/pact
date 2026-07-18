import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${origin}/home?error=calendar-denied`)
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()

  if (!tokens.access_token) {
    return NextResponse.redirect(`${origin}/home?error=token-exchange`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/`)

  // Store calendar connection
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase.from('calendar_connections').upsert({
    user_id: user.id,
    provider: 'google',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expiry: expiresAt,
    calendar_id: 'primary',
  }, { onConflict: 'user_id,provider' })

  // TODO: Initial sync — fetch busy blocks for next 60 days
  // This will be implemented in Phase 2

  return NextResponse.redirect(`${origin}/home?connected=google`)
}
