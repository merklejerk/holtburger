import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import svg from "@poppanator/sveltekit-svg";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAppBuild } from "./scripts/app-build.ts";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => {
	const appBuild = readAppBuild(rootDir, command === "serve" && !isPreview);
	return {
		define: {
			__HOLTBURGER_APP_BUILD__: JSON.stringify(appBuild),
		},
		plugins: [
			{
				name: "release-build-identity",
				generateBundle() {
					this.emitFile({
						type: "asset",
						fileName: "build-info.json",
						source: JSON.stringify(appBuild),
					});
				},
			},
			{
				name: "user-theme-probe-policy",
				transformIndexHtml(html) {
					if (!html.includes("__UI_THEME_PROBE_CSP__")) return html;
					const source = readFileSync(
						resolve(rootDir, "client/index.html"),
						"utf8",
					);
					const policyTag = source.match(
						/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/,
					)?.[0];
					const policy = policyTag?.match(/\bcontent="([^"]+)"/)?.[1];
					if (policy === undefined)
						throw new Error("Client content policy is missing");
					return html.replace("__UI_THEME_PROBE_CSP__", policy);
				},
			},
			svelte(),
			// Keep editor-authored artwork intact and leave cursor/nameplate asset loading alone.
			svg({
				includePaths: [
					resolve(rootDir, "src/assets/icons"),
					resolve(rootDir, "../../assets/branding"),
				],
				svgoOptions: false,
			}),
		],
		// Electron loads built entries from disk; assets must resolve beside those entries.
		base: "./",
		build: {
			rolldownOptions: {
				input: {
					client: resolve(rootDir, "client/index.html"),
					launcher: resolve(rootDir, "launcher/index.html"),
					explorer: resolve(rootDir, "explorer/index.html"),
					browserHarness: resolve(rootDir, "harness/browser/index.html"),
					userThemeProbe: resolve(rootDir, "harness/user-theme/index.html"),
				},
			},
		},
		server: {
			fs: { allow: [rootDir, resolve(rootDir, "../../assets/branding")] },
			host: "127.0.0.1",
			port: 1420,
			strictPort: true,
		},
		test: {
			environment: "node",
			include: [
				"src/**/*.test.ts",
				"electron/**/*.test.ts",
				"scripts/**/*.test.ts",
			],
		},
	};
});
