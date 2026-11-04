import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const entries = (await readdir(dist, { recursive: true })).filter((entry) =>
	entry.endsWith(".html"),
);
if (entries.length === 0) throw new Error("No built HTML entries found");

for (const entry of entries) {
	const html = await readFile(join(dist, entry), "utf8");
	// Ignore comments so an example or disabled tag cannot satisfy the contract.
	const document = html.replace(/<!--[\s\S]*?-->/g, "");
	const declaration = document.match(
		/<style\s*>\s*@layer\s+base\s*,\s*components\s*,\s*theme\s*,\s*overrides\s*;\s*<\/style>/i,
	);
	if (declaration === null) {
		throw new Error(`${entry}: missing inline CSS layer order declaration`);
	}
	// Scripts can load CSS dynamically; establish priority before those too.
	const preceding = document.slice(0, declaration.index);
	if (
		/<style\b|<script\b|<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(
			preceding,
		)
	) {
		throw new Error(
			`${entry}: CSS layer order must precede styles and scripts`,
		);
	}
}

console.info(
	`Verified CSS layer order in ${entries.length} built HTML entries`,
);
