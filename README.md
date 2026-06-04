# Next GA4 Dashboard

Next GA4 Dashboard is an open-source analytics engineer for your Next.js app.

It scans your app locally, helps your own coding agent understand your tracking, suggests missing GA4 events, generates funnels, and adds a self-hosted analytics dashboard directly inside your own website.

## Principles

- Fully self-hosted free version.
- No hosted OAuth, hosted backend, billing, user accounts, or cloud storage.
- No remote AI calls and no required AI API key.
- Source code stays local.
- The user brings Google Cloud OAuth or service account credentials.

## Commands

```bash
npx next-ga4-dashboard audit
npx next-ga4-dashboard audit --agent
npx next-ga4-dashboard apply-agent-output
npx next-ga4-dashboard init --from-audit
```

See [docs/getting-started.md](docs/getting-started.md).
