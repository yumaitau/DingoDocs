// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  markdownEditorExtensions,
  markdownToHtml,
} from "./markdown-field";

const markdown = [
  "## Evidence",
  "Login page accepts **weak** passwords.",
  "![Login screen](https://evidence.example/shot.png)",
  "- First step",
  "- See [advisory](https://example.com/advisory)",
].join("\n\n");

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("MarkdownField conversion", () => {
  it("keeps screenshots through the Tiptap editor round trip", () => {
    editor = new Editor({
      extensions: markdownEditorExtensions(),
      content: markdownToHtml(markdown),
    });
    const html = editor.getHTML();
    expect(html).toContain('src="https://evidence.example/shot.png"');
    expect(htmlToMarkdown(html)).toContain(
      "![Login screen](https://evidence.example/shot.png)",
    );

    // Simulate the first keystroke: content must survive an edit.
    editor.commands.insertContentAt(1, "X");
    expect(htmlToMarkdown(editor.getHTML())).toContain(
      "![Login screen](https://evidence.example/shot.png)",
    );
  });

  it("inserts a screenshot with setImage", () => {
    editor = new Editor({
      extensions: markdownEditorExtensions(),
      content: markdownToHtml("Intro"),
    });
    editor
      .chain()
      .focus("end")
      .setImage({ src: "https://evidence.example/new.png", alt: "" })
      .run();
    expect(htmlToMarkdown(editor.getHTML())).toContain(
      "![](https://evidence.example/new.png)",
    );
  });

  it("registers Link only once", () => {
    const names = markdownEditorExtensions().map((extension) => extension.name);
    editor = new Editor({ extensions: markdownEditorExtensions() });
    const registered = editor.extensionManager.extensions.map(
      (extension) => extension.name,
    );
    expect(names).toContain("image");
    expect(registered.filter((name) => name === "link")).toHaveLength(1);
  });

  it("drops non-http image sources", () => {
    expect(markdownToHtml("![x](javascript:alert(1))")).not.toContain("<img");
  });
});
