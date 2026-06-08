# Next GA4 Dashboard

Next GA4 Dashboard is an open-source analytics engineer for your Next.js app.

It scans your app locally, helps your own coding agent understand your tracking, suggests missing GA4 events, generates funnels, and adds a self-hosted analytics dashboard directly inside your own website.

The current generator is based on a production FreeAstroAPI implementation: OAuth-first GA4 access, a dark DataFast-style dashboard, Recharts, quota-safe GA4 report calls, and optional extension points for Stripe revenue, Supabase custom funnels/cache, and Google Search Console keywords.

## Principles

- Fully self-hosted free version.
- No hosted OAuth, hosted backend, billing, user accounts, or cloud storage.
- No remote AI calls and no required AI API key.
- Source code stays local.
- The user brings Google Cloud OAuth credentials. Service-account credentials are supported as a fallback, but OAuth is recommended because many Google Cloud organizations block service-account key creation.

## Commands

```bash
npx next-ga4-dashboard audit
npx next-ga4-dashboard audit --agent
npx next-ga4-dashboard apply-agent-output
npx next-ga4-dashboard init --from-audit
```

See [docs/getting-started.md](docs/getting-started.md).

## Production Lessons Captured

- Keep GA4, Search Console, and Stripe credentials server-side.
- Use OAuth refresh tokens for GA4/Search Console instead of asking most users to create service-account keys.
- Limit GA4 Data API concurrency; the generated helper defaults to `GA4_DATA_API_CONCURRENCY=2`.
- Treat Stripe revenue as backend data, not frontend data. Never expose `STRIPE_SECRET_KEY` to the browser.
- Normalize mixed Stripe currencies with a display currency such as `ANALYTICS_REVENUE_CURRENCY=usd`.
- Use first-party attribution if you need to answer "which landing page/channel/browser generated revenue".
- Use Supabase or your own database for custom funnel definitions and persistent dashboard cache when the dashboard becomes production-critical.
