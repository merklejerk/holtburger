import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_EXTENSIONS = [".ts", ".svelte"] as const;
const PROHIBITED_ACTIVE_SOURCE_PATTERNS = [
	"src/" + "v" + "2",
	"/" + "v" + "2" + "/",
	"browser-" + "v" + "2",
	"Browser" + "World" + "Display" + "V" + "2",
	"World" + "Display" + ".svelte",
	"landblock-render" + "-product",
	"static-landblock" + "-render-worker",
	"asset" + "-worker",
	"\\b" + "V" + "2" + "\\b",
	"\\b" + "v" + "2" + "\\b",
] as const;

describe("canonical browser source boundary", () => {
	it("does not retain migration or replaced-browser implementation references", () => {
		const violations = collectSourceFiles(SOURCE_ROOT).flatMap((filePath) =>
			collectCanonicalSourceViolations(filePath),
		);

		expect(violations).toEqual([]);
	});
});

function collectSourceFiles(directory: string): string[] {
	const files: string[] = [];

	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}

		if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
			files.push(path);
		}
	}

	return files;
}

function collectCanonicalSourceViolations(filePath: string): string[] {
	const source = readFileSync(filePath, "utf8");
	const relativePath = relative(SOURCE_ROOT, filePath).split(sep).join("/");

	return PROHIBITED_ACTIVE_SOURCE_PATTERNS.flatMap((pattern) => {
		const expression = new RegExp(pattern);
		return expression.test(source)
			? [`${relativePath} matches ${pattern}`]
			: [];
	});
}
