# Pact — Source of Truth

> **CRITICAL RULE:** Always stick to the prototype (`pact-app.html`) since we flushed out the features and design there first before starting to build. It would take more time and effort to iterate as we go, and to correct every new thing.

---

## 1. Project Overview

**App Name:** Pact
**Mission:** Help friend groups (~10-20 people) in Metro Manila align schedules and make plans that actually push through.
**Target Users:** Friend circles in Metro Manila who struggle to coordinate hangouts.

---

## 2. Tech Stack Configuration

### Frontend / Hosting — Vercel

- **Framework:** Next.js 15 (App Router) with TypeScript and Tailwind CSS
- **Deployment:** Vercel (Hobby tier)
- **Production URL:** https://pact-khaki-seven.vercel.app
- **Team slug:** `beachutvs-projects`
- **Git repo:** https://github.com/beachutv/pact (public)
- **Branch:** `main` (auto-deploys on push)
- **Bundler:** Turbopack

### Database / Auth — Supabase

- **Project ID:** `zxluwryrbpnvsktpxqlj`
- **Region:** Singapore
- **Auth:** Google OAuth (via Supabase Auth)
- **Storage:** `avatars` bucket (public) for profile photos

#### Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User profiles (name, email, color, home_area, home_x/y, birthday, avatar_url, phone, address, share_phone, share_address, theme, precise_loc, live_lat/lng/area/updated_at) |
| `circles` | Friend groups (name, emoji, invite_code, created_by) |
| `circle_members` | Circle membership (circle_id, user_id, role: admin/member) |
| `calendar_connections` | Google Calendar OAuth tokens (access_token, refresh_token, token_expiry, selected_calendars) |
| `busy_blocks` | Hourly busy/free data per user per date (source: google/apple/manual/pact) |
| `pacts` | Planned hangouts (date, win_start, win_end, spot_name/emoji/area, circle_id, occasion, created_by, from_message) |
| `pact_members` | Who's in each pact (pact_id, user_id) |
| `threads` | Chat threads (name, circle_id, color) |
| `thread_members` | Thread membership |
| `messages` | Chat messages (text, date_card proposals, spots, RSVP tracking) |
| `rsvps` | Date card responses (message_id, user_id, response: in/out) |
| `thread_reads` | Unread tracking (thread_id, user_id, last_read_at) |
| `notifications` | App-wide notifications (type: message/pact_new/pact_change/pact_upcoming/spark, title, body, link, read) |
| `occasions` | Special dates (birthdays, anniversaries) |
| `favorite_spots` | Saved locations |

#### Key RLS Functions

- `get_my_circle_ids()` — SECURITY DEFINER, returns circle IDs for current user
- `get_my_circle_mate_ids()` — SECURITY DEFINER, returns user IDs of all circle mates
- `user_thread_ids()` — SECURITY DEFINER, returns thread IDs for current user (breaks circular chat RLS)
- `trg_thread_last_msg` — Trigger: auto-updates threads.last_message_at and last_message_preview on new message

#### Key Patterns

- `crypto.randomUUID()` for client-side ID generation (avoids RLS SELECT-after-INSERT failures)
- `window.location.href` instead of `router.push()` when server components need fresh data
- CASCADE foreign keys on messages, thread_members, thread_reads, rsvps → threads (simplifies deletion)

### Calendar Integration — Google Calendar API

- **GCP Project:** `strange-wharf-502518-i8`
- **OAuth Consent Screen:** Testing mode with sensitive scopes
- **Client ID:** `176863843742-8r23tdiq5f72v0l8i0mjvj88v5pr5mlc.apps.googleusercontent.com`
- **Scopes:** `calendar.readonly`, `calendar.events` (for read + write)
- **Redirect URI (prod):** `https://pact-khaki-seven.vercel.app/api/calendar/connect/callback`

#### How Availability Works

1. User connects Google Calendar via OAuth → tokens stored in `calendar_connections`
2. On calendar page load, auto-sync fires → `/api/calendar/sync` calls Google freeBusy API for all selected calendars across 14 days
3. Busy periods are merged (overlapping blocks combined) and stored as `busy_blocks` rows
4. Calendar grid computes free windows per member, showing best shared availability
5. Sparks detect nearby friends (< 25 min travel) with shared free windows today

### Google Places API

- **API Key:** `AIzaSyDKs-EC4-7NLpKM9UuMNomS4hrDxLNHVkE`
- **Usage:** Autocomplete for plan location input (`/api/places/autocomplete`)
- **Billing:** Free trial ($300 credit, 90 days)

---

## 3. Current Status — Features Built and Working

### Core

- [x] Google OAuth login via Supabase Auth
- [x] Onboarding flow (name, home area, birthday)
- [x] Circle creation and invite code join
- [x] Circle settings (rename, emoji, admin management, member removal)
- [x] Dark/light theme toggle (persisted per user)

### Calendar

- [x] Google Calendar connect/disconnect
- [x] Auto-sync on page load (freeBusy API, all selected calendars)
- [x] Monthly grid with free window indicators (green = all free, time labels)
- [x] Day sheet: hourly timeline per member, free window buttons, propose plan
- [x] Manual busy/free toggle on own row
- [x] Friend filter chips
- [x] Sparks: detect nearby friends with shared free windows
- [x] Pact date indicators on calendar (dots on dates with pacts)
- [x] Calendar settings gear icon (replaces old My Calendars / Sync buttons)
- [x] Realtime refresh when busy_blocks or pacts change

### Plans

- [x] Create plan from calendar free window (date/time prefilled)
- [x] Google Places autocomplete for location
- [x] Plan list with RSVP (I'm in / I'm out)
- [x] Edit plan (creator only): date, time, title, spot
- [x] Delete plan (creator or admin)
- [x] Push pact events to Google Calendar (Proposed/Confirmed prefix)
- [x] Remove Google Calendar event on leave/delete
- [x] Swipe-to-delete on pact cards

### Chat

- [x] DMs and group threads
- [x] New chat modal (pick circle members)
- [x] Date card proposals with RSVP
- [x] Group settings (rename, color, add/remove members)
- [x] Realtime messages via Supabase Realtime
- [x] Unread tracking with thread_reads table
- [x] Multi-select mode (bulk delete, mark read/unread)
- [x] Swipe-to-delete on thread items
- [x] Thread preview (last message text)
- [x] Message deduplication

### Profile

- [x] Profile view (own + other members)
- [x] Edit name, color, phone, address with privacy controls
- [x] Avatar upload via Supabase Storage
- [x] Birthday display with countdown
- [x] Calendar settings section (My Calendars, Sync, Disconnect)

### Dashboard (Home)

- [x] Upcoming pacts cards
- [x] Long-press pact quick settings (edit, discuss, delete)
- [x] Spark check button + spark cards
- [x] Birthday reminders
- [x] Live location display
- [x] Pull-to-refresh

### App-Wide

- [x] Notification bell with dropdown (message, pact, spark notifications)
- [x] Pull-to-refresh on all tabs (home, plans, chat, calendar)
- [x] Persistent live location tracking (watchPosition in AppShell)
- [x] Profile photo context propagation (updateUser in CircleContext)
- [x] Bottom navigation (Home, Calendar, Chat, Plans, Spots)
- [x] Viewport zoom prevention on mobile input focus

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/calendar/connect` | GET | Start Google OAuth flow |
| `/api/calendar/connect/callback` | GET | OAuth callback, store tokens |
| `/api/calendar/sync` | POST | Sync busy blocks from Google freeBusy |
| `/api/calendar/list` | GET/POST | List/update selected Google calendars |
| `/api/calendar/push-event` | POST | Push pact event to Google Calendar |
| `/api/calendar/delete-event` | POST | Remove pact event from Google Calendar |
| `/api/places/autocomplete` | GET | Google Places autocomplete proxy |
| `/api/avatar/upload` | POST | (Legacy — now uses client-side Supabase upload) |

---

## 4. Current Active Task

Working on batch 2 bug fixes:
- Calendar indicators: changing from dots to border colors (orange=pending, gold=confirmed, red=special events)
- Pact details in day sheet (time + address)
- Fix swipe-to-delete conflicting with pull-to-refresh in chat
- Fix profile photo not persisting / not showing globally
- Replace emoji icons (bell, sun/moon) with clean minimal SVG icons

---

## 5. Next Steps

1. **Fix current batch** — Complete all bug fixes listed in section 4
2. **Deploy and verify** — Type-check, push to GitHub, verify Vercel build
3. **Spots tab** — Build the Spots page (favorite locations, discover nearby spots)

---

## 6. File Structure (Key Files)

```
src/
  app/
    (app)/
      layout.tsx          — Auth guard + AppShell wrapper (server component)
      home/page.tsx       — Dashboard with pacts, sparks, birthdays
      calendar/page.tsx   — Monthly calendar with availability grid
      chat/page.tsx       — Thread list + message view
      plans/page.tsx      — Plan list with RSVP, edit, swipe delete
      plans/new/page.tsx  — Create new plan form
      profile/[id]/page.tsx — Profile view/edit
      circles/new/page.tsx — Create/join circle
      circles/[id]/settings/page.tsx — Circle admin
      spots/page.tsx      — Spots (placeholder)
    api/calendar/...     — Calendar API routes
    api/places/...       — Places API route
    api/avatar/...       — Avatar upload route (legacy)
    page.tsx             — Landing / login page
    onboarding/page.tsx  — New user setup
    join/[code]/page.tsx — Circle invite link
  components/
    AppShell.tsx         — App shell with header, nav, circle context, notifications
  hooks/
    usePullToRefresh.ts  — Reusable pull-to-refresh hook
  lib/
    supabase/client.ts   — Browser Supabase client
    supabase/server.ts   — Server Supabase client
    utils.ts             — Shared utilities (dates, travel time, areas, formatting)
    useLocationUpdate.ts — Persistent geolocation tracking hook
  app/globals.css        — Theme variables, component classes
```

---

*Last updated: July 18, 2026*
