import { app, BrowserWindow, ipcMain } from "electron";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { once } from "node:events";
import { TRAVELERS_KIT_THEME_ID } from "../src/app/ui-theme-contract.js";
import { CLIENT_DEFAULT_THEME_ID } from "../src/client/client-settings-values.js";
import { clientUserSettingsPatchSchema } from "../src/client/client-settings-sections.js";
import { z } from "zod";
import { ClientSettingsStore } from "./client-settings-store.js";
import { UiThemeCatalog } from "./ui-theme-catalog.js";
import {
	registerUiThemeScheme,
	installUiThemeProtocol,
} from "./ui-theme-protocol.js";

registerUiThemeScheme();
// Keep the diagnostic process alive until cleanup and its explicit exit status finish.
app.on("window-all-closed", () => {});
const appRoot = resolve(import.meta.dirname, "../..");
const fixture = join(appRoot, "scripts/fixtures/user-theme");
const snapshot = z.object({
	imageUrl: z.string(),
	pixel: z.array(z.number()),
	width: z.number(),
	imported: z.string(),
	identity: z.boolean(),
	draft: z.string(),
});
const origin = process.argv
	.find((arg) => arg.startsWith("--probe-origin="))
	?.slice("--probe-origin=".length);
if (origin === undefined) throw new Error("Missing --probe-origin");
const packageRoot = process.argv
	.find((arg) => arg.startsWith("--probe-package-root="))
	?.slice("--probe-package-root=".length);
const directory = process.argv
	.find((arg) => arg.startsWith("--probe-directory="))
	?.slice("--probe-directory=".length);
if (directory === undefined) throw new Error("Missing --probe-directory");
app.setPath("userData", join(directory, "profile"));
app.whenReady().then(async () => {
	let window: BrowserWindow | undefined;
	try {
		const id = "Probe 雪 100%";
		const theme = join(directory, "themes", id);
		await cp(fixture, theme, { recursive: true });
		await cp(join(fixture, "probe-500.ttf"), join(theme, "font.ttf"));
		// Diagnostic fault injection leaves a request unsettled to exercise the production deadline.
		const catalog = new (class extends UiThemeCatalog {
			override async read(value: string): ReturnType<UiThemeCatalog["read"]> {
				if (new URL(value).pathname.endsWith("/stalled.css"))
					return new Promise(() => {});
				return super.read(value);
			}
		})(join(directory, "themes"), console.error);
		const store = new ClientSettingsStore(join(directory, "settings.json"), {
			normalBounds: { width: 1200, height: 900 },
			maximized: false,
		});
		await store.load();
		const diagnosticIdentity = "user-theme-diagnostic";
		ipcMain.handle("document:boot", () => diagnosticIdentity);
		let failCatalog = false;
		ipcMain.handle("themes:list", () => {
			if (failCatalog) throw new Error("Diagnostic user catalog failure");
			return catalog.list();
		});
		ipcMain.handle(
			"themes:resolve",
			(_event, identity: unknown, id: string) => {
				assert.equal(identity, diagnosticIdentity);
				return catalog.resolve(id);
			},
		);
		ipcMain.handle("themes:open-directory", () => {
			throw new Error("Diagnostic folder opening failure");
		});
		ipcMain.handle(
			"settings:load-user",
			(_event, identity: unknown, defaults: unknown) => {
				assert.equal(identity, diagnosticIdentity);
				return store.loadUser(defaults, "persisted");
			},
		);
		ipcMain.handle(
			"settings:save-user-patch",
			(_event, identity: unknown, patch: unknown) => {
				assert.equal(identity, diagnosticIdentity);
				return store.saveUserPatch(clientUserSettingsPatchSchema.parse(patch));
			},
		);
		window = new BrowserWindow({
			show: false,
			webPreferences: {
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				preload: join(import.meta.dirname, "preload.cjs"),
				additionalArguments: ["--holtburger-mode=client"],
			},
		});
		installUiThemeProtocol(window.webContents.session, catalog);
		const target = window;
		const consoleErrors: string[] = [];
		target.webContents.on("console-message", ({ level, message, sourceId }) => {
			if (level === "error") consoleErrors.push(`${sourceId}: ${message}`);
		});
		const read = async (expression: string): Promise<unknown> =>
			target.webContents.executeJavaScript(`(async () => {
     try { return await (${expression}); }
     catch (error) { throw new Error(String(error)); }
    })()`);
		const wait = async (expression: string) => {
			for (let attempt = 0; attempt < 200; attempt++) {
				if (await read(expression)) return;
				await new Promise((accept) => setTimeout(accept, 20));
			}
			throw new Error(`Probe condition timed out: ${expression}`);
		};
		const reload = async () => {
			const loaded = once(target.webContents, "did-finish-load");
			target.reload();
			await loaded;
			await wait("!!window.__UI_THEME_ASSET_PROBE__");
		};
		const settingsApi = "window.__UI_THEME_SETTINGS_PROBE__";
		const mountSettings = async () => {
			await read("window.__UI_THEME_ASSET_PROBE__.settings()");
			await wait(`${settingsApi}?.read().ready`);
			await read(
				`[...document.querySelectorAll('[role="tab"]')].find(node => node.textContent.trim() === 'UI').click()`,
			);
			await wait(`!!document.querySelector('select[aria-label="UI theme"]')`);
		};
		const select = async (id: string | null) => {
			await read(
				`(() => { const control = document.querySelector('select[aria-label="UI theme"]'); control.value = ${JSON.stringify(id ?? "")}; control.dispatchEvent(new Event('change', { bubbles: true })); })()`,
			);
		};
		const click = async (text: string) =>
			read(
				`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`,
			);
		// Each entry carries its load target; packaged paths only exist with an explicit root.
		const entries: (
			| { mode: "development"; url: string }
			| { mode: "built-file" | "packaged-asar"; file: string }
		)[] = [
			{ mode: "development", url: `${origin}/harness/user-theme/` },
			{
				mode: "built-file",
				file: join(appRoot, "dist/harness/user-theme/index.html"),
			},
		];
		if (packageRoot !== undefined) {
			const resources =
				process.platform === "darwin"
					? join(packageRoot, "holtburger-3d.app/Contents/Resources")
					: join(packageRoot, "resources");
			entries.push({
				mode: "packaged-asar",
				file: join(resources, "app.asar/dist/harness/user-theme/index.html"),
			});
		}
		for (const entry of entries) {
			const { mode } = entry;
			await cp(join(fixture, "probe-500.ttf"), join(theme, "font.ttf"));
			await cp(join(fixture, "panel.svg"), join(theme, "panel.svg"));
			await cp(
				join(fixture, "styles/controls.css"),
				join(theme, "styles/controls.css"),
			);
			if (entry.mode === "development") await target.loadURL(entry.url);
			else await target.loadFile(entry.file);
			await target.webContents
				.executeJavaScript(`new Promise((resolve, reject) => {
			const deadline = setTimeout(() => reject(new Error("Theme probe did not mount")), 10000);
			const poll = () => { if (window.__UI_THEME_ASSET_PROBE__) { clearTimeout(deadline); resolve(true); } else setTimeout(poll, 20); }; poll();
		})`);
			const baseFonts = await read(
				"window.__UI_THEME_ASSET_PROBE__.baseFonts()",
			);
			const apply = async () => {
				const url = await catalog.resolve(id);
				const value: unknown = await target.webContents.executeJavaScript(
					`window.__UI_THEME_ASSET_PROBE__.apply(${JSON.stringify(url)})`,
				);
				return snapshot.parse(value);
			};
			const first = await apply();
			assert.deepEqual(first.pixel, [255, 0, 0, 255]);
			assert.equal(first.imported, "first");
			assert.ok(
				Math.abs(first.width - 80) < 0.01,
				"First font decoded with its authored advance",
			);
			await cp(join(fixture, "probe-900.ttf"), join(theme, "font.ttf"));
			await writeFile(
				join(theme, "panel.svg"),
				(await readFile(join(fixture, "panel.svg"), "utf8")).replace(
					'fill="red"',
					'fill="blue"',
				),
			);
			await writeFile(
				join(theme, "styles/controls.css"),
				"@layer theme { #image { --probe-import: second; } }",
			);
			const second = await apply();
			assert.notEqual(first.imageUrl, second.imageUrl);
			assert.deepEqual(second.pixel, [0, 0, 255, 255]);
			assert.equal(second.imported, "second");
			assert.ok(
				Math.abs(second.width - 144) < 0.01,
				"Reloaded font decoded with its replacement advance",
			);
			assert.equal(second.identity, true);
			assert.equal(second.draft, "retained draft");
			const url = await catalog.resolve(id);
			const cancelled: unknown = await target.webContents.executeJavaScript(
				`window.__UI_THEME_ASSET_PROBE__.cancellation(${JSON.stringify(url)})`,
			);
			assert.equal(cancelled, true);
			const recovered: unknown = await read(
				`window.__UI_THEME_ASSET_PROBE__.timeout(${JSON.stringify(new URL("stalled.css", url).href)}, ${JSON.stringify(url)})`,
			);
			assert.equal(recovered, true);
			const rejectedSheet = await read(
				`window.__UI_THEME_ASSET_PROBE__.failedLoad(${JSON.stringify(new URL("missing.css", url).href)}, ${JSON.stringify(url)})`,
			);
			assert.equal(rejectedSheet, true);
			const fontRefreshes = await read(
				`window.__UI_THEME_ASSET_PROBE__.fontRefresh(${JSON.stringify(new URL("font.ttf", url).href)})`,
			);
			assert.ok(typeof fontRefreshes === "number" && fontRefreshes > 0);
			const missingFont = await read(
				`window.__UI_THEME_ASSET_PROBE__.fontFailure(${JSON.stringify(new URL("missing.ttf", url).href)})`,
			);
			await writeFile(join(theme, "corrupt.ttf"), "not a font");
			const corruptFont = await read(
				`window.__UI_THEME_ASSET_PROBE__.fontFailure(${JSON.stringify(new URL("corrupt.ttf", url).href)})`,
			);
			assert.match(String(missingFont), /Could not load combat font/);
			assert.match(String(corruptFont), /Could not load combat font/);
			await mountSettings();

			// Bundled assets and preferences use the same renderer owner and real disk-backed settings.
			const bundledId = TRAVELERS_KIT_THEME_ID;
			if (mode === "development") {
				// First document uses a fresh profile; later modes intentionally restore saved Base.
				assert.equal(
					await read(`${settingsApi}.read().ui.themeId`),
					CLIENT_DEFAULT_THEME_ID,
				);
				assert.equal(
					await read(`${settingsApi}.read().state.selection.activeId`),
					CLIENT_DEFAULT_THEME_ID,
				);
			}
			assert.ok(
				await read(
					`${settingsApi}.read().state.catalog.ids.includes(${JSON.stringify(bundledId)})`,
				),
			);
			await select(bundledId);
			await wait(
				`${settingsApi}.read().state.selection.activeId === ${JSON.stringify(bundledId)}`,
			);
			const bundledAssets = async () =>
				read("window.__UI_THEME_ASSET_PROBE__.bundledAssets()");
			const assets = z
				.object({ href: z.string(), decoded: z.number() })
				.parse(await bundledAssets());
			assert.equal(assets.decoded, 4);
			if (mode === "packaged-asar") assert.ok(assets.href.includes("app.asar"));
			await read(`${settingsApi}.flush()`);
			await reload();
			await mountSettings();
			assert.equal(
				await read(`${settingsApi}.read().state.selection.activeId`),
				bundledId,
			);
			await click("Reload theme");
			await wait(`${settingsApi}.read().state.selection.kind === 'ready'`);
			assert.equal(
				z.object({ decoded: z.number() }).parse(await bundledAssets()).decoded,
				4,
			);
			failCatalog = true;
			await click("Refresh list");
			await wait(`${settingsApi}.read().state.catalog.kind === 'failed'`);
			assert.equal(
				await read(
					`${settingsApi}.read().state.catalog.ids.includes(${JSON.stringify(bundledId)})`,
				),
				true,
			);
			failCatalog = false;
			const collision = join(directory, "themes", bundledId);
			await cp(fixture, collision, { recursive: true });
			await click("Refresh list");
			await wait(`document.body.textContent.includes('Rename that folder')`);
			await rm(collision, { recursive: true });
			await click("Refresh list");
			await wait(`${settingsApi}.read().state.catalog.kind === 'ready'`);

			// Exercise the real pregame settings controls and persisted user section.
			await select(id);
			await wait(
				`${settingsApi}.read().ui.themeId === ${JSON.stringify(id)} && ${settingsApi}.read().state.selection.kind === 'ready'`,
			);
			await read(`${settingsApi}.flush()`);
			const broken = join(directory, "themes", "Broken");
			await cp(fixture, broken, { recursive: true });
			await click("Refresh list");
			await wait(`${settingsApi}.read().state.catalog.ids.includes('Broken')`);
			await rm(join(broken, "theme.css"));
			await select("Broken");
			await wait(`${settingsApi}.read().state.selection.kind === 'failed'`);
			assert.equal(await read(`${settingsApi}.read().ui.themeId`), id);
			assert.equal(
				await read(
					`document.querySelector('select[aria-label="UI theme"]').value`,
				),
				id,
			);
			await rm(broken, { recursive: true, force: true });
			await read(`${settingsApi}.gameplay()`);
			await wait(
				`document.querySelector('[aria-label="UI theme"]')?.getBoundingClientRect().width > 0`,
			);
			await select(null);
			await wait(`${settingsApi}.read().ui.themeId === null`);
			await read(`${settingsApi}.flush()`);
			await select(id);
			await wait(`${settingsApi}.read().ui.themeId === ${JSON.stringify(id)}`);
			await read(`${settingsApi}.flush()`);
			// A new document/new selection owner restores from the actual disk-backed store.
			await reload();
			await mountSettings();
			assert.equal(await read(`${settingsApi}.read().ui.themeId`), id);
			assert.equal(
				await read(`${settingsApi}.read().state.selection.activeId`),
				id,
			);
			await rm(join(theme, "theme.css"));
			await click("Refresh list");
			await wait(
				`!${settingsApi}.read().state.catalog.ids.includes(${JSON.stringify(id)})`,
			);
			await click("Reload theme");
			await wait(`${settingsApi}.read().state.selection.kind === 'failed'`);
			assert.equal(
				await read(`${settingsApi}.read().state.selection.activeId`),
				id,
			);
			await reload();
			await mountSettings();
			assert.equal(await read(`${settingsApi}.read().ui.themeId`), id);
			assert.equal(
				await read(`${settingsApi}.read().state.selection.activeId`),
				null,
			);
			assert.equal(
				await read(
					`document.querySelector('select[aria-label="UI theme"]').selectedOptions[0].textContent.includes('unavailable')`,
				),
				true,
			);
			await cp(join(fixture, "theme.css"), join(theme, "theme.css"));
			await click("Reload theme");
			await wait(
				`${settingsApi}.read().state.selection.kind === 'ready' && ${settingsApi}.read().state.selection.activeId === ${JSON.stringify(id)}`,
			);
			await click("Open themes folder");
			await wait(
				"document.body.textContent.includes('Diagnostic folder opening failure')",
			);
			await select(null);
			await wait(`${settingsApi}.read().ui.themeId === null`);
			await read(`${settingsApi}.flush()`);
			console.log(
				JSON.stringify({
					mode,
					baseFonts,
					bundled: assets,
					first,
					second,
					cancelled,
					recovered,
					rejectedSheet,
					fontRefreshes,
					missingFont,
					corruptFont,
					settings:
						"pregame/gameplay selection, disk restore, missing-theme fallback and retry passed",
				}),
			);
		}
		assert.deepEqual(
			consoleErrors.filter(
				(message) =>
					!/missing\.(?:ttf|css)|corrupt\.ttf|OTS parsing error/.test(message),
			),
			[],
		);
		window.destroy();
		app.exit(0);
	} catch (error) {
		console.error(error);
		window?.destroy();
		app.exit(1);
	}
});
