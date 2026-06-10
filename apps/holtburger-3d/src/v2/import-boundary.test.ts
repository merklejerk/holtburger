import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const V2_ROOT = fileURLToPath(new URL(".", import.meta.url));
const SOURCE_EXTENSIONS = [".ts", ".svelte"] as const;
const PROHIBITED_IMPORTS = [
	"../app",
	"../../app",
	"../workers",
	"../../workers",
	"../lib/assets",
	"../../lib/assets",
	"../lib/world-display",
	"../../lib/world-display",
];

describe("V2 import boundary", () => {
	it("does not import from legacy frontend implementation modules", () => {
		const violations = collectSourceFiles(V2_ROOT).flatMap((filePath) =>
			collectImportViolations(filePath),
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

function collectImportViolations(filePath: string): string[] {
	const source = readFileSync(filePath, "utf8");
	const importMatches = source.matchAll(
		/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
	);
	const relativePath = relative(V2_ROOT, filePath).split(sep).join("/");
	const violations: string[] = [];

	for (const match of importMatches) {
		const specifier = match[1] as string;
		if (PROHIBITED_IMPORTS.some((prefix) => specifier.startsWith(prefix))) {
			violations.push(`${relativePath} imports ${specifier}`);
		}
	}

	return violations;
}
