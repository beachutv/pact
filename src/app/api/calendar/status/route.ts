import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ connected: false, reason: 'not authenticated' })
    }

    const { data, error } = await supabase
      .from('calendar_connections')
      .select('id, created_at, provider, selected_calendars')
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ connected: false, reason: error.message })
    }

    return NextResponse.json({
      connected: !!data,
      createdAt: data?.created_at || null,
      selectedCalendars: data?.selected_calendars || null,
    })
  } catch (e: any) {
    return NextResponse.json({ connected: false, reason: e.message })
  }
}
