/**
 * Send push notifications to specified users via the API route.
 * Fire-and-forget — failures are silently logged.
 */
export async function sendPushNotification({
  userIds,
  title,
  body,
  url,
  tag,
}: {
  userIds: string[]
  title: string
  body: string
  url?: string
  tag?: string
}) {
  if (!userIds.length) return
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_ids: userIds,
        title,
        body,
        url: url || '/home',
        tag: tag || 'pact-default',
      }),
    })
  } catch (e) {
    console.error('Push notification send failed:', e)
  }
}
