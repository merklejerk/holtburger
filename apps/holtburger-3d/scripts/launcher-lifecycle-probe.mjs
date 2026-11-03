#!/usr/bin/env node
// Behavior/resource verification only. No screenshots or visual acceptance judgments.
import { spawn } from "node:child_process";
import electronPath from "electron";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createCdpClient } from "./cdp-client.mjs";
import { findAvailablePort } from "./dev-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspace = resolve(appRoot, "../..");
const { values } = parseArgs({
	options: {
		assets: { type: "string" },
		package: { type: "string" },
		"quit-during-attempt": { type: "boolean" },
		"tree-stats": { type: "boolean" },
		"connection-failure-only": { type: "boolean" },
		"profile-content-only": { type: "boolean" },
		"app-settings-only": { type: "boolean" },
		"dev-restart-only": { type: "boolean" },
	},
});
const directory = await mkdtemp(join(tmpdir(), "h3d-launcher-probe-"));
const config = join(directory, "config");
const profileName = values.package ? "holtburger-3d" : "holtburger-3d-dev";
const userData = join(config, profileName);
await mkdir(userData, { recursive: true });
const preference = join(userData, "content-selection.json");
const appSettingsFile = join(userData, "app-settings.json");
if (values["app-settings-only"] || values["dev-restart-only"]) {
	await writeFile(
		appSettingsFile,
		JSON.stringify({
			version: 1,
			settings: { graphicsBackend: "automatic", vsync: false },
		}),
	);
}
const initialPreference = {
	version: 1,
	selection: {
		kind: "selected",
		location: join(directory, "old-assets"),
		health: { kind: "ready" },
	},
};
await writeFile(preference, JSON.stringify(initialPreference));
const contentProfiles = {
	serverId: randomUUID(),
	firstId: randomUUID(),
	secondId: randomUUID(),
	firstPath: join(directory, "profile-a "),
	secondPath: join(directory, "profile-b"),
};
if (values["profile-content-only"]) {
	await writeFile(
		join(userData, "launcher-settings.json"),
		JSON.stringify({
			version: 5,
			servers: [
				{
					id: contentProfiles.serverId,
					name: "Content probe",
					endpoint: { host: "127.0.0.1", port: 1 },
				},
			],
			profiles: [
				{
					id: contentProfiles.firstId,
					name: "Content A",
					serverId: contentProfiles.serverId,
					// Unreadable credentials must not prevent initialization of the CLI content draft.
					credentials: {
						version: 1,
						nonce: "",
						ciphertext: "",
						authenticationTag: "",
					},
					contentPath: contentProfiles.firstPath,
				},
				{
					id: contentProfiles.secondId,
					name: "Content B",
					serverId: contentProfiles.serverId,
					credentials: null,
					contentPath: contentProfiles.secondPath,
				},
			],
			serverCredentials: {},
			window: { normalBounds: { width: 1100, height: 850 }, maximized: false },
			lastSelection: {
				serverId: contentProfiles.serverId,
				profileId: contentProfiles.firstId,
			},
			lastProfileByServer: {
				[contentProfiles.serverId]: contentProfiles.firstId,
			},
		}),
	);
}
const assets = values.assets
	? resolve(values.assets)
	: join(directory, "assets");
if (!values.assets) {
	await mkdir(assets);
}
const port = await findAvailablePort();
const origin = `http://127.0.0.1:${port}`;
const preview =
	values.package || values["dev-restart-only"]
		? null
		: spawn(
				process.execPath,
				[
					join(appRoot, "node_modules/vite/bin/vite.js"),
					"preview",
					"--host",
					"127.0.0.1",
					"--port",
					String(port),
					"--strictPort",
				],
				{ cwd: appRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
			);
let output = "";
let child;
let browser;
let inspector;
let page;
let status = null;
const report = {
	assetMode: values.assets
		? "external diagnostic assets"
		: "empty temporary asset directory",
	snapshots: [],
	scenarios: [],
};
function requireCondition(condition, message) {
	if (!condition) throw new Error(message);
}
async function waitFor(read, label) {
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		if (status !== null)
			throw new Error(
				`Electron stopped while waiting for ${label}: ${JSON.stringify(status)}\n${output}`,
			);
		try {
			const result = await read();
			if (result) return result;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!/Execution context was destroyed|Cannot find context|Document request admission is closed|Inspected target navigated or closed/.test(
					error.message,
				)
			)
				throw error;
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`Timed out waiting for ${label}\n${output}`);
}
async function evaluate(client, expression) {
	const result = await client.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result.exceptionDetails)
		throw new Error(JSON.stringify(result.exceptionDetails));
	return result.result?.value;
}
/** Real browser key events prove native focus movement; synthetic DOM keys cannot. */
async function pressTab(shift = false) {
	await page.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
		modifiers: shift ? 8 : 0,
	});
	await page.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
		modifiers: shift ? 8 : 0,
	});
}
/** Include text so Chromium performs the same implicit submission as a physical Enter press. */
async function pressEnter() {
	await page.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		text: "\r",
	});
	await page.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
}
async function attach(role) {
	page?.close();
	const target = await waitFor(async () => {
		const { targetInfos } = await browser.send("Target.getTargets");
		const pages = targetInfos.filter((target) => target.type === "page");
		requireCondition(
			pages.length <= 1,
			`Expected one product page, received ${pages.length}`,
		);
		if (pages.length === 0) return false;
		return pages.find((target) => target.url.includes(`/${role}/`));
	}, `${role} document`);
	const endpoint = await fetch(
		`http://127.0.0.1:${new URL(browserEndpoint).port}/json/list`,
	).then((response) => response.json());
	const details = endpoint.find((value) => value.id === target.targetId);
	requireCondition(details, "Missing page debugger endpoint");
	page = await createCdpClient(details.webSocketDebuggerUrl);
	await waitFor(
		() =>
			evaluate(
				page,
				`location.pathname.includes('/${role}/') && Boolean(document.querySelector('#app.ui-theme .client-pregame-screen')) && ${role === "launcher" ? "window.holtburgerLauncher.snapshot().then((value) => value.canPlay)" : "window.holtburgerContent.snapshot().then(() => true)"}`,
			),
		`mounted and admitted ${role} document`,
	);
	const nativeWindow = await evaluate(
		inspector,
		"Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then((electron) => electron.BrowserWindow.getAllWindows().map((window) => window.id))",
	);
	requireCondition(nativeWindow.length === 1, "Expected one native window");
	if (windowId === null) windowId = nativeWindow[0];
	requireCondition(
		nativeWindow[0] === windowId,
		"Application created another native window",
	);
}
let browserEndpoint;
let windowId = null;
async function snapshot(label) {
	const native = await evaluate(
		inspector,
		`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then((electron) => ({
    windows: electron.BrowserWindow.getAllWindows().length,
    visible: electron.BrowserWindow.getAllWindows()[0]?.isVisible() === true,
    metrics: electron.app.getAppMetrics().map(({type, memory, cpu}) => ({type, memory, cpu})),
    children: process._getActiveHandles().filter((handle) => handle.constructor.name === 'ChildProcess').map((handle) => ({pid: handle.pid, exitCode: handle.exitCode, spawnfile: handle.spawnfile}))
  }))`,
	);
	const renderer = await evaluate(
		page,
		`({canvases: document.querySelectorAll('canvas').length, resources: performance.getEntriesByType('resource').map((value) => value.name)})`,
	);
	requireCondition(native.windows === 1, "Expected one native BrowserWindow");
	report.snapshots.push({ label, native, renderer });
	return { native, renderer };
}
async function runProbe() {
	if (values["dev-restart-only"]) {
		await runDevRestartProbe();
		return;
	}
	if (preview) {
		for (const stream of [preview.stdout, preview.stderr])
			stream.on("data", (chunk) => {
				output += chunk;
			});
		await waitFor(async () => {
			try {
				return (await fetch(`${origin}/launcher/index.html`)).ok;
			} catch {
				return false;
			}
		}, "preview server");
	}
	const switches = [
		"--inspect=0",
		"--remote-debugging-port=0",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-sandbox",
	];
	const gameArgs = [
		...(values["profile-content-only"]
			? ["--no-content-search"]
			: ["--clear-content"]),
		"--content",
		assets,
		"--settings-file",
		join(userData, "client-settings.json"),
	];
	child = values.package
		? spawn(
				resolve(values.package),
				[`--user-data-dir=${userData}`, ...switches, ...gameArgs],
				{
					cwd: appRoot,
					env: { ...process.env, XDG_CONFIG_HOME: config },
					stdio: ["ignore", "pipe", "pipe"],
				},
			)
		: spawn(electronPath, [...switches, ".", ...gameArgs], {
				cwd: appRoot,
				env: {
					...process.env,
					XDG_CONFIG_HOME: config,
					APPDATA: config,
					LOCALAPPDATA: join(directory, "local"),
					XDG_DATA_HOME: join(directory, "data"),
					XDG_CACHE_HOME: join(directory, "cache"),
					HOLTBURGER_ELECTRON_DEV_ORIGIN: origin,
					HOLTBURGER_HOST_BIN: join(
						workspace,
						"target/debug/holtburger-3d-host",
					),
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
	child.on("error", (error) => {
		output += error.stack;
	});
	child.on("close", (code, signal) => {
		status = { code, signal };
	});
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			output += chunk;
		});
	browserEndpoint = await waitFor(
		() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],
		"browser debugging endpoint",
	);
	const inspectorEndpoint = await waitFor(
		() => output.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1],
		"main debugging endpoint",
	);
	browser = await createCdpClient(browserEndpoint);
	inspector = await createCdpClient(inspectorEndpoint);
	await attach("launcher");
	if (values["app-settings-only"]) {
		const startup = await evaluate(
			inspector,
			`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ app }) => ({ angle: app.commandLine.getSwitchValue('use-angle'), vsyncDisabled: app.commandLine.hasSwitch('disable-gpu-vsync') }))`,
		);
		requireCondition(
			startup.angle === "swiftshader" && startup.vsyncDisabled,
			"Startup preferences must apply before ready and preserve explicit backend overrides",
		);
		await evaluate(
			inspector,
			`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ app }) => {
globalThis.__originalGpuInfo = app.getGPUInfo;
app.getGPUInfo = () => new Promise((resolve) => { globalThis.__releaseGpuInfo = () => resolve({gpuDevice: [], auxAttributes: {}}); });
})`,
		);
		try {
			await evaluate(
				page,
				`document.querySelector('button[aria-label="App settings"]').click()`,
			);
			await waitFor(
				() => evaluate(inspector, `Boolean(globalThis.__releaseGpuInfo)`),
				"pending GPU query",
			);
			const cancelled = await evaluate(
				page,
				`(() => {
const button = [...document.querySelectorAll('.app-settings-dialog button')].find((node) => node.textContent.trim() === 'Cancel');
if (!button || button.disabled) return false;
button.click(); return true;
})()`,
			);
			requireCondition(
				cancelled,
				"Settings loading must remain cancellable during a pending GPU query",
			);
			await waitFor(
				() => evaluate(page, `!document.querySelector('.app-settings-dialog')`),
				"cancelled loading modal",
			);
			report.scenarios.push(
				"Settings loading remains cancellable while native GPU information is pending",
			);
		} finally {
			await evaluate(
				inspector,
				`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ app }) => {
app.getGPUInfo = globalThis.__originalGpuInfo;
globalThis.__releaseGpuInfo?.();
delete globalThis.__originalGpuInfo; delete globalThis.__releaseGpuInfo;
})`,
			);
		}
		await evaluate(
			page,
			`document.querySelector('button[aria-label="App settings"]').click()`,
		);
		await waitFor(
			() =>
				evaluate(
					page,
					`Boolean(document.querySelector('.app-settings-dialog select'))`,
				),
			"loaded app settings modal",
		);
		const initial = await evaluate(
			page,
			`window.holtburgerLauncher.appSettings()`,
		);
		requireCondition(
			initial.settings.vsync === false &&
				initial.overrides.includes("--use-angle"),
			"Modal must expose saved preferences and diagnostic overrides",
		);
		requireCondition(
			initial.diagnostic === null,
			`Could not read graphics information: ${JSON.stringify(initial)}`,
		);
		const displayedRenderer = await evaluate(
			page,
			`document.querySelector('.app-settings-dialog dd').textContent.trim()`,
		);
		requireCondition(
			displayedRenderer === (initial.renderer ?? "Not reported by Chromium"),
			"Modal must distinguish actual renderer information from an uninitialized GPU",
		);
		const clipboardBefore = await evaluate(
			inspector,
			`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ clipboard }) => clipboard.readText())`,
		);
		try {
			await evaluate(
				page,
				`document.querySelector('.app-settings-dialog details').open = true; [...document.querySelectorAll('.app-settings-dialog button')].find((button) => button.textContent.trim() === 'Copy hardware info').click()`,
			);
			await waitFor(async () => {
				const state = await evaluate(
					page,
					`({copied: [...document.querySelectorAll('.app-settings-dialog button')].some((node) => node.textContent.trim() === 'Copied!'), error: document.querySelector('.app-settings-dialog [role=alert]')?.textContent})`,
				);
				if (state.error)
					throw new Error(`Hardware info copy failed: ${state.error}`);
				return state.copied;
			}, "hardware report clipboard confirmation");
			const copied = await evaluate(
				inspector,
				`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ clipboard }) => clipboard.readText())`,
			);
			const hardwareReport = JSON.parse(copied);
			requireCondition(
				hardwareReport.application &&
					hardwareReport.system &&
					hardwareReport.display &&
					hardwareReport.launcherWebgl2Probe,
				"Clipboard is missing hardware report sections",
			);
			requireCondition(
				copied.includes('"unmaskedRenderer"') ||
					copied.includes("Unavailable: WebGL2 context creation failed"),
				"Hardware report must contain WebGL evidence or its failure state",
			);
			requireCondition(
				!copied.includes(directory) &&
					!copied.includes("probe-secret") &&
					!copied.includes("client-settings.json"),
				"Hardware report leaked launch paths or credentials",
			);
			await waitFor(
				() =>
					evaluate(
						page,
						`[...document.querySelectorAll('.app-settings-dialog button')].some((button) => button.textContent.trim() === 'Copy hardware info')`,
					),
				"copy button label recovery",
			);
			report.scenarios.push(
				"Copy hardware info writes one JSON object, briefly shows Copied!, and restores its label",
			);
		} finally {
			await evaluate(
				inspector,
				`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ clipboard }) => clipboard.writeText(${JSON.stringify(clipboardBefore)}))`,
			);
		}
		const savedSource = await readFile(appSettingsFile, "utf8");
		await evaluate(
			page,
			`document.querySelector('.app-settings-dialog input[type=checkbox]').click(); [...document.querySelectorAll('.app-settings-dialog button')].find((button) => button.textContent.trim() === 'Cancel').click()`,
		);
		requireCondition(
			(await readFile(appSettingsFile, "utf8")) === savedSource,
			"Cancel must discard the draft",
		);
		await evaluate(
			page,
			`document.querySelector('button[aria-label="App settings"]').click()`,
		);
		await waitFor(
			() =>
				evaluate(
					page,
					`Boolean(document.querySelector('.app-settings-dialog select'))`,
				),
			"restart app settings modal",
		);
		await evaluate(
			page,
			`[...document.querySelectorAll('.app-settings-dialog button')].find((button) => button.textContent.trim() === 'Use defaults').click()`,
		);
		const draftUi = await evaluate(
			page,
			`({ backend: document.querySelector('.app-settings-dialog select').value, checked: document.querySelector('.app-settings-dialog input[type=checkbox]').checked })`,
		);
		requireCondition(
			draftUi.backend === initial.defaults.graphicsBackend &&
				draftUi.checked === initial.defaults.vsync,
			`Use defaults did not restore native platform settings: ${JSON.stringify(draftUi)}`,
		);
		report.scenarios.push(
			"native startup preferences, backend override precedence, actual renderer diagnostics, platform defaults reset, and draft cancellation",
		);
		// Intercept only spawning the replacement, so the production restart still drains and exits.
		// This avoids leaving an untracked Electron process after the probe cleans its user data.
		const relaunchMarker = join(directory, "relaunch-requested");
		await evaluate(
			inspector,
			`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(({ app }) => { app.relaunch = () => process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(relaunchMarker)}, 'requested'); })`,
		);
		await evaluate(
			page,
			`setTimeout(() => [...document.querySelectorAll('.app-settings-dialog button')].find((button) => button.textContent.trim() === 'Save and restart').click(), 0)`,
		);
		// Node's inspector keeps a quitting process alive until its debugger detaches.
		inspector.close();
		inspector = null;
		const restartDeadline = Date.now() + 10000;
		while (status === null && Date.now() < restartDeadline)
			await new Promise((done) => setTimeout(done, 100));
		requireCondition(
			status?.code === 0,
			`Restart shutdown failed: ${JSON.stringify(status)}`,
		);
		requireCondition(
			(await readFile(relaunchMarker, "utf8")) === "requested",
			"Clean native shutdown did not request app relaunch",
		);
		const saved = JSON.parse(await readFile(appSettingsFile, "utf8"));
		requireCondition(
			saved.settings.graphicsBackend === initial.defaults.graphicsBackend &&
				saved.settings.vsync === initial.defaults.vsync,
			"Save and restart did not persist the draft",
		);
		report.scenarios.push(
			"Save and restart flushes native state, requests relaunch, and exits cleanly (replacement spawn intercepted)",
		);
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	if (values["connection-failure-only"]) {
		requireCondition(
			Boolean(values.assets),
			"Connection failure probe requires --assets",
		);
		const serverId = randomUUID();
		await evaluate(
			page,
			`window.holtburgerLauncher.saveServer(${JSON.stringify({ id: serverId, name: "Connection failure probe", endpoint: { host: "127.0.0.1", port: 1 } })})`,
		);
		await evaluate(
			page,
			`window.holtburgerLauncher.play(${JSON.stringify({ serverId, profileId: null, contentPath: assets, credentials: { account: "launcher-probe", password: "probe-secret" } })})`,
		);
		await attach("client");
		await attach("launcher");
		const returned = await evaluate(
			page,
			"window.holtburgerLauncher.snapshot()",
		);
		requireCondition(
			returned.canPlay &&
				returned.failure?.includes(
					"Login failed: Connection timed out: no server traffic",
				),
			"Shared timeout explanation was lost during native return",
		);
		const resources = await snapshot("picker after connection failure");
		requireCondition(
			resources.native.children.length === 0 &&
				resources.renderer.canvases === 0,
			"Failed attempt retained native or renderer resources",
		);
		requireCondition(
			await evaluate(
				page,
				"document.querySelector('.launcher-error[role=alert]')?.textContent.includes('no server traffic')",
			),
			"Launcher did not render the shared timeout explanation",
		);
		const desktopNotice = await evaluate(
			page,
			`(() => {
            const notice = document.querySelector('.launcher-error');
            const box = notice.getBoundingClientRect();
            const brand = document.querySelector('.pregame-brand').getBoundingClientRect();
            const content = document.querySelector('.pregame-content').getBoundingClientRect();
            return { besideBrand: box.left >= brand.right, aboveContent: box.bottom <= content.top,
                framed: parseFloat(getComputedStyle(notice).borderTopWidth) > 0,
                insideViewport: box.right <= innerWidth };
        })()`,
		);
		requireCondition(
			Object.values(desktopNotice).every(Boolean),
			`Invalid header notice layout: ${JSON.stringify(desktopNotice)}`,
		);
		await evaluate(
			inspector,
			"Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(electron => electron.BrowserWindow.getAllWindows()[0].setContentSize(680, 760))",
		);
		await waitFor(
			() => evaluate(page, "innerWidth <= 720"),
			"narrow launcher viewport",
		);
		requireCondition(
			await evaluate(
				page,
				`(() => {
            const notice = document.querySelector('.launcher-error').getBoundingClientRect();
            const brand = document.querySelector('.pregame-brand').getBoundingClientRect();
            const content = document.querySelector('.pregame-content').getBoundingClientRect();
            return notice.left >= brand.right && notice.right <= innerWidth && notice.bottom <= content.top;
        })()`,
			),
			"Narrow header notice overlaps branding or controls",
		);
		await evaluate(
			page,
			"document.querySelector('button[aria-label=\"Dismiss error\"]').click()",
		);
		await waitFor(
			() =>
				evaluate(page, "document.querySelector('.launcher-error') === null"),
			"dismissed header notice",
		);
		requireCondition(
			await evaluate(
				page,
				"window.holtburgerLauncher.snapshot().then(value => value.canPlay && value.failure !== null)",
			),
			"Dismissal altered the retained failure or disabled Play",
		);
		await evaluate(
			page,
			`window.holtburgerLauncher.play(${JSON.stringify({ serverId, profileId: null, contentPath: assets, credentials: { account: "launcher-probe", password: "probe-secret" } })})`,
		);
		await attach("client");
		await attach("launcher");
		requireCondition(
			await evaluate(
				page,
				"document.querySelector('.launcher-error[role=alert]')?.textContent.includes('no server traffic')",
			),
			"A later failure did not show a new notice",
		);
		report.scenarios.push(
			"framed header notice sits beside branding, wraps above controls in a narrow window, dismisses locally, and reappears for a later failure",
			"login timeout survives native retirement and renders in the usable launcher; no host or canvas remains",
		);
		await quitAndReport();
		return;
	}
	const initial = await snapshot("picker initial");
	requireCondition(
		initial.native.visible,
		"Mounted launcher remained hidden after its document loaded",
	);
	requireCondition(
		JSON.stringify(JSON.parse(await readFile(preference, "utf8"))) ===
			JSON.stringify(initialPreference),
		"Idle picker consumed clear-content before Play",
	);
	requireCondition(
		initial.native.children.length === 0 && initial.renderer.canvases === 0,
		"Picker constructed game resources",
	);
	requireCondition(
		!initial.renderer.resources.some((name) =>
			/ClientApp-|client-presentation-root-|terrain-worker/.test(name),
		),
		"Picker imported game composition",
	);
	const click = (text) =>
		evaluate(
			page,
			`(() => { const button = [...document.querySelectorAll('button')].find((value) => (value.getAttribute('aria-label') ?? value.textContent.trim()) === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)}); button.closest('details:not([open])')?.querySelector('summary').click(); button.click(); })()`,
		);
	const fill = (scope, label, value) =>
		evaluate(
			page,
			`(() => { const row = [...document.querySelectorAll(${JSON.stringify(scope + " label")})].find((value) => value.textContent.trim() === ${JSON.stringify(label)}); const input = row?.querySelector('input'); if (!input) throw new Error('Missing input: ' + ${JSON.stringify(label)}); input.closest('details:not([open])')?.querySelector('summary').click(); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
		);
	if (values["profile-content-only"]) {
		const input =
			"document.querySelector('input[placeholder=\"Use application default\"]')";
		const ready = () =>
			waitFor(
				() =>
					evaluate(
						page,
						"document.querySelector('.launcher')?.getAttribute('aria-busy') === 'false'",
					),
				"ready content draft",
			);
		const selectProfile = async (id) => {
			await evaluate(
				page,
				`(() => { const select = document.querySelector('.launcher-profile select'); select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
			);
			await ready();
		};
		await ready();
		requireCondition(
			await evaluate(
				page,
				`!document.querySelector('.launcher-advanced').open && !${input}.checkVisibility()`,
			),
			"Advanced controls did not start collapsed",
		);
		await evaluate(
			page,
			"document.querySelector('.launcher-advanced summary').focus()",
		);
		await pressEnter();
		requireCondition(
			await evaluate(
				page,
				"document.querySelector('.launcher-advanced').open && getComputedStyle(document.querySelector('.launcher-advanced-content')).borderTopWidth !== '0px'",
			),
			"Advanced did not expand with a visible frame",
		);
		await pressEnter();
		requireCondition(
			await evaluate(
				page,
				"!document.querySelector('.launcher-advanced').open",
			),
			"Advanced did not collapse by keyboard",
		);
		requireCondition(
			await evaluate(page, `${input}.value === ${JSON.stringify(assets)}`),
			"CLI content did not initialize the remembered profile draft",
		);
		await selectProfile(contentProfiles.secondId);
		requireCondition(
			await evaluate(
				page,
				`${input}.value === ${JSON.stringify(contentProfiles.secondPath)}`,
			),
			"Profile B did not replace CLI content",
		);
		await selectProfile(contentProfiles.firstId);
		await fill(".launcher-profile", "Account", "content-probe");
		await click("Overwrite profile");
		await ready();
		const overwriteDisabled =
			"[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Overwrite profile').disabled";
		requireCondition(
			await evaluate(page, overwriteDisabled),
			"Saved profile baseline remained dirty",
		);
		await fill(
			".launcher-profile",
			"Content path override",
			contentProfiles.secondPath,
		);
		requireCondition(
			!(await evaluate(page, overwriteDisabled)),
			"Path-only change did not enable Overwrite",
		);
		await fill(
			".launcher-profile",
			"Content path override",
			contentProfiles.firstPath,
		);
		requireCondition(
			await evaluate(page, overwriteDisabled),
			"Reverted path remained dirty",
		);
		await click("Use application default");
		await click("Overwrite profile");
		await ready();
		requireCondition(
			(
				await evaluate(page, "window.holtburgerLauncher.snapshot()")
			).profiles.find((profile) => profile.id === contentProfiles.firstId)
				.contentPath === null,
			"Clearing a profile did not persist the default selection",
		);
		await fill(
			".launcher-profile",
			"Content path override",
			contentProfiles.firstPath,
		);
		await click("Overwrite profile");
		await ready();
		let expectedPreference = await readFile(preference, "utf8");
		for (const [profileId, location, useDefault] of [
			[contentProfiles.firstId, contentProfiles.firstPath, false],
			[contentProfiles.firstId, initialPreference.selection.location, true],
			[contentProfiles.secondId, contentProfiles.secondPath, false],
		]) {
			await selectProfile(profileId);
			await fill(".launcher-profile", "Account", "content-probe");
			if (useDefault) await click("Use application default");
			await click("Play");
			await attach("client");
			await waitFor(
				() =>
					evaluate(
						page,
						`window.holtburgerContent.snapshot().then(value => value.phase.kind === 'needs_assets' && value.phase.location === ${JSON.stringify(location)})`,
					),
				"attempt selected expected content",
			);
			const currentPreference = await readFile(preference, "utf8");
			if (useDefault) {
				requireCondition(
					JSON.parse(currentPreference).selection.location ===
						initialPreference.selection.location,
					"Default recovery replaced the saved location",
				);
				expectedPreference = currentPreference;
			} else
				requireCondition(
					currentPreference === expectedPreference,
					"Profile attempt changed global content preferences",
				);
			const longDiagnostic =
				profileId === contentProfiles.secondId
					? "Content diagnostic with a long path and details.\n".repeat(100)
					: null;
			await evaluate(
				page,
				`window.holtburgerLauncher.back(${JSON.stringify(longDiagnostic)})`,
			);
			await attach("launcher");
			await ready();
			const expectedPath =
				profileId === contentProfiles.firstId
					? contentProfiles.firstPath
					: contentProfiles.secondPath;
			requireCondition(
				await evaluate(
					page,
					`${input}.value === ${JSON.stringify(expectedPath)}`,
				),
				"Returning to launcher did not restore the remembered profile path",
			);
			requireCondition(
				(await snapshot("profile content attempt retired")).native.children
					.length === 0,
				"Retired content host survived",
			);
		}
		for (const width of [1100, 680]) {
			await evaluate(
				inspector,
				`Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then(electron => electron.BrowserWindow.getAllWindows()[0].setContentSize(${width}, 760))`,
			);
			await waitFor(
				() => evaluate(page, `innerWidth === ${width}`),
				"notice viewport resize",
			);
			// Re-loading the same native snapshot restores the diagnostic after the prior local dismissal.
			if (width === 680) {
				await evaluate(page, "location.reload()");
				await attach("launcher");
				await ready();
			}
			const before = await evaluate(
				page,
				`(() => {
				const profile = document.querySelector('.launcher-profile');
				const content = document.querySelector('.pregame-content').getBoundingClientRect();
				const message = document.querySelector('.launcher-error-message');
				const notice = document.querySelector('.launcher-error').getBoundingClientRect();
				const brand = document.querySelector('.pregame-brand').getBoundingClientRect();
				return { height: profile.clientHeight, scrollHeight: profile.scrollHeight, contentTop: content.top, contentHeight: content.height,
					truncated: message.scrollWidth > message.clientWidth && getComputedStyle(message).textOverflow === 'ellipsis' && getComputedStyle(message).whiteSpace === 'nowrap',
					contained: notice.left >= brand.right && notice.right <= innerWidth && notice.bottom <= content.top };
			})()`,
			);
			requireCondition(
				before.truncated && before.contained,
				`Error did not truncate inside branding height: ${JSON.stringify(before)}`,
			);
			await click("View full error");
			await waitFor(
				() =>
					evaluate(
						page,
						"document.querySelector('.launcher-error-dialog')?.open",
					),
				"full error dialog",
			);
			requireCondition(
				await evaluate(
					page,
					`(() => {
					const details = document.querySelector('.launcher-error-details');
					return details.textContent === document.querySelector('.launcher-error-message').textContent &&
						details.scrollHeight > details.clientHeight && getComputedStyle(details).overflowY === 'auto';
				})()`,
				),
				"Full error text was not preserved in a scrollable dialog",
			);
			await click("Close");
			await waitFor(
				() =>
					evaluate(
						page,
						"document.querySelector('.launcher-error-dialog') === null",
					),
				"closed error dialog",
			);
			await click("Dismiss error");
			const after = await evaluate(
				page,
				`(() => {
				const profile = document.querySelector('.launcher-profile');
				const content = document.querySelector('.pregame-content').getBoundingClientRect();
				return { height: profile.clientHeight, scrollHeight: profile.scrollHeight, contentTop: content.top, contentHeight: content.height };
			})()`,
			);
			requireCondition(
				before.height === after.height &&
					before.scrollHeight === after.scrollHeight &&
					before.contentTop === after.contentTop &&
					before.contentHeight === after.contentHeight,
				`Error changed form geometry at ${width}px: ${JSON.stringify({ before, after })}`,
			);
		}
		report.scenarios.push(
			"Advanced starts collapsed, supports keyboard toggling, and frames content overrides; long errors truncate and open full scrollable details without changing form geometry at desktop and narrow widths",
			"CLI initializes once despite unreadable credentials; profile paths preserve whitespace, dirty/revert, saved clearing, A/default/B attempts, recovery isolation, and launcher restoration pass",
		);
		await quitAndReport();
		return;
	}

	await waitFor(
		() =>
			evaluate(
				page,
				"Boolean([...document.querySelectorAll('button')].find((value) => value.textContent.trim() === 'Add server' && !value.disabled))",
			),
		"ready launcher controls",
	);
	await evaluate(page, "document.activeElement.blur()");
	await pressTab();
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.textContent.trim() === 'Add server'",
		),
		"Initial Tab did not enter launcher controls",
	);
	await pressTab();
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.textContent.trim() === 'Import from TreeStats'",
		),
		"Tab did not advance between launcher actions",
	);
	await pressTab(true);
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.textContent.trim() === 'Add server'",
		),
		"Shift+Tab did not reverse launcher navigation",
	);
	requireCondition(
		await evaluate(
			page,
			`(() => {
		const play = document.querySelector('.launcher-play');
		const frame = getComputedStyle(play, '::before');
		const icon = getComputedStyle(document.querySelector('.launcher-password .ui-icon-button'));
		const quiet = getComputedStyle(document.querySelector('.pregame-footer button'));
		return getComputedStyle(play).clipPath.startsWith('polygon(') && frame.borderImageSource !== 'none' && frame.pointerEvents === 'none' && icon.width === icon.height && icon.minHeight === '0px' && quiet.clipPath === 'none';
	})()`,
		),
		"Launcher must inherit pregame action frames while retaining compact icons and quiet controls",
	);
	report.scenarios.push(
		"production pregame action frames, compact icon geometry, and quiet-action exclusions are inherited",
	);
	// Explicit opt-in: ordinary lifecycle runs and unit tests never depend on the public API.
	if (values["tree-stats"]) {
		// Hold one native fetch so loading assertions do not depend on network timing.
		const holdDirectoryFetch = () =>
			evaluate(
				inspector,
				`(() => {
			const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
			const {app} = require('electron');
			const {ServerDirectoryCatalog} = require(app.getAppPath() + '/dist-electron/electron/server-directory.js');
			const load = ServerDirectoryCatalog.prototype.load;
			ServerDirectoryCatalog.prototype.load = function(refresh) {
				ServerDirectoryCatalog.prototype.load = load;
				return new Promise(resolve => {globalThis.__h3dReleaseDirectory = resolve;}).then(() => load.call(this, refresh));
			};
		})()`,
			);
		const releaseDirectoryFetch = () =>
			evaluate(
				inspector,
				"globalThis.__h3dReleaseDirectory(); delete globalThis.__h3dReleaseDirectory; true",
			);
		await holdDirectoryFetch();
		await click("Import from TreeStats");
		await waitFor(
			() =>
				evaluate(
					page,
					"Boolean(document.querySelector('.directory-results-region .directory-loading[role=status] svg'))",
				),
			"initial directory loading spinner",
		);
		await releaseDirectoryFetch();
		await waitFor(
			() =>
				evaluate(
					page,
					"document.querySelectorAll('.directory-row button:not(:disabled)').length > 0",
				),
			"live TreeStats directory",
		);
		requireCondition(
			await evaluate(page, "!document.querySelector('.directory-loading')"),
			"Loading spinner survived completed fetch",
		);
		requireCondition(
			await evaluate(
				page,
				`(() => {const style = getComputedStyle(document.querySelector('.directory-sort')); return style.minHeight === '0px' && style.paddingTop === '4px' && style.paddingLeft === '8px';})()`,
			),
			"Compact directory sorting dimensions lost to shared pregame overrides",
		);
		const alphabetical = await evaluate(
			page,
			"[...document.querySelectorAll('.directory-row summary strong')].map(name => name.textContent)",
		);
		await evaluate(
			page,
			"document.querySelector('[aria-label=\"Sort servers: Name\"]').click()",
		);
		requireCondition(
			await evaluate(
				page,
				`(() => {
				const rows = [...document.querySelectorAll('.directory-row')].map(row => {
					const field = [...row.querySelectorAll('dt')].find(field => field.textContent === 'Reported players');
					const report = field.nextElementSibling.textContent.trim();
					return { name: row.querySelector('summary strong').textContent, population: report === 'Not reported' ? -1 : Number(report) };
				});
				return rows.every((row, index) => index === 0 || rows[index - 1].population > row.population ||
					(rows[index - 1].population === row.population && rows[index - 1].name.localeCompare(row.name) <= 0));
			})()`,
			),
			"Population sort did not order reported counts descending, unknown reports last, and ties by name",
		);
		await evaluate(
			page,
			"document.querySelector('[aria-label=\"Sort servers: Population\"]').click()",
		);
		requireCondition(
			JSON.stringify(
				await evaluate(
					page,
					"[...document.querySelectorAll('.directory-row summary strong')].map(name => name.textContent)",
				),
			) === JSON.stringify(alphabetical),
			"Sort did not cycle back to name ordering",
		);
		const candidates = await evaluate(
			page,
			"[...document.querySelectorAll('.directory-row')].filter(row => !row.querySelector('button').disabled).slice(0,2).map(row => ({name:row.querySelector('summary strong').textContent, labels:[...row.querySelectorAll('summary .directory-tag')].map(pill=>pill.textContent)}))",
		);
		requireCondition(
			candidates.length > 0,
			"Live directory has no addable servers",
		);
		requireCondition(
			await evaluate(
				page,
				"document.querySelectorAll('.directory-row details[open]').length === 0",
			),
			"Directory rows did not start collapsed",
		);
		await evaluate(
			page,
			"document.querySelector('.directory-row summary').click()",
		);
		requireCondition(
			await evaluate(
				page,
				"Boolean(document.querySelector('.directory-row details[open] .ui-facts'))",
			),
			"Expanding a server did not reveal its metadata",
		);
		requireCondition(
			await evaluate(
				page,
				`(() => {
				const details = document.querySelector('.directory-row details[open]');
				const fields = [...details.querySelectorAll('.ui-facts dt')].map(field => field.textContent);
				const description = details.querySelector('.directory-description');
				return ['Host', 'Port', 'Reported players'].every(field => fields.includes(field)) &&
					(description === null || (description.querySelector('h3').textContent === 'Description' && Boolean(description.querySelector('p'))));
			})()`,
			),
			"Server metadata did not expose structured fields and a distinct description",
		);
		requireCondition(
			(await evaluate(page, "window.holtburgerLauncher.snapshot()")).servers
				.length === 0,
			"Expansion added a server",
		);
		await evaluate(
			page,
			"document.querySelector('.directory-row summary').click()",
		);
		requireCondition(
			await evaluate(
				page,
				"Boolean(document.querySelector('.directory-filter-disclosure:not([open])')) && !document.querySelector('[aria-label=\"Type filters\"] button').checkVisibility()",
			),
			"Directory filters did not start hidden",
		);
		await evaluate(
			page,
			"document.querySelector('.directory-filter-disclosure summary').click()",
		);

		for (const [group, label] of [
			["Type", candidates[0].labels[0]],
			["Software", candidates[0].labels[1]],
		]) {
			await evaluate(
				page,
				`(() => {const group = document.querySelector('[aria-label="'+${JSON.stringify(group)}+' filters"]'); [...group.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(label)}).click();})()`,
			);
		}
		requireCondition(
			await evaluate(
				page,
				`document.querySelectorAll('.directory-row').length > 0 && [...document.querySelectorAll('.directory-row')].every(row=>JSON.stringify([...row.querySelectorAll('summary .directory-tag')].map(pill=>pill.textContent))===${JSON.stringify(JSON.stringify(candidates[0].labels))})`,
			),
			"Type/software pill filters did not intersect",
		);
		await evaluate(
			page,
			"document.querySelector('.directory-filter-disclosure summary').click()",
		);
		requireCondition(
			await evaluate(
				page,
				"document.querySelector('.directory-filter-disclosure summary').textContent.includes('2 selected')",
			),
			"Collapsed filters did not retain their active-count summary",
		);
		await evaluate(
			page,
			"document.querySelector('.directory-filter-disclosure summary').click()",
		);

		for (const group of ["Type", "Software"])
			await evaluate(
				page,
				`document.querySelector('[aria-label="'+${JSON.stringify(group)}+' filters"] button').click()`,
			);
		await evaluate(
			page,
			"document.querySelector('.directory-filter-disclosure summary').click()",
		);
		requireCondition(
			await evaluate(
				page,
				"Boolean(document.querySelector('.ui-dialog-actions button')) && document.querySelector('.ui-dialog-actions button').textContent.trim() === 'Refresh' && [...document.querySelectorAll('.directory-row button')].every(button => button.classList.contains('ui-icon-button') && Boolean(button.querySelector('svg')))",
			),
			"Refresh was not in the footer or Add did not use icon controls",
		);

		await fill("dialog", "Search servers", candidates[0].name);
		requireCondition(
			await evaluate(
				page,
				"document.querySelectorAll('.directory-row').length > 0",
			),
			"Search removed its matching server",
		);
		await fill("dialog", "Search servers", "");
		for (const candidate of candidates) {
			await evaluate(
				page,
				`(() => {const row=[...document.querySelectorAll('.directory-row')].find(row=>row.querySelector('summary strong').textContent===${JSON.stringify(candidate.name)});row.querySelector('button').click();})()`,
			);
			await waitFor(
				() =>
					evaluate(
						page,
						`Boolean(document.querySelector('dialog')) && [...document.querySelectorAll('.directory-row button')].some(button=>button.getAttribute('aria-label')===${JSON.stringify("Added " + candidate.name)} && button.disabled)`,
					),
				"immediate add with browser retained",
			);
		}
		const imported = await evaluate(
			page,
			"window.holtburgerLauncher.snapshot()",
		);
		requireCondition(
			imported.servers.length === candidates.length &&
				imported.profiles.length === 0,
			"Immediate adds did not create only server definitions",
		);
		requireCondition(
			(await snapshot("directory added without game admission")).native.children
				.length === 0,
			"Directory add started a sidecar",
		);
		await holdDirectoryFetch();
		await click("Refresh");
		await waitFor(
			() =>
				evaluate(
					page,
					"Boolean(document.querySelector('.directory-loading svg')) && document.querySelector('.directory-results').inert",
				),
			"refresh spinner and inactive retained results",
		);
		await releaseDirectoryFetch();
		await waitFor(
			() =>
				evaluate(
					page,
					"document.querySelector('.directory-results').getAttribute('aria-busy') === 'false'",
				),
			"directory refresh",
		);
		requireCondition(
			await evaluate(
				page,
				"!document.querySelector('.directory-loading') && !document.querySelector('.directory-results').inert",
			),
			"Refresh did not restore the interactive server list",
		);
		report.scenarios.push(
			"directory spinner occupies results while initial fetch and refresh are pending, and retires when loading completes",
		);
		requireCondition(
			await evaluate(page, "!document.querySelector('dialog [role=alert]')"),
			"Live directory refresh failed",
		);
		await click("Done");
		await click("Import from TreeStats");
		await waitFor(
			() =>
				evaluate(
					page,
					`document.querySelectorAll('.directory-row button:disabled').length === ${candidates.length}`,
				),
			"already-added directory status",
		);
		await click("Done");
		for (const server of imported.servers)
			await evaluate(
				page,
				`window.holtburgerLauncher.deleteServer(${JSON.stringify(server.id)})`,
			);
		report.scenarios.push(
			"live TreeStats search and collapsed type/software pill filters, plain metadata tags, structured details, disclosure independent of immediate icon Add, browser retained, Added disabled across reopen, explicit refresh, no profiles or sidecar created",
		);
	}
	await click("Add server");
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"server dialog",
	);
	await evaluate(page, "document.querySelector('dialog').focus()");
	await pressTab();
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.closest('label').textContent.trim() === 'Name'",
		),
		"Tab did not enter server editor fields",
	);
	await pressTab();
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.closest('label').textContent.trim() === 'Host'",
		),
		"Tab did not advance in the pregame dialog",
	);
	await pressTab(true);
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.closest('label').textContent.trim() === 'Name'",
		),
		"Shift+Tab did not reverse pregame dialog navigation",
	);
	await fill("dialog", "Name", "Probe");
	await fill("dialog", "Host", "127.0.0.1");
	await fill("dialog", "Port", "1");
	await click("Save");
	await waitFor(
		() =>
			evaluate(
				page,
				"!document.querySelector('dialog') && document.querySelector('.launcher-list strong')?.textContent === 'Probe'",
			),
		"saved server row",
	);
	const choicePoint = await evaluate(
		page,
		"(() => {const bounds=document.querySelector('.launcher-server-choice').getBoundingClientRect();return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};})()",
	);
	await page.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...choicePoint,
	});
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.classList.contains('launcher-server-choice')",
		),
		"Pregame pointer selection did not retain native button focus",
	);
	// Release outside the button so selection's transient disabled state does not
	// blur the control before we verify traversal to its sibling actions.
	await page.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		x: 1,
		y: 1,
	});
	await pressTab();
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.getAttribute('aria-label') === 'Edit Probe'",
		),
		"Tab could not reach focus-revealed server actions",
	);
	await pressTab(true);
	requireCondition(
		await evaluate(
			page,
			"document.activeElement.classList.contains('launcher-server-choice')",
		),
		"Shift+Tab did not return from server actions",
	);
	report.scenarios.push(
		"native Tab/Shift+Tab enters launcher from no focus, traverses dialogs and server actions, and pointer controls retain focus",
	);
	await click("Add server");
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"duplicate server dialog",
	);
	await fill("dialog", "Name", "Duplicate probe");
	await fill("dialog", "Host", "127.0.0.1");
	await fill("dialog", "Port", "1");
	await click("Save");
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('dialog [role=alert]')?.textContent.includes('already exists')",
			),
		"visible duplicate endpoint error",
	);
	requireCondition(
		(await evaluate(page, "window.holtburgerLauncher.snapshot()")).servers
			.length === 1,
		"Duplicate Add modified the saved catalog",
	);
	await click("Cancel");
	report.scenarios.push(
		"manual Add rejects an existing endpoint with a visible editor error and retains the original server",
	);
	const serverId = await evaluate(
		page,
		"window.holtburgerLauncher.snapshot().then((value) => value.servers[0].id)",
	);
	requireCondition(
		await evaluate(
			page,
			"document.querySelector('.launcher-profile select').value === '' && Boolean(document.querySelector('.launcher-play'))",
		),
		"Launch controls require a profile",
	);
	const playShine =
		"getComputedStyle(document.querySelector('.launcher-play'), '::after')";
	requireCondition(
		await evaluate(page, `${playShine}.animationName === 'none'`),
		"Disabled Play must not run its shine",
	);
	await fill(".launcher-profile", "Account", "launcher-probe");
	requireCondition(
		await evaluate(
			page,
			`${playShine}.animationName === 'launcher-play-shine' && ${playShine}.animationIterationCount === '1' && ${playShine}.pointerEvents === 'none'`,
		),
		"Enabled Play must run one noninteractive shine",
	);
	await fill(".launcher-profile", "Account", "");
	requireCondition(
		await evaluate(page, `${playShine}.animationName === 'none'`),
		"Disabling Play must reset its shine",
	);
	await fill(".launcher-profile", "Account", "launcher-probe");
	requireCondition(
		await evaluate(
			page,
			`${playShine}.animationName === 'launcher-play-shine'`,
		),
		"Re-enabling Play must rearm its shine",
	);
	await page.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	requireCondition(
		await evaluate(page, `${playShine}.animationName === 'none'`),
		"Play shine must respect reduced motion",
	);
	await page.send("Emulation.setEmulatedMedia", { features: [] });
	report.scenarios.push(
		"Play shine runs once per enable, resets on disable, excludes pointer input, and respects reduced motion",
	);
	await fill(".launcher-profile", "Content path override", assets);
	await fill(".launcher-profile", "Password", "initial-secret");
	await click("Show password");
	requireCondition(
		await evaluate(
			page,
			"document.querySelector('input[autocomplete=current-password]').type === 'text' && document.querySelector('input[autocomplete=current-password]').value === 'initial-secret' && document.querySelector('[aria-label=\"Hide password\"]').getAttribute('aria-pressed') === 'true'",
		),
		"Show password did not reveal the current draft",
	);
	await click("Hide password");
	requireCondition(
		await evaluate(
			page,
			"document.querySelector('input[autocomplete=current-password]').type === 'password' && document.querySelector('input[autocomplete=current-password]').value === 'initial-secret'",
		),
		"Hide password changed the draft or failed to mask it",
	);
	await click("Show password");
	requireCondition(
		await evaluate(page, "!document.querySelector('.launcher-play').disabled"),
		"Unsaved credentials could not enable Play",
	);
	await click("Save to new profile");
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"new profile dialog",
	);
	await fill("dialog", "Profile name", "Probe account");
	await evaluate(page, "document.querySelector('dialog input').focus()");
	await pressEnter();
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('.launcher-profile select').value !== '' && document.querySelector('.launcher').getAttribute('aria-busy') === 'false'",
			),
		"explicit profile save",
	);
	requireCondition(
		await evaluate(
			page,
			"document.querySelector('input[autocomplete=current-password]').type === 'password'",
		),
		"Loading a saved profile retained password visibility",
	);
	report.scenarios.push(
		"password reveal/hide preserves credentials and loading a profile restores masking",
	);
	const overwriteDisabled =
		"[...document.querySelectorAll('.launcher-profile button')].find(button => button.textContent.trim() === 'Overwrite profile').disabled";
	requireCondition(
		await evaluate(page, overwriteDisabled),
		"Unchanged saved profile must not enable Overwrite",
	);
	await fill(".launcher-profile", "Account", "edited-account");
	requireCondition(
		!(await evaluate(page, overwriteDisabled)),
		"Editing the account did not enable Overwrite",
	);
	await fill(".launcher-profile", "Account", "launcher-probe");
	requireCondition(
		await evaluate(page, overwriteDisabled),
		"Reverting the account did not disable Overwrite",
	);
	await fill(".launcher-profile", "Password", "");
	requireCondition(
		!(await evaluate(page, overwriteDisabled)),
		"Clearing a saved password did not enable Overwrite",
	);
	await fill(".launcher-profile", "Password", "initial-secret");
	requireCondition(
		await evaluate(page, overwriteDisabled),
		"Reverting the password did not disable Overwrite",
	);
	await fill(".launcher-profile", "Password", "probe-secret");
	await click("Overwrite profile");
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('.launcher').getAttribute('aria-busy') === 'false'",
			),
		"explicit profile overwrite",
	);
	requireCondition(
		await evaluate(page, overwriteDisabled),
		"Successful overwrite did not reset the saved baseline",
	);
	report.scenarios.push(
		"Overwrite requires changed credentials, disables on revert, accepts clearing a password, and resets after saving",
	);
	const profileId = await evaluate(
		page,
		"window.holtburgerLauncher.snapshot().then((value) => value.profiles[0].id)",
	);
	requireCondition(
		await evaluate(
			page,
			`window.holtburgerLauncher.snapshot().then((value) => value.profiles[0].serverId === ${JSON.stringify(serverId)})`,
		),
		"Profile form selected the wrong server",
	);
	await click("Add server");
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"row-action fixture editor",
	);
	await fill("dialog", "Name", "Row action fixture");
	await fill("dialog", "Host", "row-actions.invalid");
	await fill("dialog", "Port", "1");
	await click("Save");
	await waitFor(
		() => evaluate(page, "!document.querySelector('dialog')"),
		"row-action fixture saved",
	);
	await evaluate(
		page,
		"[...document.querySelectorAll('.launcher-server-choice')].find(button => button.querySelector('strong').textContent === 'Probe').click()",
	);
	await waitFor(
		() =>
			evaluate(
				page,
				`document.querySelector('.launcher-server-row[data-selected="true"] strong')?.textContent === 'Probe' && document.querySelector('.launcher-profile select').value === '' && document.querySelector('.launcher').getAttribute('aria-busy') === 'false'`,
			),
		"unused server has no remembered profile",
	);
	await evaluate(
		page,
		`(() => { const select = document.querySelector('.launcher-profile select'); select.value = ${JSON.stringify(profileId)}; select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('.launcher').getAttribute('aria-busy') === 'false'",
			),
		"explicit profile selection",
	);
	await fill(".launcher-profile", "Account", "launcher-probe");
	await fill(".launcher-profile", "Password", "probe-secret");
	await evaluate(
		page,
		"document.querySelector('[aria-label=\"Edit Row action fixture\"]').click()",
	);
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"inactive server row editor",
	);
	await fill("dialog", "Name", "Renamed fixture");
	await click("Save");
	await waitFor(
		() => evaluate(page, "!document.querySelector('dialog')"),
		"inactive server row edit saved",
	);
	await evaluate(
		page,
		"document.querySelector('[aria-label=\"Delete Renamed fixture\"]').click()",
	);
	await waitFor(
		() => evaluate(page, "Boolean(document.querySelector('dialog[open]'))"),
		"inactive server row deletion confirmation",
	);
	await click("Confirm");
	await waitFor(
		() => evaluate(page, "!document.querySelector('dialog')"),
		"inactive server row deleted",
	);
	requireCondition(
		await evaluate(
			page,
			`document.querySelector('.launcher-server-row[data-selected="true"] strong')?.textContent === 'Probe' && document.querySelector('.launcher-profile select').value === ${JSON.stringify(profileId)} && document.querySelector('.launcher-profile input[autocomplete=username]').value === 'launcher-probe' && document.querySelector('.launcher-profile input[type=password]').value === 'probe-secret'`,
		),
		"Editing/deleting an inactive server changed selection or cleared the active credential draft",
	);
	requireCondition(
		(await evaluate(page, "window.holtburgerLauncher.snapshot()")).servers
			.length === 1,
		"Per-row Delete targeted the wrong server",
	);
	report.scenarios.push(
		"per-server edit/delete target an inactive row while retaining active server/profile selection and entered credentials",
	);
	await fill(".launcher-profile", "Account", "launcher-probe");
	await fill(".launcher-profile", "Password", "probe-secret");
	requireCondition(
		(await snapshot("profile selected before Play")).native.children.length ===
			0,
		"Profile selection started a sidecar before Play",
	);
	const source = await readFile(
		join(userData, "launcher-settings.json"),
		"utf8",
	);
	requireCondition(
		// Content paths can contain the probe account as a substring; compare complete JSON string values.
		!source.includes(JSON.stringify("probe-secret")) &&
			!source.includes(JSON.stringify("launcher-probe")),
		"Credentials were stored as plaintext",
	);
	report.scenarios.push(
		"no-argument picker, one window, no host/canvas/game imports, encrypted catalog",
	);
	const secondServerId = randomUUID();
	const secondProfileId = randomUUID();
	await evaluate(
		page,
		`window.holtburgerLauncher.saveServer(${JSON.stringify({ id: secondServerId, name: "Second server", endpoint: { host: "127.0.0.1", port: 2 } })})`,
	);
	await evaluate(
		page,
		`window.holtburgerLauncher.saveProfile(${JSON.stringify({ id: secondProfileId, name: "Second account", serverId: secondServerId, contentPath: assets, credentials: { account: "launcher-probe", password: "probe-secret" } })})`,
	);
	const visual = JSON.parse(
		await readFile(
			join(appRoot, "src/client/fixtures/object-preview-wire.json"),
			"utf8",
		),
	).equipped.outcome.source;
	const guid = 7;
	const pickerGeometry = await evaluate(
		inspector,
		"Promise.resolve(process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')).then((electron) => electron.BrowserWindow.getAllWindows()[0].getNormalBounds())",
	);
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt === 0) {
			await evaluate(
				page,
				"document.querySelector('input[autocomplete=username]').focus()",
			);
			await pressEnter();
		} else
			await evaluate(
				page,
				`window.holtburgerLauncher.play({ serverId: ${JSON.stringify(secondServerId)}, profileId: ${JSON.stringify(secondProfileId)}, contentPath: ${JSON.stringify(assets)}, credentials: {account:"launcher-probe",password:"probe-secret"} })`,
			);
		await attach("client");
		requireCondition(
			(await evaluate(page, `window.holtburgerVisualCache.read(${guid})`))
				.kind === "missing",
			"Another endpoint's character capture leaked into this attempt",
		);
		await evaluate(
			page,
			`window.holtburgerSettings.saveCharacterPatch(${guid}, { lastKnownName: ${JSON.stringify(`Endpoint ${attempt + 1}`)} })`,
		);
		const capture = structuredClone(visual);
		capture.body.scale = attempt + 1;
		await evaluate(
			page,
			`window.holtburgerVisualCache.stage(${JSON.stringify({ guid, source: capture })})`,
		);
		if (values.assets) {
			await waitFor(
				() => evaluate(page, "document.querySelector('canvas') !== null"),
				"game renderer construction",
			);
			await snapshot(`attempt ${attempt + 1} starting`);
		} else {
			await waitFor(
				() =>
					evaluate(
						page,
						"window.holtburgerContent.snapshot().then((value) => value.phase.kind === 'needs_assets')",
					),
				"missing-asset recovery",
			);
		}
		if (values.assets && attempt === 1) {
			await attach("launcher");
			requireCondition(
				await evaluate(
					page,
					"window.holtburgerLauncher.snapshot().then((value) => value.failure?.includes('Login failed: Connection timed out: no server traffic'))",
				),
				"Shared login timeout explanation was lost during automatic native return",
			);
			report.scenarios.push(
				"real connection timeout returns to picker with diagnostic",
			);
		} else {
			await evaluate(
				page,
				`window.holtburgerLauncher.back(${JSON.stringify(attempt === 0 ? "Local client failure retained" : null)})`,
			);
			await attach("launcher");
		}
		const returned = await snapshot(`picker after attempt ${attempt + 1}`);
		const mostRecentName = attempt === 0 ? "Probe" : "Second server";
		await waitFor(
			() =>
				evaluate(
					page,
					`document.querySelector('.launcher-server-choice strong')?.textContent === ${JSON.stringify(mostRecentName)} && document.querySelector('.launcher-server-row[data-selected="true"] strong')?.textContent === ${JSON.stringify(mostRecentName)} && document.querySelector('.launcher').getAttribute('aria-busy') === 'false'`,
				),
			"most recently launched server sorted first and restored",
		);
		if (attempt === 1) {
			await evaluate(
				page,
				"document.querySelector('.launcher-server-choice').focus()",
			);
			for (const [key, virtualCode, name, expectedProfile] of [
				["ArrowDown", 40, "Probe", profileId],
				["ArrowDown", 40, "Second server", secondProfileId],
				["ArrowUp", 38, "Probe", profileId],
				["Home", 36, "Second server", secondProfileId],
				["End", 35, "Probe", profileId],
			]) {
				for (const type of ["keyDown", "keyUp"])
					await page.send("Input.dispatchKeyEvent", {
						type,
						key,
						code: key,
						windowsVirtualKeyCode: virtualCode,
					});
				await waitFor(
					() =>
						evaluate(
							page,
							`document.activeElement?.classList.contains('launcher-server-choice') && document.activeElement.querySelector('strong').textContent === ${JSON.stringify(name)} && document.querySelector('.launcher-server-row[data-selected="true"] strong')?.textContent === ${JSON.stringify(name)} && document.querySelector('.launcher-profile select').value === ${JSON.stringify(expectedProfile)} && document.querySelector('.launcher').getAttribute('aria-busy') === 'false'`,
						),
					`${key} selects and retains focus on ${name}`,
				);
			}
			requireCondition(
				await evaluate(
					page,
					"document.querySelector('.launcher-server-choice strong').textContent === 'Second server'",
				),
				"Keyboard browsing changed Play recency order",
			);
			report.scenarios.push(
				"server Up/Down wraps and Home/End selects endpoints, preserves focus through credential loading, and leaves recency order unchanged",
			);
			for (const [name, expectedProfile] of [
				["Probe", profileId],
				["Second server", secondProfileId],
			]) {
				await evaluate(
					page,
					`[...document.querySelectorAll('.launcher-server-choice')].find(button => button.querySelector('strong').textContent === ${JSON.stringify(name)}).click()`,
				);
				await waitFor(
					() =>
						evaluate(
							page,
							`document.querySelector('.launcher-profile select').value === ${JSON.stringify(expectedProfile)} && document.querySelector('.launcher-profile input[autocomplete=username]').value === 'launcher-probe' && document.querySelector('.launcher-profile input[type=password]').value === 'probe-secret' && document.querySelector('.launcher').getAttribute('aria-busy') === 'false'`,
						),
					`remembered profile and credentials for ${name}`,
				);
			}
			report.scenarios.push(
				"server switching restores each server's last launched profile and credentials after document remount",
			);
		}
		if (attempt === 0)
			requireCondition(
				await evaluate(
					page,
					"window.holtburgerLauncher.snapshot().then((value) => value.failure === 'Local client failure retained')",
				),
				"Client page diagnostic was lost during return",
			);
		requireCondition(
			returned.native.children.every((value) => value.exitCode !== null),
			"Sidecar survived return to picker",
		);
		requireCondition(
			returned.renderer.canvases === 0,
			"Game canvas survived return",
		);
		requireCondition(
			await evaluate(
				page,
				"window.holtburgerLauncher.snapshot().then((value) => value.canPlay)",
			),
			"Picker did not reopen Play admission",
		);
		const persistedLauncher = await readFile(
			join(userData, "launcher-settings.json"),
			"utf8",
		);
		requireCondition(
			!persistedLauncher.includes(JSON.stringify("launcher-probe")) &&
				!persistedLauncher.includes(JSON.stringify("probe-secret")) &&
				JSON.parse(persistedLauncher).profiles.find(
					(value) => value.id === profileId,
				).credentials !== null,
			"Explicit profile save did not persist encrypted credentials",
		);
		const storedPicker = JSON.parse(
			await readFile(join(userData, "launcher-settings.json"), "utf8"),
		).window.normalBounds;
		// Each surface owns dimensions; the OS owns placement.
		requireCondition(
			JSON.stringify(Object.keys(storedPicker).sort()) ===
				JSON.stringify(["height", "width"]),
			"Picker window settings must contain only dimensions",
		);
		requireCondition(
			storedPicker.width === pickerGeometry.width &&
				storedPicker.height === pickerGeometry.height,
			`Game dimensions overwrote picker dimensions: expected ${JSON.stringify(pickerGeometry)}, received ${JSON.stringify(storedPicker)}`,
		);
		const selectedContent = JSON.parse(await readFile(preference, "utf8"));
		if (attempt === 0) {
			requireCondition(
				selectedContent.selection.kind === "unselected",
				"First Play did not clear content selection",
			);
			await writeFile(preference, JSON.stringify(initialPreference));
		} else
			requireCondition(
				JSON.stringify(selectedContent) === JSON.stringify(initialPreference),
				"Second Play repeated clear-content",
			);
	}
	report.scenarios.push(
		"two attempts and returns in same native window, sidecars retired, picker admission restored",
	);
	const gameSettings = JSON.parse(
		await readFile(join(userData, "client-settings.json"), "utf8"),
	);
	for (const endpoint of [1, 2]) {
		requireCondition(
			gameSettings.characters[`127.0.0.1:${endpoint}/0x00000007`]?.lastKnownName
				.value === `Endpoint ${endpoint}`,
			"Character settings crossed endpoint scopes",
		);
	}
	const captures = await readdir(join(userData, "character-visuals"));
	requireCondition(
		captures.length === 2,
		"Expected independent persisted character captures",
	);
	report.scenarios.push(
		"equal character GUIDs retain independent settings/captures across endpoints; geometry remains separated",
	);
	report.scenarios.push(
		"clear-content executes on first Play only, not idle picker or later attempts",
	);
	const profilesBeforeProfileFree = JSON.parse(
		await readFile(join(userData, "launcher-settings.json"), "utf8"),
	).profiles;
	await evaluate(
		page,
		"(() => {const select=document.querySelector('.launcher-profile select');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('.launcher').getAttribute('aria-busy') === 'false'",
			),
		"no profile selected",
	);
	await fill(".launcher-profile", "Account", "profile-free-account");
	await fill(".launcher-profile", "Password", "profile-free-password");
	await fill(".launcher-profile", "Content path override", assets);
	await evaluate(
		page,
		"document.querySelector('input[autocomplete=current-password]').focus()",
	);
	await pressEnter();
	await attach("client");
	await evaluate(page, "window.holtburgerLauncher.back(null)");
	await attach("launcher");
	const profileFreeFile = await readFile(
		join(userData, "launcher-settings.json"),
		"utf8",
	);
	requireCondition(
		JSON.stringify(JSON.parse(profileFreeFile).profiles) ===
			JSON.stringify(profilesBeforeProfileFree) &&
			!profileFreeFile.includes("profile-free-account") &&
			!profileFreeFile.includes("profile-free-password"),
		"Profile-free Play changed a named profile or stored plaintext credentials",
	);
	requireCondition(
		await evaluate(
			page,
			"document.querySelector('.launcher-profile select').value === '' && Boolean(document.querySelector('.launcher-play'))",
		),
		"Returning from profile-free Play required a profile",
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('input[autocomplete=username]').value === 'profile-free-account' && document.querySelector('input[autocomplete=current-password]').value === 'profile-free-password' && document.querySelector('input[autocomplete=current-password]').type === 'password'",
			),
		"restored profile-free credentials after return",
	);
	await evaluate(
		page,
		`(() => { const select=document.querySelector('.launcher-profile select'); select.value=${JSON.stringify(secondProfileId)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('.launcher').getAttribute('aria-busy') === 'false'",
			),
		"named profile selected after profile-free login",
	);
	await evaluate(
		page,
		"(() => { const select=document.querySelector('.launcher-profile select'); select.value=''; select.dispatchEvent(new Event('change',{bubbles:true})); })()",
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"document.querySelector('input[autocomplete=username]').value === 'profile-free-account' && document.querySelector('input[autocomplete=current-password]').value === 'profile-free-password'",
			),
		"profile-free credentials restored after switching presets",
	);
	report.scenarios.push(
		"optional profile controls, explicit save/overwrite, profile-free Play preserves named presets and restores its own encrypted credentials",
	);
	report.scenarios.push(
		"Enter submits Play from account/password fields while the profile naming dialog submits its own form",
	);

	if (values.assets) {
		await evaluate(
			page,
			`window.holtburgerLauncher.play({ serverId: ${JSON.stringify(serverId)}, profileId: ${JSON.stringify(profileId)}, contentPath: ${JSON.stringify(assets)}, credentials: {account:"launcher-probe",password:"probe-secret"} })`,
		);
		await attach("client");
		await waitFor(
			() =>
				evaluate(
					inspector,
					"process._getActiveHandles().some((value) => value.constructor.name === 'ChildProcess' && value.exitCode === null)",
				),
			"live sidecar before crash injection",
		);
		await evaluate(
			inspector,
			"process._getActiveHandles().find((value) => value.constructor.name === 'ChildProcess' && value.exitCode === null).kill()",
		);
		await attach("launcher");
		requireCondition(
			await evaluate(
				page,
				"window.holtburgerLauncher.snapshot().then((value) => value.canPlay && Boolean(value.failure))",
			),
			"Host crash did not return with diagnostic",
		);
		report.scenarios.push(
			"host crash retires attempt and restores picker with diagnostic",
		);
	}
	// A malformed game file must not poison launcher startup or application lifetime.
	await writeFile(
		join(userData, "client-settings.json"),
		"broken game settings",
	);
	await evaluate(
		page,
		`window.holtburgerLauncher.play({ serverId: ${JSON.stringify(serverId)}, profileId: ${JSON.stringify(profileId)}, contentPath: ${JSON.stringify(assets)}, credentials: {account:"launcher-probe",password:"probe-secret"} })`,
	);
	await waitFor(
		() =>
			evaluate(
				page,
				"window.holtburgerLauncher.snapshot().then((value) => value.canPlay && Boolean(value.failure))",
			),
		"game settings failure recovery",
	);
	report.scenarios.push("invalid game settings returns to usable picker");
	if (values["quit-during-attempt"]) {
		await writeFile(
			join(userData, "client-settings.json"),
			JSON.stringify(gameSettings),
		);
		await evaluate(
			page,
			`window.holtburgerLauncher.play({ serverId: ${JSON.stringify(serverId)}, profileId: ${JSON.stringify(profileId)}, contentPath: ${JSON.stringify(assets)}, credentials: {account:"launcher-probe",password:"probe-secret"} })`,
		);
		await attach("client");
	}
	await quitAndReport();
}

/** Exercise the user's npm launcher and actual replacement processes; keep Vite under its real owner. */
async function runDevRestartProbe() {
	const npmEntry = process.env.npm_execpath;
	requireCondition(
		npmEntry !== undefined,
		"Run the development restart probe through npm run probe:launcher",
	);
	child = spawn(
		process.execPath,
		[
			npmEntry,
			"run",
			"dev:client",
			"--",
			"--debug-port",
			"0",
			"--vite-port",
			String(port),
			"--no-content-search",
		],
		{
			cwd: appRoot,
			detached: process.platform !== "win32",
			env: {
				...process.env,
				XDG_CONFIG_HOME: config,
				APPDATA: config,
				LOCALAPPDATA: join(directory, "local"),
				HOLTBURGER_ELECTRON_DISABLE_GPU: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	child.on("error", (error) => {
		output += error.stack;
	});
	child.on("close", (code, signal) => {
		status = { code, signal };
	});
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			output += chunk;
		});
	const readEndpoint = () =>
		[...output.matchAll(/DevTools listening on (ws:\/\/[^\s]+)/g)].at(-1)?.[1];
	async function attachLauncher(previousEndpoint) {
		browserEndpoint = await waitFor(() => {
			const endpoint = readEndpoint();
			return endpoint && endpoint !== previousEndpoint ? endpoint : false;
		}, "development Electron debugging endpoint");
		browser = await createCdpClient(browserEndpoint);
		const target = await waitFor(async () => {
			const response = await fetch(
				`http://127.0.0.1:${new URL(browserEndpoint).port}/json/list`,
			);
			return (await response.json()).find(
				(target) => target.type === "page" && target.url.includes("/launcher/"),
			);
		}, "development launcher target");
		page = await createCdpClient(target.webSocketDebuggerUrl);
		await waitFor(
			() =>
				evaluate(
					page,
					`Boolean(document.querySelector('button[aria-label="App settings"]')) && window.holtburgerLauncher.appSettings()`,
				),
			"mounted development launcher",
		);
	}
	await attachLauncher(null);
	const initialEndpoint = browserEndpoint;
	await evaluate(
		page,
		`document.querySelector('button[aria-label="App settings"]').click()`,
	);
	await waitFor(
		() =>
			evaluate(
				page,
				`Boolean(document.querySelector('.app-settings-dialog select'))`,
			),
		"development settings modal",
	);
	await evaluate(
		page,
		`document.querySelector('.app-settings-dialog input[type=checkbox]').click()`,
	);
	await evaluate(
		page,
		`setTimeout(() => [...document.querySelectorAll('.app-settings-dialog button')].find((button) => button.textContent.trim() === 'Save and restart').click(), 0)`,
	);
	page.close();
	browser.close();
	await attachLauncher(initialEndpoint);
	const settings = await evaluate(
		page,
		`window.holtburgerLauncher.appSettings()`,
	);
	requireCondition(
		settings.settings.vsync === true && !settings.restartRequired,
		"Replacement Electron did not load the saved preferences",
	);
	requireCondition(
		(await fetch(`${origin}/launcher/index.html`)).ok,
		"Development restart lost Vite",
	);
	requireCondition(
		(output.match(/Using Vite port /g) ?? []).length === 1,
		"Development restart rebuilt the frontend server",
	);
	report.scenarios.push(
		"npm run dev:client restarts Electron, preserves the same Vite server, and applies saved settings",
	);
	await evaluate(
		page,
		`setTimeout(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Quit application').click(), 0)`,
	);
	page.close();
	browser.close();
	const deadline = Date.now() + 10000;
	while (status === null && Date.now() < deadline)
		await new Promise((done) => setTimeout(done, 100));
	requireCondition(
		status?.code === 0,
		`Development Quit did not stop the supervisor cleanly: ${JSON.stringify(status)}`,
	);
	let viteStopped = false;
	try {
		await fetch(`${origin}/launcher/index.html`);
	} catch {
		viteStopped = true;
	}
	requireCondition(viteStopped, "Development Quit left Vite running");
	report.scenarios.push(
		"Quit stops the replacement Electron process and Vite and exits the npm launcher cleanly",
	);
	console.log(JSON.stringify(report, null, 2));
}

async function quitAndReport() {
	const quitting = evaluate(page, "window.holtburgerClient.quit()").catch(
		() => {},
	);
	inspector.close();
	inspector = null;
	await waitFor(async () => {
		await quitting;
		return true;
	}, "Quit request");
	const deadline = Date.now() + 10000;
	while (status === null && Date.now() < deadline)
		await new Promise((done) => setTimeout(done, 100));
	requireCondition(
		status?.code === 0,
		`Quit failed: ${JSON.stringify(status)}\n${output}`,
	);
	report.scenarios.push(
		values["quit-during-attempt"]
			? "Quit during startup retires the attempt and exits cleanly"
			: "picker Quit flushes and exits cleanly",
	);
	console.log(JSON.stringify(report, null, 2));
}

try {
	await runProbe();
} catch (error) {
	console.error(output);
	throw error;
} finally {
	if (inspector && status === null)
		await evaluate(inspector, "process.exit(1)").catch(() => {});
	page?.close();
	browser?.close();
	inspector?.close();
	if (child && status === null) {
		// The dev probe owns npm, Electron, and Vite in one process group on POSIX.
		if (values["dev-restart-only"] && process.platform !== "win32")
			process.kill(-child.pid, "SIGTERM");
		else child.kill();
	}
	preview?.kill();
	if (child && status === null)
		await Promise.race([
			new Promise((done) => child.once("close", done)),
			new Promise((done) => setTimeout(done, 2000)),
		]);
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
