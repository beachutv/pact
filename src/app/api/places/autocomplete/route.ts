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

  // Use Places API (New) — the legacy API is deprecated
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input: query,
        includedRegionCodes: ['ph'],
        locationBias: {
          circle: {
            center: { latitude: 14.5995, longitude: 120.9842 },
            radius: 30000.0,
          },
        },
      }),
    })

    const data = await res.json()

    if (data.error) {
      console.error('[Places] API error:', data.error.message)
      return NextResponse.json({ predictions: [], error: data.error.message })
    }

    const predictions = (data.suggestions || [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => {
        const p = s.placePrediction
        return {
          place_id: p.placeId || p.place || '',
          description: p.text?.text || '',
          main_text: p.structuredFormat?.mainText?.text || p.text?.text || '',
          secondary_text: p.structuredFormat?.secondaryText?.text || '',
        }
      })

    return NextResponse.json({ predictions })
  } catch (e: any) {
    console.error('[Places] Fetch error:', e.message)
    return NextResponse.json({ predictions: [] })
  }
}
