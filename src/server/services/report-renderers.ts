import { readFile } from "node:fs/promises";
import { join } from "node:path";
import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
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
import sharp from "sharp";
import { safeReportImage } from "@/lib/reports/layout";
import {
  blocksForSection,
  findingFieldBlocks,
  riskMatrixTable,
  severityChartRows,
} from "@/lib/reports/document-blocks";
import { createStoredZip } from "@/lib/reports/office-zip";
import type {
  ReportExam,
  ReportFormat,
  ReportSectionDefinition,
  RiskMatrixDefinition,
} from "@/db/schema";
import { logoBytes } from "@/lib/reports/branding";

export type ReportFindingModel = {
  identifier: string;
  title: string;
  severity: string;
  status: string;
  executiveSummary?: string | null;
  technicalDetail?: string | null;
  reproductionSteps?: string | null;
  proofOfConcept?: string | null;
  businessImpact?: string | null;
  technicalImpact?: string | null;
  remediation?: string | null;
  references?: string[];
  mappings?: Array<{ framework: string; reference: string; title?: string }>;
  affectedAssets?: string[];
  cwe?: string | null;
  owasp?: string | null;
  attackTechniques?: string[];
  cve?: string | null;
  epssScore?: string | null;
  kev?: boolean;
  complianceTags?: string[];
  cvssVector?: string | null;
  cvssScore?: string | null;
};

export type ReportDocumentModel = {
  exam?: ReportExam;
  editRevision?: string;
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
  riskMatrix?: RiskMatrixDefinition;
  theme: {
    primaryColour: string;
    accentColour: string;
    bodyFont: string;
    headingFont: string;
    bodySize: number;
    pageSize?: "A4" | "LETTER";
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
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const PAGE_SIZES = {
  LETTER: { name: "LETTER" as const, width: 612, height: 792 },
  A4: { name: "A4" as const, width: 595.28, height: 841.89 },
};
const DOCX_PAGE_SIZES = {
  LETTER: { width: 12240, height: 15840 },
  A4: { width: 11906, height: 16838 },
};

export async function renderReport(
  model: ReportDocumentModel,
  format: ReportFormat,
) {
  if (format === "pdf") return renderReportPdf(model);
  if (format === "docx") return renderReportDocx(model);
  if (format === "html") return bytes(renderReportHtml(model));
  if (format === "markdown") return bytes(renderReportMarkdown(model));
  if (format === "xlsx") return renderReportXlsx(model);
  if (format === "pptx") return renderReportPptx(model);
  return bytes(JSON.stringify(model, null, 2));
}

export function renderReportHtml(model: ReportDocumentModel) {
  const primary = safeColour(model.theme.primaryColour, "#174b6b");
  const accent = safeColour(model.theme.accentColour, "#d59b2d");
  const sections = model.sections
    .map(({ definition, content }) =>
      renderHtmlSection(model, definition, content),
    )
    .join("\n");
  const customCss = sanitiseCss(model.theme.customCss ?? "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.title)}</title><style>
:root{--primary:${primary};--accent:${accent}}*{box-sizing:border-box}body{margin:0;color:#17202a;background:#eef2f5;font-family:${safeFont(model.theme.bodyFont)},Arial,sans-serif;font-size:${model.theme.bodySize}px;line-height:1.55}.report{width:min(900px,100%);margin:0 auto;background:white;min-height:100vh;padding:64px 72px}.cover{min-height:780px;display:flex;flex-direction:column;justify-content:center;border-top:8px solid var(--primary)}.kicker{color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.12em}.cover h1{font:700 44px/1.12 ${safeFont(model.theme.headingFont)},Arial,sans-serif;color:var(--primary);margin:16px 0}.meta{color:#53616d}.classification{margin-top:auto;border:1px solid #cbd5dc;padding:10px;text-align:center;font-weight:700}.logo{max-height:56px;margin-bottom:18px}.toc{padding-left:20px}.section{padding:32px 0;border-top:1px solid #dce3e8}.section.page-break{break-before:page}.section h2{font:700 26px/1.2 ${safeFont(model.theme.headingFont)},Arial,sans-serif;color:var(--primary)}.finding{margin:24px 0;padding:20px;border-left:5px solid var(--accent);background:#f7f9fa}.severity{display:inline-block;border-radius:999px;padding:3px 9px;background:#e8eef2;font-size:12px;font-weight:700;text-transform:uppercase}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #cbd5dc;padding:10px;text-align:left;vertical-align:top}th{background:#eef3f6;color:var(--primary)}.chart{margin:16px 0}.chart svg{max-width:100%;height:auto}.watermark{position:fixed;inset:45% 0 auto;transform:rotate(-28deg);text-align:center;font-size:70px;font-weight:700;color:rgba(80,90,100,.08);pointer-events:none}.signatures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px;margin-top:50px}.signature{border-top:1px solid #475569;padding-top:8px}${customCss}
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
  if (model.exam)
    output.push(
      `**Candidate:** ${model.exam.candidateName} | ${model.exam.candidateEmail} | ${model.exam.osid}`,
      "",
    );
  for (const { definition, content } of model.sections) {
    if (definition.type === "page_break") {
      output.push("---", "");
      continue;
    }
    if (definition.type === "cover") continue;
    output.push(`## ${definition.title ?? titleFor(definition.type)}`, "");
    if (definition.type === "code") {
      const fence = "`".repeat(
        Math.max(
          3,
          ...((content ?? "").match(/`+/g) ?? []).map((run) => run.length + 1),
        ),
      );
      output.push(fence, content ?? "", fence, "");
    } else if (content) output.push(content, "");
    if (definition.type === "image") {
      const image = safeReportImage(definition.options?.imageDataUri);
      if (image) output.push(`![Screenshot](${image})`, "");
    }
    if (definition.type === "findings")
      for (const finding of model.findings) {
        output.push(
          `### ${finding.identifier}: ${finding.title}`,
          "",
          `**Severity:** ${finding.severity}${finding.cvssScore ? ` | **CVSS:** ${finding.cvssScore}` : ""}${finding.cvssVector ? ` | ${finding.cvssVector}` : ""}`,
          "",
          finding.executiveSummary ?? "",
          "",
        );
        for (const field of findingFieldBlocks(finding)) {
          output.push(`#### ${field.label}`, field.text || "", "");
        }
      }
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
    if (definition.type === "chart" || definition.type === "risk_matrix") {
      output.push(
        ...markdownTable(
          ["Severity", "Findings"],
          severityChartRows(model.severityCounts),
        ),
      );
      if (definition.type === "risk_matrix" && model.riskMatrix) {
        const matrix = riskMatrixTable(model.riskMatrix);
        output.push(...markdownTable(matrix.headers, matrix.rows));
      }
    }
    const extra = structuredSection(model, definition.type);
    if (extra?.kind === "table")
      output.push(...markdownTable(extra.headers, extra.rows));
    if (extra?.kind === "list")
      output.push(...extra.items.map((item) => item), "");
  }
  if (model.signatures.length) {
    output.push("## Approvals and signatures", "");
    for (const signature of model.signatures)
      output.push(
        `____________________  ${signature.label} - ${signature.role}`,
        "",
      );
  }
  return output.join("\n");
}

async function renderReportPdf(model: ReportDocumentModel) {
  const pageKey = model.theme.pageSize === "A4" ? "A4" : "LETTER";
  const page = PAGE_SIZES[pageKey];
  const document = new PDFDocument({
    size: page.name,
    margins: { top: 72, right: 72, bottom: 90, left: 72 },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: model.title,
      Author: model.organisationName,
      Subject: model.engagementName,
    },
  });
  const monoBytes = await readFile(
    join(process.cwd(), "public/fonts/NotoSansMono-Regular.ttf"),
  );
  document.registerFont("ReportCode", monoBytes);
  document.registerFont("Noto Sans Mono", monoBytes);
  const bodyFont = resolvePdfFont(model.theme.bodyFont, false);
  const headingFont = resolvePdfFont(model.theme.headingFont, true);
  const bodyFontRegular = resolvePdfFont(model.theme.bodyFont, false);
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const primary = safeColour(model.theme.primaryColour, "#174b6b");
  const accent = safeColour(model.theme.accentColour, "#d59b2d");
  const contentWidth = page.width - 144;
  const footerY = page.height - 82;
  addPdfPage(document, page);
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
      addPdfPage(document, page);
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
        .font(headingFont)
        .fontSize(11)
        .text(model.organisationName.toUpperCase(), { characterSpacing: 1.5 });
      if (model.tagline)
        document
          .moveDown(0.4)
          .fillColor("#52606d")
          .font(bodyFontRegular)
          .fontSize(11)
          .text(model.tagline);
      document
        .moveDown()
        .fillColor(primary)
        .font(headingFont)
        .fontSize(30)
        .text(model.title);
      document
        .moveDown()
        .fillColor("#52606d")
        .font(bodyFontRegular)
        .fontSize(14)
        .text(`${model.clientName} | ${model.engagementReference}`);
      if (model.exam)
        document
          .moveDown()
          .fontSize(12)
          .text(
            [
              model.exam.candidateName,
              model.exam.candidateEmail,
              model.exam.osid,
            ]
              .filter(Boolean)
              .join("\n"),
          );
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
        .lineTo(72 + contentWidth, document.y)
        .stroke();
      document
        .moveDown()
        .fillColor("#263746")
        .font(headingFont)
        .fontSize(10)
        .text(model.classification.toUpperCase(), { align: "center" });
      continue;
    }
    if (definition.type === "page_break") continue;
    ensurePdfSpace(document, 90, page);
    document
      .moveDown()
      .fillColor(primary)
      .font(headingFont)
      .fontSize(19)
      .text(definition.title ?? titleFor(definition.type));
    document
      .moveDown(0.5)
      .fillColor("#263746")
      .font(bodyFont)
      .fontSize(model.theme.bodySize);
    if (definition.type === "code") {
      document
        .font("ReportCode")
        .fontSize(9)
        .text(content ?? "", {
          paragraphGap: 0,
          lineGap: 2,
        });
      document.font(bodyFont).fontSize(model.theme.bodySize);
    } else if (definition.type === "image") {
      const image = await reportImage(definition.options?.imageDataUri);
      if (image) {
        const scale = Math.min(contentWidth / image.width, 430 / image.height, 1);
        const height = image.height * scale;
        ensurePdfSpace(document, height + 40, page);
        const y = document.y;
        document.image(image.bytes, 72, y, {
          width: image.width * scale,
          height,
        });
        document.y = y + height + 10;
      }
      if (content) document.text(content, { paragraphGap: 8 });
    } else if (content) document.text(content, { paragraphGap: 8 });
    renderPdfDataSection(
      document,
      model,
      definition.type,
      primary,
      accent,
      bodyFont,
      headingFont,
      page,
    );
  }
  if (model.signatures.length) {
    addPdfPage(document, page);
    document
      .fillColor(primary)
      .font(headingFont)
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
        .font(bodyFont)
        .fontSize(10)
        .text(`${signature.label} - ${signature.role}`);
  }
  const range = document.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex++) {
    document.switchToPage(pageIndex);
    // Footer coordinates lie outside the reserved body area. Do not let
    // PDFKit paginate these fixed-position labels onto extra blank pages.
    document.page.margins.bottom = 0;
    if (model.theme.watermark)
      document
        .save()
        .fillColor("#93a1ad")
        .opacity(0.08)
        .font(headingFont)
        .fontSize(54)
        .rotate(-28, { origin: [page.width / 2, page.height / 2] })
        .text(model.theme.watermark, 80, page.height / 2 - 30, {
          width: page.width - 160,
          align: "center",
        })
        .restore();
    document
      .opacity(1)
      .fillColor("#64748b")
      .font(bodyFont)
      .fontSize(8)
      .text(model.theme.headerLeft ?? model.organisationName, 72, 34, {
        width: contentWidth / 2,
        lineBreak: false,
      });
    document.text(model.theme.headerRight ?? model.classification, 72 + contentWidth / 2, 34, {
      width: contentWidth / 2,
      align: "right",
      lineBreak: false,
    });
    document.text(
      model.theme.footerLeft ?? model.engagementReference,
      72,
      footerY,
      {
        width: contentWidth / 2,
        lineBreak: false,
      },
    );
    if (model.theme.showPageNumbers)
      document.text(`Page ${pageIndex + 1} of ${range.count}`, 72 + contentWidth / 2, footerY, {
        width: contentWidth / 2,
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
      if (model.exam)
        children.push(
          new Paragraph({
            text: [
              model.exam.candidateName,
              model.exam.candidateEmail,
              model.exam.osid,
            ]
              .filter(Boolean)
              .join(" | "),
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
    if (definition.type === "code") {
      for (const line of (content ?? "").split("\n"))
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: line || " ", font: "Courier New", size: 18 }),
            ],
            spacing: { after: 0, line: 240 },
          }),
        );
    } else if (definition.type === "image") {
      const image = await reportImage(definition.options?.imageDataUri);
      if (image) {
        const scale = Math.min(600 / image.width, 550 / image.height, 1);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: image.type,
                data: image.bytes,
                transformation: {
                  width: Math.round(image.width * scale),
                  height: Math.round(image.height * scale),
                },
                altText: {
                  title: definition.title ?? "Screenshot",
                  description: content ?? "Report evidence",
                  name: definition.id,
                },
              }),
            ],
          }),
        );
      }
      if (content) children.push(new Paragraph({ text: content }));
    } else if (content) children.push(new Paragraph({ text: content }));
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
            size: DOCX_PAGE_SIZES[model.theme.pageSize === "A4" ? "A4" : "LETTER"],
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
  const primary = safeColour(model.theme.primaryColour, "#174b6b");
  if (definition.type === "cover")
    return `<section class="cover">${model.logoDataUri ? `<img class="logo" alt="" src="${escapeHtml(model.logoDataUri)}">` : ""}<p class="kicker">${escapeHtml(model.organisationName)}</p>${model.tagline ? `<p class="meta">${escapeHtml(model.tagline)}</p>` : ""}<h1>${escapeHtml(model.title)}</h1><p class="meta">${escapeHtml(model.clientName)} | ${escapeHtml(model.engagementReference)}</p>${model.startDate || model.endDate ? `<p class="meta">Testing window: ${escapeHtml(model.startDate ?? "not recorded")} – ${escapeHtml(model.endDate ?? "not recorded")}</p>` : ""}${model.exam ? `<p>${escapeHtml(model.exam.candidateName)}<br>${escapeHtml(model.exam.candidateEmail)}<br>${escapeHtml(model.exam.osid)}</p>` : ""}<p class="classification">${escapeHtml(model.classification)}</p></section>`;
  if (definition.type === "page_break")
    return `<div class="section page-break"></div>`;
  let body = content
    ? `<p>${escapeHtml(content).replaceAll("\n", "<br>")}</p>`
    : "";
  if (definition.type === "code")
    body = `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f1f5f9;font:12px/1.5 monospace"><code>${escapeHtml(content ?? "")}</code></pre>`;
  if (definition.type === "image") {
    const uri = safeReportImage(definition.options?.imageDataUri);
    body = `<figure>${uri ? `<img alt="${escapeHtml(content ?? definition.title ?? "Screenshot")}" src="${uri}" style="max-width:100%;height:auto">` : ""}<figcaption>${escapeHtml(content ?? "")}</figcaption></figure>`;
  }
  if (definition.type === "findings")
    body += blocksForSection(model, "findings")
      .map((block) => {
        if (block.kind !== "finding") return "";
        const finding = block.finding;
        const fields = findingFieldBlocks(finding)
          .map(
            (field) =>
              `<h4>${escapeHtml(field.label)}</h4><p>${escapeHtml(field.text).replaceAll("\n", "<br>")}</p>`,
          )
          .join("");
        return `<article class="finding"><span class="severity">${escapeHtml(finding.severity)}</span><h3>${escapeHtml(finding.identifier)}: ${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.executiveSummary ?? "")}</p>${fields}${finding.cvssScore || finding.cvssVector ? `<p><strong>CVSS:</strong> ${escapeHtml(finding.cvssScore ?? "")} ${escapeHtml(finding.cvssVector ?? "")}</p>` : ""}</article>`;
      })
      .join("");
  if (definition.type === "scope")
    body += htmlTable(
      ["Name", "Value", "Status"],
      model.scope.map((item) => [item.name, item.value, item.status]),
    );
  if (definition.type === "assets")
    body += htmlTable(
      ["Asset", "Type", "Identifier", "Criticality"],
      model.assets.map((item) => [
        item.name,
        item.type,
        item.identifier,
        item.criticality ?? "",
      ]),
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
    body += htmlSeverityChart(model.severityCounts, primary);
  if (definition.type === "risk_matrix") {
    body += htmlSeverityChart(model.severityCounts, primary);
    body += htmlTable(
      ["Severity", "Findings"],
      severityChartRows(model.severityCounts),
    );
    if (model.riskMatrix) {
      const matrix = riskMatrixTable(model.riskMatrix);
      body += htmlTable(matrix.headers, matrix.rows);
    }
  }
  const extra = structuredSection(model, definition.type);
  if (extra?.kind === "table") body += htmlTable(extra.headers, extra.rows);
  if (extra?.kind === "list")
    body += `<ol class="toc">${extra.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
  return `<section class="section${definition.options?.pageBreakBefore === true ? " page-break" : ""}"><h2>${escapeHtml(definition.title ?? titleFor(definition.type))}</h2>${body}</section>`;
}

function renderPdfDataSection(
  document: PDFKit.PDFDocument,
  model: ReportDocumentModel,
  type: ReportSectionDefinition["type"],
  primary: string,
  accent: string,
  bodyFont: string,
  headingFont: string,
  page: (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES],
) {
  if (type === "findings")
    for (const block of blocksForSection(model, "findings")) {
      if (block.kind !== "finding") continue;
      const finding = block.finding;
      ensurePdfSpace(document, 170, page);
      document
        .moveDown()
        .fillColor(accent)
        .font(headingFont)
        .fontSize(9)
        .text(finding.severity.toUpperCase());
      document
        .fillColor(primary)
        .fontSize(13)
        .text(`${finding.identifier}: ${finding.title}`);
      document
        .fillColor("#263746")
        .font(bodyFont)
        .fontSize(10)
        .text(finding.executiveSummary ?? "", { paragraphGap: 5 });
      if (finding.cvssScore || finding.cvssVector)
        document
          .font(headingFont)
          .text("CVSS")
          .font(bodyFont)
          .text(
            [finding.cvssScore, finding.cvssVector].filter(Boolean).join(" "),
          );
      for (const field of findingFieldBlocks(finding)) {
        document
          .moveDown(0.3)
          .font(headingFont)
          .text(field.label)
          .font(bodyFont)
          .text(field.text || "");
      }
    }
  if (type === "scope")
    pdfRows(
      document,
      ["Name", "Value", "Status"],
      model.scope.map((item) => [item.name, item.value, item.status]),
      page,
    );
  if (type === "assets")
    pdfRows(
      document,
      ["Asset", "Type", "Identifier"],
      model.assets.map((item) => [item.name, item.type, item.identifier]),
      page,
    );
  if (type === "evidence")
    pdfRows(
      document,
      ["File", "Type", "Classification"],
      model.evidence.map((item) => [
        item.filename,
        item.mediaType,
        item.classification,
      ]),
      page,
    );
  if (type === "chart" || type === "risk_matrix") {
    drawPdfSeverityChart(document, model.severityCounts, primary, page);
    pdfRows(
      document,
      ["Severity", "Findings"],
      severityChartRows(model.severityCounts),
      page,
    );
    if (type === "risk_matrix" && model.riskMatrix) {
      const matrix = riskMatrixTable(model.riskMatrix);
      pdfRows(document, matrix.headers, matrix.rows, page);
    }
  }
  const extra = structuredSection(model, type);
  if (extra?.kind === "table")
    pdfRows(document, extra.headers, extra.rows, page);
  if (extra?.kind === "list")
    for (const item of extra.items)
      document.moveDown(0.2).font(bodyFont).fontSize(10.5).text(item);
}

function docxDataSection(
  model: ReportDocumentModel,
  type: ReportSectionDefinition["type"],
  primary: string,
): Array<Paragraph | Table> {
  if (type === "findings")
    return blocksForSection(model, "findings").flatMap((block) => {
      if (block.kind !== "finding") return [];
      const finding = block.finding;
      const nodes: Array<Paragraph | Table> = [
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
            new TextRun({
              text: finding.cvssVector ? ` ${finding.cvssVector}` : "",
            }),
          ],
        }),
        new Paragraph({ text: finding.executiveSummary ?? "" }),
      ];
      for (const field of findingFieldBlocks(finding)) {
        nodes.push(
          new Paragraph({
            children: [new TextRun({ text: field.label, bold: true })],
          }),
          new Paragraph({ text: field.text || "" }),
        );
      }
      return nodes;
    });
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
        model.assets.map((item) => [
          item.name,
          item.type,
          item.identifier,
          item.criticality ?? "",
        ]),
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
  if (type === "chart" || type === "risk_matrix") {
    const nodes: Array<Paragraph | Table> = [
      docxSeverityBars(model.severityCounts, primary),
      docxTable(
        ["Severity", "Findings"],
        severityChartRows(model.severityCounts),
        primary,
      ),
    ];
    if (type === "risk_matrix" && model.riskMatrix) {
      const matrix = riskMatrixTable(model.riskMatrix);
      nodes.push(docxTable(matrix.headers, matrix.rows, primary));
    }
    return nodes;
  }
  const extra = structuredSection(model, type);
  if (extra?.kind === "table")
    return [docxTable(extra.headers, extra.rows, primary)];
  if (extra?.kind === "list")
    return extra.items.map((item) => new Paragraph({ text: item }));
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
                  children: [
                    new TextRun({ text: header, bold: true, color: primary }),
                  ],
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
    ...rows.map(
      (row) =>
        `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`,
    ),
    "",
  ];
}
function pdfRows(
  document: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  page: (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES] = PAGE_SIZES.LETTER,
) {
  const x = 72;
  const width = page.width - 144;
  const columnWidth = width / headers.length;
  let y = document.y + 8;
  const drawRow = (row: string[], header = false) => {
    const longest = Math.max(...row.map((cell) => cell.length));
    const approximateLines = Math.max(
      1,
      Math.ceil(longest / Math.max(12, Math.floor(columnWidth / 5.5))),
    );
    const height = Math.max(28, 14 + approximateLines * 12);
    ensurePdfSpace(document, height + 8, page);
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
function ensurePdfSpace(
  document: PDFKit.PDFDocument,
  height: number,
  page: (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES] = PAGE_SIZES.LETTER,
) {
  if (document.y + height > page.height - 112) addPdfPage(document, page);
}
function addPdfPage(
  document: PDFKit.PDFDocument,
  page: (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES] = PAGE_SIZES.LETTER,
) {
  document.addPage({ size: page.name });
  document
    .save()
    .fillColor("#ffffff")
    .rect(0, 0, document.page.width, document.page.height)
    .fill()
    .restore();
  document.x = 72;
  document.y = 72;
}

function resolvePdfFont(requested: string, bold: boolean) {
  const name = requested.trim();
  if (/^noto\s*sans\s*mono$/i.test(name) || name === "ReportCode")
    return "Noto Sans Mono";
  return bold ? "Helvetica-Bold" : "Helvetica";
}

function htmlSeverityChart(counts: Record<string, number>, primary: string) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const width = Math.max(320, entries.length * 72);
  const height = 180;
  const chartHeight = 130;
  const bars = entries
    .map(([label, value], index) => {
      const barHeight = Math.max(4, (value / max) * chartHeight);
      const x = 40 + index * 72;
      const y = 20 + chartHeight - barHeight;
      return `<rect x="${x}" y="${y}" width="44" height="${barHeight}" fill="${escapeHtml(primary)}"/><text x="${x + 22}" y="${y - 6}" text-anchor="middle" font-size="12" fill="#17202a">${value}</text><text x="${x + 22}" y="${20 + chartHeight + 18}" text-anchor="middle" font-size="11" fill="#53616d">${escapeHtml(label)}</text>`;
    })
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Severity chart">${bars}</svg></div>`;
}

function drawPdfSeverityChart(
  document: PDFKit.PDFDocument,
  counts: Record<string, number>,
  primary: string,
  page: (typeof PAGE_SIZES)[keyof typeof PAGE_SIZES],
) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const chartHeight = 120;
  ensurePdfSpace(document, chartHeight + 50, page);
  const baseY = document.y + chartHeight + 10;
  const startX = 72;
  entries.forEach(([label, value], index) => {
    const barHeight = Math.max(4, (value / max) * chartHeight);
    const x = startX + index * 72;
    const y = baseY - barHeight;
    document
      .save()
      .fillColor(primary)
      .rect(x, y, 44, barHeight)
      .fill()
      .restore()
      .fillColor("#263746")
      .fontSize(9)
      .text(String(value), x, y - 14, { width: 44, align: "center" })
      .fillColor("#53616d")
      .text(label, x, baseY + 6, { width: 44, align: "center" });
  });
  document.y = baseY + 28;
  document.x = 72;
}

function docxSeverityBars(counts: Record<string, number>, primary: string) {
  const max = Math.max(1, ...Object.values(counts));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2340, 7020],
    rows: Object.entries(counts).map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 2340, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${label}: ${value}`,
                      bold: true,
                      color: primary,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 7020, type: WidthType.DXA },
              shading: {
                type: ShadingType.CLEAR,
                fill: "EEF3F6",
                color: "auto",
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "█".repeat(Math.max(1, Math.round((value / max) * 20))),
                      color: primary,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

function renderReportXlsx(model: ReportDocumentModel) {
  const headers = [
    "Identifier",
    "Title",
    "Severity",
    "Status",
    "Executive summary",
    "Technical detail",
    "Reproduction steps",
    "Proof of concept",
    "Business impact",
    "Technical impact",
    "Remediation",
    "References",
    "Mappings",
    "Affected assets",
    "CWE",
    "OWASP",
    "Attack techniques",
    "CVE",
    "EPSS",
    "KEV",
    "Compliance tags",
    "CVSS score",
    "CVSS vector",
  ];
  const rows = model.findings.map((finding) => [
    finding.identifier,
    finding.title,
    finding.severity,
    finding.status,
    finding.executiveSummary ?? "",
    finding.technicalDetail ?? "",
    finding.reproductionSteps ?? "",
    finding.proofOfConcept ?? "",
    finding.businessImpact ?? "",
    finding.technicalImpact ?? "",
    finding.remediation ?? "",
    (finding.references ?? []).join("; "),
    (finding.mappings ?? [])
      .map((item) =>
        [item.framework, item.reference, item.title].filter(Boolean).join(" "),
      )
      .join("; "),
    (finding.affectedAssets ?? []).join("; "),
    finding.cwe ?? "",
    finding.owasp ?? "",
    (finding.attackTechniques ?? []).join("; "),
    finding.cve ?? "",
    finding.epssScore ?? "",
    finding.kev === true ? "Yes" : finding.kev === false ? "No" : "",
    (finding.complianceTags ?? []).join("; "),
    finding.cvssScore ?? "",
    finding.cvssVector ?? "",
  ]);
  const sheetRows = [headers, ...rows]
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, columnIndex) => {
            const ref = `${xlsxColumn(columnIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  return createStoredZip([
    {
      path: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      path: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Findings" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { path: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

function renderReportPptx(model: ReportDocumentModel) {
  const buckets = Object.entries(model.severityCounts);
  const slides = [
    pptxSlide(
      1,
      model.title,
      `${model.clientName} · ${model.engagementReference}\n${model.classification}`,
    ),
    ...buckets.map(([severity, count], index) =>
      pptxSlide(
        index + 2,
        `${severity} findings`,
        `${count} finding(s)\n\n${model.findings
          .filter((finding) => finding.severity === severity)
          .map((finding) => `${finding.identifier}: ${finding.title}`)
          .join("\n") || "None"}`,
      ),
    ),
  ];
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldIdLst>${slides
    .map(
      (_, index) =>
        `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`,
    )
    .join("")}</p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;
  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${slides
  .map(
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
  )
  .join("")}
</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${slides
  .map(
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  )
  .join("")}
</Types>`;
  return createStoredZip([
    { path: "[Content_Types].xml", data: contentTypes },
    {
      path: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    },
    { path: "ppt/presentation.xml", data: presentation },
    { path: "ppt/_rels/presentation.xml.rels", data: presentationRels },
    ...slides.map((slide, index) => ({
      path: `ppt/slides/slide${index + 1}.xml`,
      data: slide,
    })),
  ]);
}

function pptxSlide(index: number, title: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="914400"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="1371600"/><a:ext cx="8229600" cy="4572000"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>${body
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(line || " ")}</a:t></a:r></a:p>`,
    )
    .join("")}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
}

function xlsxColumn(index: number) {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
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
      rows: (model.documentControl ?? []).map((item) => [
        item.field,
        item.value,
      ]),
    };
  if (type === "severity_ratings")
    return {
      kind: "table",
      headers: ["Severity", "CVSS", "Meaning"],
      rows: (model.severityRatings ?? []).map((item) => [
        item.severity,
        item.cvss,
        item.meaning,
      ]),
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
  return type
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function bytes(value: string) {
  return new TextEncoder().encode(value);
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
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
    .replace(/[<>\\]/g, "")
    .replace(/@/g, "")
    .replace(/url\s*\(/gi, "blocked(")
    .replace(/expression/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/behavior/gi, "")
    .replace(/-moz-binding/gi, "")
    .slice(0, 50_000);
}

async function reportImage(value: unknown) {
  const uri = safeReportImage(value);
  if (!uri) return undefined;
  const bytes = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  const metadata = await sharp(bytes, {
    limitInputPixels: 16_000_000,
  }).metadata();
  if (!metadata.width || !metadata.height)
    throw new Error("Screenshot dimensions could not be read");
  return {
    bytes,
    width: metadata.width,
    height: metadata.height,
    type: (metadata.format === "jpeg" ? "jpg" : "png") as "jpg" | "png",
  };
}
