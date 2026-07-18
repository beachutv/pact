'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nearestArea } from '@/lib/utils'

/**
 * Request the user's live location and update their profile in Supabase.
 * Uses watchPosition for continuous updates while the app is open.
 * Throttles DB writes to at most once per 2 minutes.
 */
export function useLocationUpdate(userId: string, key: string) {
  const hasRun = useRef<string>('')
  const lastUpdate = useRef(0)

  useEffect(() => {
    if (!userId || hasRun.current === key) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return

    hasRun.current = key

    async function updateLocation(lat: number, lng: number) {
      // Throttle: at most once per 2 minutes
      if (Date.now() - lastUpdate.current < 120000) return
      lastUpdate.current = Date.now()

      const { name } = nearestArea(lat, lng)
      const supabase = createClient()

      await supabase.from('users').update({
        live_lat: lat,
        live_lng: lng,
        live_area: name,
        live_updated_at: new Date().toISOString(),
      }).eq('id', userId)
    }

    // Try watchPosition for continuous updates
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        updateLocation(pos.coords.latitude, pos.coords.longitude)
      },
      (err) => {
        console.log('Location unavailable:', err.message)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [userId, key])
}
