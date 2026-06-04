export const gaDashboardConfig = {
  "generatedAt": "2026-06-04T11:01:50.613Z",
  "widgets": [
    {
      "id": "active-users",
      "title": "Active users",
      "type": "metric",
      "metric": "activeUsers"
    },
    {
      "id": "sessions",
      "title": "Sessions",
      "type": "line",
      "metric": "sessions"
    },
    {
      "id": "conversions",
      "title": "Conversions",
      "type": "bar",
      "eventName": "button_search_docs_docs"
    },
    {
      "id": "funnel-acquisition-to-conversion",
      "title": "Acquisition to conversion",
      "type": "funnel"
    },
    {
      "id": "funnel-developer-activation",
      "title": "Developer activation",
      "type": "funnel"
    }
  ],
  "funnels": [
    {
      "id": "acquisition-to-conversion",
      "name": "Acquisition to conversion",
      "description": "Tracks the path from first page view to the strongest detected conversion action.",
      "steps": [
        {
          "name": "Page view",
          "eventName": "page_view",
          "description": "User views a page."
        },
        {
          "name": "Pricing intent",
          "eventName": "view_pricing",
          "description": "User reaches or interacts with pricing."
        },
        {
          "name": "Signup intent",
          "eventName": "button_get_started",
          "description": "User starts account creation."
        },
        {
          "name": "Checkout intent",
          "eventName": "button_subscribe_to_pro_pricing",
          "description": "User starts payment or plan selection."
        }
      ]
    },
    {
      "id": "developer-activation",
      "name": "Developer activation",
      "description": "Tracks docs and API discovery actions that indicate technical activation.",
      "steps": [
        {
          "name": "Docs view",
          "eventName": "view_docs",
          "description": "User views documentation."
        },
        {
          "name": "Docs search or copy",
          "eventName": "button_search_docs_docs",
          "description": "User searches docs, copies code, or interacts with API content."
        }
      ]
    }
  ],
  "detectedEvents": [
    "button_search_docs_docs",
    "page_view",
    "view_pricing",
    "button_get_started",
    "button_subscribe_to_pro_pricing",
    "view_docs",
    "button_search_docs_docs"
  ],
  "recommendedEvents": [
    {
      "name": "form_form_submit_docs",
      "label": "form submit",
      "file": "app/docs/page.tsx",
      "reason": "User action detected without an obvious dedicated GA4 event."
    },
    {
      "name": "button_copy_code_docs",
      "label": "Copy code",
      "file": "app/docs/page.tsx",
      "reason": "High-intent UI action that can clarify conversion and funnel performance."
    },
    {
      "name": "link_view_pricing",
      "label": "View pricing",
      "file": "app/page.tsx",
      "reason": "High-intent UI action that can clarify conversion and funnel performance."
    },
    {
      "name": "form_form_submit",
      "label": "form submit",
      "file": "app/page.tsx",
      "reason": "User action detected without an obvious dedicated GA4 event."
    },
    {
      "name": "button_join_newsletter",
      "label": "Join newsletter",
      "file": "app/page.tsx",
      "reason": "High-intent UI action that can clarify conversion and funnel performance."
    },
    {
      "name": "button_start_free_trial_pricing",
      "label": "Start free trial",
      "file": "app/pricing/page.tsx",
      "reason": "High-intent UI action that can clarify conversion and funnel performance."
    },
    {
      "name": "button_contact_sales_pricing",
      "label": "Contact sales",
      "file": "app/pricing/page.tsx",
      "reason": "High-intent UI action that can clarify conversion and funnel performance."
    }
  ]
} as const;
