import { Marked } from "marked";

/** Escape raw HTML and image descriptions; the changelog never creates remote resources. */
function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Notes are formatted prose; navigation belongs exclusively to native release actions. */
const markdown = new Marked({
	async: false,
	renderer: {
		html: ({ text }) => escapeHtml(text),
		image: ({ text }) => escapeHtml(text),
		link({ tokens }) {
			return this.parser.parseInline(tokens);
		},
		// A release heading owns h3, so authored note headings start below it.
		heading({ tokens, depth }) {
			const level = Math.min(depth + 3, 6);
			return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`;
		},
	},
});

/** Only parser-authored markup reaches Svelte's HTML boundary. */
export function renderReleaseNotes(notes: string): string {
	return markdown.parse(notes, { async: false });
}
