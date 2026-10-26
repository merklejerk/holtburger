import { afterEach, expect, it } from "vitest";
import {
	mkdtemp,
	mkdir,
	rm,
	symlink,
	writeFile,
	chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UiThemeCatalog } from "./ui-theme-catalog";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true })),
	);
	roots.length = 0;
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "holtburger-themes-"));
	roots.push(root);
	const errors: Error[] = [];
	const catalog = new UiThemeCatalog(join(root, "themes"), (error) =>
		errors.push(error),
	);
	const directory = await catalog.directory();
	async function theme(id: string) {
		const path = join(directory, id);
		await mkdir(path);
		await writeFile(
			join(path, "theme.css"),
			"@layer theme { :root { --test: 1; } }",
		);
		return path;
	}
	return { root, directory, catalog, errors, theme };
}

it("discovers sorted usable themes and round-trips names through fresh resource namespaces", async () => {
	const { catalog, theme, directory } = await fixture();
	await theme("雪 100%");
	await theme("Amber");
	await mkdir(join(directory, "not-a-theme"));
	expect(await catalog.list()).toEqual(["Amber", "雪 100%"]);
	const first = await catalog.resolve("雪 100%");
	expect(await catalog.resolve("雪 100%")).not.toBe(first);
	const asset = await catalog.read(first);
	expect(asset.contentType).toBe("text/css");
	expect(asset.data.toString()).toContain("--test: 1");
});

it("keeps valid candidates available when another candidate is invalid", async () => {
	const { catalog, theme, directory, errors } = await fixture();
	await theme("good");
	await mkdir(join(directory, "broken", "theme.css"), { recursive: true });
	expect(await catalog.list()).toEqual(["good"]);
	expect(errors).toHaveLength(1);
	await expect(catalog.resolve("broken")).rejects.toThrow("not a file");
});

it("rejects theme roots and assets that resolve outside their physical directories", async () => {
	const { catalog, root, directory, theme } = await fixture();
	const path = await theme("good");
	await writeFile(join(root, "secret.css"), "outside sentinel");
	await symlink(root, join(directory, "escape"), "dir");
	await symlink(join(root, "secret.css"), join(path, "escape.css"));
	await expect(catalog.resolve("escape")).rejects.toThrow("escapes");
	const url = await catalog.resolve("good");
	await expect(catalog.read(new URL("escape.css", url).href)).rejects.toThrow(
		"escapes",
	);
});

it("allows contained symlinks and rechecks resources after discovery", async () => {
	const { catalog, theme } = await fixture();
	const path = await theme("good");
	await symlink(join(path, "theme.css"), join(path, "alias.css"));
	const url = await catalog.resolve("good");
	expect((await catalog.read(new URL("alias.css", url).href)).contentType).toBe(
		"text/css",
	);
	await rm(join(path, "theme.css"));
	await expect(catalog.read(url)).rejects.toThrow();
	await expect(catalog.resolve("good")).rejects.toThrow();
});

it("rejects malformed origins, encoded separators, traversal, and unsupported resource types", async () => {
	const { catalog, theme } = await fixture();
	await theme("good");
	const url = await catalog.resolve("good");
	for (const invalid of [
		url.replace("local/", "other/"),
		url.replace("good/", "bad%2fname/"),
		new URL("../../outside.css", url).href,
		new URL("bad%5cname.css", url).href,
		new URL("code.js", url).href,
		url.replace("theme.css", "%zz.css"),
	]) {
		await expect(catalog.read(invalid)).rejects.toThrow();
	}
});

it("reports a root that cannot be created instead of inventing an empty catalog", async () => {
	const { root } = await fixture();
	const file = join(root, "file");
	await writeFile(file, "occupied");
	const catalog = new UiThemeCatalog(file, () => {
		throw new Error("Unexpected per-theme error");
	});
	await expect(catalog.list()).rejects.toThrow();
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"reports unreadable roots and omits unreadable candidates while retaining usable themes",
	async () => {
		const { directory, catalog, theme, errors } = await fixture();
		const locked = await theme("locked");
		await theme("good");
		await chmod(locked, 0);
		try {
			expect(await catalog.list()).toEqual(["good"]);
			expect(errors).toHaveLength(1);
			await expect(catalog.resolve("locked")).rejects.toThrow();
		} finally {
			await chmod(locked, 0o700);
		}
		await chmod(directory, 0);
		try {
			await expect(catalog.list()).rejects.toThrow();
		} finally {
			await chmod(directory, 0o700);
		}
	},
);
