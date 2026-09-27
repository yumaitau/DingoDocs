"use client";

import { Editor, Element, Frame, useEditor, useNode } from "@craftjs/core";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import type {
  ReportSectionDefinition,
  ReportTemplateDefinition,
} from "@/db/schema";
import { Button } from "@/components/ui/button";
import { professionalPentestTemplate } from "@/lib/reports/professional-template";
import { osaiReportTemplate } from "@/lib/reports/osai-template";
import {
  MAX_IMAGE_LENGTH,
  osaiReadiness,
  safeReportImage,
  sectionTypes,
} from "@/lib/reports/layout";

const field =
  "mt-1 w-full rounded-md border bg-paper px-3 py-2 text-sm text-foreground";
const palette = [
  "prose",
  "code",
  "image",
  "page_break",
  "findings",
  "scope",
  "evidence",
  "table_of_contents",
  "cover",
] as const;
const label = (type: string) =>
  type === "prose"
    ? "Text"
    : type === "code"
      ? "Commands / code"
      : type === "image"
        ? "Screenshot"
        : type.replaceAll("_", " ");

export function ReportLayoutEditor({
  initialDefinition,
  action,
  submitLabel,
  children,
  allowStarters = false,
  customCss = "",
}: {
  initialDefinition: ReportTemplateDefinition;
  action: (data: FormData) => Promise<void | { href: string }>;
  submitLabel: string;
  children?: ReactNode;
  allowStarters?: boolean;
  customCss?: string;
}) {
  const [definition, setDefinition] = useState(initialDefinition);
  const [generation, setGeneration] = useState(0);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const issues = definition.exam
    ? osaiReadiness(definition.sections, definition.exam.osid)
    : [];

  function starter(kind: string) {
    setDefinition(
      kind === "osai"
        ? osaiReportTemplate()
        : kind === "blank"
          ? {
              ...professionalPentestTemplate(),
              sections: [
                {
                  id: "opening",
                  type: "prose",
                  title: "Report introduction",
                  content: "",
                },
              ],
            }
          : professionalPentestTemplate(),
    );
    setGeneration((value) => value + 1);
    setMessage("Starter loaded. Save to keep this layout.");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("definition", JSON.stringify(definition));
        startTransition(async () => {
          setMessage("");
          try {
            const result = await action(data);
            setMessage("Saved successfully.");
            if (result?.href) router.push(result.href);
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not save. Your edits remain in the editor.",
            );
          }
        });
      }}
      className="space-y-5"
      aria-label="Report layout editor"
    >
      {children}
      {allowStarters && (
        <label className="block max-w-sm text-sm font-medium">
          Start from
          <select
            className={field}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) starter(event.target.value);
            }}
          >
            <option value="" disabled>
              Choose a starting layout
            </option>
            <option value="osai">OSAI exam report</option>
            <option value="pentest">Professional penetration test</option>
            <option value="blank">Blank report</option>
          </select>
          <span className="mt-1 block text-xs text-slate-600">
            Choosing a starter replaces unsaved layout edits.
          </span>
        </label>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Branding and page text
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Organisation name
            <input
              className={field}
              value={definition.branding.organisationName ?? ""}
              onChange={(e) =>
                setDefinition((d) => ({
                  ...d,
                  branding: { ...d.branding, organisationName: e.target.value },
                }))
              }
            />
          </label>
          <label className="text-sm">
            Primary colour
            <input
              className={`${field} h-10`}
              type="color"
              value={definition.branding.primaryColour}
              onChange={(e) =>
                setDefinition((d) => ({
                  ...d,
                  branding: { ...d.branding, primaryColour: e.target.value },
                }))
              }
            />
          </label>
          <label className="text-sm">
            Accent colour
            <input
              className={`${field} h-10`}
              type="color"
              value={definition.branding.accentColour}
              onChange={(e) =>
                setDefinition((d) => ({
                  ...d,
                  branding: { ...d.branding, accentColour: e.target.value },
                }))
              }
            />
          </label>
          <label className="text-sm">
            Classification
            <input
              className={field}
              value={definition.classification}
              onChange={(e) =>
                setDefinition((d) => ({ ...d, classification: e.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            Header
            <input
              className={field}
              value={definition.header.left ?? ""}
              onChange={(e) =>
                setDefinition((d) => ({
                  ...d,
                  header: { ...d.header, left: e.target.value },
                }))
              }
            />
          </label>
          <label className="text-sm">
            Footer
            <input
              className={field}
              value={definition.footer.left ?? ""}
              onChange={(e) =>
                setDefinition((d) => ({
                  ...d,
                  footer: { ...d.footer, left: e.target.value },
                }))
              }
            />
          </label>
        </div>
      </details>
      {definition.exam && (
        <fieldset className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-slate-900">
          <legend className="px-2 font-semibold">OSAI candidate details</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["osid", "OSID", "OS-12345"],
                ["candidateName", "Candidate name", ""],
                ["candidateEmail", "Candidate email", ""],
              ] as const
            ).map(([key, title, placeholder]) => (
              <label key={key} className="text-sm">
                {title}
                <input
                  className={field}
                  placeholder={placeholder}
                  type={key === "candidateEmail" ? "email" : "text"}
                  value={definition.exam![key]}
                  onChange={(event) =>
                    setDefinition((d) => ({
                      ...d,
                      exam: { ...d.exam!, [key]: event.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-sm">
            Review every target, screenshot, command, source and AI interaction
            before submission. This checklist cannot verify completeness or
            guarantee a score.
          </p>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
      <Editor
        key={generation}
        resolver={{ ReportCanvas, ReportBlock }}
        onNodesChange={(query) => {
          const nodes = query.getSerializedNodes();
          if (!nodes.ROOT) return;
          const sections = nodes.ROOT.nodes.map((id) => ({
            ...nodes[id].props.section,
            id,
          })) as ReportSectionDefinition[];
          if (sections.length) setDefinition((d) => ({ ...d, sections }));
        }}
      >
        <div className="rounded-xl border bg-muted/40">
          <EditorToolbar />
          <div className="grid min-w-0 gap-4 p-3 xl:grid-cols-[150px_minmax(0,1fr)_240px]">
            <BlockPalette />
            <div
              className="min-w-0 overflow-auto rounded-lg bg-slate-200 p-3"
              style={{ maxHeight: "75vh" }}
              data-testid="report-canvas-scroll"
            >
              <Frame>
                <Element is={ReportCanvas} canvas id="ROOT">
                  {definition.sections.map((section) => (
                    <ReportBlock key={section.id} section={section} />
                  ))}
                </Element>
              </Frame>
            </div>
            <BlockInspector />
          </div>
        </div>
      </Editor>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced print CSS
        </summary>
        <p className="mt-2 text-xs text-slate-600">
          Applies to HTML only. PDF and Word use the report blocks and branding
          settings.
        </p>
        <textarea
          className={`${field} min-h-24 font-mono`}
          aria-label="Advanced print CSS"
          name="customCss"
          defaultValue={customCss}
        />
      </details>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <p role="status" aria-live="polite" className="text-sm">
          {message}
        </p>
      </div>
    </form>
  );
}

function ReportCanvas({ children }: { children?: ReactNode }) {
  const {
    connectors: { connect },
  } = useNode();
  return (
    <div
      ref={(element) => {
        if (element) connect(element);
      }}
      className="mx-auto min-h-[700px] max-w-[820px] space-y-4 bg-white p-6 text-slate-900 shadow-sm"
      data-testid="report-canvas"
    >
      {children}
    </div>
  );
}
ReportCanvas.craft = {
  rules: {
    canMoveIn: (nodes: Array<{ data: { type: unknown } }>) =>
      nodes.every((node) => node.data.type === ReportBlock),
  },
};

function ReportBlock({ section }: { section: ReportSectionDefinition }) {
  const {
    id,
    connectors: { connect, drag },
    selected,
    actions: { setProp },
  } = useNode((node) => ({ selected: node.events.selected }));
  const { actions } = useEditor();
  const image = safeReportImage(section.options?.imageDataUri);
  return (
    <section
      ref={(element) => {
        if (element) connect(element);
      }}
      onClick={() => actions.selectNode(id)}
      className={`group relative rounded border p-4 ${selected ? "border-sky-700 ring-2 ring-sky-100" : "border-transparent hover:border-slate-300"}`}
      data-testid="report-block"
      data-block-title={section.title}
    >
      <button
        ref={(element) => {
          if (element) drag(element);
        }}
        type="button"
        aria-label={`Drag ${section.title || label(section.type)}`}
        className="absolute right-1 top-1 cursor-grab rounded bg-slate-100 p-1 text-slate-700"
      >
        <GripVertical className="size-4" />
      </button>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label(section.type)}
      </p>
      {section.type === "page_break" ? (
        <div className="border-t border-dashed py-3 text-center text-sm text-slate-500">
          Page break
        </div>
      ) : (
        <>
          <h3
            className={`${section.type === "cover" ? "py-8 text-3xl" : "text-lg"} mb-2 pr-5 font-semibold`}
          >
            {section.title || label(section.type)}
          </h3>
          {section.type === "image" ? (
            image ? (
              // Inline evidence stays local; Next image optimisation is unnecessary.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={section.content || "Report screenshot"}
                className="h-auto max-w-full"
              />
            ) : (
              <div className="rounded border border-dashed p-8 text-center text-sm text-slate-600">
                Select this block to upload a screenshot
              </div>
            )
          ) : section.type === "code" ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 font-mono text-xs">
              {section.content || "Add commands or code in the block settings"}
            </pre>
          ) : (
            <div
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label={`Content for ${section.title || label(section.type)}`}
              className="min-h-6 whitespace-pre-wrap text-sm leading-6 outline-none focus:ring-2 focus:ring-sky-200"
              onBlur={(event) => {
                const content = event.currentTarget.innerText;
                if (content !== section.content)
                  setProp((props: { section: ReportSectionDefinition }) => {
                    props.section.content = content;
                  });
              }}
            >
              {section.content}
            </div>
          )}
          {!section.content &&
            !["image", "code", "cover"].includes(section.type) && (
              <p className="text-xs text-slate-500">
                {["prose", "appendix", "executive_summary"].includes(
                  section.type,
                )
                  ? "Click to write, or use block settings."
                  : "Populated from engagement data when the report is created."}
              </p>
            )}
        </>
      )}
    </section>
  );
}

function EditorToolbar() {
  const { actions, undo, redo } = useEditor((_, query) => ({
    undo: query.history.canUndo(),
    redo: query.history.canRedo(),
  }));
  return (
    <div className="flex items-center justify-between gap-3 border-b p-3">
      <h2 className="text-sm font-medium">
        Drag blocks to arrange your report
      </h2>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!undo}
          onClick={() => actions.history.undo()}
        >
          <Undo2 className="size-4" />
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!redo}
          onClick={() => actions.history.redo()}
        >
          <Redo2 className="size-4" />
          Redo
        </Button>
      </div>
    </div>
  );
}

function BlockPalette() {
  const { connectors, actions, query } = useEditor();
  function element(type: ReportSectionDefinition["type"]) {
    return (
      <ReportBlock
        section={{
          id: crypto.randomUUID(),
          type,
          title: label(type),
          content: "",
        }}
      />
    );
  }
  return (
    <aside aria-label="Report blocks" className="space-y-2">
      <h3 className="mb-3 text-xs font-semibold uppercase text-slate-600">
        Add a block
      </h3>
      {palette.map((type) => (
        <button
          key={type}
          type="button"
          ref={(node) => {
            if (node) connectors.create(node, element(type));
          }}
          onClick={() =>
            actions.addNodeTree(
              query.parseReactElement(element(type)).toNodeTree(),
              "ROOT",
            )
          }
          className="flex w-full cursor-grab items-center gap-2 rounded-md border bg-paper px-3 py-2 text-left text-sm capitalize hover:border-sky-600"
        >
          <Plus className="size-3" />
          {label(type)}
        </button>
      ))}
      <p className="pt-2 text-xs leading-5 text-slate-600">
        Drag onto the page or click to append. Select a block to edit,
        duplicate, or move with buttons.
      </p>
    </aside>
  );
}

function BlockInspector() {
  const { actions, query, selectedId, section, order } = useEditor((state) => {
    const selectedId = [...state.events.selected][0];
    return {
      selectedId,
      section: selectedId
        ? (state.nodes[selectedId]?.data.props.section as
            ReportSectionDefinition | undefined)
        : undefined,
      order: state.nodes.ROOT?.data.nodes ?? [],
    };
  });
  const [error, setError] = useState("");
  if (!section || !selectedId)
    return (
      <aside className="p-2 text-sm text-slate-600">
        Select a report block to edit its content and settings.
      </aside>
    );
  const index = order.indexOf(selectedId);
  function update(change: Partial<ReportSectionDefinition>) {
    actions.setProp(
      selectedId,
      (props: { section: ReportSectionDefinition }) => {
        props.section = { ...props.section, ...change };
      },
    );
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 2_000_000
    ) {
      setError("Choose a PNG or JPEG screenshot under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Could not read this image.");
    reader.onload = () => {
      const imageDataUri = String(reader.result);
      if (
        imageDataUri.length > MAX_IMAGE_LENGTH ||
        !safeReportImage(imageDataUri)
      )
        setError("Invalid PNG or JPEG image.");
      else update({ options: { ...section!.options, imageDataUri } });
    };
    reader.readAsDataURL(file);
  }
  return (
    <aside className="space-y-3" aria-label="Block settings">
      <h3 className="text-xs font-semibold uppercase text-slate-600">
        Block settings
      </h3>
      <label className="block text-sm">
        Block title
        <input
          className={field}
          value={section.title ?? ""}
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        Block type
        <select
          className={field}
          value={section.type}
          onChange={(e) =>
            update({ type: e.target.value as ReportSectionDefinition["type"] })
          }
        >
          {sectionTypes.map((type) => (
            <option key={type} value={type}>
              {label(type)}
            </option>
          ))}
        </select>
      </label>
      {section.type !== "page_break" && (
        <label className="block text-sm">
          {section.type === "image" ? "Screenshot caption" : "Block content"}
          <textarea
            aria-label={
              section.type === "image" ? "Screenshot caption" : "Block content"
            }
            className={`${field} min-h-48 ${section.type === "code" ? "font-mono text-xs" : ""}`}
            value={section.content ?? ""}
            onChange={(e) => update({ content: e.target.value })}
          />
        </label>
      )}
      {section.type === "reusable_content" && (
        <label className="block text-sm">
          Reusable content key
          <input
            className={field}
            value={section.reusableKey ?? ""}
            onChange={(e) => update({ reusableKey: e.target.value })}
          />
        </label>
      )}
      {section.type === "image" && (
        <>
          <label className="block text-sm">
            Upload screenshot
            <input
              className={`${field} text-xs`}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          <p className="text-xs text-slate-600">
            PNG or JPEG, under 2 MB. Use readable crops; add more blocks for
            each attack stage.
          </p>
          {section.options?.imageDataUri && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                update({ options: { ...section.options, imageDataUri: "" } })
              }
            >
              Remove image
            </Button>
          )}
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={section.options?.pageBreakBefore === true}
          onChange={(e) =>
            update({
              options: {
                ...section.options,
                pageBreakBefore: e.target.checked,
              },
            })
          }
        />
        Start on new page
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Move block up"
          disabled={index <= 0}
          onClick={() => actions.move(selectedId, "ROOT", index - 1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Move block down"
          disabled={index >= order.length - 1}
          onClick={() => actions.move(selectedId, "ROOT", index + 2)}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Duplicate block"
          onClick={() =>
            actions.addNodeTree(
              query
                .parseReactElement(
                  <ReportBlock
                    section={{ ...section, id: crypto.randomUUID() }}
                  />,
                )
                .toNodeTree(),
              "ROOT",
            )
          }
        >
          <Copy className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Delete block"
          disabled={order.length <= 1}
          onClick={() => actions.delete(selectedId)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
