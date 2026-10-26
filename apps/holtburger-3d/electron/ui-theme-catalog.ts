import { mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	UI_THEME_SCHEME,
	uiThemeIdSchema,
} from "../src/app/ui-theme-contract.js";

/** Browser-supported theme resource types; no executable documents are served. */
const resourceTypes = new Map([
	[".css", "text/css"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".avif", "image/avif"],
	[".svg", "image/svg+xml"],
	[".ico", "image/x-icon"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
	[".ttf", "font/ttf"],
	[".otf", "font/otf"],
]);

/** Require physical containment after resolving symlinks, on either platform. */
function contained(root: string, target: string): void {
	const path = relative(root, target);
	if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
		throw new Error("Theme resource escapes its directory");
}

/** Native filesystem owner shared by product startup and isolated Electron probes. */
export class UiThemeCatalog {
	readonly #directory: string;
	readonly #report: (error: Error) => void;

	constructor(directory: string, report: (error: Error) => void) {
		this.#directory = directory;
		this.#report = report;
	}

	/** Creation is recoverable theme work, never a prerequisite for opening the app. */
	async directory(): Promise<string> {
		await mkdir(this.#directory, { recursive: true });
		return realpath(this.#directory);
	}

	async #theme(id: string): Promise<string> {
		uiThemeIdSchema.parse(id);
		const root = await this.directory();
		const theme = await realpath(join(root, id));
		contained(root, theme);
		if (theme === root || !(await stat(theme)).isDirectory())
			throw new Error(`Theme is not a directory: ${id}`);
		return theme;
	}

	async #file(id: string, parts: readonly string[]): Promise<string> {
		const theme = await this.#theme(id);
		const file = await realpath(join(theme, ...parts));
		contained(theme, file);
		if (!(await stat(file)).isFile())
			throw new Error("Theme resource is not a file");
		return file;
	}

	/** One bad candidate does not hide other usable themes. */
	async list(): Promise<readonly string[]> {
		const root = await this.directory();
		const ids: string[] = [];
		for (const entry of await readdir(root, { withFileTypes: true })) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			try {
				await this.#file(entry.name, ["theme.css"]);
				ids.push(entry.name);
			} catch (cause) {
				// Ordinary non-theme folders are expected alongside installed themes.
				if (
					cause instanceof Error &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					continue;
				this.#report(
					new Error(`Could not discover theme ${entry.name}`, { cause }),
				);
			}
		}
		return ids.sort();
	}

	/** Fresh path namespaces invalidate CSS imports, images, and font-face source caches together. */
	async resolve(id: string): Promise<string> {
		await this.#file(id, ["theme.css"]);
		return `${UI_THEME_SCHEME}://local/${encodeURIComponent(id)}/${randomUUID()}/theme.css`;
	}

	/** Revalidate every request; discovery does not pin files or symlink destinations. */
	async read(
		value: string,
	): Promise<{ readonly data: Buffer; readonly contentType: string }> {
		const url = new URL(value);
		if (
			url.protocol !== `${UI_THEME_SCHEME}:` ||
			url.host !== "local" ||
			url.username ||
			url.password
		)
			throw new Error("Invalid theme resource origin");
		const [rawId, generation, ...parts] = url.pathname
			.slice(1)
			.split("/")
			.map(decodeURIComponent);
		const id = uiThemeIdSchema.parse(rawId);
		z.string().uuid().parse(generation);
		if (
			parts.length === 0 ||
			parts.some((part) => !uiThemeIdSchema.safeParse(part).success)
		)
			throw new Error("Invalid theme resource path");
		const contentType = resourceTypes.get(
			extname(parts.join("/")).toLowerCase(),
		);
		if (contentType === undefined)
			throw new Error("Unsupported theme resource type");
		const file = await this.#file(id, parts);
		return { data: await readFile(file), contentType };
	}
}
