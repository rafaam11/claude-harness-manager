// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownSafe } from "./markdown";

describe("renderMarkdownSafe", () => {
  it("removes scripts, inline handlers, and dangerous URL schemes", () => {
    const html = renderMarkdownSafe(
      '# Title\n<img src="x" onerror="alert(1)">\n[bad](javascript:alert(1))\n<script>alert(1)</script>',
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript:');
  });

  it("preserves the caller's line-break rendering option", () => {
    expect(renderMarkdownSafe("first\nsecond", { breaks: true })).toContain("<br>");
  });
});
