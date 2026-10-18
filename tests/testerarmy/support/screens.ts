export const engagementId = "0197f30f-122c-7000-8000-000000000004";
export const clientId = "0197f30f-122c-7000-8000-000000000003";
export const reportId = "0197f30f-122c-7000-8000-000000000011";
export const templateId = "0197f30f-122c-7000-8000-000000000010";
export const engagementPath = `/engagements/${engagementId}`;

export const screens = [
  ["/dashboard", "Good morning"],
  ["/analytics", "Risk analytics"],
  ["/clients", "Clients"],
  ["/clients/new", "New client"],
  [`/clients/${clientId}`, "Northstar Systems"],
  ["/engagements", "Engagements"],
  ["/engagements/new", "New engagement"],
  [engagementPath, "Northstar customer portal assessment"],
  ["/schedule", "Schedule"],
  ["/programs", "Programs"],
  ["/opportunities", "Opportunities"],
  ["/findings-library", "Findings Library"],
  ["/tasks", "Tasks"],
  ["/tasks?view=board", "Tasks"],
  ["/templates", "Templates"],
  ["/templates/new", "Create report template"],
  [`/templates/${templateId}`, "Technical Penetration Test Report"],
  ["/reports", "Reports"],
  [`/reports/${reportId}`, "Northstar Customer Portal Assessment"],
  [`/reports/${reportId}/edit`, /Northstar Customer Portal Assessment/],
  ["/runbooks", "Runbooks"],
  ["/imports", "Imports and exports"],
  ["/team", "Team"],
  ["/audit", "Audit Log"],
  ["/integrations", "Integrations and automation"],
  ["/settings", "Security and operations"],
  ["/account/security", "Account security"],
  ["/account/preferences", "Personal preferences"],
] as const;

export const engagementTabs = [
  "Overview",
  "Scope",
  "Assets",
  "Rules of Engagement",
  "Team",
  "Methodology",
  "Findings",
  "Evidence",
  "Notes",
  "Timeline",
  "Tasks",
  "Time Tracking",
  "Reports",
  "QA",
  "Retesting",
  "Client Portal",
  "Audit History",
];
export const slug = (value: string) => value.toLowerCase().replaceAll(" ", "-");
