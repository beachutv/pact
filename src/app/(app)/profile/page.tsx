'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCircle } from '@/components/AppShell'

/**
 * /profile (no ID) → redirect to own profile.
 * The full profile UI lives in /profile/[id]/page.tsx.
 */
export default function ProfileRedirect() {
  const { user } = useCircle()
  const router = useRouter()

  useEffect(() => {
    router.replace(`/profile/${user.id}`)
  }, [user.id, router])

  return null
}
