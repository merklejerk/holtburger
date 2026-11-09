#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// Exercise production native ownership, preload IPC, persistence, and launcher restoration.
if (process.versions.electron) {
	void probe().catch((error) => {
		console.error(error);
		electron.app.exit(1);
	});
} else {
	const profile = await mkdtemp(join(tmpdir(), "h3d-display-"));
	try {
		const child = spawnSync(
			electron,
			[
				"--force-device-scale-factor=1",
				...(process.platform === "linux"
					? [
							`--ozone-platform=${process.argv.includes("--wayland") ? "wayland" : "x11"}`,
						]
					: []),
				fileURLToPath(import.meta.url),
				`--display-probe-profile=${profile}`,
			],
			{ stdio: "inherit" },
		);
		if (child.error) throw child.error;
		if (child.status === null)
			throw new Error(`Display probe terminated by ${child.signal}`);
		process.exitCode = child.status;
	} finally {
		await rm(profile, { recursive: true, force: true });
	}
}
async function probe() {
	const { app, BrowserWindow, ipcMain, screen } = electron;
	const profileArgument = process.argv.find((argument) =>
		argument.startsWith("--display-probe-profile="),
	);
	const profile = profileArgument?.slice("--display-probe-profile=".length);
	if (profile === undefined)
		throw new Error("Display probe requires a temporary profile.");
	app.setPath("userData", profile);
	const timeout = setTimeout(() => {
		console.error("Display probe timed out.");
		app.exit(1);
	}, 60_000);
	let window;
	let server;
	try {
		await app.whenReady();
		const { WindowDisplay, restoreWindowGeometry } =
			await import("../dist-electron/electron/window-display.js");
		const { observeWindowGeometry } =
			await import("../dist-electron/electron/window-geometry.js");
		const { ClientSettingsStore } =
			await import("../dist-electron/electron/client-settings-store.js");
		const { clientWindowSettingsSchema } =
			await import("../dist-electron/src/app/window-settings-contract.js");
		const { windowDisplayRequestSchema, windowDisplaySnapshotSchema } =
			await import("../dist-electron/src/app/window-display-contract.js");
		const { APP_WINDOW_TUNING, APP_PERSISTENCE_TUNING } =
			await import("../dist-electron/src/app/app-tuning.js");
		const initial = clientWindowSettingsSchema.parse({
			normalBounds: APP_WINDOW_TUNING.game.initialContentSize,
			maximized: false,
		});
		// X11 allows deterministic placement; --wayland exercises compositor-owned placement.
		// Unit scale keeps exact-size assertions independent of fractional desktop quantization.
		// Production reports actual sizes, including fractional desktop scaling quantization.
		const display = screen
			.getAllDisplays()
			.sort((left, right) => right.workArea.width - left.workArea.width)[0];
		if (display === undefined)
			throw new Error("No native display is available.");
		window = new BrowserWindow({
			x: display.workArea.x,
			y: display.workArea.y,
			...initial.normalBounds,
			title: "H3D display regression probe",
			webPreferences: {
				preload: fileURLToPath(
					new URL("../dist-electron/electron/preload.cjs", import.meta.url),
				),
				sandbox: true,
				additionalArguments: ["--holtburger-mode=client"],
			},
		});
		const failures = [];
		window.webContents.on("preload-error", (_event, _path, error) =>
			failures.push(error),
		);
		const restoredInitial = await restoreWindowGeometry(
			window,
			initial,
			"client",
		);
		const store = new ClientSettingsStore(
			join(profile, "settings.json"),
			initial,
		);
		await store.load();
		const controls = new WindowDisplay(
			window,
			restoredInitial,
			(state) => window.webContents.send("window:display-state", state),
			(error) => failures.push(error),
		);
		const stop = observeWindowGeometry(
			window,
			(value) => store.updateWindow(value),
			(error) => failures.push(error),
			() => controls.settings(),
		);
		ipcMain.handle("document:boot", () => "display-probe");
		const admit = (event, identity) => {
			assert.equal(event.sender, window.webContents);
			assert.equal(identity, "display-probe");
		};
		ipcMain.handle("window:display-snapshot", (event, identity) => {
			admit(event, identity);
			return controls.snapshot();
		});
		ipcMain.handle(
			"window:display-change",
			async (event, identity, request) => {
				admit(event, identity);
				await controls.change(windowDisplayRequestSchema.parse(request));
				await store.updateWindow(controls.settings());
			},
		);
		const { createServer } = await import("vite");
		server = await createServer({
			server: { host: "127.0.0.1", port: 0 },
			plugins: [
				{
					name: "display-controls-probe",
					configureServer(vite) {
						vite.middlewares.use((request, response, next) => {
							if (request.url !== "/__display_probe__") return next();
							response.setHeader("Content-Type", "text/html");
							const html = `<!doctype html><html><body class="ui-theme"><div id="app"></div><script type="module">
      import {mount} from "svelte";
      import Controls from "/src/harness/DisplaySettingsProbe.svelte";
      import "/src/app/ui-base.css";
      import "/src/client/client-settings-controls.css";
      mount(Controls, {target: document.getElementById("app")});
     </script></body></html>`;
							void vite
								.transformIndexHtml("/__display_probe__", html)
								.then((value) => response.end(value))
								.catch(next);
						});
					},
				},
			],
		});
		await server.listen();
		const origin = server.resolvedUrls?.local[0];
		if (origin === undefined)
			throw new Error("Display probe server has no local URL.");
		await window.loadURL(new URL("/__display_probe__", origin).href);
		const run = (code) => window.webContents.executeJavaScript(code);
		const snapshot = async () =>
			windowDisplaySnapshotSchema.parse(
				await run("holtburgerDisplay.snapshot()"),
			);
		const rawChange = (request) =>
			run(`holtburgerDisplay.change(${JSON.stringify(request)})`);
		const keepPreview = async () => {
			const state = await snapshot();
			if (state.confirmation === null) return;
			await run(`new Promise(resolve => {
				const check = () => document.querySelector('dialog[open]') ? resolve() : requestAnimationFrame(check);
				check();
			})`);
			assert.equal(
				await run(
					"document.activeElement?.hasAttribute('data-display-revert')",
				),
				true,
			);
			await run(
				"[...document.querySelectorAll('dialog button')].find(button => button.textContent.trim() === 'Keep').click(); undefined;",
			);
			await waitForDecision();
		};
		const change = async (request) => {
			await rawChange(request);
			await keepPreview();
		};
		const waitForDecision = () =>
			run(`new Promise((resolve, reject) => {
			const deadline = Date.now() + ${APP_WINDOW_TUNING.transitionTimeoutMs};
			const check = async () => {
				const state = await holtburgerDisplay.snapshot();
				if (!state.busy && state.confirmation === null) resolve();
				else if (Date.now() >= deadline) reject(new Error('Display decision did not settle.'));
				else setTimeout(check, 20);
			};
			check();
		})`);
		// Native mode events can precede the compositor animation and final Chromium resize.
		const assertViewport = async (expected, message) => {
			const viewport = await run(`new Promise(resolve => {
    const deadline = performance.now() + ${APP_WINDOW_TUNING.transitionTimeoutMs};
    const check = () => {
     const size = {width: innerWidth, height: innerHeight};
     if ((size.width === ${expected.width} && size.height === ${expected.height}) || performance.now() >= deadline) resolve(size);
     else requestAnimationFrame(check);
    };
    check();
   })`);
			assert.deepEqual(
				viewport,
				expected,
				`${message} ${JSON.stringify({ outer: window.getBounds(), content: window.getContentBounds(), fullscreen: window.isFullScreen(), resizable: window.isResizable() })}`,
			);
		};
		const assertFullscreenViewport = async () => {
			const displaySize = await run(
				"({width: screen.width, height: screen.height})",
			);
			await assertViewport(displaySize, "Fullscreen must fill the display.");
		};
		await run(
			"globalThis.displayStates = []; holtburgerDisplay.onState(state => displayStates.push(state)); undefined;",
		);
		const ready = async () => {
			await run(`new Promise(resolve => {
				const check = async () => {
					const state = await holtburgerDisplay.snapshot();
					if (!state.busy && document.querySelectorAll('input[type="checkbox"]').length === 2) resolve();
					else requestAnimationFrame(check);
				};
				check();
			})`);
			await keepPreview();
		};
		await ready();
		const first = await snapshot();
		const preset = first.presets[0];
		if (preset === undefined)
			throw new Error(
				`Display controls returned no window size presets: ${JSON.stringify({ snapshot: first, display: screen.getDisplayMatching(window.getBounds()), minimum: window.getMinimumSize() })}`,
			);
		const originalSettings = controls.settings();
		await rawChange({ kind: "size", size: preset });
		assert.notEqual((await snapshot()).confirmation, null);
		assert.deepEqual(controls.settings(), originalSettings);
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				APP_PERSISTENCE_TUNING.windowGeometryWriteDelayMs +
					APP_WINDOW_TUNING.geometryQuietMs,
			),
		);
		assert.deepEqual(store.readWindow(), originalSettings);
		assert.equal(await run("document.querySelector('select').disabled"), true);
		window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
		await waitForDecision();
		assert.deepEqual(controls.settings(), originalSettings);
		assert.deepEqual(
			window.getBounds().width,
			originalSettings.normalBounds.width,
		);

		// Both the explicit action and the shared backdrop policy restore the same transaction.
		await rawChange({ kind: "size", size: preset });
		await run(
			"document.querySelector('[data-display-revert]').click(); undefined;",
		);
		await waitForDecision();
		assert.deepEqual(controls.settings(), originalSettings);
		await rawChange({ kind: "size", size: preset });
		await run(`const dialog = document.querySelector('dialog[open]');
			const bounds = dialog.getBoundingClientRect();
			const point = {clientX: bounds.left - 1, clientY: bounds.top - 1, bubbles: true};
			dialog.dispatchEvent(new PointerEvent('pointerdown', point));
			dialog.dispatchEvent(new MouseEvent('click', point)); undefined;`);
		await waitForDecision();
		assert.deepEqual(controls.settings(), originalSettings);

		await rawChange({ kind: "size", size: preset });
		const restoreSize = window.setSize.bind(window);
		window.setSize = () => {
			throw new Error("Synthetic native restoration failure.");
		};
		try {
			await run(
				"document.querySelector('[data-display-revert]').click(); undefined;",
			);
			await run(`new Promise((resolve, reject) => {
				const deadline = Date.now() + ${APP_WINDOW_TUNING.transitionTimeoutMs};
				const check = async () => {
					const state = await holtburgerDisplay.snapshot();
					const dialog = document.querySelector('dialog[open]');
					if (!state.busy && state.confirmation?.kind === 'recovery' && dialog?.querySelector('[role=alert]')) resolve();
					else if (Date.now() >= deadline) reject(new Error('Restoration recovery prompt did not appear.'));
					else setTimeout(check, 20);
				};
				check();
			})`);
			assert.equal(
				await run(
					"[...document.querySelectorAll('dialog button')].some(button => button.textContent.trim() === 'Keep')",
				),
				false,
			);
			assert.equal(
				await run(
					"document.querySelector('dialog [role=alert]').textContent.includes('Synthetic native restoration failure')",
				),
				true,
			);
			assert.deepEqual(controls.settings(), originalSettings);
		} finally {
			window.setSize = restoreSize;
		}
		await run(
			"document.querySelector('[data-display-revert]').click(); undefined;",
		);
		await waitForDecision();
		assert.deepEqual(controls.settings(), originalSettings);

		await rawChange({ kind: "fullscreen", enabled: true });
		assert.equal(window.isFullScreen(), true);
		assert.deepEqual(controls.settings(), originalSettings);
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				APP_WINDOW_TUNING.displayConfirmationMs +
					APP_WINDOW_TUNING.geometryQuietMs * 4,
			),
		);
		await waitForDecision();
		assert.equal(window.isFullScreen(), false);
		assert.deepEqual(controls.settings(), originalSettings);

		await change({ kind: "size", size: preset });
		await run(
			"document.querySelectorAll('input[type=checkbox]')[1].click(); undefined;",
		);
		await ready();
		assert.equal(window.isResizable(), false);
		const lockedPreset = first.presets[1];
		if (lockedPreset === undefined)
			throw new Error("Display probe needs two supported presets.");
		await run(
			"const picker = document.querySelector('select'); picker.value = '1'; picker.dispatchEvent(new Event('change', {bubbles: true})); undefined;",
		);
		await ready();
		assert.deepEqual((await snapshot()).contentSize, lockedPreset);
		const lockedBounds = controls.settings().normalBounds;

		await run(
			"document.querySelector('input[type=checkbox]').click(); undefined;",
		);
		await ready();
		assert.equal((await snapshot()).fullscreen, true);
		assert.equal((await snapshot()).freeResize, false);
		assert.equal(window.isResizable(), true);
		await assertFullscreenViewport();
		assert.equal(await run("document.querySelector('select').disabled"), true);
		await change({ kind: "fullscreen", enabled: false });
		await assertViewport(
			lockedPreset,
			"Leaving fullscreen must restore the actual windowed viewport.",
		);
		assert.deepEqual(controls.settings().normalBounds, lockedBounds);
		assert.equal((await snapshot()).freeResize, false);
		assert.equal(window.isResizable(), false);
		await change({ kind: "free-resize", enabled: true });
		await restoreWindowGeometry(
			window,
			{ ...controls.settings(), maximized: true },
			"client",
		);
		await change({ kind: "fullscreen", enabled: true });
		assert.equal(controls.settings().maximized, true);
		await change({ kind: "fullscreen", enabled: false });
		assert.equal(window.isMaximized(), true);
		await change({ kind: "size", size: preset });
		assert.equal(window.isMaximized(), false);
		await change({ kind: "free-resize", enabled: false });
		await change({ kind: "fullscreen", enabled: true });
		assert.equal(
			await run("document.querySelector('[role=alert]') === null"),
			true,
		);
		await controls.close();
		await stop();
		await store.flush();
		const persisted = new ClientSettingsStore(
			join(profile, "settings.json"),
			initial,
		);
		await persisted.load();
		assert.deepEqual(persisted.readWindow(), controls.settings());
		const launcher = clientWindowSettingsSchema.parse({
			normalBounds: APP_WINDOW_TUNING.launcher.initialContentSize,
			maximized: false,
		});
		await restoreWindowGeometry(window, launcher, "picker");

		assert.equal(window.isFullScreen(), false);
		assert.equal(window.isResizable(), true);
		await restoreWindowGeometry(window, persisted.readWindow(), "client");
		assert.equal(window.isFullScreen(), true);
		await assertFullscreenViewport();
		assert.equal(window.isResizable(), true);
		await restoreWindowGeometry(
			window,
			{ ...persisted.readWindow(), fullscreen: false },
			"client",
		);
		const { width, height } = window.getBounds();
		assert.deepEqual({ width, height }, persisted.readWindow().normalBounds);
		assert.ok(await run("displayStates.length > 0"));
		assert.deepEqual(failures, []);
		console.log(
			"Display probe passed: confirmation Keep/Revert/Escape/backdrop/timeout, failed rollback recovery, preview persistence isolation, locked presets, fullscreen/maximize restoration, preload events, saved preferences, launcher round trip.",
		);
	} finally {
		clearTimeout(timeout);
		window?.destroy();
		await server?.close();
	}
	app.exit(0);
}
