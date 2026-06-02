// ─── REQUIRED: Fill these in before opening index.html ───────────────────────
window.CRM_CONFIG = {
  // Azure AD tenant ID (from Azure portal > Azure Active Directory > Overview)
  tenantId: "YOUR_TENANT_ID",

  // Azure AD app (client) ID — must have Dynamics CRM user_impersonation scope
  clientId: "YOUR_CLIENT_ID",

  // Your Dynamics 365 org URL, e.g. "https://yourorg.crm.dynamics.com"
  dynamicsUrl: "https://YOUR_ORG.crm.dynamics.com",

  // Which field drives the Kanban columns.
  // "stepname"   → BPF pipeline stage (Qualify / Develop / Propose / Close)
  // "statuscode" → Status reason (In Progress / On Hold / Won / etc.)
  groupBy: "stepname",

  // Column order (leave empty [] to auto-detect from live data)
  columnOrder: ["Qualify", "Develop", "Propose", "Close"],

  // Max opportunities to fetch per load
  pageSize: 250,
};
