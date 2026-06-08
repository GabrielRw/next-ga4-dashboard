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

It also writes `ga-dashboard.prompts.md`, which contains copy-paste prompts for:

- reconciling desired dashboard events with existing GA4 events
- adding missing events in code
- finalizing funnel definitions for the generated dashboard

## 2. Agent-assisted audit

```bash
npx next-ga4-dashboard audit --agent
```

This creates `.ga-dashboard/` with deterministic scanner output for your own coding agent.

Ask your agent:

```text
Read .ga-dashboard/agent-instructions.md and complete the Next GA4 Dashboard audit.
```

For better event quality, also paste the relevant section from `.ga-dashboard/ready-prompts.md`. It tells the agent how to use existing GA4 events when they already match the funnel step and how to avoid duplicate or inflated conversion events.

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
- `.env.ga-dashboard.example`
- `scripts/create-google-analytics-refresh-token.mjs`

The generated dashboard is intentionally self-hosted. The browser calls your own `/api/ga-dashboard` route, and that route calls Google server-side.

## Environment variables

Use your own Google Cloud OAuth credentials:

```bash
GA4_PROPERTY_ID=123456789
GA4_CLIENT_ID=1234567890-example.apps.googleusercontent.com
GA4_CLIENT_SECRET=GOCSPX-example
GA4_REFRESH_TOKEN=1//example
GA4_DATA_API_CONCURRENCY=2
```

To create `GA4_REFRESH_TOKEN`, put `GA4_CLIENT_ID` and `GA4_CLIENT_SECRET` in `.env.local`, add the local redirect URI to your Google Cloud OAuth client, then run:

```bash
node scripts/create-google-analytics-refresh-token.mjs
```

The helper asks you to open the Google consent URL and paste the callback URL or `code=` value. It prints the refresh token. Paste the refresh token into `.env.local` and into your deployment provider.

Scopes requested by the helper:

```text
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/webmasters.readonly
```

`webmasters.readonly` is included so the same OAuth client can later power Google Search Console keyword data. If you do not need keyword data, the GA4 dashboard still works with only `analytics.readonly`.

Service-account credentials are still supported as a fallback:

```bash
GA4_PROPERTY_ID=123456789
GA4_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GA4_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

OAuth is the recommended path because Google Cloud organizations often block service-account key creation with `iam.disableServiceAccountKeyCreation`.

Also make sure:

- Google Analytics Data API is enabled in the Google Cloud project.
- Your Google account can read the GA4 property.
- Your OAuth consent screen includes your Google account as a test user when the app is in testing mode.
- `GA4_PROPERTY_ID` is the numeric property id, not the `G-...` measurement id.

## Required app dependencies

The generated dashboard expects these dependencies in the target Next.js app:

```bash
npm install @google-analytics/data google-auth-library recharts lucide-react
```

Tailwind CSS is recommended because the generated UI uses Tailwind utility classes.

## Optional Revenue Layer

The generated dashboard is GA4-only by default. If you want Stripe revenue in the same view, keep it server-side:

```bash
STRIPE_SECRET_KEY=sk_live_...
ANALYTICS_REVENUE_CURRENCY=usd
```

Recommended architecture:

```text
Browser admin dashboard
  -> Next.js /api/ga-dashboard
  -> GA4 Data API
  -> your protected backend revenue endpoint
  -> Stripe
```

Do not call Stripe revenue APIs from client-side React. Admin-only frontend JavaScript still runs in a browser, so it cannot contain `STRIPE_SECRET_KEY`.

If your Stripe account accepts multiple currencies, normalize the dashboard to one display currency. In the FreeAstroAPI implementation, the backend uses Stripe `balance_transaction` data to convert non-USD charges into `ANALYTICS_REVENUE_CURRENCY` and excludes unconvertible charges with a warning.

## Optional Attribution Layer

GA4 can show visitor source and pages. Stripe can show payments. Neither automatically joins a payment back to the exact signup user, landing page, browser, OS, or device.

For revenue attribution, add first-party attribution:

- Store a visitor id and session id in first-party cookies.
- Store landing page and referrer in local storage or a first-party cookie.
- Capture UTM fields, browser, OS, and device.
- Persist attribution when the user signs up.
- Pass attribution or a signup-attribution id through Stripe Checkout metadata.
- Persist a payment-attribution row from `checkout.session.completed`.

That makes breakdowns like country, channel, referrer, entry page, browser, OS, and device able to show both traffic and revenue.

## Optional Supabase Layer

For production dashboards, add database-backed custom funnels and cache:

- `admin_analytics_funnels`: admin-created funnel definitions with page or GA event steps.
- `admin_analytics_cache`: persistent dashboard cache for non-live ranges such as yesterday, 7 days, and 30 days.

The FreeAstroAPI implementation uses an in-memory 5-minute cache plus a 30-minute Supabase cache for historical ranges. The custom funnels are refreshed even when the dashboard payload itself comes from cache.

## Optional Search Console Layer

For real keyword data, use Google Search Console. GA4 often returns `(not provided)` or `(not set)` for keyword dimensions.

Add:

```bash
GSC_SITE_URL=sc-domain:example.com
```

If your Search Console property is URL-prefix instead of Domain, use the exact property URL, for example:

```bash
GSC_SITE_URL=https://www.example.com/
```

When revenue attribution exists by landing page, keyword revenue can only be estimated unless you have user-level attribution. The practical estimate is:

```text
keyword revenue = landing-page revenue * keyword clicks to that page / total Search Console clicks to that page
```

Label this as estimated revenue in the UI.

## Common Setup Mistakes

- Pasting the OAuth callback `code=` as `GA4_REFRESH_TOKEN`; exchange it first with the helper script.
- Using a refresh token created from a different OAuth client id/secret.
- Forgetting to add `webmasters.readonly` before trying to call Search Console.
- Setting `GA4_PROPERTY_ID` to the `G-...` measurement id instead of the numeric property id.
- Exposing `STRIPE_SECRET_KEY` in a `NEXT_PUBLIC_*` variable.
- Querying too many GA4 reports concurrently and hitting `RESOURCE_EXHAUSTED`; lower `GA4_DATA_API_CONCURRENCY`.
