import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { runbookTemplateSteps, runbookTemplates } from "@/db/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type RunbookLibraryStep = {
  title: string;
  procedure: string;
  objective?: string;
  expectedEvidence?: string;
  required?: boolean;
};

export type RunbookLibraryTemplate = {
  name: string;
  description: string;
  assessmentTypes: string[];
  tags: string[];
  steps: RunbookLibraryStep[];
};

export const RUNBOOK_LIBRARY: RunbookLibraryTemplate[] = [
  {
    name: "OWASP WSTG Web Assessment",
    description: "Reusable web testing checklist inspired by WSTG themes, written for DingoDocs engagements.",
    assessmentTypes: ["Web Application Assessment"],
    tags: ["owasp","wstg","web"],
    steps: [
      { title: "Confirm scope and test accounts", procedure: "Verify in-scope hosts, roles, and out-of-scope constraints with the client before testing." },
      { title: "Map application entry points", procedure: "Enumerate reachable URLs, forms, APIs, and authenticated areas from a clean crawl." },
      { title: "Review transport security", procedure: "Check TLS configuration, HSTS, and mixed content on primary hosts." },
      { title: "Test authentication flows", procedure: "Exercise login, logout, lockout, remember-me, and password reset for logic flaws." },
      { title: "Probe session management", procedure: "Validate cookie flags, session fixation resistance, and timeout behaviour." },
      { title: "Assess access control", procedure: "Attempt horizontal and vertical privilege changes across object and function boundaries." },
      { title: "Test input handling", procedure: "Send injection payloads for SQL, command, template, and path contexts on every parameter class." },
      { title: "Review client-side controls", procedure: "Bypass UI-only validation and inspect DOM sinks for XSS." },
      { title: "Check business logic", procedure: "Replay, reorder, and race critical workflows such as checkout and entitlement changes." },
      { title: "Inspect error handling", procedure: "Force failures and confirm responses omit stack traces and sensitive internals." },
      { title: "Review third-party components", procedure: "Note outdated libraries and missing Subresource Integrity on script includes." },
      { title: "Document residual risk", procedure: "Capture evidence, severity, and remediation for each confirmed issue." },
    ],
  },
  {
    name: "OWASP MASTG Mobile Assessment",
    description: "Mobile application checklist covering Android and iOS platform risks.",
    assessmentTypes: ["Mobile Application Assessment"],
    tags: ["owasp","mastg","mobile"],
    steps: [
      { title: "Identify platform and build type", procedure: "Record OS targets, build flavour, and whether the package is debug or release." },
      { title: "Static binary review", procedure: "Inspect the package for hardcoded secrets, exported components, and insecure flags." },
      { title: "Local storage review", procedure: "Check preferences, databases, and keychain or keystore usage for plaintext secrets." },
      { title: "Network traffic capture", procedure: "Intercept API calls and verify TLS, pinning behaviour, and certificate validation." },
      { title: "Authentication and session tests", procedure: "Validate token storage, biometric fallback, and logout revocation." },
      { title: "IPC and deep link tests", procedure: "Invoke exported activities, intents, and custom schemes with crafted input." },
      { title: "WebView review", procedure: "Assess JavaScript bridges, file access, and loading of untrusted content." },
      { title: "Backup and logging checks", procedure: "Confirm backups exclude secrets and logs omit credentials." },
      { title: "Runtime tamper checks", procedure: "Observe behaviour under instrumentation and note missing integrity detections." },
      { title: "Backend API follow-up", procedure: "Retest mobile API endpoints for BOLA and auth gaps discovered from traffic." },
    ],
  },
  {
    name: "OWASP ASVS Application Verification",
    description: "Verification-oriented checklist aligned to ASVS control themes for application reviews.",
    assessmentTypes: ["Web Application Assessment","API Assessment"],
    tags: ["owasp","asvs"],
    steps: [
      { title: "Architecture and threat model", procedure: "Confirm trust boundaries, sensitive data flows, and authentication components." },
      { title: "Authentication verification", procedure: "Check credential storage, MFA options, and recovery path hardening." },
      { title: "Session verification", procedure: "Validate generation, rotation, binding, and termination of session tokens." },
      { title: "Access control verification", procedure: "Sample privileged operations for deny-by-default authorisation." },
      { title: "Validation and encoding", procedure: "Confirm server-side validation and context-aware output encoding." },
      { title: "Cryptography verification", procedure: "Review algorithms, key management, and randomness for security tokens." },
      { title: "Error and logging verification", procedure: "Ensure security events are logged without leaking secrets to clients." },
      { title: "Data protection verification", procedure: "Check encryption in transit and at rest for sensitive fields." },
      { title: "Communication verification", procedure: "Confirm TLS, certificate validation, and secure cookie attributes." },
      { title: "Malicious input verification", procedure: "Regression-test injection classes relevant to the stack." },
      { title: "File and resource verification", procedure: "Review upload, download, and SSRF-prone fetch features." },
      { title: "Configuration verification", procedure: "Inspect security headers, debug flags, and default credentials." },
    ],
  },
  {
    name: "PTES Engagement Workflow",
    description: "End-to-end penetration testing execution checklist based on PTES-style phases.",
    assessmentTypes: ["Web Application Assessment","Network Assessment","Active Directory Assessment"],
    tags: ["ptes","methodology"],
    steps: [
      { title: "Pre-engagement interactions", procedure: "Confirm rules of engagement, contacts, and emergency stop procedures." },
      { title: "Intelligence gathering", procedure: "Collect OSINT and technical reconnaissance within agreed constraints." },
      { title: "Threat modelling", procedure: "Prioritise likely attack paths against business-critical assets." },
      { title: "Vulnerability analysis", procedure: "Scan and manually validate weaknesses on in-scope targets." },
      { title: "Exploitation", procedure: "Demonstrate impact with controlled proof for agreed findings only." },
      { title: "Post-exploitation", procedure: "Assess lateral movement potential without exceeding scope." },
      { title: "Evidence curation", procedure: "Organise screenshots, logs, and reproduction notes for reporting." },
      { title: "Reporting", procedure: "Draft clear technical and executive narratives with remediation priority." },
      { title: "Cleanup", procedure: "Remove test artifacts and restore modified accounts or configs." },
      { title: "Debrief", procedure: "Walk stakeholders through residual risk and next steps." },
    ],
  },
  {
    name: "OSSTMM Security Testing",
    description: "Operational security testing checklist emphasising controls visibility and trust metrics.",
    assessmentTypes: ["Network Assessment","Web Application Assessment"],
    tags: ["osstmm","methodology"],
    steps: [
      { title: "Define security scope channels", procedure: "List human, physical, wireless, telecommunications, and data networks in scope." },
      { title: "Identify visibility surfaces", procedure: "Enumerate what an unauthenticated outsider can interact with." },
      { title: "Measure access controls", procedure: "Test authentication and authorisation gates on each channel." },
      { title: "Assess trust relationships", procedure: "Map trusts between systems and verify they are necessary." },
      { title: "Review controls interactivity", procedure: "Determine which controls can be bypassed or influenced remotely." },
      { title: "Evaluate process integrity", procedure: "Check whether security processes fail closed under fault conditions." },
      { title: "Collect operations metrics", procedure: "Record response times for detection and containment during tests." },
      { title: "Document porosity", procedure: "Summarise open, unrestricted, and unverified paths remaining." },
      { title: "Recommend control improvements", procedure: "Propose measurable control changes tied to observed gaps." },
    ],
  },
  {
    name: "AWS Cloud Security Review",
    description: "Cloud review checklist for common AWS account and workload risks.",
    assessmentTypes: ["Cloud Assessment"],
    tags: ["aws","cloud"],
    steps: [
      { title: "Account identity baseline", procedure: "Review root MFA, unused credentials, and password policy." },
      { title: "IAM least privilege", procedure: "Sample high-risk roles for wildcard actions and broad resource ARNs." },
      { title: "Network exposure", procedure: "Inspect security groups and public subnets for admin or data stores." },
      { title: "Storage public access", procedure: "Audit S3 public access blocks, bucket policies, and ACLs." },
      { title: "Encryption posture", procedure: "Confirm default encryption for EBS, S3, and RDS with key policy review." },
      { title: "Logging and monitoring", procedure: "Verify CloudTrail, GuardDuty, and log retention settings." },
      { title: "Compute metadata hardening", procedure: "Ensure IMDSv2 required and hop limits set on instances." },
      { title: "Secrets handling", procedure: "Search for long-lived keys in Lambda env, userdata, and code artifacts." },
      { title: "Perimeter services", procedure: "Review CloudFront, ALB, and WAF configurations for weak defaults." },
      { title: "Backup and recovery", procedure: "Confirm snapshots are private and restore paths are tested." },
      { title: "Evidence pack", procedure: "Export config findings with account IDs and resource ARNs." },
    ],
  },
  {
    name: "Azure Cloud Security Review",
    description: "Checklist for Microsoft Azure identity, network, and data plane reviews.",
    assessmentTypes: ["Cloud Assessment"],
    tags: ["azure","cloud"],
    steps: [
      { title: "Entra ID privileged roles", procedure: "Review standing Global Admin count and PIM usage." },
      { title: "Conditional access gaps", procedure: "Identify privileged users without MFA or location controls." },
      { title: "Network security groups", procedure: "Find wide-open NSG rules to management ports." },
      { title: "Storage account exposure", procedure: "Check public blob access and shared key usage." },
      { title: "Key Vault access", procedure: "Validate RBAC, network rules, and soft-delete settings." },
      { title: "Managed identity scope", procedure: "Confirm identities are not granted subscription Owner." },
      { title: "Activity logging", procedure: "Ensure diagnostic settings cover critical subscriptions." },
      { title: "App Service TLS", procedure: "Verify HTTPS-only and minimum TLS version on web apps." },
      { title: "SQL and data exfiltration paths", procedure: "Review firewall rules and private endpoint usage." },
      { title: "Document findings", procedure: "Map each issue to subscription, resource group, and owner." },
    ],
  },
  {
    name: "GCP Cloud Security Review",
    description: "Checklist for Google Cloud organisation and project security baselines.",
    assessmentTypes: ["Cloud Assessment"],
    tags: ["gcp","cloud"],
    steps: [
      { title: "Organisation policy review", procedure: "Check constraints that block public IPs and SA key creation." },
      { title: "IAM principal audit", procedure: "Find primitive roles and allUsers bindings on sensitive resources." },
      { title: "Service account keys", procedure: "Inventory user-managed keys and last rotation dates." },
      { title: "VPC firewall rules", procedure: "Identify 0.0.0.0/0 ingress to SSH, RDP, or databases." },
      { title: "Cloud Storage IAM", procedure: "Detect public buckets and uniform access gaps." },
      { title: "KMS key IAM", procedure: "Ensure decrypt permissions are tightly scoped." },
      { title: "Logging sinks", procedure: "Confirm audit logs export to a locked project." },
      { title: "GKE control plane", procedure: "Review private clusters, authorized networks, and workload identity." },
      { title: "Secrets in CI", procedure: "Scan build configs for embedded credentials." },
      { title: "Summarise risk by project", procedure: "Group findings by project ID for owners." },
    ],
  },
  {
    name: "Active Directory Security Assessment",
    description: "Domain security checklist covering common privilege escalation paths.",
    assessmentTypes: ["Active Directory Assessment"],
    tags: ["active-directory","ad"],
    steps: [
      { title: "Domain inventory", procedure: "Identify forests, domains, trusts, and tier-0 assets." },
      { title: "Privileged group review", procedure: "Enumerate Domain Admins, Enterprise Admins, and equivalent." },
      { title: "Kerberoastable accounts", procedure: "List SPN users and evaluate password age and length." },
      { title: "AS-REP roasting candidates", procedure: "Find accounts without Kerberos pre-authentication." },
      { title: "Delegation review", procedure: "Locate unconstrained and risky constrained delegation." },
      { title: "GPO ACL review", procedure: "Identify non-admin write access on critical GPOs." },
      { title: "LAPS and local admin", procedure: "Confirm unique local admin passwords and reader groups." },
      { title: "SMB and LDAP hardening", procedure: "Check signing requirements and channel binding." },
      { title: "Legacy protocol exposure", procedure: "Test LLMNR/NBT-NS and NTLM relay opportunities." },
      { title: "DCSync rights audit", procedure: "Verify replication rights exist only on domain controllers." },
      { title: "Evidence and attack path map", procedure: "Document shortest paths to domain dominance." },
    ],
  },
  {
    name: "API Security Assessment",
    description: "Focused API testing checklist for REST and GraphQL services.",
    assessmentTypes: ["API Assessment"],
    tags: ["api","rest","graphql"],
    steps: [
      { title: "Inventory endpoints", procedure: "Build a catalogue from docs, traffic, and discovery of shadow routes." },
      { title: "Authentication matrix", procedure: "Test each auth scheme for bypass, replay, and token weakness." },
      { title: "Object-level authorisation", procedure: "Swap IDs across tenants on read and write operations." },
      { title: "Function-level authorisation", procedure: "Call admin operations with low-privilege tokens." },
      { title: "Mass assignment checks", procedure: "Submit unexpected privileged fields in create and update bodies." },
      { title: "Injection across parsers", procedure: "Probe JSON, XML, GraphQL, and query parameters for injection." },
      { title: "Rate limiting and abuse", procedure: "Measure brute-force and costly query protections." },
      { title: "GraphQL specifics", procedure: "Test introspection, depth, batching, and field-level auth." },
      { title: "Error and data leakage", procedure: "Confirm responses omit stack traces and excess entity fields." },
      { title: "Webhook and callback safety", procedure: "Validate signature checks and SSRF controls on callbacks." },
      { title: "Version and deprecation", procedure: "Flag old API versions with weaker controls still online." },
    ],
  },
  {
    name: "Thick Client Assessment",
    description: "Checklist for desktop thick-client binary and protocol testing.",
    assessmentTypes: ["Thick Client Assessment"],
    tags: ["thick-client","desktop"],
    steps: [
      { title: "Installation and privilege review", procedure: "Note required OS privileges and autostart behaviour." },
      { title: "Local storage inspection", procedure: "Search config, cache, and registries for secrets." },
      { title: "Traffic interception", procedure: "Capture client-server protocols and check for encryption." },
      { title: "Authentication analysis", procedure: "Test offline auth, credential storage, and update channels." },
      { title: "Input handling", procedure: "Fuzz IPC, file parsers, and network message handlers." },
      { title: "Update mechanism review", procedure: "Verify signed updates and HTTPS endpoints." },
      { title: "Binary hardening", procedure: "Check ASLR, DEP, stack cookies, and packing anomalies." },
      { title: "Privilege escalation paths", procedure: "Look for service misconfigs and insecure helper binaries." },
      { title: "Tamper and reverse-engineering notes", procedure: "Record trivial bypasses of license or security checks." },
      { title: "Report client and server findings", procedure: "Separate local issues from backend API weaknesses." },
    ],
  },
  {
    name: "OT and ICS Security Assessment",
    description: "Operational technology checklist emphasising safety and passive-first techniques.",
    assessmentTypes: ["OT Assessment","Network Assessment"],
    tags: ["ot","ics","scada"],
    steps: [
      { title: "Safety and ROE confirmation", procedure: "Reconfirm no active exploits on safety systems without written approval." },
      { title: "Zone and conduit mapping", procedure: "Document Purdue levels, firewalls, and data diodes in scope." },
      { title: "Passive network discovery", procedure: "Identify controllers, HMIs, and engineering workstations from captures." },
      { title: "Protocol exposure review", procedure: "Note cleartext ICS protocols reachable from higher zones." },
      { title: "Engineering access paths", procedure: "Assess jump hosts, VPN, and vendor remote access controls." },
      { title: "Patch and firmware posture", procedure: "Record versions and known critical advisories without disrupting process." },
      { title: "Authentication on OT assets", procedure: "Check default credentials and shared accounts on HMIs and PLCs." },
      { title: "Change and backup processes", procedure: "Verify configuration backups and change control evidence." },
      { title: "Detection capability", procedure: "Determine whether anomalous engineering commands would be noticed." },
      { title: "Findings with safety context", procedure: "Prioritise issues by process safety impact, not only CVSS." },
    ],
  },
];

export async function seedRunbookLibrary(
  tx: Transaction,
  organisationId: string,
  createdBy: string,
) {
  let inserted = 0;
  for (const item of RUNBOOK_LIBRARY) {
    const [existing] = await tx
      .select({ id: runbookTemplates.id })
      .from(runbookTemplates)
      .where(
        and(
          eq(runbookTemplates.organisationId, organisationId),
          eq(runbookTemplates.name, item.name),
          isNull(runbookTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (existing) continue;

    const [template] = await tx
      .insert(runbookTemplates)
      .values({
        organisationId,
        name: item.name,
        description: item.description,
        assessmentTypes: item.assessmentTypes,
        tags: item.tags,
        version: 1,
        status: "published",
        createdBy,
      })
      .returning();
    if (!template) throw new Error(`Unable to seed runbook ${item.name}`);

    await tx.insert(runbookTemplateSteps).values(
      item.steps.map((step, index) => ({
        organisationId,
        templateId: template.id,
        position: index + 1,
        title: step.title,
        objective: step.objective,
        procedure: step.procedure,
        expectedEvidence: step.expectedEvidence,
        required: step.required ?? true,
      })),
    );
    inserted += 1;
  }
  return { inserted, total: RUNBOOK_LIBRARY.length };
}
