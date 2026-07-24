export default function PrivacyPage() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0', background: '#0f1117', minHeight: '100vh',
      lineHeight: 1.7, fontSize: 15,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
        <span style={{ color: '#7c5cff' }}>P</span>act — Privacy Policy
      </h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 32 }}>
        Last updated: July 2026
      </p>

      <Section title="What Pact does">
        <p>
          Pact is a group scheduling app for friend groups. It helps you find when
          everyone in your circle is free, pick a spot to meet, and lock in plans.
        </p>
      </Section>

      <Section title="What data we collect">
        <p>
          <b>Account information:</b> When you sign in with Google, we store your
          name, email address, and profile photo to identify you within your circles.
        </p>
        <p>
          <b>Calendar availability:</b> We access your Google Calendar to determine
          which hours you are busy or free. We only read the start and end times of
          your events — <b>we never read, store, or display event titles, descriptions,
          attendees, or any other event details</b>. Your circle members only see
          time blocks marked as "busy" or "free."
        </p>
        <p>
          <b>Calendar events (write):</b> When you propose or confirm a plan in Pact,
          we create a calendar event on your Google Calendar so the plan appears in your
          schedule. We only write events that you explicitly create through Pact.
        </p>
        <p>
          <b>Location:</b> If you grant permission, we use your device's location to
          show approximate travel times to other circle members and suggest meeting spots.
          Location is stored as a general area name (e.g., "Makati") — precise GPS
          coordinates are only used transiently for travel time calculations and are not
          shared with other users.
        </p>
      </Section>

      <Section title="How we use Google Calendar data">
        <p>
          Pact's use of Google Calendar data is limited to:
        </p>
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li>Reading your calendar's free/busy information to show availability overlaps with your circle</li>
          <li>Creating calendar events when you propose or confirm plans through Pact</li>
          <li>Deleting calendar events when you cancel or leave a plan</li>
        </ul>
        <p>
          We do not use Google Calendar data for advertising, sell it to third parties,
          or use it for any purpose other than providing the Pact scheduling service.
        </p>
        <p>
          Pact's use and transfer of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy"
            style={{ color: '#7c5cff' }}
            target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Data storage and security">
        <p>
          Your data is stored securely on Supabase (hosted on AWS in the Singapore region).
          All connections use HTTPS encryption. We do not store your Google password —
          authentication is handled entirely through Google's OAuth 2.0 flow.
        </p>
        <p>
          Calendar busy/free blocks are refreshed each time you open the app and are
          stored only as time ranges (e.g., "busy 9am–11am") with no event content.
        </p>
      </Section>

      <Section title="Data sharing">
        <p>
          We share your availability (busy/free status only) with members of circles
          you have joined. We do not share your data with any third parties, advertisers,
          or data brokers.
        </p>
      </Section>

      <Section title="Data retention and deletion">
        <p>
          You can delete your account at any time from your profile settings. When you
          delete your account, all your data is permanently removed, including your
          profile, circle memberships, calendar connections, busy blocks, messages, and
          favorite spots.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can disconnect your Google Calendar at any time from the calendar settings
          in the app. You can revoke Pact's access to your Google account at{' '}
          <a href="https://myaccount.google.com/permissions"
            style={{ color: '#7c5cff' }}
            target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For questions about this privacy policy, contact us at{' '}
          <a href="mailto:beatricelinchu@gmail.com" style={{ color: '#7c5cff' }}>
            beatricelinchu@gmail.com
          </a>.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff' }}>{title}</h2>
      {children}
    </section>
  )
}
