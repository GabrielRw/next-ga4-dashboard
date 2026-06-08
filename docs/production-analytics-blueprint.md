# Production Analytics Blueprint

This blueprint records the production lessons from the FreeAstroAPI admin Analytics tab so the CLI can guide future website projects without repeating the same mistakes.

## What The Production Dashboard Does

- Adds an admin-only Analytics tab.
- Uses a dark, dense DataFast-style layout rather than a generic marketing dashboard.
- Uses Recharts for the main visitors line plus events/revenue bars.
- Shows ranked horizontal bars for country, channel, referrer, page, browser, OS, and device.
- Uses two-color rows when both traffic and revenue exist: muted blue for visitors and deeper blue for revenue.
- Lists GA/DataFast goals and lets the admin open a full modal of all events.
- Supports custom funnels with page-step and event-step definitions.
- Stores custom funnels in the backend database.
- Caches historical dashboard responses so 30-day and yesterday views do not hammer GA4.
- Copies an AI-ready analytics brief for conversion analysis.

## Recommended Data Boundary

```text
Browser admin tab
  -> Next.js /api/ga-dashboard
  -> GA4 Data API
  -> Google Search Console API
  -> protected backend admin endpoints
     -> Stripe
     -> Supabase or project database
```

The browser should never receive these secrets:

- `GA4_CLIENT_SECRET`
- `GA4_REFRESH_TOKEN`
- `STRIPE_SECRET_KEY`
- service-account private keys

## Required GA4 Setup

Use OAuth refresh-token auth by default:

```bash
GA4_PROPERTY_ID=
GA4_CLIENT_ID=
GA4_CLIENT_SECRET=
GA4_REFRESH_TOKEN=
GA4_DATA_API_CONCURRENCY=2
```

Why OAuth first:

- Google Cloud orgs often block service-account key creation with `iam.disableServiceAccountKeyCreation`.
- Vercel and Render can store OAuth credentials as normal env vars.
- The same OAuth client can request both GA4 and Search Console scopes.

Service accounts are still useful when the user already has a key or workload identity, but the CLI should not make service-account JSON the default path.

## GA4 Quota Guard

The production dashboard originally hit:

```text
RESOURCE_EXHAUSTED: Exhausted concurrent requests quota
```

Guardrails:

- Limit GA4 Data API report concurrency, default `2`.
- Retry quota errors with short exponential backoff.
- Cache combined dashboard responses for five minutes in memory.
- Persist historical ranges such as `yesterday`, `7d`, and `30d` for about 30 minutes in the database.
- Do not auto-poll. Refresh manually.

## Stripe Revenue

Stripe revenue belongs on the backend or server route, never in client-side React.

Minimum output for a backend revenue endpoint:

```json
{
  "configured": true,
  "currency": "usd",
  "total_revenue": 176,
  "transactions": 14,
  "paid_customers": 14,
  "timeseries": [{ "label": "2026-06-01", "revenue": 24, "transactions": 2 }],
  "by_country": [{ "country": "US", "revenue": 24, "transactions": 2, "paid_customers": 2 }]
}
```

If the Stripe account has mixed currencies:

- Choose a display currency, for example `ANALYTICS_REVENUE_CURRENCY=usd`.
- Use Stripe `balance_transaction.currency` and `balance_transaction.amount` when a charge currency differs from the display currency.
- Exclude charges that cannot be converted and show a warning instead of inflating totals.

## Revenue Attribution

GA4 visitor data and Stripe payment data are not joined by default.

To attribute revenue by entry page, referrer, browser, OS, device, and channel:

1. Create a first-party visitor id and session id.
2. Store landing page, referrer, UTM fields, browser, OS, and device.
3. Persist attribution when the user signs up.
4. Pass attribution or a signup-attribution id through Stripe Checkout metadata.
5. Persist the final payment attribution on `checkout.session.completed`.

Without this, a dashboard can still show total Stripe revenue, but it cannot honestly say which page or browser produced it.

## Search Console Keywords

GA4 keyword dimensions often show `(not provided)` or `(not set)`. Use Search Console for real query rows.

Required:

```bash
GSC_SITE_URL=sc-domain:example.com
```

OAuth scope:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

If revenue attribution exists by landing page, keyword revenue is only an estimate:

```text
query revenue = landing-page revenue * query clicks to that page / total clicks to that page
```

The UI should label this as estimated revenue.

## Custom Funnels

Store custom funnels in the project database, not in React state.

Suggested table:

```sql
create table admin_analytics_funnels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  steps jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Step shape:

```json
{
  "id": "step-id",
  "name": "Visit pricing",
  "type": "page",
  "url_match_type": "starts_with",
  "url_value": "/pricing"
}
```

or:

```json
{
  "id": "step-id",
  "name": "Signup completed",
  "type": "event",
  "event_name": "signup_completed"
}
```

The editor should autocomplete event names from actual GA4 event rows, because manually typing event names is error-prone.

## CLI Guidance To Add

The CLI should eventually ask:

- What is the numeric GA4 property id?
- Do you want OAuth setup now?
- Do you also want Search Console keyword data?
- Is this dashboard admin-protected already?
- Is Stripe used for payments?
- Which backend route can safely return revenue analytics?
- Do you need first-party attribution by page/channel/browser?
- Is Supabase or another database available for funnels/cache?
- What display currency should revenue use?

The CLI should generate:

- OAuth helper script.
- `.env.ga-dashboard.example`.
- GA4 quota-safe helper.
- Dashboard route and UI.
- Optional database migration templates for funnels/cache.
- Optional backend revenue endpoint template.
- A checklist explaining what remains manual.
