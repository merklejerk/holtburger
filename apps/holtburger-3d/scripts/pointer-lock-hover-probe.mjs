#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// Exercise the production preload and main adapter in Chromium, including browser-computed
// movement deltas. Simulate lock state and the stale native coordinates; no game assets or
// physical input are required. The original native Wayland failure was reproduced separately.
if (process.versions.electron) {
	// Electron waits for ESM entry evaluation before emitting ready; do not await ready at top level.
	void probe().catch((error) => {
		console.error(error);
		electron.app.exit(1);
	});
} else {
	const profile = await mkdtemp(join(tmpdir(), "h3d-pointer-hover-"));
	try {
		const child = spawnSync(
			electron,
			[fileURLToPath(import.meta.url), profile],
			{ stdio: "inherit" },
		);
		if (child.error) throw child.error;
		if (child.status === null)
			throw new Error(`Pointer probe terminated by ${child.signal}`);
		process.exitCode = child.status;
	} finally {
		await rm(profile, { recursive: true, force: true });
	}
}

/** Real Electron input dispatch is necessary: unit mocks cannot calculate MouseEvent movement. */
async function probe() {
	const { app, BrowserWindow, ipcMain } = electron;
	const profile = process.argv[2];
	if (profile === undefined)
		throw new Error("Pointer probe requires a temporary profile.");
	app.setPath("userData", profile);
	let waitingFor = "Electron initialization";
	const timeout = setTimeout(() => {
		console.error(
			`Pointer restoration probe timed out waiting for ${waitingFor}.`,
		);
		app.exit(1);
	}, 10_000);
	let window;
	try {
		await app.whenReady();
		const { PointerLockHover, pointerPositionSchema } =
			await import("../dist-electron/electron/pointer-lock-hover.js");
		window = new BrowserWindow({
			width: 800,
			height: 650,
			title: "Pointer restoration regression probe",
			webPreferences: {
				preload: fileURLToPath(
					new URL("../dist-electron/electron/preload.cjs", import.meta.url),
				),
				sandbox: true,
				additionalArguments: ["--holtburger-wayland-pointer-restore"],
			},
		});
		const contents = window.webContents;
		contents.on("preload-error", (_event, _path, error) => {
			console.error(error);
			app.exit(1);
		});
		const owner = new PointerLockHover(contents);
		// Physical pointer entry/motion must not alter this synthetic regression sequence.
		let dispatching = false;
		const dispatch = (action) => {
			dispatching = true;
			try {
				action();
			} finally {
				dispatching = false;
			}
		};
		contents.on("before-mouse-event", (event, input) => {
			if (dispatching) owner.beforeMouse(event, input);
			else event.preventDefault();
		});
		const restored = Promise.withResolvers();
		ipcMain.handle("document:boot", () => "probe-document");
		ipcMain.handle("window:restore-pointer", (event, identity, point) => {
			assert.equal(event.sender, contents);
			assert.equal(identity, "probe-document");
			dispatch(() => owner.restore(pointerPositionSchema.parse(point)));
			restored.resolve(point);
		});
		await window.loadURL(
			"data:text/html," +
				encodeURIComponent(`<!doctype html>
<style>body{margin:0}#surface{position:absolute;inset:0 auto auto 0;width:800px;height:250px}
#target{position:absolute;left:0;top:300px;width:700px;height:120px}</style>
<canvas id="surface"></canvas><button id="target">Target</button><script>
globalThis.moves=[];globalThis.presses=[];globalThis.releases=0;
addEventListener('mousemove',e=>moves.push({x:e.clientX,y:e.clientY,mx:e.movementX,my:e.movementY}));
addEventListener('mousedown',e=>presses.push({target:e.target.id,x:e.clientX,y:e.clientY}));
addEventListener('mouseup',()=>releases++);
</script>`),
		);
		window.focus();
		contents.focus();
		// Observe dispatch itself; animation frames can pause when the probe is occluded.
		const waitFor = async (condition) => {
			waitingFor = condition;
			while (!(await contents.executeJavaScript(condition)))
				await new Promise((resolve) => setTimeout(resolve, 10));
		};
		const origin = { x: 100, y: 100, globalX: 122, globalY: 185 };
		const displaced = { x: 200, y: 350, globalX: 222, globalY: 435 };
		const input = (type, position) =>
			dispatch(() =>
				contents.sendInputEvent({ type, button: "left", ...position }),
			);
		const lock = (locked) =>
			contents.executeJavaScriptInIsolatedWorld(999, [
				{
					code: `Object.defineProperty(document,'pointerLockElement',{configurable:true,value:${locked ? "document.getElementById('surface')" : "null"}});document.dispatchEvent(new Event('pointerlockchange'));`,
				},
			]);
		input("mouseMove", origin);
		input("mouseDown", origin);
		await waitFor("presses.length === 1");
		await lock(true);
		input("mouseMove", displaced);
		input("mouseUp", displaced);
		await waitFor("releases === 1");
		await lock(false);
		waitingFor = "the preload's restoration request";
		assert.deepEqual(await restored.promise, origin);
		await waitFor("document.getElementById('surface').matches(':hover')");

		input("mouseDown", displaced);
		input("mouseUp", displaced);
		await waitFor("releases === 2");
		assert.deepEqual(await contents.executeJavaScript("presses.at(-1)"), {
			target: "surface",
			x: origin.x,
			y: origin.y,
		});

		// Restart without an unlocked movement. Only the new displacement may reach the camera.
		input("mouseDown", displaced);
		await waitFor("presses.length === 3");
		await lock(true);
		input("mouseMove", {
			...displaced,
			x: displaced.x + 1,
			globalX: displaced.globalX + 1,
		});
		await waitFor(`moves.at(-1)?.x === ${displaced.x + 1}`);
		const firstMove = await contents.executeJavaScript("moves.at(-1)");
		assert.equal(firstMove.mx, 1);
		assert.equal(firstMove.my, 0);
		input("mouseUp", displaced);
		await waitFor("releases === 3");
		await lock(false);
		await waitFor(`moves.at(-1)?.x === ${origin.x}`);

		input("mouseMove", displaced);
		input("mouseDown", displaced);
		input("mouseUp", displaced);
		await waitFor("releases === 4");
		assert.deepEqual(await contents.executeJavaScript("presses.at(-1)"), {
			target: "target",
			x: displaced.x,
			y: displaced.y,
		});
		console.log(
			JSON.stringify({
				pass: true,
				lockLifecycle: "simulated",
				hoverRestored: true,
				stationaryClickCorrected: true,
				orbitRestartDelta: { x: firstMove.mx, y: firstMove.my },
				movementRetiresCorrection: true,
			}),
		);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		clearTimeout(timeout);
		window?.destroy();
		app.exit(process.exitCode ?? 0);
	}
}
