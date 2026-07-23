/** Format hour number to "9 AM" / "12 PM" style */
export function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12 MN'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

/** Short format: "9a" / "12p" */
export function fmtTiny(h: number): string {
  if (h === 0 || h === 24) return '12mn'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** Format a time window */
export function fmtWin(s: number, e: number): string {
  return `${fmtHour(s)} – ${fmtHour(e)}`
}

/** Format date string to "Friday, July 18" */
export function fmtDate(ds: string): string {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  })
}

/** Format date string to "Fri, Jul 18" */
export function fmtShort(ds: string): string {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

/** Date to YYYY-MM-DD string */
export function toStr(d: Date): string {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

/** Days between two date strings */
export function daysUntil(ds: string): number {
  const a = new Date(ds + 'T00:00:00')
  const b = new Date(toStr(new Date()) + 'T00:00:00')
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/** Auto-contrast text color for avatar backgrounds */
export function txtOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#141824' : '#fff'
}

/** Birthday countdown in days (-1 if not within maxDays) */
export function bdaySoon(birthday: string, maxDays = 14): number {
  const today = new Date()
  const [mm, dd] = birthday.split('-').map(Number)
  let b = new Date(today.getFullYear(), mm - 1, dd)
  if (b < new Date(toStr(today) + 'T00:00:00')) {
    b = new Date(today.getFullYear() + 1, mm - 1, dd)
  }
  const days = Math.round((b.getTime() - new Date(toStr(today) + 'T00:00:00').getTime()) / 86400000)
  return days <= maxDays ? days : -1
}

/** Escape HTML entities */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Metro Manila areas with coordinates for travel time calculation */
export const AREAS: Record<string, { x: number; y: number }> = {
  // Quezon City
  'Katipunan, QC': { x: 6, y: 8 },
  'Maginhawa, QC': { x: 5.2, y: 7.5 },
  'Timog Ave, QC': { x: 4.8, y: 7 },
  'Diliman, QC': { x: 5, y: 8.2 },
  'Cubao, QC': { x: 5.3, y: 6.8 },
  'Eastwood, QC': { x: 6, y: 6.5 },
  'Tomas Morato, QC': { x: 4.9, y: 7.2 },
  'Commonwealth, QC': { x: 5.5, y: 9 },
  'Fairview, QC': { x: 4.5, y: 10 },
  'Novaliches, QC': { x: 5, y: 10.5 },
  'Project 2-3, QC': { x: 4.8, y: 7.4 },
  // Makati
  'Poblacion, Makati': { x: 4.2, y: 3.8 },
  'Ayala, Makati': { x: 4, y: 3.4 },
  'Legazpi Village, Makati': { x: 4.1, y: 3.5 },
  'Salcedo Village, Makati': { x: 4.3, y: 3.6 },
  // Taguig
  'BGC, Taguig': { x: 5.5, y: 3.5 },
  'Uptown, Taguig': { x: 5.6, y: 3.3 },
  'McKinley, Taguig': { x: 5.3, y: 3.2 },
  // Pasig
  'Kapitolyo, Pasig': { x: 5.3, y: 5.3 },
  'Ortigas, Pasig': { x: 5.5, y: 5.6 },
  'C5/Bagong Ilog, Pasig': { x: 5.8, y: 5 },
  // Manila
  'Ermita, Manila': { x: 2.8, y: 5 },
  'Malate, Manila': { x: 2.7, y: 4.5 },
  'Binondo, Manila': { x: 3, y: 6 },
  'Sampaloc, Manila': { x: 3.5, y: 6.5 },
  'Intramuros, Manila': { x: 2.8, y: 5.5 },
  'U-Belt, Manila': { x: 3.3, y: 6.2 },
  // San Juan
  'San Juan': { x: 4.3, y: 5.6 },
  // Mandaluyong
  'Mandaluyong': { x: 4.5, y: 4.8 },
  'Shaw/Greenfield, Mandaluyong': { x: 4.8, y: 5 },
  // Marikina
  'Marikina': { x: 7, y: 7.5 },
  // Parañaque
  'BF Homes, Parañaque': { x: 4, y: 1 },
  'Sucat, Parañaque': { x: 5, y: 1.5 },
  // Las Piñas
  'Alabang, Muntinlupa': { x: 4.5, y: 0.5 },
  'Las Piñas': { x: 3.2, y: 1 },
  // Pasay
  'Pasay/MOA': { x: 3.3, y: 2.5 },
  // Caloocan
  'Caloocan': { x: 3.8, y: 8 },
  // Valenzuela
  'Valenzuela': { x: 3.5, y: 9 },
  // Navotas / Malabon
  'Navotas/Malabon': { x: 3, y: 8.5 },
  // Nearby cities
  'Antipolo, Rizal': { x: 8, y: 7 },
  'Cainta, Rizal': { x: 7.5, y: 6 },
  'Taytay, Rizal': { x: 7.5, y: 5 },
}

/** Available avatar colors */
export const AVATAR_COLORS = [
  '#7c5cff', '#f472b6', '#38bdf8', '#fbbf24', '#4ade80',
  '#fb923c', '#2dd4bf', '#a3e635', '#f97316', '#e879f9',
  '#64748b', '#ef4444',
]

/** Travel time between two coordinate points (Metro Manila approximation) */
export function travelMin(a: { x: number; y: number }, b: { x: number; y: number }): number {
  // x = lat, y = lng. Convert degree differences to km using Manila-appropriate factors
  const dLatKm = (a.x - b.x) * 111.32 // 1° lat ≈ 111.32 km
  const dLngKm = (a.y - b.y) * 107.55 // 1° lng at ~14.5°N ≈ 107.55 km
  const km = Math.sqrt(dLatKm * dLatKm + dLngKm * dLngKm)
  // Metro Manila: ~3 min per km average with traffic, +5 min base
  return Math.round(km * 3) + 5
}

/** More accurate travel time using GPS lat/lng (Haversine → km → Metro Manila driving minutes) */
export function travelMinGps(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng
  const km = 2 * R * Math.asin(Math.sqrt(h))
  // Metro Manila: ~3 min per km average with traffic, +5 min base
  return Math.round(km * 3) + 5
}

/** Get browser timezone (falls back to Asia/Manila) */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'Asia/Manila'
  }
}

/** Get current hour in a given timezone */
export function currentHourInTz(tz: string): number {
  const str = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
  return parseInt(str)
}

export const DAY_START = 6
export const DAY_END = 24

/** Real GPS coordinates for Metro Manila areas (for live location matching) */
export const AREA_GPS: Record<string, { lat: number; lng: number }> = {
  'Katipunan, QC': { lat: 14.6313, lng: 121.0735 },
  'Maginhawa, QC': { lat: 14.6519, lng: 121.0445 },
  'Timog Ave, QC': { lat: 14.6339, lng: 121.0313 },
  'Diliman, QC': { lat: 14.6545, lng: 121.0600 },
  'Cubao, QC': { lat: 14.6181, lng: 121.0543 },
  'Eastwood, QC': { lat: 14.6101, lng: 121.0784 },
  'Tomas Morato, QC': { lat: 14.6342, lng: 121.0355 },
  'Commonwealth, QC': { lat: 14.6694, lng: 121.0872 },
  'Fairview, QC': { lat: 14.7040, lng: 121.0570 },
  'Novaliches, QC': { lat: 14.7200, lng: 121.0400 },
  'Project 2-3, QC': { lat: 14.6400, lng: 121.0400 },
  'Poblacion, Makati': { lat: 14.5636, lng: 121.0300 },
  'Ayala, Makati': { lat: 14.5507, lng: 121.0244 },
  'Legazpi Village, Makati': { lat: 14.5535, lng: 121.0180 },
  'Salcedo Village, Makati': { lat: 14.5600, lng: 121.0220 },
  'BGC, Taguig': { lat: 14.5503, lng: 121.0502 },
  'Uptown, Taguig': { lat: 14.5545, lng: 121.0530 },
  'McKinley, Taguig': { lat: 14.5420, lng: 121.0450 },
  'Kapitolyo, Pasig': { lat: 14.5726, lng: 121.0552 },
  'Ortigas, Pasig': { lat: 14.5876, lng: 121.0610 },
  'C5/Bagong Ilog, Pasig': { lat: 14.5750, lng: 121.0700 },
  'Ermita, Manila': { lat: 14.5831, lng: 120.9853 },
  'Malate, Manila': { lat: 14.5700, lng: 120.9880 },
  'Binondo, Manila': { lat: 14.6000, lng: 120.9730 },
  'Sampaloc, Manila': { lat: 14.6120, lng: 120.9930 },
  'Intramuros, Manila': { lat: 14.5893, lng: 120.9752 },
  'U-Belt, Manila': { lat: 14.6040, lng: 120.9900 },
  'San Juan': { lat: 14.6019, lng: 121.0355 },
  'Mandaluyong': { lat: 14.5794, lng: 121.0359 },
  'Shaw/Greenfield, Mandaluyong': { lat: 14.5818, lng: 121.0460 },
  'Marikina': { lat: 14.6315, lng: 121.1065 },
  'BF Homes, Parañaque': { lat: 14.4650, lng: 121.0200 },
  'Sucat, Parañaque': { lat: 14.4750, lng: 121.0450 },
  'Alabang, Muntinlupa': { lat: 14.4242, lng: 121.0421 },
  'Las Piñas': { lat: 14.4497, lng: 121.0005 },
  'Pasay/MOA': { lat: 14.5351, lng: 120.9827 },
  'Caloocan': { lat: 14.6490, lng: 120.9700 },
  'Valenzuela': { lat: 14.6917, lng: 120.9710 },
  'Navotas/Malabon': { lat: 14.6600, lng: 120.9560 },
  'Antipolo, Rizal': { lat: 14.5861, lng: 121.1761 },
  'Cainta, Rizal': { lat: 14.5730, lng: 121.1200 },
  'Taytay, Rizal': { lat: 14.5590, lng: 121.1350 },
}

/** Find the nearest Metro Manila area from GPS coordinates */
export function nearestArea(lat: number, lng: number): { name: string; distKm: number } {
  let best = { name: 'Unknown', distKm: Infinity }
  for (const [name, gps] of Object.entries(AREA_GPS)) {
    const dLat = (lat - gps.lat) * 111.32
    const dLng = (lng - gps.lng) * 111.32 * Math.cos(lat * Math.PI / 180)
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist < best.distKm) best = { name, distKm: dist }
  }
  return best
}
