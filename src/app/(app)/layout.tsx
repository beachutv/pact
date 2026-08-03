import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import Changelog from '@/components/Changelog'
import Walkthrough from '@/components/Walkthrough'

// Prevent Next.js from caching stale user data (avatar, name, etc.)
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  // Fetch user profile + circles
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile?.home_area) redirect('/onboarding')

  const { data: memberships } = await supabase
    .from('circle_members')
    .select('circle_id, role, circles(id, name, emoji, invite_code, visibility, join_mode, created_by)')
    .eq('user_id', user.id)

  const circles = (memberships || [])
    .map(m => (m as any).circles)
    .filter(Boolean)

  return (
    <AppShell user={profile} circles={circles}>
      <Changelog />
      <Walkthrough />
      {children}
    </AppShell>
  )
}
