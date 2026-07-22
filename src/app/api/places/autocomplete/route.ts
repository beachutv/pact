import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query || query.length < 2) {
    return NextResponse.json({ predictions: [] })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || 'AIzaSyDKs-EC4-7NLpKM9UuMNomS4hrDxLNHVkE'
  if (!apiKey) {
    console.error('[Places] GOOGLE_PLACES_API_KEY not set')
    return NextResponse.json({ predictions: [] })
  }

  // Use legacy Places Autocomplete API (the "Places API (New)" isn't enabled)
  try {
    const params = new URLSearchParams({
      input: query,
      key: apiKey,
      components: 'country:ph',
      location: '14.5995,120.9842',
      radius: '30000',
    })

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
      { next: { revalidate: 0 } }
    )

    const data = await res.json()

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('[Places] API error:', data.status, data.error_message)
      return NextResponse.json({ predictions: [], error: data.error_message || data.status })
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      place_id: p.place_id || '',
      description: p.description || '',
      main_text: p.structured_formatting?.main_text || p.description || '',
      secondary_text: p.structured_formatting?.secondary_text || '',
    }))

    return NextResponse.json({ predictions })
  } catch (e: any) {
    console.error('[Places] Fetch error:', e.message)
    return NextResponse.json({ predictions: [] })
  }
}
