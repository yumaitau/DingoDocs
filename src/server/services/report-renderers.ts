import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import type { ReportFormat, ReportSectionDefinition } from "@/db/schema";
import { logoBytes } from "@/lib/reports/branding";

export type ReportFindingModel = {
  identifier: string;
  title: string;
  severity: string;
  status: string;
  executiveSummary?: string | null;
  technicalDetail?: string | null;
  businessImpact?: string | null;
  remediation?: string | null;
  cvssVector?: string | null;
  cvssScore?: string | null;
};

export type ReportDocumentModel = {
  reportId: string;
  reportVersionId: string;
  version: number;
  title: string;
  organisationName: string;
  clientName: string;
  engagementName: string;
  engagementReference: string;
  classification: string;
  generatedAt: string;
  whiteLabel?: boolean;
  tagline?: string;
  logoDataUri?: string;
  clientLogoDataUri?: string;
  startDate?: string | null;
  endDate?: string | null;
  preparedBy?: string;
  address?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  documentControl?: Array<{ field: string; value: string }>;
  severityRatings?: Array<{ severity: string; cvss: string; meaning: string }>;
  glossary?: Array<{ term: string; definition: string }>;
  contacts?: Array<{
    role: string;
    name: string;
    email?: string;
    phone?: string;
  }>;
  recommendations?: Array<{
    identifier: string;
    title: string;
    severity: string;
    remediation: string;
  }>;
  theme: {
    primaryColour: string;
    accentColour: string;
    bodyFont: string;
    headingFont: string;
    bodySize: number;
    customCss?: string | null;
    headerLeft?: string;
    headerRight?: string;
    footerLeft?: string;
    showPageNumbers: boolean;
    watermark?: string;
  };
  sections: Array<{
    definition: ReportSectionDefinition;
    content?: string;
  }>;
  findings: ReportFindingModel[];
  scope: Array<{ name: string; value: string; status: string }>;
  assets: Array<{
    name: string;
    type: string;
    identifier: string;
    criticality?: string | null;
  }>;
  evidence: Array<{
    filename: string;
    mediaType: string;
    classification: string;
    sha256: string;
  }>;
  severityCounts: Record<string, number>;
  signatures: Array<{ label: string; role: string }>;
};

export const reportMediaTypes: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export async function renderReport(model: ReportDocumentModel, format: ReportFormat) {
  if (format === "pdf") return renderReportPdf(model);
  if (format === "docx") return renderReportDocx(model);
  if (format === "html") return bytes(renderReportHtml(model));
  if (format === "markdown") return bytes(renderReportMarkdown(model));
  return bytes(JSON.stringify(model, null, 2));
}

export function renderReportHtml(model: ReportDocumentModel) {
  const primary = safeColour(model.theme.primaryColour, "#174b6b");
  const accent = safeColour(model.theme.accentColour, "#d59b2d");
  const sections = model.sections
    .map(({ definition, content }) => renderHtmlSection(model, definition, content))
    .join("\n");
  const customCss = sanitiseCss(model.theme.customCss ?? "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.title)}</title><style>
:root{--primary:${primary};--accent:${accent}}*{box-sizing:border-box}body{margin:0;color:#17202a;background:#eef2f5;font-family:${safeFont(model.theme.bodyFont)},Arial,sans-serif;font-size:${model.theme.bodySize}px;line-height:1.55}.report{width:min(900px,100%);margin:0 auto;background:white;min-height:100vh;padding:64px 72px}.cover{min-height:780px;display:flex;flex-direction:column;justify-content:center;border-top:8px solid var(--primary)}.kicker{color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.12em}.cover h1{font:700 44px/1.12 ${safeFont(model.theme.headingFont)},Arial,sans-serif;color:var(--primary);margin:16px 0}.meta{color:#53616d}.classification{margin-top:auto;border:1px solid #cbd5dc;padding:10px;text-align:center;font-weight:700}.logo{max-height:56px;margin-bottom:18px}.toc{padding-left:20px}.section{padding:32px 0;border-top:1px solid #dce3e8}.section.page-break{break-before:page}.section h2{font:700 26px/1.2 ${safeFont(model.theme.headingFont)},Arial,sans-serif;color:var(--primary)}.finding{margin:24px 0;padding:20px;border-left:5px solid var(--accent);background:#f7f9fa}.severity{display:inline-block;border-radius:999px;padding:3px 9px;background:#e8eef2;font-size:12px;font-weight:700;text-transform:uppercase}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #cbd5dc;padding:10px;text-align:left;vertical-align:top}th{background:#eef3f6;color:var(--primary)}.chart{display:flex;gap:12px;align-items:flex-end;height:180px}.bar{min-width:72px;background:var(--primary);color:white;text-align:center;padding:8px}.watermark{position:fixed;inset:45% 0 auto;transform:rotate(-28deg);text-align:center;font-size:70px;font-weight:700;color:rgba(80,90,100,.08);pointer-events:none}.signatures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px;margin-top:50px}.signature{border-top:1px solid #475569;padding-top:8px}${customCss}
</style></head><body>${model.theme.watermark ? `<div class="watermark">${escapeHtml(model.theme.watermark)}</div>` : ""}<main class="report">${sections}${model.signatures.length ? `<section class="section"><h2>Approvals and signatures</h2><div class="signatures">${model.signatures.map((signature) => `<div class="signature">${escapeHtml(signature.label)} - ${escapeHtml(signature.role)}</div>`).join("")}</div></section>` : ""}</main></body></html>`;
}

export function renderReportMarkdown(model: ReportDocumentModel) {
  const output = [
    `# ${model.title}`,
    "",
    `**Client:** ${model.clientName}`,
    `**Engagement:** ${model.engagementName} (${model.engagementReference})`,
    `**Classification:** ${model.classification}`,
    "",
  ];
  for (const { definition, content } of model.sections) {
    if (definition.type === "page_break") {
      output.push("---", "");
      continue;
    }
    if (definition.type === "cover") continue;
    output.push(`## ${definition.title ?? titleFor(definition.type)}`, "");
    if (content) output.push(content, "");
    if (definition.type === "findings")
      for (const finding of model.findings)
        output.push(
          `### ${finding.identifier}: ${finding.title}`,
          "",
          `**Severity:** ${finding.severity}${finding.cvssScore ? ` | **CVSS:** ${finding.cvssScore}` : ""}`,
          "",
          finding.executiveSummary ?? "",
          "",
          "#### Technical detail",
          finding.technicalDetail ?? "",
          "",
          "#### Remediation",
          finding.remediation ?? "",
          "",
        );
    if (definition.type === "scope")
      output.push(
        ...markdownTable(
          ["Name", "Value", "Status"],
          model.scope.map((item) => [item.name, item.value, item.status]),
        ),
      );
    if (definition.type === "assets")
      output.push(
        ...markdownTable(
          ["Asset", "Type", "Identifier", "Criticality"],
          model.assets.map((item) => [
            item.name,
            item.type,
            item.identifier,
            item.criticality ?? "",
          ]),
        ),
      );
    if (definition.type === "evidence")
      output.push(
        ...markdownTable(
          ["File", "Type", "Classification", "SHA-256"],
          model.evidence.map((item) => [
            item.filename,
            item.mediaType,
            item.classification,
            item.sha256,
          ]),
        ),
      );
    if (definition.type === "chart" || definition.type === "risk_matrix")
      output.push(
        ...markdownTable(
          ["Severity", "Findings"],
          Object.entries(model.severityCounts).map(([key, value]) => [key, String(value)]),
        ),
      );
    const extra = structuredSection(model, definition.type);
    if (extra?.kind === "table") output.push(...markdownTable(extra.headers, extra.rows));
    if (extra?.kind === "list") output.push(...extra.items.map((item) => item), "");
  }
  if (model.signatures.length) {
    output.push("## Approvals and signatures", "");
    for (const signature of model.signatures)
      output.push(`____________________  ${signature.label} - ${signature.role}`, "");
  }
  return output.join("\n");
}

async function renderReportPdf(model: ReportDocumentModel) {
  const document = new PDFDocument({
    size: "LETTER",
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: model.title,
      Author: model.organisationName,
      Subject: model.engagementName,
    },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const primary = safeColour(model.theme.primaryColour, "#174b6b");
  const accent = safeColour(model.theme.accentColour, "#d59b2d");
  addPdfPage(document);
  for (const [index, section] of model.sections.entries()) {
    const { definition, content } = section;
    const previous = model.sections[index - 1]?.definition.type;
    if (
      index > 0 &&
      (previous === "cover" ||
        definition.type === "cover" ||
        definition.type === "page_break" ||
        definition.options?.pageBreakBefore === true)
    )
      addPdfPage(document);
    if (definition.type === "cover") {
      const logo = logoBytes(model.logoDataUri);
      if (logo) {
        try {
          document.image(logo, 72, 72, { height: 48 });
          document.moveDown(4);
        } catch {
          /* invalid or unsupported logo bytes are omitted */
        }
      } else document.moveDown(7);
      document
        .fillColor(accent)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(model.organisationName.toUpperCase(), { characterSpacing: 1.5 });
      if (model.tagline)
        document
          .moveDown(0.4)
          .fillColor("#52606d")
          .font("Helvetica")
          .fontSize(11)
          .text(model.tagline);
      document.moveDown().fillColor(primary).font("Helvetica-Bold").fontSize(30).text(model.title);
      document
        .moveDown()
        .fillColor("#52606d")
        .font("Helvetica")
        .fontSize(14)
        .text(`${model.clientName} | ${model.engagementReference}`);
      if (model.startDate || model.endDate)
        document
          .moveDown(0.4)
          .fontSize(11)
          .text(
            `Testing window: ${model.startDate ?? "not recorded"} – ${model.endDate ?? "not recorded"}`,
          );
      document
        .moveDown(12)
        .strokeColor("#cbd5dc")
        .moveTo(72, document.y)
        .lineTo(540, document.y)
        .stroke();
      document
        .moveDown()
        .fillColor("#263746")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(model.classification.toUpperCase(), { align: "center" });
      continue;
    }
    if (definition.type === "page_break") continue;
    ensurePdfSpace(document, 90);
    document
      .moveDown()
      .fillColor(primary)
      .font("Helvetica-Bold")
      .fontSize(19)
      .text(definition.title ?? titleFor(definition.type));
    document.moveDown(0.5).fillColor("#263746").font("Helvetica").fontSize(10.5);
    if (content) document.text(content, { paragraphGap: 8 });
    renderPdfDataSection(document, model, definition.type, primary, accent);
  }
  if (model.signatures.length) {
    addPdfPage(document);
    document
      .fillColor(primary)
      .font("Helvetica-Bold")
      .fontSize(19)
      .text("Approvals and signatures");
    for (const signature of model.signatures)
      document
        .moveDown(4)
        .strokeColor("#475569")
        .moveTo(72, document.y)
        .lineTo(300, document.y)
        .stroke()
        .moveDown(0.5)
        .fillColor("#263746")
        .font("Helvetica")
        .fontSize(10)
        .text(`${signature.label} - ${signature.role}`);
  }
  const range = document.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    document.switchToPage(page);
    if (model.theme.watermark)
      document
        .save()
        .fillColor("#93a1ad")
        .opacity(0.08)
        .font("Helvetica-Bold")
        .fontSize(54)
        .rotate(-28, { origin: [306, 396] })
        .text(model.theme.watermark, 80, 365, { width: 450, align: "center" })
        .restore();
    document
      .opacity(1)
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text(model.theme.headerLeft ?? model.organisationName, 72, 34, {
        width: 260,
        lineBreak: false,
      });
    document.text(model.theme.headerRight ?? model.classification, 280, 34, {
      width: 260,
      align: "right",
      lineBreak: false,
    });
    document.text(model.theme.footerLeft ?? model.engagementReference, 72, 710, {
      width: 260,
      lineBreak: false,
    });
    if (model.theme.showPageNumbers)
      document.text(`Page ${page + 1} of ${range.count}`, 280, 710, {
        width: 260,
        align: "right",
        lineBreak: false,
      });
  }
  document.end();
  return new Uint8Array(await completed);
}

async function renderReportDocx(model: ReportDocumentModel) {
  const primary = safeHex(model.theme.primaryColour, "174B6B");
  const muted = "53616D";
  const children: Array<Paragraph | Table> = [];
  for (const { definition, content } of model.sections) {
    if (definition.type === "page_break") {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }
    if (definition.type === "cover") {
      children.push(
        new Paragraph({
          spacing: { before: 2640, after: 360 },
          children: [
            new TextRun({
              text: model.organisationName.toUpperCase(),
              bold: true,
              color: safeHex(model.theme.accentColour, "D59B2D"),
              size: 22,
              font: model.theme.headingFont,
            }),
          ],
        }),
      );
      if (model.tagline)
        children.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: model.tagline,
                color: muted,
                size: 22,
                font: model.theme.bodyFont,
              }),
            ],
          }),
        );
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          children: [
            new TextRun({
              text: model.title,
              bold: true,
              color: primary,
              size: 58,
              font: model.theme.headingFont,
            }),
          ],
        }),
      );
      children.push(
        new Paragraph({
          spacing: { after: 2200 },
          children: [
            new TextRun({
              text: `${model.clientName} | ${model.engagementReference}`,
              color: muted,
              size: 28,
              font: model.theme.bodyFont,
            }),
          ],
        }),
      );
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: model.classification.toUpperCase(),
              bold: true,
              size: 20,
            }),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      );
      continue;
    }
    children.push(
      new Paragraph({
        text: definition.title ?? titleFor(definition.type),
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: definition.options?.pageBreakBefore === true,
      }),
    );
    if (content) children.push(new Paragraph({ text: content }));
    children.push(...docxDataSection(model, definition.type, primary));
  }
  if (model.signatures.length) {
    children.push(
      new Paragraph({
        text: "Approvals and signatures",
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
    );
    for (const signature of model.signatures) {
      children.push(
        new Paragraph({
          spacing: { before: 800, after: 80 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: "475569" },
          },
          children: [
            new TextRun({
              text: `${signature.label} - ${signature.role}`,
              size: 20,
            }),
          ],
        }),
      );
      children.push(new Paragraph({ spacing: { after: 240 } }));
    }
  }
  const document = new Document({
    creator: model.organisationName,
    title: model.title,
    description: model.engagementName,
    styles: {
      default: {
        document: {
          run: {
            font: model.theme.bodyFont,
            size: model.theme.bodySize * 2,
            color: "17202A",
          },
          paragraph: { spacing: { after: 120, line: 264 } },
        },
        heading1: {
          run: {
            font: model.theme.headingFont,
            size: 32,
            bold: true,
            color: primary,
          },
          paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
        },
        heading2: {
          run: {
            font: model.theme.headingFont,
            size: 26,
            bold: true,
            color: primary,
          },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
              header: 708,
              footer: 708,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    color: "D7DBE2",
                    size: 4,
                  },
                },
                children: [
                  new TextRun({
                    text: `${model.theme.headerLeft ?? model.organisationName}    ${model.theme.headerRight ?? model.classification}`,
                    color: muted,
                    size: 16,
                  }),
                ],
              }),
              ...(model.theme.watermark
                ? [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: model.theme.watermark,
                          color: "D9E0E5",
                          size: 36,
                          bold: true,
                        }),
                      ],
                    }),
                  ]
                : []),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: model.theme.footerLeft ?? model.engagementReference,
                    color: muted,
                    size: 16,
                  }),
                  ...(model.theme.showPageNumbers
                    ? [
                        new TextRun({
                          text: "    Page ",
                          color: muted,
                          size: 16,
                        }),
                        new TextRun({
                          children: [PageNumber.CURRENT],
                          color: muted,
                          size: 16,
                        }),
                      ]
                    : []),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function renderHtmlSection(
  model: ReportDocumentModel,
  definition: ReportSectionDefinition,
  content?: string,
) {
  if (definition.type === "cover")
    return `<section class="cover">${model.logoDataUri ? `<img class="logo" alt="" src="${escapeHtml(model.logoDataUri)}">` : ""}<p class="kicker">${escapeHtml(model.organisationName)}</p>${model.tagline ? `<p class="meta">${escapeHtml(model.tagline)}</p>` : ""}<h1>${escapeHtml(model.title)}</h1><p class="meta">${escapeHtml(model.clientName)} | ${escapeHtml(model.engagementReference)}</p>${model.startDate || model.endDate ? `<p class="meta">Testing window: ${escapeHtml(model.startDate ?? "not recorded")} – ${escapeHtml(model.endDate ?? "not recorded")}</p>` : ""}<p class="classification">${escapeHtml(model.classification)}</p></section>`;
  if (definition.type === "page_break") return `<div class="section page-break"></div>`;
  let body = content ? `<p>${escapeHtml(content).replaceAll("\n", "<br>")}</p>` : "";
  if (definition.type === "findings")
    body += model.findings
      .map(
        (finding) =>
          `<article class="finding"><span class="severity">${escapeHtml(finding.severity)}</span><h3>${escapeHtml(finding.identifier)}: ${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.executiveSummary ?? "")}</p><h4>Technical detail</h4><p>${escapeHtml(finding.technicalDetail ?? "")}</p><h4>Business impact</h4><p>${escapeHtml(finding.businessImpact ?? "")}</p><h4>Remediation</h4><p>${escapeHtml(finding.remediation ?? "")}</p>${finding.cvssVector ? `<p><strong>CVSS v4:</strong> ${escapeHtml(finding.cvssScore ?? "")} ${escapeHtml(finding.cvssVector)}</p>` : ""}</article>`,
      )
      .join("");
  if (definition.type === "scope")
    body += htmlTable(
      ["Name", "Value", "Status"],
      model.scope.map((item) => [item.name, item.value, item.status]),
    );
  if (definition.type === "assets")
    body += htmlTable(
      ["Asset", "Type", "Identifier", "Criticality"],
      model.assets.map((item) => [item.name, item.type, item.identifier, item.criticality ?? ""]),
    );
  if (definition.type === "evidence")
    body += htmlTable(
      ["File", "Type", "Classification", "SHA-256"],
      model.evidence.map((item) => [
        item.filename,
        item.mediaType,
        item.classification,
        item.sha256,
      ]),
    );
  if (definition.type === "chart")
    body += `<div class="chart">${Object.entries(model.severityCounts)
      .map(
        ([label, value]) =>
          `<div class="bar" style="height:${Math.max(35, value * 28)}px">${value}<br>${escapeHtml(label)}</div>`,
      )
      .join("")}</div>`;
  if (definition.type === "risk_matrix")
    body += htmlTable(
      ["Severity", "Findings"],
      Object.entries(model.severityCounts).map(([key, value]) => [key, String(value)]),
    );
  const extra = structuredSection(model, definition.type);
  if (extra?.kind === "table") body += htmlTable(extra.headers, extra.rows);
  if (extra?.kind === "list")
    body += `<ol class="toc">${extra.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  return `<section class="section"><h2>${escapeHtml(definition.title ?? titleFor(definition.type))}</h2>${body}</section>`;
}

function renderPdfDataSection(
  document: PDFKit.PDFDocument,
  model: ReportDocumentModel,
  type: ReportSectionDefinition["type"],
  primary: string,
  accent: string,
) {
  if (type === "findings")
    for (const finding of model.findings) {
      ensurePdfSpace(document, 170);
      document
        .moveDown()
        .fillColor(accent)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(finding.severity.toUpperCase());
      document.fillColor(primary).fontSize(13).text(`${finding.identifier}: ${finding.title}`);
      document
        .fillColor("#263746")
        .font("Helvetica")
        .fontSize(10)
        .text(finding.executiveSummary ?? "", { paragraphGap: 5 });
      if (finding.technicalDetail)
        document
          .font("Helvetica-Bold")
          .text("Technical detail")
          .font("Helvetica")
          .text(finding.technicalDetail);
      if (finding.remediation)
        document
          .moveDown(0.4)
          .font("Helvetica-Bold")
          .text("Remediation")
          .font("Helvetica")
          .text(finding.remediation);
    }
  if (type === "scope")
    pdfRows(
      document,
      ["Name", "Value", "Status"],
      model.scope.map((item) => [item.name, item.value, item.status]),
    );
  if (type === "assets")
    pdfRows(
      document,
      ["Asset", "Type", "Identifier"],
      model.assets.map((item) => [item.name, item.type, item.identifier]),
    );
  if (type === "evidence")
    pdfRows(
      document,
      ["File", "Type", "Classification"],
      model.evidence.map((item) => [item.filename, item.mediaType, item.classification]),
    );
  if (type === "chart" || type === "risk_matrix")
    pdfRows(
      document,
      ["Severity", "Findings"],
      Object.entries(model.severityCounts).map(([key, value]) => [key, String(value)]),
    );
  const extra = structuredSection(model, type);
  if (extra?.kind === "table") pdfRows(document, extra.headers, extra.rows);
  if (extra?.kind === "list")
    for (const item of extra.items)
      document.moveDown(0.2).font("Helvetica").fontSize(10.5).text(item);
}

function docxDataSection(
  model: ReportDocumentModel,
  type: ReportSectionDefinition["type"],
  primary: string,
): Array<Paragraph | Table> {
  if (type === "findings")
    return model.findings.flatMap((finding) => [
      new Paragraph({
        text: `${finding.identifier}: ${finding.title}`,
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: finding.severity.toUpperCase(),
            bold: true,
            color: primary,
          }),
          new TextRun({
            text: finding.cvssScore ? ` | CVSS ${finding.cvssScore}` : "",
          }),
        ],
      }),
      new Paragraph({ text: finding.executiveSummary ?? "" }),
      new Paragraph({
        children: [new TextRun({ text: "Technical detail", bold: true })],
      }),
      new Paragraph({ text: finding.technicalDetail ?? "" }),
      new Paragraph({
        children: [new TextRun({ text: "Remediation", bold: true })],
      }),
      new Paragraph({ text: finding.remediation ?? "" }),
    ]);
  if (type === "scope")
    return [
      docxTable(
        ["Name", "Value", "Status"],
        model.scope.map((item) => [item.name, item.value, item.status]),
        primary,
      ),
    ];
  if (type === "assets")
    return [
      docxTable(
        ["Asset", "Type", "Identifier", "Criticality"],
        model.assets.map((item) => [item.name, item.type, item.identifier, item.criticality ?? ""]),
        primary,
      ),
    ];
  if (type === "evidence")
    return [
      docxTable(
        ["File", "Type", "Classification", "SHA-256"],
        model.evidence.map((item) => [
          item.filename,
          item.mediaType,
          item.classification,
          item.sha256,
        ]),
        primary,
      ),
    ];
  if (type === "chart" || type === "risk_matrix")
    return [
      docxTable(
        ["Severity", "Findings"],
        Object.entries(model.severityCounts).map(([key, value]) => [key, String(value)]),
        primary,
      ),
    ];
  const extra = structuredSection(model, type);
  if (extra?.kind === "table") return [docxTable(extra.headers, extra.rows, primary)];
  if (extra?.kind === "list") return extra.items.map((item) => new Paragraph({ text: item }));
  return [];
}

function docxTable(headers: string[], rows: string[][], primary: string) {
  const widths = columnWidths(headers.length);
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map(
          (header, index) =>
            new TableCell({
              width: { size: widths[index]!, type: WidthType.DXA },
              shading: {
                type: ShadingType.CLEAR,
                fill: "EEF3F6",
                color: "auto",
              },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: header, bold: true, color: primary })],
                }),
              ],
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: headers.map(
              (_, index) =>
                new TableCell({
                  width: { size: widths[index]!, type: WidthType.DXA },
                  margins: { top: 100, bottom: 100, left: 120, right: 120 },
                  children: [new Paragraph({ text: row[index] ?? "" })],
                }),
            ),
          }),
      ),
    ],
  });
}

function htmlTable(headers: string[], rows: string[][]) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function markdownTable(headers: string[], rows: string[][]) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`),
    "",
  ];
}
function pdfRows(document: PDFKit.PDFDocument, headers: string[], rows: string[][]) {
  const x = 72;
  const width = 468;
  const columnWidth = width / headers.length;
  let y = document.y + 8;
  const drawRow = (row: string[], header = false) => {
    const longest = Math.max(...row.map((cell) => cell.length));
    const approximateLines = Math.max(
      1,
      Math.ceil(longest / Math.max(12, Math.floor(columnWidth / 5.5))),
    );
    const height = Math.max(28, 14 + approximateLines * 12);
    ensurePdfSpace(document, height + 8);
    if (document.y > y) y = document.y + 8;
    for (let index = 0; index < headers.length; index++) {
      document
        .save()
        .fillColor(header ? "#eef3f6" : "#ffffff")
        .strokeColor("#cbd5dc")
        .rect(x + index * columnWidth, y, columnWidth, height)
        .fillAndStroke()
        .restore()
        .fillColor(header ? "#174b6b" : "#263746")
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5)
        .text(row[index] ?? "", x + index * columnWidth + 6, y + 7, {
          width: columnWidth - 12,
          height: height - 12,
        });
    }
    y += height;
    document.y = y;
  };
  drawRow(headers, true);
  for (const row of rows) {
    drawRow(row);
  }
  document.x = 72;
  document.y = y + 8;
}
function ensurePdfSpace(document: PDFKit.PDFDocument, height: number) {
  if (document.y + height > 680) addPdfPage(document);
}
function addPdfPage(document: PDFKit.PDFDocument) {
  document.addPage();
  document
    .save()
    .fillColor("#ffffff")
    .rect(0, 0, document.page.width, document.page.height)
    .fill()
    .restore();
  document.x = 72;
  document.y = 72;
}
function columnWidths(count: number) {
  const base = Math.floor(9360 / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 9360 - base * (count - 1) : base,
  );
}
function structuredSection(
  model: ReportDocumentModel,
  type: ReportSectionDefinition["type"],
):
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "list"; items: string[] }
  | null {
  if (type === "table_of_contents")
    return {
      kind: "list",
      items: model.sections
        .filter(
          (section) =>
            section.definition.type !== "cover" &&
            section.definition.type !== "page_break" &&
            section.definition.type !== "table_of_contents",
        )
        .map(
          (section, index) =>
            `${index + 1}. ${section.definition.title ?? titleFor(section.definition.type)}`,
        ),
    };
  if (type === "document_control")
    return {
      kind: "table",
      headers: ["Field", "Value"],
      rows: (model.documentControl ?? []).map((item) => [item.field, item.value]),
    };
  if (type === "severity_ratings")
    return {
      kind: "table",
      headers: ["Severity", "CVSS", "Meaning"],
      rows: (model.severityRatings ?? []).map((item) => [item.severity, item.cvss, item.meaning]),
    };
  if (type === "recommendations")
    return {
      kind: "table",
      headers: ["ID", "Finding", "Severity", "Recommendation"],
      rows: (model.recommendations ?? []).map((item) => [
        item.identifier,
        item.title,
        item.severity,
        item.remediation,
      ]),
    };
  if (type === "glossary")
    return {
      kind: "table",
      headers: ["Term", "Definition"],
      rows: (model.glossary ?? []).map((item) => [item.term, item.definition]),
    };
  if (type === "contacts")
    return {
      kind: "table",
      headers: ["Role", "Name", "Email", "Phone"],
      rows: (model.contacts ?? []).map((item) => [
        item.role,
        item.name,
        item.email ?? "",
        item.phone ?? "",
      ]),
    };
  return null;
}

function titleFor(type: ReportSectionDefinition["type"]) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function bytes(value: string) {
  return new TextEncoder().encode(value);
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
function safeColour(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function safeHex(value: string, fallback: string) {
  return safeColour(value, `#${fallback}`).slice(1).toUpperCase();
}
function safeFont(value: string) {
  return /^[a-zA-Z0-9 ,'-]{1,80}$/.test(value) ? value : "Arial";
}
function sanitiseCss(value: string) {
  return value
    .replace(/[<>]/g, "")
    .replace(/@import/gi, "")
    .replace(/url\s*\(/gi, "blocked(")
    .slice(0, 50_000);
}
