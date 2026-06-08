# Agent Workflow

`audit --agent` separates deterministic scanning from semantic product analysis.

The CLI creates:

- `.ga-dashboard/audit-context.json`
- `.ga-dashboard/audit-summary.md`
- `.ga-dashboard/agent-instructions.md`
- `.ga-dashboard/suggested-files.json`
- `.ga-dashboard/detected-events.json`
- `.ga-dashboard/route-map.json`
- `.ga-dashboard/ui-actions.json`
- `.ga-dashboard/funnels.draft.json`
- `.ga-dashboard/schema.json`

The user's own coding agent reads this workspace and writes `ga-dashboard.audit.json`.

The free version does not call hosted AI APIs, upload source code, provide hosted OAuth, or store analytics data outside the user's project.

## What The Agent Should Inspect

In addition to GA4 event calls, the agent should check whether the app already has:

- an admin-protected area where the dashboard should live
- DataFast or another goal-tracking helper
- Stripe checkout, subscriptions, webhooks, or billing routes
- Supabase or another database for custom funnels and dashboard cache
- first-party attribution fields such as visitor id, session id, landing page, referrer, UTM fields, browser, OS, and device
- Google Search Console requirements for keyword data

The scanner now records these as `integrationCapabilities` in `ga-dashboard.audit.json`. They are not proof that the app is production-ready; they are signals that the implementation can use to ask better follow-up questions.

## Production Warnings The Agent Should Preserve

- Do not expose `STRIPE_SECRET_KEY`, `GA4_CLIENT_SECRET`, or `GA4_REFRESH_TOKEN` to client-side code.
- Prefer OAuth refresh-token auth for GA4; service-account keys are commonly blocked by Google Cloud org policy.
- Limit GA4 Data API concurrency and cache historical ranges.
- Treat revenue attribution as first-party product data. GA4 plus Stripe alone cannot reliably answer which user or landing page produced a payment.
- Label Search Console keyword revenue as estimated unless there is user-level attribution from query to payment.
