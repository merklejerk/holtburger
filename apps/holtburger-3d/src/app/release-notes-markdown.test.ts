import { expect, it } from "vitest";
import { renderReleaseNotes } from "./release-notes-markdown";

it("formats changelog prose with headings below the release heading", () => {
	const html = renderReleaseNotes(
		"## Changes\n\n- **Fixed** `movement`\n\n> Details",
	);
	expect(html).toContain("<h5>Changes</h5>");
	expect(html).toContain(
		"<li><strong>Fixed</strong> <code>movement</code></li>",
	);
	expect(html).toContain("<blockquote>");
});

it("treats HTML, remote media and navigation as inert prose", () => {
	const html = renderReleaseNotes(
		"<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[**Details**](javascript:alert(1)) ![image](https://example.invalid/image.png) <https://example.invalid>",
	);
	expect(html).not.toMatch(/<(script|img|a)\b/);
	expect(html).not.toContain("href=");
	expect(html).toContain("&lt;script&gt;");
	expect(html).toContain("<strong>Details</strong>");
});
