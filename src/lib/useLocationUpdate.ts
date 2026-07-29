'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nearestArea } from '@/lib/utils'

/**
 * Track the user's live location and update their profile in Supabase.
 * Uses getCurrentPosition for immediate updates + watchPosition for continuous.
 * Throttles DB writes to at most once per 2 minutes.
 * Re-triggers on visibility change (app foregrounded).
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

    function getOnce() {
      navigator.geolocation.getCurrentPosition(
        (pos) => updateLocation(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      )
    }

    let watchId: number | null = null

    function startWatching() {
      // Immediate position on start
      getOnce()

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          updateLocation(pos.coords.latitude, pos.coords.longitude)
        },
        (err) => {
          console.log('Location unavailable:', err.message)
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      )
    }

    // Re-trigger location on visibility change (app foregrounded)
    function onVisChange() {
      if (document.visibilityState === 'visible') {
        // Reset throttle so we get fresh location when user comes back
        lastUpdate.current = 0
        getOnce()
      }
    }

    let permCleanup: (() => void) | null = null

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'granted') {
          startWatching()
          document.addEventListener('visibilitychange', onVisChange)
        } else if (result.state === 'prompt') {
          const onChange = () => {
            if (result.state === 'granted') {
              startWatching()
              document.addEventListener('visibilitychange', onVisChange)
            }
          }
          result.addEventListener('change', onChange)
          permCleanup = () => result.removeEventListener('change', onChange)
        }
      }).catch(() => {})
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
      }
      document.removeEventListener('visibilitychange', onVisChange)
      if (permCleanup) permCleanup()
    }
  }, [userId, key])
}
