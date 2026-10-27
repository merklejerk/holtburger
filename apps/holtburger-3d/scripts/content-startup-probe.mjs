#!/usr/bin/env node
// Native lifecycle verification only: no screenshots or visual acceptance judgments.
import { execFile, spawn } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, toNamespacedPath } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CdpConnectionError, createCdpClient } from "./cdp-client.mjs";
import { findAvailablePort } from "./dev-port.mjs";
import { probePackagedThemeAssets } from "./packaged-theme-assets.mjs";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspace = resolve(appRoot, "../..");
const runFile = promisify(execFile);
const { values } = parseArgs({
	options: { package: { type: "string" }, flatpak: { type: "boolean" } },
});
if (values.flatpak === true && values.package !== undefined)
	throw new Error("Choose --package <executable> or --flatpak");
const launchTarget =
	values.flatpak === true
		? {
				kind: "flatpak",
				executable: join(workspace, ".github/flatpak/probe-launch"),
				appId: JSON.parse(
					await readFile(
						join(
							workspace,
							".github/flatpak/io.github.merklejerk.holtburger-alpha.json",
						),
						"utf8",
					),
				).id,
			}
		: values.package === undefined
			? { kind: "development" }
			: { kind: "package", executable: resolve(values.package) };
const profileName =
	launchTarget.kind === "development" ? "holtburger-3d-dev" : "holtburger-3d";
const directory = await mkdtemp(join(tmpdir(), "h3d-content-probe-"));
const config = join(directory, "config");
const preference = join(config, profileName, "content-selection.json");
const localAssets = join(directory, "assets");
await mkdir(localAssets, { recursive: true });
await mkdir(join(config, profileName), { recursive: true });
await copyFile(
	join(appRoot, "scripts/fixtures/minimal-content.hba.fixture"),
	join(localAssets, "assets.hba"),
);
const vitePort = await findAvailablePort();
const origin = `http://127.0.0.1:${vitePort}`;
const vite =
	launchTarget.kind === "development"
		? spawn(
				process.execPath,
				[
					join(appRoot, "node_modules/vite/bin/vite.js"),
					"--host",
					"127.0.0.1",
					"--port",
					String(vitePort),
					"--strictPort",
				],
				{ cwd: appRoot, stdio: ["ignore", "pipe", "pipe"] },
			)
		: null;
let viteOutput = "";
for (const stream of vite === null ? [] : [vite.stdout, vite.stderr])
	stream.on("data", (chunk) => {
		viteOutput += chunk.toString();
	});

async function waitFor(read, label) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const result = await read();
		if (result) return result;
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function evaluate(client, expression) {
	const response = await client.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (response.exceptionDetails)
		throw new Error(
			response.exceptionDetails.exception?.description ??
				response.exceptionDetails.text,
		);
	return response.result.value;
}

/** Compare actual filesystem identity while preserving the host's canonical display spelling. */
async function requireFixtureLocation(location, fixture) {
	const identity = await fixture.canonicalize(location);
	if (identity !== fixture.identity)
		throw new Error(
			`Expected fixture ${fixture.identity}, received ${identity}`,
		);
}

async function launch(mode, args) {
	const switches = [
		// Native packages honor Electron's profile override on every OS, including macOS.
		...(launchTarget.kind === "development"
			? []
			: [`--user-data-dir=${join(config, profileName)}`]),
		"--remote-debugging-port=0",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
	];
	const gameArgs = [
		...(mode === "explorer" ? ["explorer"] : []),
		...args,
		...(mode === "client" ? ["--account", "content-probe", "--port", "1"] : []),
	];
	const command =
		launchTarget.kind === "development"
			? process.execPath
			: launchTarget.executable;
	const commandArgs =
		launchTarget.kind === "development"
			? [
					join(appRoot, "node_modules/electron/cli.js"),
					...switches,
					".",
					...gameArgs,
				]
			: [...gameArgs, ...switches];
	const child = spawn(command, commandArgs, {
		cwd: appRoot,
		env: {
			...process.env,
			XDG_CONFIG_HOME: config,
			XDG_DATA_HOME: join(directory, "data"),
			XDG_CACHE_HOME: join(directory, "cache"),
			APPDATA: config,
			LOCALAPPDATA: join(directory, "local"),
			HOLTBURGER_ELECTRON_DEV_ORIGIN: origin,
			HOLTBURGER_HOST_BIN:
				process.env.HOLTBURGER_HOST_BIN ??
				join(
					workspace,
					"target/debug",
					process.platform === "win32"
						? "holtburger-3d-host.exe"
						: "holtburger-3d-host",
				),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	let status = null;
	child.on("error", (error) => {
		output += error.stack;
	});
	child.on("close", (code, signal) => {
		status = { code, signal };
	});
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			output += chunk.toString();
		});
	let client;
	try {
		const browser = await waitFor(() => {
			if (status !== null)
				throw new Error(`Electron stopped before setup: ${output}`);
			return output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
		}, "Electron debugging endpoint");
		const port = new URL(browser).port;
		const page = await waitFor(async () => {
			const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
				(response) => response.json(),
			);
			return targets.find(
				(target) => target.type === "page" && target.url.includes(`/${mode}/`),
			)?.webSocketDebuggerUrl;
		}, "application page");
		client = await createCdpClient(page);
		await waitFor(
			() =>
				evaluate(
					client,
					"Boolean(window.holtburgerContent && document.querySelector('#app.ui-theme .client-pregame-screen'))",
				),
			"pregame startup surface",
		);
		return {
			client,
			snapshot: () => evaluate(client, "window.holtburgerContent.snapshot()"),
			async close(expectedCode) {
				try {
					// Quit can close the debugger before its reply arrives. Process exit is
					// independent; only a transport closure may accompany a valid exit.
					const [request, exit] = await Promise.allSettled([
						evaluate(client, "void window.holtburgerContent.quit()"),
						waitFor(() => status, "orderly app exit"),
					]);
					if (exit.status === "rejected") throw exit.reason;
					if (
						request.status === "rejected" &&
						!(request.reason instanceof CdpConnectionError)
					)
						throw request.reason;
					if (exit.value.code !== expectedCode || exit.value.signal !== null)
						throw new Error(
							`Application close failed: ${JSON.stringify(exit.value)}`,
						);
				} catch (error) {
					throw new Error(
						`${mode} close probe failed (${JSON.stringify(status)}): ${output}`,
						{ cause: error },
					);
				} finally {
					client.close();
					if (status === null) {
						child.kill();
						await waitFor(() => status, "probe process cleanup");
					}
				}
			},
		};
	} catch (error) {
		client?.close();
		if (status === null) child.kill();
		throw new Error(`${mode} startup probe failed: ${output}`, {
			cause: error,
		});
	}
}

let portalGrant = null;
try {
	if (launchTarget.kind === "flatpak") {
		const { stdout } = await runFile("flatpak", [
			"document-export",
			"--unique",
			"--allow-read",
			`--app=${launchTarget.appId}`,
			localAssets,
		]);
		const location = stdout.trim();
		portalGrant = { location, id: basename(dirname(location)) };
	}
	const assets = portalGrant === null ? localAssets : portalGrant.location;
	// Portal canonical paths belong to the app's mount namespace, not the outside runner.
	const canonicalize =
		launchTarget.kind === "flatpak"
			? async (location) => {
					const { stdout } = await runFile("flatpak", [
						"run",
						"--user",
						"--command=realpath",
						launchTarget.appId,
						"-e",
						"--",
						location,
					]);
					return stdout.trim();
				}
			: async (location) => toNamespacedPath(await realpath(location));
	const fixture = { identity: await canonicalize(assets), canonicalize };
	if (vite !== null)
		await waitFor(async () => {
			if (vite.exitCode !== null) throw new Error(`Vite exited: ${viteOutput}`);
			try {
				return (await fetch(`${origin}/explorer/index.html`)).ok;
			} catch {
				return false;
			}
		}, "Vite");
	const results = [];
	for (const mode of ["explorer", "client"]) {
		await writeFile(
			preference,
			JSON.stringify({
				version: 1,
				selection: {
					kind: "selected",
					location: assets,
					health: { kind: "ready" },
				},
			}),
		);
		let app = await launch(mode, []);
		try {
			const state = await waitFor(async () => {
				const current = await app.snapshot();
				if (current.phase.kind === "fatal")
					throw new Error(current.phase.message);
				return current.phase.kind === "restart_required" ? current : null;
			}, `${mode} necessary-resource failure`);
			await requireFixtureLocation(state.phase.location, fixture);
			const footer = await evaluate(
				app.client,
				"document.querySelector('.startup-overlay .pregame-footer .loading-assets')?.textContent",
			);
			const expectedFooter = `Assets: ${state.phase.location}`;
			if (footer !== expectedFooter)
				throw new Error(
					`Loading footer expected ${JSON.stringify(expectedFooter)}, received ${JSON.stringify(footer)}`,
				);
		} finally {
			await app.close(mode === "client" ? 1 : 0);
		}
		const failed = JSON.parse(await readFile(preference, "utf8"));
		if (
			failed.selection.health.kind !== "needs_attention" ||
			failed.selection.health.failure.kind !== "resource"
		)
			throw new Error("Required resource failure did not persist attention");
		await requireFixtureLocation(failed.selection.location, fixture);
		app = await launch(mode, []);
		try {
			const state = await waitFor(async () => {
				const current = await app.snapshot();
				return current.phase.kind === "needs_assets" ? current : null;
			}, `${mode} recovery on next launch`);
			if (state.phase.location !== failed.selection.location)
				throw new Error("Recovery lost the saved location");
			if (
				(await evaluate(
					app.client,
					"document.querySelector('.asset-setup .asset-location')?.textContent",
				)) !== `Assets: ${failed.selection.location}`
			)
				throw new Error(
					"Loading page did not identify the selected asset location",
				);
			if (
				await evaluate(app.client, "document.querySelector('canvas') !== null")
			)
				throw new Error("Game constructed before recovery admission");
			if (
				!(await evaluate(
					app.client,
					"Boolean([...document.querySelectorAll('.asset-setup button')].find(button => button.textContent.trim() === 'Choose folder')) && document.querySelector('.asset-setup h1').textContent.trim() === 'Unable to load game assets'",
				))
			)
				throw new Error(
					"Recovery did not offer assets in the shared pregame page",
				);
			if (
				!(await evaluate(
					app.client,
					"Boolean(document.querySelector('.asset-heading .asset-warning + h1')) && Boolean(document.querySelector('.asset-diagnostic')?.textContent.trim()) && !document.querySelector('.asset-setup details')",
				))
			)
				throw new Error(
					"Asset failure did not show its inline heading and cause",
				);
		} finally {
			await app.close(0);
		}
		app = await launch(mode, ["--content", join(directory, "missing")]);
		try {
			const state = await waitFor(async () => {
				const current = await app.snapshot();
				return current.phase.kind === "needs_assets" ? current : null;
			}, `${mode} explicit override refusal`);
			if (!state.temporary)
				throw new Error("Override session was not temporary");
			// Exercise the actual rendered retry action, not only its preload method.
			await evaluate(
				app.client,
				"[...document.querySelectorAll('.asset-setup button')].find(button => button.textContent.trim() === 'Try again').click()",
			);
			await waitFor(async () => {
				const current = await app.snapshot();
				return (
					current.revision > state.revision &&
					current.phase.kind === "needs_assets"
				);
			}, `${mode} pregame asset retry`);
		} finally {
			await app.close(0);
		}
		if (
			JSON.stringify(JSON.parse(await readFile(preference, "utf8"))) !==
			JSON.stringify(failed)
		)
			throw new Error("Override changed saved recovery state");
		app = await launch(mode, ["--no-content-search", "--clear-content"]);
		try {
			await waitFor(
				async () => (await app.snapshot()).phase.kind === "needs_assets",
				`${mode} forced asset setup`,
			);
			if (
				await evaluate(app.client, "document.querySelector('canvas') !== null")
			)
				throw new Error("Disabling search constructed the game");
			if (
				!(await evaluate(
					app.client,
					"Boolean(document.querySelector('.asset-setup')) && document.querySelector('.asset-instructions').textContent.includes('end-of-retail') && document.querySelector('.asset-instructions').textContent.includes('full-profile HBA') && !document.querySelector('.asset-setup details, .asset-setup .asset-warning, .asset-setup [role=alert]')",
				))
			)
				throw new Error("Ordinary asset setup was presented as a failure");
			if (
				await evaluate(
					app.client,
					"[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Try again')",
				)
			)
				throw new Error("Setup offered discovery retry with search disabled");
			await evaluate(app.client, "window.holtburgerContent.retry()");
			const state = await app.snapshot();
			if (
				state.phase.kind !== "needs_assets" ||
				state.phase.location !== null ||
				state.phase.canRetry
			)
				throw new Error("Retry bypassed disabled automatic search");
			if (
				JSON.parse(await readFile(preference, "utf8")).selection.kind !==
				"unselected"
			)
				throw new Error("Clear-content retained the saved source");
			if (launchTarget.kind !== "development" && mode === "client")
				await probePackagedThemeAssets({
					client: app.client,
					read: (expression) => evaluate(app.client, expression),
					waitFor,
					profileDirectory: join(config, profileName),
				});
		} finally {
			await app.close(0);
		}
		results.push({
			mode,
			requiredFailure: "persisted",
			nextLaunch: "setup_without_game",
			presentation: "shared_pregame_shell_with_dedicated_asset_setup",
			override: "isolated",
			reset: "saved source cleared; discovery disabled through retry",
			close: "bounded; setup exits successfully",
		});
	}
	console.log(
		JSON.stringify({
			ok: true,
			packaged: launchTarget.kind !== "development",
			documentPortal: launchTarget.kind === "flatpak",
			platform: process.platform,
			results,
		}),
	);
} finally {
	vite?.kill();
	try {
		if (portalGrant !== null)
			await runFile("flatpak", [
				"document-unexport",
				"--doc-id",
				portalGrant.id,
			]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
