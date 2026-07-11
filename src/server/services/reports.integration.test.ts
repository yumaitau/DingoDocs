import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportTemplateDefinition } from "@/db/schema";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("report engine with PostgreSQL and storage fixtures", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    author: randomUUID(),
    qa: randomUUID(),
    approver: randomUUID(),
    outsider: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    scope: randomUUID(),
    asset: randomUUID(),
    finding: randomUUID(),
    evidence: randomUUID(),
  };
  const author = { organisationId: ids.orgA, userId: ids.author };
  const qa = { organisationId: ids.orgA, userId: ids.qa };
  const approver = { organisationId: ids.orgA, userId: ids.approver };
  let modules: Awaited<ReturnType<typeof load>>;
  let root: string;
  let provider: InstanceType<
    Awaited<ReturnType<typeof load>>["LocalStorageProvider"]
  >;
  let templateId: string;
  let reportId: string;
  let versionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    root = await mkdtemp(join(tmpdir(), "dingodocs-reports-"));
    provider = new modules.LocalStorageProvider(root);
    await modules.db.insert(modules.users).values([
      {
        id: ids.author,
        name: "Report Author",
        email: `${ids.author}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.qa,
        name: "Report QA",
        email: `${ids.qa}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.approver,
        name: "Report Approver",
        email: `${ids.approver}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Other Tenant",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `reports-${ids.orgA}`, name: "Report Security" },
      { id: ids.orgB, slug: `reports-${ids.orgB}`, name: "Other Reports" },
    ]);
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.orgA,
      name: "Report Client",
    });
    await modules.db.insert(modules.engagements).values({
      id: ids.engagement,
      organisationId: ids.orgA,
      clientId: ids.client,
      name: "Portal Assessment",
      reference: `RPT-${ids.engagement.slice(0, 8)}`,
      type: "Web Application",
      status: "reporting",
    });
    await modules.db.insert(modules.scopeVersions).values({
      id: ids.scope,
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      version: 1,
      status: "approved",
      changeSummary: "Approved scope",
      createdBy: ids.author,
      approvedBy: ids.qa,
      approvedAt: new Date(),
    });
    await modules.db.insert(modules.scopeItems).values({
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      scopeVersionId: ids.scope,
      name: "Portal",
      type: "application",
      value: "portal.report.test",
      scopeStatus: "in_scope",
    });
    await modules.db.insert(modules.assets).values({
      id: ids.asset,
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      name: "Portal",
      type: "application",
      identifier: "portal.report.test",
      criticality: "high",
    });
    await modules.db.insert(modules.findings).values({
      id: ids.finding,
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      identifier: "WEB-001",
      title: "Cross-tenant invoice access",
      status: "qa_approved",
      severity: "high",
      executiveSummary: "Invoices can be retrieved across tenants.",
      technicalDetail: "The lookup omits the active tenant identifier.",
      businessImpact: "Customer invoice data may be disclosed.",
      remediation: "Scope invoice lookups to the active tenant.",
      cvssVector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H",
      cvssScore: "8.7",
      authorId: ids.author,
    });
    await modules.db.insert(modules.evidence).values({
      id: ids.evidence,
      organisationId: ids.orgA,
      clientId: ids.client,
      engagementId: ids.engagement,
      originalFilename: "invoice-proof.png",
      storageProvider: "local",
      storageKey: `${ids.orgA}/${ids.engagement}/invoice-proof.png`,
      mediaType: "image/png",
      sizeBytes: 68,
      sha256: "b".repeat(64),
      uploadedBy: ids.author,
      classification: "restricted",
      malwareScanStatus: "clean",
    });
  });

  afterAll(async () => {
    if (modules) {
      await modules.db
        .delete(modules.auditEvents)
        .where(
          modules.inArray(modules.auditEvents.organisationId, [
            ids.orgA,
            ids.orgB,
          ]),
        );
      await modules.db
        .delete(modules.organisations)
        .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
      await modules.db
        .delete(modules.users)
        .where(
          modules.inArray(modules.users.id, [
            ids.author,
            ids.qa,
            ids.approver,
            ids.outsider,
          ]),
        );
      await modules.sqlClient.end();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("versions templates and snapshots the complete live-preview model", async () => {
    const template = await modules.createReportTemplate(author, {
      name: "Technical Assessment",
      definition: definition(),
    });
    templateId = template!.id;
    const revision = await modules.reviseReportTemplate(author, templateId, {
      definition: { ...definition(), classification: "Highly Confidential" },
    });
    expect(revision).toMatchObject({ version: 2 });
    const created = await modules.createReport(author, {
      engagementId: ids.engagement,
      templateId: revision!.id,
      title: "Portal Security Assessment",
    });
    reportId = created.report!.id;
    versionId = created.version!.id;
    expect(created.model).toMatchObject({
      clientName: "Report Client",
      engagementReference: expect.stringContaining("RPT-"),
      classification: "Highly Confidential",
    });
    expect(
      created.model.sections.map((section) => section.definition.type),
    ).toEqual(
      expect.arrayContaining([
        "cover",
        "findings",
        "scope",
        "assets",
        "chart",
        "risk_matrix",
        "evidence",
        "appendix",
      ]),
    );
    expect(
      created.model.sections.find(
        (section) => section.definition.id === "summary",
      )?.content,
    ).toContain("Portal Assessment for Report Client");
    expect(created.model.findings[0]).toMatchObject({
      identifier: "WEB-001",
      cvssScore: "8.7",
    });
    await modules.db
      .update(modules.findings)
      .set({ title: "Updated after snapshot" })
      .where(modules.eq(modules.findings.id, ids.finding));
    const workspace = await modules.getReportWorkspace(ids.orgA, reportId);
    expect(
      (workspace.current.content as { findings: Array<{ title: string }> })
        .findings[0]?.title,
    ).toBe("Cross-tenant invoice access");
    await expect(
      modules.getReportWorkspace(ids.orgB, reportId),
    ).rejects.toBeInstanceOf(modules.ReportScopeError);
  });

  it("generates and stores all formats through the background-job handler", async () => {
    await modules.queueReportGeneration(author, reportId, [
      ...modules.reportFormats,
    ]);
    await modules.generateReportJob(
      versionId,
      [...modules.reportFormats],
      provider,
    );
    const workspace = await modules.getReportWorkspace(ids.orgA, reportId);
    expect(workspace.current.renderStatus).toBe("completed");
    for (const format of modules.reportFormats) {
      const key = workspace.current.exportKeys[format];
      expect(key).toBeTruthy();
      expect(await provider.exists(key!)).toBe(true);
    }
    const pdf = await modules.streamToBytes(
      await provider.get(workspace.current.exportKeys.pdf!),
    );
    const docx = await modules.streamToBytes(
      await provider.get(workspace.current.exportKeys.docx!),
    );
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe("%PDF");
    expect(Buffer.from(docx.subarray(0, 2)).toString()).toBe("PK");
    const html = new TextDecoder().decode(
      await modules.streamToBytes(
        await provider.get(workspace.current.exportKeys.html!),
      ),
    );
    expect(html).toBe(
      modules.renderReportHtml(
        workspace.current.content as Parameters<
          typeof modules.renderReportHtml
        >[0],
      ),
    );
  });

  it("enforces review separation, publication, immutability, and revisions", async () => {
    await modules.transitionReport(author, {
      reportId,
      toStatus: "internal_review",
    });
    await expect(
      modules.transitionReport(author, { reportId, toStatus: "qa_approved" }),
    ).rejects.toThrow("authors cannot");
    await modules.transitionReport(qa, {
      reportId,
      toStatus: "qa_approved",
      comment: "QA checks complete",
    });
    await modules.transitionReport(qa, { reportId, toStatus: "client_review" });
    await expect(
      modules.transitionReport(qa, { reportId, toStatus: "approved" }),
    ).rejects.toThrow("different approver");
    await modules.transitionReport(approver, {
      reportId,
      toStatus: "approved",
      comment: "Client and approver accepted",
    });
    await modules.transitionReport(approver, {
      reportId,
      toStatus: "published",
    });
    const published = await modules.getReportWorkspace(ids.orgA, reportId);
    expect(published.current).toMatchObject({
      immutable: true,
      status: "published",
    });
    await expect(
      modules.queueReportGeneration(author, reportId),
    ).rejects.toThrow("immutable");
    const revision = await modules.createReportRevision(author, reportId);
    expect(revision).toMatchObject({
      version: 2,
      immutable: false,
      status: "draft",
    });
    const revised = await modules.getReportWorkspace(ids.orgA, reportId);
    expect(
      (revised.current.content as { findings: Array<{ title: string }> })
        .findings[0]?.title,
    ).toBe("Updated after snapshot");
    expect(
      revised.versions.find((version) => version.version === 1),
    ).toMatchObject({ immutable: true, status: "superseded" });
  });

  it("audits export/download history and rejects cross-tenant records", async () => {
    const original = (
      await modules.getReportWorkspace(ids.orgA, reportId)
    ).versions.find((version) => version.version === 1)!;
    const result = await modules.getReportExport(author, {
      reportVersionId: original.id,
      format: "pdf",
    });
    expect(result.key).toBeTruthy();
    const audits = await modules.db
      .select()
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.action, "report.export_downloaded"),
          modules.eq(modules.auditEvents.targetId, reportId),
        ),
      );
    expect(audits).toHaveLength(1);
    await expect(
      modules.getReportExport(
        { organisationId: ids.orgB, userId: ids.outsider },
        { reportVersionId: original.id, format: "pdf" },
      ),
    ).rejects.toBeInstanceOf(modules.ReportScopeError);
  });
});

function definition(): ReportTemplateDefinition {
  return {
    sections: [
      { id: "cover", type: "cover" },
      {
        id: "summary",
        type: "executive_summary",
        title: "Executive summary",
        content: "{{engagement.name}} for {{client.name}}",
      },
      {
        id: "method",
        type: "reusable_content",
        title: "Methodology",
        reusableKey: "methodology",
      },
      {
        id: "chart",
        type: "chart",
        title: "Severity chart",
        condition: { field: "hasFindings", operator: "truthy" },
      },
      { id: "matrix", type: "risk_matrix", title: "Risk matrix" },
      { id: "scope", type: "scope", title: "Scope" },
      { id: "assets", type: "assets", title: "Assets" },
      { id: "findings", type: "findings", title: "Findings" },
      {
        id: "evidence",
        type: "evidence",
        title: "Evidence",
        condition: { field: "hasEvidence", operator: "truthy" },
      },
      { id: "break", type: "page_break" },
      {
        id: "appendix",
        type: "appendix",
        title: "Appendix",
        content: "Controlled document.",
      },
    ],
    reusableContent: {
      methodology: "Risk-based testing under the approved Rules of Engagement.",
    },
    variables: {},
    branding: {
      organisationName: "Report Security",
      primaryColour: "#174b6b",
      accentColour: "#d59b2d",
    },
    typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
    header: {
      left: "{{organisation.name}}",
      right: "Highly Confidential",
      showRule: true,
    },
    footer: { left: "{{engagement.reference}}", showPageNumbers: true },
    watermark: "CONFIDENTIAL",
    classification: "Confidential",
    approvals: [{ role: "quality_assurance", required: true }],
    signatures: [
      { label: "Prepared by", role: "Lead consultant" },
      { label: "Approved by", role: "Approver" },
    ],
  };
}

async function load() {
  const [
    { db, sqlClient },
    schema,
    reportsService,
    evidenceService,
    renderer,
    storage,
    drizzle,
  ] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./reports"),
    import("./evidence"),
    import("./report-renderers"),
    import("@/lib/storage/local"),
    import("drizzle-orm"),
  ]);
  return {
    db,
    sqlClient,
    ...schema,
    ...reportsService,
    ...evidenceService,
    ...renderer,
    ...storage,
    ...drizzle,
  };
}
