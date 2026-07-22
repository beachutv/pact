import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Not logged in — redirect to login, then back here
    redirect(`/?next=/join/${code}`)
  }

  // Find circle
  const { data: circle } = await supabase
    .from('circles')
    .select('id, name, emoji')
    .eq('invite_code', code)
    .single()

  if (!circle) {
    redirect('/calendar')
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circle.id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'member',
    })
  }

  redirect('/calendar')
}
