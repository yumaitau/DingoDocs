"use client";

import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useState } from "react";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToHtml(markdown: string) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inCode = false;
  let code: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet || ordered) {
      const next = bullet ? "ul" : "ol";
      if (inList !== next) {
        closeList();
        html.push(`<${next}>`);
        inList = next;
      }
      html.push(
        `<li>${inlineMarkdown(bullet?.[1] ?? ordered?.[1] ?? "")}</li>`,
      );
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith("> ")) {
      html.push(
        `<blockquote><p>${inlineMarkdown(line.slice(2))}</p></blockquote>`,
      );
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/);
    if (image) {
      const src = safeImageUrl(image[2]);
      if (src) {
        html.push(
          `<img alt="${escapeHtml(image[1])}" src="${escapeHtml(src)}" />`,
        );
        continue;
      }
    }
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode)
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("") || "<p></p>";
}

function safeImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer nofollow">$1</a>',
    );
}

function htmlToMarkdown(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const blocks: string[] = [];

  const walkInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const inner = Array.from(node.childNodes).map(walkInline).join("");
    switch (node.tagName.toLowerCase()) {
      case "strong":
      case "b":
        return `**${inner}**`;
      case "em":
      case "i":
        return `*${inner}*`;
      case "code":
        return node.parentElement?.tagName.toLowerCase() === "pre"
          ? inner
          : `\`${inner}\``;
      case "a": {
        const href = node.getAttribute("href") ?? "";
        return href ? `[${inner}](${href})` : inner;
      }
      case "br":
        return "\n";
      default:
        return inner;
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (!(child instanceof HTMLElement)) {
      const text = child.textContent?.trim();
      if (text) blocks.push(text);
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (tag === "p") {
      blocks.push(walkInline(child));
      continue;
    }
    if (/^h[1-3]$/.test(tag)) {
      const level = Number(tag[1]);
      blocks.push(`${"#".repeat(level)} ${walkInline(child)}`);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      Array.from(child.children).forEach((item, index) => {
        if (!(item instanceof HTMLElement)) return;
        const prefix = tag === "ul" ? "-" : `${index + 1}.`;
        blocks.push(`${prefix} ${walkInline(item)}`);
      });
      continue;
    }
    if (tag === "pre") {
      blocks.push("```", walkInline(child), "```");
      continue;
    }
    if (tag === "blockquote") {
      blocks.push(`> ${walkInline(child)}`);
      continue;
    }
    if (tag === "img") {
      const src = safeImageUrl(child.getAttribute("src") ?? "");
      if (src) blocks.push(`![${child.getAttribute("alt") ?? ""}](${src})`);
      continue;
    }
    const text = walkInline(child).trim();
    if (text) blocks.push(text);
  }

  return blocks.join("\n\n").trim();
}

export function MarkdownField({
  name,
  label,
  defaultValue,
  className,
}: {
  name: string;
  label?: string;
  defaultValue?: string | null;
  className?: string;
}) {
  const id = useId();
  const [markdown, setMarkdown] = useState(defaultValue ?? "");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      }),
    ],
    content: markdownToHtml(defaultValue ?? ""),
    editorProps: {
      attributes: {
        class:
          className ??
          "prose prose-sm max-w-none min-h-24 rounded-md border bg-paper px-3 py-2 outline-none focus:border-[var(--harbour-500)]",
        "aria-label": label ?? name,
        id,
      },
    },
    onUpdate: ({ editor: current }) => {
      setMarkdown(htmlToMarkdown(current.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = defaultValue ?? "";
    const current = htmlToMarkdown(editor.getHTML());
    if (next !== current) {
      editor.commands.setContent(markdownToHtml(next), { emitUpdate: true });
    }
  }, [defaultValue, editor]);

  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      ) : null}
      <div className="flex justify-end">
        <button
          className="text-xs font-medium text-slate-500 hover:text-slate-800"
          type="button"
          onClick={() => {
            if (!editor) return;
            const raw = window.prompt("Screenshot URL (http or https)");
            if (!raw) return;
            const src = safeImageUrl(raw);
            if (!src) return;
            editor
              .chain()
              .focus()
              .insertContent(`<img alt="" src="${escapeHtml(src)}" />`)
              .run();
          }}
        >
          Insert screenshot
        </button>
      </div>
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={markdown} readOnly />
    </div>
  );
}
