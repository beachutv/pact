import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Geocode a user's home area and store lat/lng in users table
// Called once when home_lat/home_lng are null but home_area is set
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('home_area, home_lat, home_lng')
    .eq('id', user.id)
    .single()

  if (!profile?.home_area) {
    return NextResponse.json({ error: 'No home area set' }, { status: 400 })
  }

  // Already geocoded
  if (profile.home_lat && profile.home_lng) {
    return NextResponse.json({ lat: profile.home_lat, lng: profile.home_lng, cached: true })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDKs-EC4-7NLpKM9UuMNomS4hrDxLNHVkE'

  try {
    // Use Google Geocoding API
    const params = new URLSearchParams({
      address: `${profile.home_area}, Metro Manila, Philippines`,
      key: apiKey,
      region: 'ph',
    })

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
      { next: { revalidate: 86400 } } // Cache 24h
    )
    const data = await res.json()

    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const { lat, lng } = data.results[0].geometry.location

      // Store in users table
      await supabase.from('users').update({ home_lat: lat, home_lng: lng }).eq('id', user.id)

      return NextResponse.json({ lat, lng, geocoded: true })
    }

    return NextResponse.json({ error: 'Geocoding failed', status: data.status }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
