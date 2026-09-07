#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { createCdpClient } from "./cdp-client.mjs";

/** Attach to a local dev:explorer instance; no game-server connection is involved. */
const [port, outputPrefix, workload = "frame"] = process.argv.slice(2);
if (workload !== "frame" && workload !== "modal")
	throw new Error("Workload must be frame or modal.");
if (!port || !/^\d+$/.test(port) || !outputPrefix)
	throw new Error(
		"Usage: npm run probe:explorer:theme -- <CDP port> <output prefix>",
	);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
	(response) => response.json(),
);
const target = targets.find(
	(candidate) =>
		candidate.type === "page" && candidate.url.includes("/explorer/"),
);
if (!target)
	throw new Error("No Explorer page exists at the supplied endpoint.");
const client = await createCdpClient(target.webSocketDebuggerUrl);
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = async (fn, ...args) => {
	const result = await client.send("Runtime.evaluate", {
		expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails)
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text,
		);
	return result.result.value;
};
const capture = async (label) =>
	writeFile(
		`${outputPrefix}.${label}.png`,
		Buffer.from(
			(
				await client.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
				})
			).data,
			"base64",
		),
	);
const click = async (selector) => {
	const point = await read((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error("Missing control: " + selector);
		element.scrollIntoView({ block: "nearest" });
		const box = element.getBoundingClientRect();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}, selector);
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			...point,
			button: "left",
			clickCount: 1,
		});
	await delay(300);
};
const tab = (id) => click("#explorer-tab-" + id);
const waitFor = async (predicate, description) => {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (await read(predicate)) return;
		await delay(100);
	}
	throw new Error("Timed out waiting for " + description);
};
const configureOverride = (opaque) =>
	read(async (opaque) => {
		const { defaultUiThemeUrl } = await import(
			new URL("/src/app/ui-theme.ts", location.origin).href
		);
		const { uiThemes } = await import(
			new URL("/src/app/mount.ts", location.origin).href
		);
		await uiThemes.replace(
			defaultUiThemeUrl,
			opaque
				? new URL("/src/harness/browser/themes/opaque.css", location.origin)
						.href
				: null,
		);
	}, opaque);

try {
	client.on("Runtime.exceptionThrown", (event) =>
		errors.push(event.exceptionDetails),
	);
	client.on("Runtime.consoleAPICalled", (event) => {
		if (event.type === "error") errors.push(event.args);
	});
	await client.send("Runtime.enable");
	await client.send("Performance.enable");
	await client.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await tab("world");
	await waitFor(
		() => !document.querySelector(".explorer-world-form button").disabled,
		"Explorer readiness",
	);
	await read(() => {
		const input = document.querySelector(".explorer-world-form .ui-input");
		input.value = "da55";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		for (const range of document.querySelectorAll(
			"[id^=explorer-residency-]",
		)) {
			range.value = "1";
			range.dispatchEvent(new Event("input", { bubbles: true }));
		}
	});
	await click(".explorer-world-form button");
	await waitFor(
		() =>
			document
				.querySelector(".explorer-world-residency")
				.textContent.toLowerCase()
				.includes("da55"),
		"requested scene",
	);
	await delay(5000);
	const identity = await read(() => {
		globalThis.__explorerThemeCanvas =
			document.querySelector(".explorer-canvas");
		const gl = globalThis.__explorerThemeCanvas.getContext("webgl2");
		const debug = gl.getExtension("WEBGL_debug_renderer_info");
		const frame = document
			.querySelector(".frame-metrics-overlay")
			.getBoundingClientRect();
		if (frame.top < 0 || frame.bottom > innerHeight)
			throw new Error("Frame readout escaped the viewport.");
		return {
			viewport: {
				width: innerWidth,
				height: innerHeight,
				deviceScale: devicePixelRatio,
			},
			renderer: debug
				? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
				: gl.getParameter(gl.RENDERER),
			theme: document.querySelector('link[rel="stylesheet"][media="all"]')
				?.href,
			frame: frame.toJSON(),
		};
	});
	const panels = {};
	for (const id of [
		"world",
		"renderer",
		"grading",
		"frame",
		"textures",
		"entities",
	]) {
		await tab(id);
		await capture(id);
		panels[id] = await read(() => {
			const body = document.querySelector(".explorer-tools-body");
			body.scrollTop = body.scrollHeight;
			return {
				text: body.innerText,
				scrollable: body.scrollHeight > body.clientHeight,
			};
		});
		await capture(id + "-scrolled");
	}
	await tab("textures");
	await read(() => {
		globalThis.__explorerThemeModalOpener = document.querySelector(
			".explorer-texture-inspect",
		);
	});
	await click(".explorer-texture-inspect");
	await waitFor(
		() => document.querySelector("dialog:modal") !== null,
		"texture readback dialog",
	);
	await capture("texture-modal");
	await click(".texture-page-modal-entry-list button:nth-child(2)");
	const modal = await read(() => ({
		selected: document
			.querySelector(".texture-page-modal-entry-list button:nth-child(2)")
			.getAttribute("aria-pressed"),
		width: document.querySelector("dialog:modal").getBoundingClientRect().width,
		previewWidth: document
			.querySelector(".texture-page-modal-viewport")
			.getBoundingClientRect().width,
		focusContained: document.activeElement.closest("dialog:modal") !== null,
		backdrop: getComputedStyle(
			document.querySelector("dialog:modal"),
			"::backdrop",
		).backgroundColor,
		filters: [...document.querySelectorAll(".ui-panel")].map(
			(element) => getComputedStyle(element).backdropFilter,
		),
	}));
	await client.send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27,
	});
	await waitFor(
		() => document.querySelector("dialog:modal") === null,
		"modal dismissal",
	);
	const focusRestored = await read(
		() => document.activeElement === globalThis.__explorerThemeModalOpener,
	);
	if (modal.previewWidth < 200 || !modal.focusContained || !focusRestored)
		throw new Error(
			"Modal top-layer geometry or focus handling failed: " +
				JSON.stringify({ modal, focusRestored }),
		);
	await tab("frame");
	await click(".explorer-frame-profile-toggle");
	// Capture the production report through its existing export action without changing the clipboard.
	await read(() => {
		globalThis.__explorerThemeClipboardWrite = navigator.clipboard.writeText;
		navigator.clipboard.writeText = async (text) => {
			globalThis.__explorerThemeReport = JSON.parse(text);
		};
	});
	const samples = [];
	for (let repetition = 0; repetition < 5; repetition++) {
		// Alternate order to avoid billing a monotonic thermal change entirely to one stylesheet selection.
		for (const opaqueOverride of repetition % 2 === 0
			? [false, true]
			: [true, false]) {
			await configureOverride(opaqueOverride);
			await delay(500);
			await click(".explorer-frame-profile-toggle");
			await click(".explorer-frame-profile-toggle");
			if (workload === "modal") {
				await tab("textures");
				await click(".explorer-texture-inspect");
				await waitFor(
					() => document.querySelector("dialog:modal") !== null,
					"measured texture dialog",
				);
				await delay(1500);
			}
			const traceEvents = [];
			const stopTrace = client.on("Tracing.dataCollected", (event) =>
				traceEvents.push(...event.value),
			);
			await client.send("Tracing.start", {
				categories: "devtools.timeline,blink,cc,gpu,viz",
				transferMode: "ReportEvents",
			});
			const before = await client.send("Performance.getMetrics");
			const frames = await read(
				() =>
					new Promise((resolve) => {
						const intervals = [];
						let last = performance.now();
						const end = last + 3000;
						const sample = (now) => {
							intervals.push(now - last);
							last = now;
							if (now >= end) resolve(intervals);
							else requestAnimationFrame(sample);
						};
						requestAnimationFrame(sample);
					}),
			);
			const after = await client.send("Performance.getMetrics");
			let stopComplete;
			const complete = new Promise((resolve) => {
				stopComplete = client.on("Tracing.tracingComplete", resolve);
			});
			await client.send("Tracing.end");
			await complete;
			stopComplete();
			stopTrace();
			if (workload === "modal") {
				await capture(
					`modal-sample-${repetition}-${opaqueOverride ? "opaque" : "glass"}`,
				);
				await click('button[aria-label="Close texture page"]');
				await tab("frame");
			}
			await click(".explorer-frame-actions button:nth-child(2)");
			const report = await read(() => globalThis.__explorerThemeReport);
			const metricDelta = Object.fromEntries(
				after.metrics.map(({ name, value }) => [
					name,
					value - before.metrics.find((entry) => entry.name === name).value,
				]),
			);
			const sample = {
				repetition,
				opaqueOverride,
				frames,
				metricDelta,
				report,
			};
			samples.push(sample);
			await writeFile(
				`${outputPrefix}.trace-${repetition}-${opaqueOverride ? "opaque" : "glass"}.json`,
				JSON.stringify({ traceEvents }),
			);
			console.log(
				JSON.stringify({
					repetition,
					opaqueOverride,
					frames: frames.length,
					taskSeconds: metricDelta.TaskDuration,
				}),
			);
		}
	}
	await configureOverride(false);
	await capture("frame-profile");
	const preserved = await read(
		() =>
			globalThis.__explorerThemeCanvas ===
			document.querySelector(".explorer-canvas"),
	);
	if (!preserved || modal.selected !== "true" || errors.length)
		throw new Error(
			"Explorer theme verification failed: " +
				JSON.stringify({ preserved, modal, errors }),
		);
	await writeFile(
		`${outputPrefix}.json`,
		JSON.stringify(
			{
				identity,
				panels,
				modal,
				preserved,
				samples,
				errors,
				workload: {
					panel: workload,
					landblock: "0xda55ffff",
					allResidencyRadii: 1,
					sampleMilliseconds: 3000,
				},
			},
			null,
			2,
		),
	);
	console.log("Explorer theme evidence: " + outputPrefix);
} finally {
	try {
		await configureOverride(false);
		await read(() => {
			if (globalThis.__explorerThemeClipboardWrite)
				navigator.clipboard.writeText =
					globalThis.__explorerThemeClipboardWrite;
			delete globalThis.__explorerThemeClipboardWrite;
			delete globalThis.__explorerThemeReport;
			delete globalThis.__explorerThemeCanvas;
			delete globalThis.__explorerThemeModalOpener;
		});
	} finally {
		client.close();
	}
}
