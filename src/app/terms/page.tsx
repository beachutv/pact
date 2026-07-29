export default function TermsPage() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0', background: '#141A1F', minHeight: '100vh',
      lineHeight: 1.7, fontSize: 15,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
        <span style={{ color: '#76ACB3' }}>P</span>act — Terms of Service
      </h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 32 }}>
        Last updated: July 2026
      </p>

      <Section title="1. What Pact is">
        <p>
          Pact is a group scheduling app that helps friend circles coordinate plans.
          It is provided by Beatrice Linchu (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;)
          and is currently in early access. By using Pact, you agree to these terms.
        </p>
      </Section>

      <Section title="2. Eligibility">
        <p>
          You must be at least 13 years old to use Pact. If you are under 18, you confirm
          that a parent or guardian has reviewed and agrees to these terms on your behalf.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You sign in using your Google account. You are responsible for keeping your
          Google credentials secure. You agree to provide accurate information in your
          profile (name, home area) and not to impersonate others.
        </p>
        <p>
          You can delete your account at any time from the profile settings. Deletion
          permanently removes all your data, including messages, plans, circle memberships,
          and calendar connections.
        </p>
      </Section>

      <Section title="4. How you may use Pact">
        <p>
          You may use Pact for personal, non-commercial group scheduling. You agree not to:
        </p>
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li>Use Pact to harass, stalk, or intimidate other users</li>
          <li>Send spam, unsolicited messages, or disruptive content</li>
          <li>Attempt to access other users&apos; data outside of normal circle membership</li>
          <li>Reverse-engineer, scrape, or copy Pact&apos;s software or design</li>
          <li>Use automated tools, bots, or scripts to interact with Pact</li>
          <li>Interfere with or disrupt the service or its infrastructure</li>
          <li>Use Pact for any illegal purpose</li>
        </ul>
      </Section>

      <Section title="5. Circles and shared data">
        <p>
          When you join a circle, members of that circle can see your name, profile photo,
          home area, and busy/free time blocks. They cannot see your event details, email
          address, or phone number (unless you choose to share your phone via privacy
          settings). You can leave a circle at any time.
        </p>
        <p>
          Circle admins can remove members and manage circle settings. If you create a
          circle, you are its first admin.
        </p>
      </Section>

      <Section title="6. Messages and content">
        <p>
          You retain ownership of the messages and content you post in Pact. By posting,
          you grant us a limited license to store and display that content to the relevant
          circle or thread members as part of providing the service.
        </p>
        <p>
          We do not monitor private messages. However, we reserve the right to remove
          content or suspend accounts that violate these terms if reported by other users.
        </p>
      </Section>

      <Section title="7. Google Calendar integration">
        <p>
          Pact accesses your Google Calendar data only as described in our{' '}
          <a href="/privacy" style={{ color: '#76ACB3' }}>Privacy Policy</a>. You can
          disconnect your calendar at any time. Pact&apos;s use of Google data complies
          with the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy"
            style={{ color: '#76ACB3' }} target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>.
        </p>
      </Section>

      <Section title="8. Location data">
        <p>
          If you enable location sharing, your approximate area is visible to circle
          members for travel time estimates. You can disable location sharing at any time
          from your profile settings. Precise GPS coordinates are used transiently and
          are not stored or shared with other users.
        </p>
      </Section>

      <Section title="9. Availability and changes">
        <p>
          Pact is provided &quot;as is&quot; during early access. We may update, modify,
          or discontinue features at any time. We do not guarantee uninterrupted
          availability. We will try to notify users of significant changes through
          in-app notifications.
        </p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>
          Pact is a coordination tool, not a contractual commitment service. We are not
          responsible for plans that fall through, missed meetups, incorrect travel time
          estimates, or any decisions made based on availability data shown in the app.
        </p>
        <p>
          To the maximum extent permitted by law, we are not liable for any indirect,
          incidental, or consequential damages arising from your use of Pact.
        </p>
      </Section>

      <Section title="11. Intellectual property">
        <p>
          Pact&apos;s design, code, features, and branding are owned by us and protected
          under applicable intellectual property laws. You may not copy, reproduce, or
          create derivative works based on Pact without our written permission.
        </p>
      </Section>

      <Section title="12. Termination">
        <p>
          We may suspend or terminate your access to Pact if you violate these terms.
          You may stop using Pact and delete your account at any time.
        </p>
      </Section>

      <Section title="13. Governing law">
        <p>
          These terms are governed by the laws of the Republic of the Philippines.
          Any disputes will be resolved in the courts of Metro Manila.
        </p>
      </Section>

      <Section title="14. Updates to these terms">
        <p>
          We may update these terms from time to time. If we make significant changes,
          we will notify you through the app. Continued use of Pact after changes
          constitutes acceptance of the updated terms.
        </p>
      </Section>

      <Section title="15. Contact">
        <p>
          For questions about these terms, contact us at{' '}
          <a href="mailto:beatricelinchu@gmail.com" style={{ color: '#76ACB3' }}>
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
