# Getting Started

Next GA4 Dashboard adds a self-hosted GA4 dashboard to your own Next.js app.

## 1. Audit locally

```bash
npx next-ga4-dashboard audit
```

This scans common local folders:

- `app`
- `pages`
- `src`
- `components`
- `lib`
- `hooks`
- `utils`

It writes `ga-dashboard.audit.json`.

## 2. Agent-assisted audit

```bash
npx next-ga4-dashboard audit --agent
```

This creates `.ga-dashboard/` with deterministic scanner output for your own coding agent.

Ask your agent:

```text
Read .ga-dashboard/agent-instructions.md and complete the Next GA4 Dashboard audit.
```

Your agent should inspect the suggested files and write the final `ga-dashboard.audit.json`.

## 3. Validate agent output

```bash
npx next-ga4-dashboard apply-agent-output
```

## 4. Generate the dashboard

```bash
npx next-ga4-dashboard init --from-audit
```

By default, this writes:

- `app/admin/analytics/page.tsx`
- `app/api/ga-dashboard/route.ts`
- `components/ga-dashboard/AnalyticsDashboard.tsx`
- `lib/ga-dashboard/ga4.ts`
- `lib/ga-dashboard/config.ts`

## Environment variables

Use your own Google Cloud credentials:

```bash
GA4_PROPERTY_ID=123456789
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Or provide inline service account credentials:

```bash
GA4_PROPERTY_ID=123456789
GA4_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GA4_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Also make sure the Google Analytics Data API is enabled in the Google Cloud project and that the service account has access to the GA4 property.

## Required app dependencies

The generated dashboard expects these dependencies in the target Next.js app:

```bash
npm install @google-analytics/data recharts
```

Tailwind CSS is recommended because the generated UI uses Tailwind utility classes.
