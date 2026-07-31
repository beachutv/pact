import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ connected: false })

  const { data } = await supabase
    .from('calendar_connections')
    .select('id, created_at, provider')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()

  return NextResponse.json({
    connected: !!data,
    createdAt: data?.created_at || null,
  })
}
