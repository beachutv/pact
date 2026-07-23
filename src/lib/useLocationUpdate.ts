'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nearestArea } from '@/lib/utils'

/**
 * Track the user's live location and update their profile in Supabase.
 * Uses watchPosition for continuous updates while the app is open.
 * Only starts tracking if permission is already granted — never triggers the browser prompt.
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

    let watchId: number | null = null

    function startWatching() {
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

    // Check permission state — only watch if granted, but listen for changes
    // so we start tracking as soon as the user grants permission
    let permCleanup: (() => void) | null = null

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'granted') {
          startWatching()
        } else if (result.state === 'prompt') {
          // Listen for the user granting permission (triggered by AppShell's one-time prompt)
          const onChange = () => {
            if (result.state === 'granted') {
              startWatching()
            }
          }
          result.addEventListener('change', onChange)
          permCleanup = () => result.removeEventListener('change', onChange)
        }
        // If 'denied', don't do anything
      }).catch(() => {
        // Fallback: some browsers don't support permissions.query for geolocation
      })
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
      }
      if (permCleanup) permCleanup()
    }
  }, [userId, key])
}
