'use client'

import { useCircle } from '@/components/AppShell'

export default function SpotsPage() {
  const { activeCircle } = useCircle()

  return (
    <div style={{ padding: 20, textAlign: 'center', marginTop: 40, color: 'var(--text2)' }}>
      <p style={{ fontSize: 40, marginBottom: 8 }}>📍</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Spots</p>
      <p style={{ fontSize: 13 }}>
        {activeCircle ? 'Spot recommendations will appear once you pick a time window from the calendar.' : 'Join a circle first.'}
      </p>
    </div>
  )
}
