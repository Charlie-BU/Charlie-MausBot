import { describe, expect, it } from "vitest";

import {
  PASTE_CHARS,
  PASTE_LINES,
  byteLength,
  composeMessage,
  fileAttachment,
  intakeFiles,
  isAttachment,
  isLongPaste,
  pasteAttachment,
} from "../src/lib/composer-attachments.ts";

describe("composer paste attachments", () => {
  it("classifies long character and line pastes without changing short text", () => {
    expect(isLongPaste("x".repeat(PASTE_CHARS - 1))).toBe(false);
    expect(isLongPaste("x".repeat(PASTE_CHARS))).toBe(true);
    expect(isLongPaste(Array.from({ length: PASTE_LINES }, () => "x").join("\n"))).toBe(true);
  });

  it("measures UTF-8 once and reports a useful summary", () => {
    const attachment = pasteAttachment("héllo\n世界");
    expect(attachment.size).toBe(byteLength(attachment.text));
    expect(attachment.size).toBeGreaterThan(attachment.text.length);
    expect(attachment.lines).toBe(2);
  });

  it("composes attachment-only and mixed messages in a stable order", () => {
    const first = pasteAttachment("first");
    const second = pasteAttachment("second");
    expect(composeMessage("", [first])).toBe(
      '<pasted-text index="1">\nfirst\n</pasted-text>',
    );
    expect(composeMessage("  intro  ", [first, second])).toBe(
      'intro\n\n<pasted-text index="1">\nfirst\n</pasted-text>\n\n' +
        '<pasted-text index="2">\nsecond\n</pasted-text>',
    );
  });

  it("keeps unusual file paths inside the attachment attribute", () => {
    const file = fileAttachment("report.txt", '/tmp/a"&<>\t\n\r.txt', 42);
    expect(composeMessage("", [file])).toBe(
      '<attached-file path="/tmp/a&quot;&amp;&lt;&gt;&#9;&#10;&#13;.txt" name="report.txt" />',
    );
  });

  it("preserves drop order and keeps pathless text files as named uploads", async () => {
    const dropped = [
      { name: "on-disk.md", size: 12, type: "text/markdown", path: "/tmp/on-disk.md" },
      { name: "browser.html", size: 7, type: "text/html", path: "" },
      { name: "missing.bin", size: 10, type: "application/octet-stream", path: "" },
    ];
    const result = await intakeFiles(dropped, {
      allowImages: false,
      getPath: (file) => file.path,
      uploadImage: async () => null,
      uploadFile: async (file, anyType) => anyType && file.name === "browser.html"
        ? fileAttachment(file.name, "/private/file.bin", file.size)
        : null,
    });
    expect(result.attachments).toEqual([
      expect.objectContaining({ kind: "file", name: "on-disk.md", path: "/tmp/on-disk.md" }),
      expect.objectContaining({ kind: "file", name: "browser.html", path: "/private/file.bin" }),
    ]);
    expect(result.problems).toEqual([{ kind: "unsupported", names: ["missing.bin"] }]);
  });

  it("rejects malformed persisted attachments", () => {
    expect(isAttachment({ kind: "paste", id: "a", text: "ok", size: 2, lines: 1 })).toBe(true);
    expect(
      isAttachment({ kind: "file", id: "f", name: "notes.txt", path: "/tmp/notes.txt", size: 2 }),
    ).toBe(true);
    expect(isAttachment({ kind: "paste", id: "a", text: "missing size" })).toBe(false);
    expect(isAttachment({ kind: "file", id: "a", text: "wrong kind", size: 2 })).toBe(false);
    expect(isAttachment({ kind: "file", id: "f", name: "empty", path: "", size: 0 })).toBe(false);
  });
});
