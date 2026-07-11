import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { db, sqlClient } from "@/db";
import {
  accounts,
  assets,
  auditEvents,
  clients,
  engagementMembers,
  engagements,
  findingTemplates,
  findings,
  organisationMembers,
  organisations,
  reportTemplates,
  reportVersions,
  reports,
  scopeItems,
  scopeVersions,
  tasks,
  users,
} from "@/db/schema";

const ids = {
  user: "0197f30f-122c-7000-8000-000000000001",
  organisation: "0197f30f-122c-7000-8000-000000000002",
  client: "0197f30f-122c-7000-8000-000000000003",
  engagement: "0197f30f-122c-7000-8000-000000000004",
  scope: "0197f30f-122c-7000-8000-000000000005",
  scopeItem: "0197f30f-122c-7000-8000-000000000006",
  asset: "0197f30f-122c-7000-8000-000000000007",
  findingTemplate: "0197f30f-122c-7000-8000-000000000008",
  finding: "0197f30f-122c-7000-8000-000000000009",
  reportTemplate: "0197f30f-122c-7000-8000-000000000010",
  report: "0197f30f-122c-7000-8000-000000000011",
  reportVersion: "0197f30f-122c-7000-8000-000000000013",
  task: "0197f30f-122c-7000-8000-000000000012",
} as const;

async function main() {
  const password = await hashPassword("DingoDocs-Demo-2026!");
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: ids.user,
        name: "Alex Morgan",
        email: "admin@dingodocs.local",
        emailVerified: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(accounts)
      .values({
        userId: ids.user,
        providerId: "credential",
        accountId: ids.user,
        password,
      })
      .onConflictDoNothing();
    await tx
      .insert(organisations)
      .values({
        id: ids.organisation,
        name: "Dingo Security",
        slug: "dingo-security",
        securityPolicy: { mfaMode: "optional" },
      })
      .onConflictDoNothing();
    await tx
      .insert(organisationMembers)
      .values({
        organisationId: ids.organisation,
        userId: ids.user,
        role: "organisation_owner",
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
    await tx
      .insert(clients)
      .values({
        id: ids.client,
        organisationId: ids.organisation,
        name: "Northstar Systems",
        legalName: "Northstar Systems Pty Ltd",
        industry: "Financial services",
        securityClassification: "Confidential",
      })
      .onConflictDoNothing();
    await tx
      .insert(engagements)
      .values({
        id: ids.engagement,
        organisationId: ids.organisation,
        clientId: ids.client,
        name: "Northstar customer portal assessment",
        reference: "ENG-2026-001",
        type: "Web Application Assessment",
        status: "testing",
        startDate: "2026-07-14",
        endDate: "2026-07-25",
        reportingDeadline: "2026-08-01",
        health: "on_track",
        progress: 46,
        objectives:
          "Assess the customer portal and supporting API for exploitable weaknesses before the August release.",
      })
      .onConflictDoNothing();
    await tx
      .insert(engagementMembers)
      .values({
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        userId: ids.user,
        role: "engagement_manager",
      })
      .onConflictDoNothing();
    await tx
      .insert(scopeVersions)
      .values({
        id: ids.scope,
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        version: 1,
        status: "approved",
        changeSummary: "Initial approved scope",
        approvedBy: ids.user,
        approvedAt: new Date(),
        createdBy: ids.user,
      })
      .onConflictDoNothing();
    await tx
      .insert(scopeItems)
      .values({
        id: ids.scopeItem,
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        scopeVersionId: ids.scope,
        name: "Customer portal",
        type: "web_application",
        value: "https://portal.northstar.example",
        environment: "production",
        scopeStatus: "in_scope",
        approvedMethods: ["authenticated testing", "automated scanning"],
      })
      .onConflictDoNothing();
    await tx
      .insert(assets)
      .values({
        id: ids.asset,
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        name: "Customer Portal",
        type: "application",
        identifier: "portal.northstar.example",
        environment: "production",
        criticality: "high",
      })
      .onConflictDoNothing();
    await tx
      .insert(findingTemplates)
      .values({
        id: ids.findingTemplate,
        organisationId: ids.organisation,
        stableKey: "missing-object-authorisation",
        version: 1,
        title: "Missing object-level authorisation",
        summary:
          "Object identifiers can be modified to access another user's records.",
        technicalDescription:
          "The application does not consistently verify that the authenticated principal owns the requested object.",
        severity: "high",
        remediation:
          "Enforce object-level authorisation on every server-side data access path.",
        references: ["https://owasp.org/API-Security/"],
        tags: ["access-control", "api"],
        assessmentTypes: ["Web Application Assessment", "API Assessment"],
        reviewStatus: "approved",
        authorId: ids.user,
      })
      .onConflictDoNothing();
    await tx
      .insert(findings)
      .values({
        id: ids.finding,
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        templateId: ids.findingTemplate,
        templateVersion: 1,
        templateSnapshot: {
          title: "Missing object-level authorisation",
          summary:
            "Object identifiers can be modified to access another user's records.",
          executiveDescription: null,
          technicalDescription:
            "The application does not consistently verify that the authenticated principal owns the requested object.",
          businessImpact: null,
          technicalImpact: null,
          likelihood: null,
          severity: "high",
          riskRationale: null,
          remediation:
            "Enforce object-level authorisation on every server-side data access path.",
          verificationSteps: null,
          references: ["https://owasp.org/API-Security/"],
          tags: ["access-control", "api"],
          assessmentTypes: ["Web Application Assessment", "API Assessment"],
          mappings: [],
        },
        identifier: "WEB-001",
        title: "Missing object-level authorisation exposes invoices",
        status: "ready_for_review",
        severity: "high",
        likelihood: "likely",
        impact: "major",
        cvssVector:
          "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N",
        executiveSummary:
          "Authenticated users can retrieve invoices belonging to other customer accounts.",
        technicalDetail:
          "Changing the invoice identifier returns records without verifying tenant ownership.",
        remediation:
          "Authorise every invoice lookup against the authenticated account before returning data.",
        authorId: ids.user,
        reviewerId: ids.user,
      })
      .onConflictDoNothing();
    await tx
      .insert(reportTemplates)
      .values({
        id: ids.reportTemplate,
        organisationId: ids.organisation,
        name: "Technical Penetration Test Report",
        version: 1,
        definition: {
          sections: [
            { id: "cover", type: "cover" },
            {
              id: "executive-summary",
              type: "executive_summary",
              title: "Executive summary",
              content:
                "This report presents the outcomes of {{engagement.name}} for {{client.name}}.",
            },
            {
              id: "severity-chart",
              type: "chart",
              title: "Finding severity overview",
              condition: { field: "hasFindings", operator: "truthy" },
            },
            { id: "scope", type: "scope", title: "Assessment scope" },
            { id: "assets", type: "assets", title: "Assessed assets" },
            { id: "findings", type: "findings", title: "Detailed findings" },
            {
              id: "evidence",
              type: "evidence",
              title: "Evidence register",
              condition: { field: "hasEvidence", operator: "truthy" },
            },
            {
              id: "appendix",
              type: "appendix",
              title: "Appendix: report controls",
              content:
                "This document is controlled according to the classification shown in its header and footer.",
              options: { pageBreakBefore: true },
            },
          ],
          reusableContent: {
            methodology:
              "Testing followed a risk-based methodology and the approved Rules of Engagement.",
          },
          variables: {},
          branding: {
            organisationName: "Dingo Security",
            primaryColour: "#174b6b",
            accentColour: "#d59b2d",
          },
          typography: {
            bodyFont: "Arial",
            headingFont: "Arial",
            bodySize: 11,
          },
          header: {
            left: "Dingo Security",
            right: "Confidential",
            showRule: true,
          },
          footer: {
            left: "{{engagement.reference}}",
            showPageNumbers: true,
          },
          watermark: "CONFIDENTIAL",
          classification: "Confidential",
          approvals: [
            { role: "peer_reviewer", required: true },
            { role: "quality_assurance", required: true },
          ],
          signatures: [
            { label: "Prepared by", role: "Lead consultant" },
            { label: "Approved by", role: "Quality assurance" },
          ],
        },
        createdBy: ids.user,
      })
      .onConflictDoNothing();
    await tx
      .insert(reports)
      .values({
        id: ids.report,
        organisationId: ids.organisation,
        clientId: ids.client,
        engagementId: ids.engagement,
        templateId: ids.reportTemplate,
        templateVersion: 1,
        title: "Northstar Customer Portal Assessment",
        status: "internal_review",
        createdBy: ids.user,
      })
      .onConflictDoNothing();
    await tx
      .insert(reportVersions)
      .values({
        id: ids.reportVersion,
        organisationId: ids.organisation,
        reportId: ids.report,
        version: 1,
        status: "internal_review",
        createdBy: ids.user,
        content: {
          reportId: ids.report,
          reportVersionId: ids.reportVersion,
          version: 1,
          title: "Northstar Customer Portal Assessment",
          organisationName: "Dingo Security",
          clientName: "Northstar Systems",
          engagementName: "Northstar customer portal assessment",
          engagementReference: "ENG-2026-001",
          classification: "Confidential",
          generatedAt: new Date().toISOString(),
          theme: {
            primaryColour: "#174b6b",
            accentColour: "#d59b2d",
            bodyFont: "Arial",
            headingFont: "Arial",
            bodySize: 11,
            headerLeft: "Dingo Security",
            headerRight: "Confidential",
            footerLeft: "ENG-2026-001",
            showPageNumbers: true,
            watermark: "CONFIDENTIAL",
          },
          sections: [
            { definition: { id: "cover", type: "cover" } },
            {
              definition: {
                id: "executive-summary",
                type: "executive_summary",
                title: "Executive summary",
              },
              content:
                "This report presents the outcomes of the Northstar customer portal assessment.",
            },
            {
              definition: {
                id: "scope",
                type: "scope",
                title: "Assessment scope",
              },
            },
            {
              definition: {
                id: "findings",
                type: "findings",
                title: "Detailed findings",
              },
            },
          ],
          findings: [
            {
              identifier: "WEB-001",
              title: "Missing object-level authorisation exposes invoices",
              severity: "high",
              status: "ready_for_review",
              executiveSummary:
                "Authenticated users can retrieve invoices belonging to other customer accounts.",
              technicalDetail:
                "Changing the invoice identifier returns records without verifying tenant ownership.",
              businessImpact: "Customer invoice data may be disclosed.",
              remediation:
                "Authorise every invoice lookup against the authenticated account.",
              cvssVector:
                "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N",
            },
          ],
          scope: [
            {
              name: "Customer portal",
              value: "https://portal.northstar.example",
              status: "in_scope",
            },
          ],
          assets: [
            {
              name: "Customer Portal",
              type: "application",
              identifier: "portal.northstar.example",
              criticality: "high",
            },
          ],
          evidence: [],
          severityCounts: {
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            informational: 0,
          },
          signatures: [
            { label: "Prepared by", role: "Lead consultant" },
            { label: "Approved by", role: "Quality assurance" },
          ],
        },
      })
      .onConflictDoNothing();
    await tx
      .insert(tasks)
      .values({
        id: ids.task,
        organisationId: ids.organisation,
        engagementId: ids.engagement,
        findingId: ids.finding,
        title: "Peer review WEB-001",
        description: "Validate reproduction steps and remediation guidance.",
        status: "todo",
        priority: "high",
        assigneeId: ids.user,
        dueAt: new Date("2026-07-16T07:00:00Z"),
        createdBy: ids.user,
      })
      .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: ids.organisation,
      actorId: ids.user,
      action: "seed.completed",
      targetType: "organisation",
      targetId: ids.organisation,
      metadata: { dataset: "demo" },
    });
  });
  console.info(
    "Seeded DingoDocs demo data. Sign in with admin@dingodocs.local / DingoDocs-Demo-2026!",
  );
}

main()
  .then(() => sqlClient.end())
  .catch(async (error) => {
    console.error(error);
    await sqlClient.end();
    process.exit(1);
  });
