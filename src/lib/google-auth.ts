/**
 * Shared Google OAuth token management.
 * Used by calendar sync, push-event, and delete-event API routes.
 */

/**
 * Get a valid Google API access token, refreshing if expired.
 * Returns null if refresh fails.
 */
export async function getAccessToken(
  conn: { id: string; access_token: string; refresh_token: string; token_expiry: string },
  supabase: any
): Promise<string | null> {
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
