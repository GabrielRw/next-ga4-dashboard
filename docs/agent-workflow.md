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
