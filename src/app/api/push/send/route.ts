import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import webpush from 'web-push'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = 'mailto:pact@pact.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { user_ids, title, body: msgBody, url, tag } = body

    if (!user_ids || !Array.isArray(user_ids) || !user_ids.length) {
      return NextResponse.json({ error: 'user_ids required' }, { status: 400 })
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 })
    }

    const supabase = await createClient()

    // Get all push subscriptions for the target users
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('user_id', user_ids)

    if (!subs || subs.length === 0) {
      return NextResponse.json({ sent: 0 })
    }

    const payload = JSON.stringify({
      title: title || 'Pact',
      body: msgBody || '',
      url: url || '/home',
      tag: tag || 'pact-default',
    })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        )
      )
    )

    // Clean up expired/invalid subscriptions
    const expiredEndpoints: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const status = (r.reason as any)?.statusCode
        if (status === 404 || status === 410) {
          expiredEndpoints.push(subs[i].endpoint)
        }
      }
    })

    if (expiredEndpoints.length) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
    }

    const sent = results.filter(r => r.status === 'fulfilled').length

    return NextResponse.json({ sent, total: subs.length })
  } catch (e: any) {
    console.error('Push send error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
