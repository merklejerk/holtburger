import assert from "node:assert/strict";
import { copyFile, cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TRAVELERS_KIT_THEME_ID } from "../dist-electron/src/app/ui-theme-contract.js";

/** Reuse the renderer asset harness through the installed app's real preload and theme protocol. */
export async function probePackagedThemeAssets({
	client,
	read,
	waitFor,
	profileDirectory,
}) {
	const fixture = resolve(import.meta.dirname, "fixtures/user-theme");
	const id = "Package probe 雪 100%";
	const theme = join(profileDirectory, "themes", id);
	await cp(fixture, theme, { recursive: true });
	await copyFile(join(fixture, "probe-500.ttf"), join(theme, "font.ttf"));
	const original = await read("location.href");
	const harness = new URL("../harness/user-theme/index.html", original).href;
	const api = "window.__UI_THEME_ASSET_PROBE__";
	const settings = "window.__UI_THEME_SETTINGS_PROBE__";
	try {
		await client.send("Page.navigate", { url: harness });
		await waitFor(() => read(`Boolean(${api})`), "packaged theme harness");
		const baseFonts = await read(`${api}.baseFonts()`);
		assert.ok(baseFonts > 0, "Bundled Base fonts must decode");
		const url = () =>
			read(`window.holtburgerThemes.resolve(${JSON.stringify(id)})`);
		const apply = async () =>
			read(`${api}.apply(${JSON.stringify(await url())})`);
		const first = await apply();
		assert.deepEqual(first.pixel, [255, 0, 0, 255]);
		assert.ok(
			Math.abs(first.width - 80) < 0.01,
			"First authored font advance must decode",
		);
		await copyFile(join(fixture, "probe-900.ttf"), join(theme, "font.ttf"));
		await writeFile(
			join(theme, "panel.svg"),
			(await readFile(join(fixture, "panel.svg"), "utf8")).replace(
				'fill="red"',
				'fill="blue"',
			),
		);
		const second = await apply();
		assert.notEqual(second.imageUrl, first.imageUrl);
		assert.deepEqual(second.pixel, [0, 0, 255, 255]);
		assert.ok(
			Math.abs(second.width - 144) < 0.01,
			"Replacement font must decode after reload",
		);
		assert.equal(second.identity, true);
		assert.equal(second.draft, "retained draft");
		const font = new URL("font.ttf", await url()).href;
		const fontRefreshes = await read(
			`${api}.fontRefresh(${JSON.stringify(font)})`,
		);
		assert.equal(fontRefreshes, 1);
		await read(`${api}.settings()`);
		await waitFor(
			() => read(`Boolean(${settings}?.read().ready)`),
			"packaged theme settings",
		);
		await read(
			"[...document.querySelectorAll('[role=tab]')].find(node => node.textContent.trim() === 'UI').click()",
		);
		await waitFor(
			() =>
				read(
					"Boolean(document.querySelector('select[aria-label=\"UI theme\"]'))",
				),
			"theme selector",
		);
		await read(`(() => {
			const control = document.querySelector('select[aria-label="UI theme"]');
			control.value = ${JSON.stringify(TRAVELERS_KIT_THEME_ID)};
			control.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
		await waitFor(
			() =>
				read(
					`${settings}.read().state.selection.kind === 'ready' && ${settings}.read().state.selection.activeId === ${JSON.stringify(TRAVELERS_KIT_THEME_ID)}`,
				),
			"bundled theme selection",
		);
		const bundled = await read(`${api}.bundledAssets()`);
		assert.equal(bundled.decoded, 4);
		assert.ok(bundled.href.includes("app.asar"));
		console.log(
			JSON.stringify({
				probe: "packaged-theme-assets",
				baseFonts,
				bundledImages: bundled.decoded,
				fontRefreshes,
				customReload: true,
			}),
		);
	} finally {
		await client.send("Page.navigate", { url: original });
		await waitFor(
			() => read("Boolean(document.querySelector('.client-pregame-screen'))"),
			"restored application page",
		);
	}
}
