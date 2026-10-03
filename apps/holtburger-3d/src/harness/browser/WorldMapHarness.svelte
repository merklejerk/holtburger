<script lang="ts">
	import { onMount, tick } from "svelte";
	import ClientWorldPanel from "../../client/ClientWorldPanel.svelte";
	import { createClientHudLayout } from "../../client/client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import { httpWorldMapSource } from "../../lib/assets/world-map-source";
	import type { WorldMapSource } from "../../lib/game/world-map/types";
	import type { WorldMapOwner } from "../../lib/game/world-map/owner";
	import { WorldMapRenderer } from "../../lib/game/world-map/renderer";
	import type { MinimapFrame } from "../../app/minimap-frame";
	import { WORLD_MAP_SETTLEMENTS } from "../../lib/game/world-map/world-map-settlements";
	import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";

	const url = new URLSearchParams(location.search).get("contentHost");
	if (!url) throw new Error("World-map harness requires a content host URL.");
	const { keyboard } = provideAppInputPolicy();
	const contentHostUrl = url;
	const transport = httpWorldMapSource(contentHostUrl);
	const viewport = { width: innerWidth, height: innerHeight };
	let placement = $state(
		createClientHudLayout(CLIENT_UI_DEFAULTS, viewport, 8).world,
	);
	let visible = $state(true);
	let canTeleportFromMap = $state(false);
	const mapTeleports: { x: number; z: number }[] = [];
	let mounted = $state(true);
	let panel = $state<{ readOwner(): WorldMapOwner | null }>();
	let opens = 0,
		tileReads = 0,
		transferredBytes = 0;
	let firstTileMs: number | null = null,
		completeMs: number | null = null;
	let injectedFailure = false;
	let closeCount = 0;
	const start = performance.now();
	let firstDrawMs: number | null = null;
	const originalDraw = WorldMapRenderer.prototype.draw;
	WorldMapRenderer.prototype.draw = function (view) {
		originalDraw.call(this, view);
		if (firstDrawMs === null && this.diagnostics().appliedTiles > 0)
			firstDrawMs = performance.now() - start;
	};
	const source: WorldMapSource = {
		async open(intent) {
			opens++;
			if (injectedFailure) {
				injectedFailure = false;
				throw new Error("Harness injected load failure");
			}
			return transport.open(intent);
		},
		async readTiles(manifest, cursor) {
			tileReads++;
			const batch = await transport.readTiles(manifest, cursor);
			for (const tile of batch.tiles) transferredBytes += tile.byteLength;
			if (batch.tiles.length && firstTileMs === null)
				firstTileMs = performance.now() - start;
			if (batch.state === "complete") completeMs = performance.now() - start;
			return batch;
		},
	};
	const readFrame = (): MinimapFrame => ({
		source: null,
		subject: {
			kind: "controlled-entity",
			guid: 1,
			anchor: {
				worldX: 42000,
				worldY: 0,
				worldZ: -16500,
				headingRadians: 0,
				residency: { landblockId: "0xda55ffff", envCellId: null },
			},
		},
		presentedEntities: () => [],
		selectedGuid: null,
		cameraFovRadians: 1,
		cameraHeadingRadians: 0,
	});
	const owner = (): WorldMapOwner => {
		const value = panel?.readOwner();
		if (!value) throw new Error("Map owner is not mounted.");
		return value;
	};
	const canvas = (): HTMLCanvasElement => {
		const value = document.querySelector<HTMLCanvasElement>(
			'canvas[aria-label="World terrain map"]',
		);
		if (!value) throw new Error("Map canvas is not mounted.");
		return value;
	};
	const read = () => {
		const current = owner().read();
		return {
			kind: current.kind,
			diagnostic:
				current.kind === "load-failed" || current.kind === "unavailable"
					? current.diagnostic
					: null,
			opens,
			tileReads,
			transferredBytes,
			firstTileMs,
			firstDrawMs,
			completeMs,
			closeCount,
			visible,
			image: owner().diagnostics(),
			view: owner().readView(),
			marker: (() => {
				const marker = document.querySelector(".world-player-target");
				if (!(marker instanceof SVGGElement))
					throw new Error("Player marker is missing.");
				const transform = marker.transform.baseVal.consolidate();
				return {
					x: transform ? transform.matrix.e : null,
					y: transform ? transform.matrix.f : null,
					hidden: marker.style.display === "none",
				};
			})(),
			canvas: { width: canvas().width, height: canvas().height },
		};
	};

	/** Exercise the production overlay while streaming or ready, without live entity residency. */
	async function teleportProbe() {
		const original = owner().readView();
		if (!original) throw new Error("Teleport probe requires a map view.");
		owner().fit();
		await owner().drawSettled();
		const surface = canvas();
		const rect = surface.getBoundingClientRect();
		const point = {
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
		};
		const event = (type: string, dx = 0) =>
			new PointerEvent(type, {
				...point,
				clientX: point.clientX + dx,
				pointerId: 91,
				button: 0,
				bubbles: true,
			});
		const down = () => surface.dispatchEvent(event("pointerdown"));
		const up = () => window.dispatchEvent(event("pointerup"));
		const assertCount = (count: number) => {
			if (mapTeleports.length !== count)
				throw new Error(
					`Expected ${count} map requests, got ${mapTeleports.length}.`,
				);
		};
		mapTeleports.length = 0;
		canTeleportFromMap = false;
		await tick();
		down();
		up();
		assertCount(0);
		canTeleportFromMap = true;
		await tick();
		down();
		up();
		assertCount(1);
		const fitted = owner().readView();
		if (
			!fitted ||
			mapTeleports[0].x !== fitted.centerX ||
			mapTeleports[0].z !== fitted.centerZ
		)
			throw new Error(
				"Map click did not preserve its exact projected location.",
			);
		const travel = SHARED_FRONTEND_TUNING.worldMap.panThresholdPixels + 10;
		down();
		window.dispatchEvent(event("pointermove", travel));
		window.dispatchEvent(event("pointermove"));
		up();
		assertCount(1);
		down();
		window.dispatchEvent(event("pointercancel"));
		up();
		assertCount(1);
		down();
		canTeleportFromMap = false;
		await tick();
		up();
		assertCount(1);
		canTeleportFromMap = true;
		await tick();
		down();
		visible = false;
		await tick();
		up();
		assertCount(1);
		visible = true;
		await tick();
		down();
		const housing = document.querySelector<HTMLButtonElement>(
			'[role="tab"][aria-controls$="-housing"]',
		);
		const world = document.querySelector<HTMLButtonElement>(
			'[role="tab"][aria-controls$="-world"]',
		);
		if (!housing || !world) throw new Error("Missing map tabs.");
		housing.click();
		await tick();
		up();
		assertCount(1);
		world.click();
		await tick();
		// At world fit, threshold travel is still a drag even though clamp keeps the view fixed.
		owner().fit();
		await owner().drawSettled();
		down();
		window.dispatchEvent(event("pointermove", travel));
		up();
		assertCount(1);
		const state = owner().read();
		canTeleportFromMap = false;
		owner().setView(original);
		await tick();
		await owner().drawSettled();
		return {
			kind: state.kind,
			requests: mapTeleports.slice(),
			cancelledCases: 6,
		};
	}

	/** Exercise the production overlay while streaming or ready, without live entity residency. */
	async function settlementProbe() {
		const original = owner().readView();
		if (!original)
			throw new Error("Settlement check requires a map projection.");
		const root = document.querySelector(".world-settlements");
		if (!(root instanceof SVGGElement))
			throw new Error("Missing settlement overlay.");
		const nodes = [...root.querySelectorAll<SVGGElement>("g[data-settlement]")];
		if (nodes.length !== WORLD_MAP_SETTLEMENTS.length)
			throw new Error("Settlement nodes were not retained.");
		const labelToggle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Show settlement labels"]',
		);
		if (!labelToggle || labelToggle.getAttribute("aria-pressed") !== "false")
			throw new Error("Settlement labels must default to hidden.");
		canvas().dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		const verify = () => {
			const view = owner().readView();
			if (!view) throw new Error("Missing settlement view.");
			let visibleCount = 0,
				labels = 0;
			for (const settlement of WORLD_MAP_SETTLEMENTS) {
				const node = nodes.find(
					(node) => node.dataset.settlement === settlement.name,
				);
				if (!node) throw new Error(`Missing ${settlement.name} marker.`);
				const expectedX =
					canvas().clientWidth / 2 +
					((settlement.position[0] - view.centerX) * canvas().clientWidth) /
						view.spanMeters;
				const expectedY =
					canvas().clientHeight / 2 +
					((settlement.position[2] - view.centerZ) * canvas().clientWidth) /
						view.spanMeters;
				const expectedVisible =
					expectedX >= 0 &&
					expectedY >= 0 &&
					expectedX <= canvas().clientWidth &&
					expectedY <= canvas().clientHeight;
				if ((node.style.display !== "none") !== expectedVisible)
					throw new Error(`Incorrect visibility for ${settlement.name}.`);
				if (!expectedVisible) continue;
				visibleCount++;
				const transform = node.transform.baseVal.consolidate();
				if (
					!transform ||
					Math.abs(transform.matrix.e - expectedX) > 0.001 ||
					Math.abs(transform.matrix.f - expectedY) > 0.001
				)
					throw new Error(`${settlement.name} missed terrain projection.`);
				const text = node.querySelector("text");
				if (!text) throw new Error("Missing settlement label.");
				const shown = getComputedStyle(text).visibility === "visible";
				if (shown) labels++;
				if (shown !== (labelToggle.getAttribute("aria-pressed") === "true"))
					throw new Error("Settlement label disagreed with visibility toggle.");
			}
			return { visibleCount, labels };
		};
		owner().fit();
		await owner().drawSettled();
		if (verify().labels !== 0)
			throw new Error("Labels appeared with the toggle off.");
		labelToggle.click();
		await tick();
		const whole = verify();
		if (
			whole.visibleCount !== WORLD_MAP_SETTLEMENTS.length ||
			whole.labels !== whole.visibleCount
		)
			throw new Error("Whole-world fit did not show settlement annotations.");
		await visibility(false);
		await visibility(true);
		if (verify().labels !== whole.labels)
			throw new Error("Label toggle was lost when reopening the map.");
		const town = WORLD_MAP_SETTLEMENTS.find(
			(entry) => entry.name === "Holtburg",
		);
		if (!town) throw new Error("Missing Holtburg reference.");
		owner().setView({
			centerX: town.position[0],
			centerZ: town.position[2],
			spanMeters: SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters * 4,
		});
		await owner().drawSettled();
		const close = verify();
		const text = root.querySelector(".ui-world-map-label");
		const dot = root.querySelector(".ui-world-map-settlement-dot");
		if (!(text instanceof SVGTextElement) || !(dot instanceof SVGCircleElement))
			throw new Error("Settlement theme hooks are missing.");
		const initialFont = getComputedStyle(text).font;
		const overrides = {
			"--ui-world-map-label-font": "italic 700 17px monospace",
			"--ui-world-map-label-color": "rgb(30, 220, 180)",
			"--ui-world-map-label-outline-color": "rgb(80, 20, 100)",
			"--ui-world-map-label-outline-width": "4px",
			"--ui-world-map-label-offset": "12px",
			"--ui-world-map-settlement-dot-radius": "4px",
		};
		for (const [key, value] of Object.entries(overrides))
			root.style.setProperty(key, value);
		const themed = getComputedStyle(text);
		if (
			themed.fontSize !== "17px" ||
			themed.fontFamily !== "monospace" ||
			themed.fontWeight !== "700" ||
			themed.fontStyle !== "italic" ||
			themed.fill !== "rgb(30, 220, 180)" ||
			themed.stroke !== "rgb(80, 20, 100)" ||
			themed.strokeWidth !== "4px" ||
			themed.transform !== "matrix(1, 0, 0, 1, 12, 0)" ||
			getComputedStyle(dot).r !== "4px" ||
			getComputedStyle(dot).fill !== themed.fill
		)
			throw new Error(
				"Retained settlement nodes did not respond to theme overrides.",
			);
		owner().fit();
		await owner().drawSettled();
		verify();
		if (
			root.querySelector(".ui-world-map-label") !== text ||
			getComputedStyle(text).fontSize !== "17px"
		)
			throw new Error("Map zoom recreated or rescaled the themed label.");
		for (const key of Object.keys(overrides)) root.style.removeProperty(key);
		if (getComputedStyle(text).font !== initialFont)
			throw new Error("Label font did not restore with theme removal.");
		owner().setView({
			centerX: town.position[0],
			centerZ: town.position[2],
			spanMeters: SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters * 4,
		});
		await owner().drawSettled();
		const hoverCenter = () => {
			const rect = canvas().getBoundingClientRect();
			canvas().dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					clientX: rect.left + rect.width / 2,
					clientY: rect.top + rect.height / 2,
				}),
			);
		};
		labelToggle.click();
		await tick();
		if (verify().labels !== 0)
			throw new Error("Labels stayed visible after switching the toggle off.");
		hoverCenter();
		if (verify().labels !== 0)
			throw new Error("Hover revealed an inline label with the toggle off.");
		const tooltip = document.querySelector(".world-map-tooltip");
		if (
			!(tooltip instanceof HTMLDivElement) ||
			tooltip.hidden ||
			tooltip.textContent !== "Holtburg · 42.0N, 33.5E"
		)
			throw new Error("Settlement hover missed its verified anchor.");
		const preferredWidth = placement.preferredWidth;
		placement = { ...placement, preferredWidth: preferredWidth + 40 };
		await tick();
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		await owner().drawSettled();
		verify();
		hoverCenter();
		if (tooltip.hidden || !tooltip.textContent?.startsWith("Holtburg ·"))
			throw new Error("Resized settlement hover missed its marker.");
		const view = owner().readView();
		if (!view) throw new Error("Missing resized view.");
		owner().setView({ ...view, centerX: view.centerX + view.spanMeters / 4 });
		await owner().drawSettled();
		verify();
		if (tooltip.textContent?.startsWith("Holtburg ·"))
			throw new Error("Stationary hover retained the old settlement hit.");
		canvas().dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		if (verify().labels !== 0)
			throw new Error("Pointer exit left a settlement label visible.");
		placement = { ...placement, preferredWidth };
		await tick();
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		owner().setView(original);
		await owner().drawSettled();
		return {
			kind: owner().read().kind,
			whole,
			close,
			total: nodes.length,
			themeOverrides: true,
		};
	}

	/** Avoid the motion timer so this proves the marker moves in the terrain's draw callback. */
	async function markerProjectionProbe() {
		const interval = globalThis.setInterval;
		globalThis.setInterval = (() => 0) as typeof setInterval;
		try {
			await visibility(false);
			await visibility(true);
			const samples = [];
			for (let sample = 0; sample < 5; sample++) {
				await zoom(sample % 2 === 0 ? 768 : 4096);
				await pan();
				const result = read();
				const view = result.view;
				if (!view) throw new Error("Image view is missing.");
				const expected = {
					x:
						result.canvas.width / 2 +
						((42000 - view.centerX) * result.canvas.width) / view.spanMeters,
					y:
						result.canvas.height / 2 +
						((-16500 - view.centerZ) * result.canvas.width) / view.spanMeters,
				};
				if (
					result.marker.hidden ||
					result.marker.x === null ||
					result.marker.y === null ||
					Math.abs(result.marker.x - expected.x) > 0.001 ||
					Math.abs(result.marker.y - expected.y) > 0.001
				)
					throw new Error("Player marker missed the image draw frame.");
				samples.push({ actual: result.marker, expected });
			}
			return samples;
		} finally {
			globalThis.setInterval = interval;
			await visibility(false);
			await visibility(true);
		}
	}

	/** Real panel controls exercise retained tab state, viewport bounds, and reset behavior. */
	async function controlsProbe() {
		const state = owner().read();
		if (state.kind !== "ready")
			throw new Error("Image is not ready for control checks.");
		const { bounds } = state.manifest;
		owner().setView({
			centerX: bounds.minX - 100000,
			centerZ: bounds.maxZ + 100000,
			spanMeters: 4096,
		});
		await owner().drawSettled();
		const clamped = read();
		const view = clamped.view;
		if (!view) throw new Error("Clamped image view is missing.");
		const halfX = view.spanMeters / 2,
			halfZ = (halfX * canvas().clientHeight) / canvas().clientWidth;
		if (
			Math.abs(view.centerX - halfX - bounds.minX) > 0.001 ||
			Math.abs(view.centerZ + halfZ - bounds.maxZ) > 0.001
		)
			throw new Error("Panning exposed space outside the map bounds.");
		const chooseTab = async (name: "world" | "housing") => {
			const button = document.querySelector(
				`[role="tab"][aria-controls$="-${name}"]`,
			);
			if (!(button instanceof HTMLButtonElement))
				throw new Error(`Missing ${name} tab.`);
			button.click();
			await tick();
			await owner().drawSettled();
		};
		await chooseTab("housing");
		const hidden = owner().diagnostics();
		if (
			canvas().clientWidth !== 0 ||
			JSON.stringify(owner().readView()) !== JSON.stringify(view)
		)
			throw new Error("Housing did not retain the hidden image view.");
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (owner().diagnostics()?.draws !== hidden?.draws)
			throw new Error("Hidden tab kept drawing.");
		await chooseTab("world");
		if (JSON.stringify(owner().readView()) !== JSON.stringify(view))
			throw new Error("World tab did not preserve its view.");
		const reset = document.querySelector('button[aria-label="Reset view"]');
		if (
			!(reset instanceof HTMLButtonElement) ||
			reset.hidden ||
			!reset.classList.contains("ui-hud-button")
		)
			throw new Error("Changed view did not expose a HUD reset control.");
		reset.click();
		await tick();
		await owner().drawSettled();
		if (!reset.hidden)
			throw new Error("Reset control remained visible at world fit.");
		const resetView = owner().readView();
		if (
			!resetView ||
			resetView.centerX !== (bounds.minX + bounds.maxX) / 2 ||
			resetView.centerZ !== (bounds.minZ + bounds.maxZ) / 2 ||
			resetView.spanMeters < bounds.maxX - bounds.minX ||
			(resetView.spanMeters * canvas().clientHeight) / canvas().clientWidth <
				bounds.maxZ - bounds.minZ
		)
			throw new Error("Reset view did not center and fit the whole world.");

		const surface = canvas();
		const rect = surface.getBoundingClientRect();
		const tooltip = document.querySelector(".world-map-tooltip");
		if (!(tooltip instanceof HTMLDivElement))
			throw new Error("Missing position tooltip.");
		surface.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
			}),
		);
		if (tooltip.hidden || !tooltip.textContent)
			throw new Error("Map hover did not show coordinates.");
		const centerTooltip = tooltip.textContent;
		owner().setView({
			...resetView,
			spanMeters: resetView.spanMeters / 4,
			centerX: bounds.minX + (bounds.maxX - bounds.minX) / 4,
		});
		await owner().drawSettled();
		if (tooltip.hidden || tooltip.textContent === centerTooltip)
			throw new Error("Stationary hover did not reproject with the map.");
		surface.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: rect.right - 1,
				clientY: rect.bottom - 1,
			}),
		);
		const tipRect = tooltip.getBoundingClientRect();
		if (
			tooltip.hidden ||
			tipRect.right > rect.right ||
			tipRect.bottom > rect.bottom
		)
			throw new Error("Edge tooltip escaped the map surface.");
		surface.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		if (!tooltip.hidden) throw new Error("Map tooltip survived pointer exit.");
		owner().fit();
		await owner().drawSettled();
		surface.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: rect.left + 1,
				clientY: rect.top + 1,
			}),
		);
		if (!tooltip.hidden)
			throw new Error("Fit margin showed terrain coordinates.");
		surface.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
		return {
			clamped: view,
			reset: resetView,
			centerTooltip,
			hiddenDraws: hidden?.draws,
		};
	}
	async function visibility(value: boolean): Promise<void> {
		visible = value;
		await tick();
		await owner().drawSettled();
	}
	async function zoom(span: number): Promise<void> {
		const view = owner().readView();
		if (!view) throw new Error("Map view is not ready.");
		const state = owner().read();
		if (state.kind !== "ready" && state.kind !== "streaming")
			throw new Error("Image is not open.");
		const bounds = state.manifest.bounds;
		const whole = span >= bounds.maxX - bounds.minX;
		owner().setView({
			...view,
			centerX: whole ? (bounds.minX + bounds.maxX) / 2 : 42000,
			centerZ: whole ? (bounds.minZ + bounds.maxZ) / 2 : -16500,
			spanMeters: span,
		});
		await owner().drawSettled();
	}
	async function pan(): Promise<void> {
		const view = owner().readView();
		if (!view) throw new Error("Map is not ready.");
		owner().setView({ ...view, centerX: view.centerX + 192 });
		await owner().drawSettled();
	}
	async function benchmark(span: number) {
		await zoom(span);
		const samples = [];
		for (let sample = 0; sample < 5; sample++) {
			const start = performance.now();
			owner().resize();
			await owner().drawSettled();
			samples.push({ elapsedMs: performance.now() - start });
		}
		return {
			span,
			canvas: read().canvas,
			workload: owner().diagnostics(),
			samples,
		};
	}
	async function benchmarkZoomLatency() {
		const samples = [];
		for (let sample = 0; sample < 5; sample++) {
			const start = performance.now();
			await zoom(768);
			await zoom(48960);
			samples.push({ elapsedMs: performance.now() - start });
		}
		return { canvas: read().canvas, samples };
	}

	/** Representative terrain requests share repository I/O with the bake, but not its decode cache. */
	async function contentProbe() {
		const samples = [];
		for (let sample = 0; sample < 5; sample++) {
			const start = performance.now();
			const response = await fetch(
				new URL("/landblock-source-batch", contentHostUrl),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						landblockId: "0xda55ffff",
						layers: ["terrain"],
					}),
				},
			);
			if (!response.ok) throw new Error(await response.text());
			const bytes = await response.arrayBuffer();
			samples.push({
				elapsedMs: performance.now() - start,
				bytes: bytes.byteLength,
			});
		}
		return { generationActive: owner().read().kind === "streaming", samples };
	}
	onMount(() => {
		const unmount = keyboard.mount(document);
		const api = {
			read,
			contentProbe,
			markerProjectionProbe,
			controlsProbe,
			settlementProbe,
			teleportProbe,
			visibility,
			zoom,
			benchmark,
			benchmarkZoomLatency,
			fit: async () => {
				owner().fit();
				await owner().drawSettled();
			},
			pan,
			// Synthetic Canvas2D loss exercises ownership/replay without relying on GPU extensions.
			loseContext: () => {
				canvas().dispatchEvent(new Event("contextlost"));
			},
			retryFixture: async () => {
				mounted = false;
				await tick();

				injectedFailure = true;
				mounted = true;
				visible = true;
				await tick();
				await owner().settled();
			},
			retry: async () => {
				await owner().load();
			},
			dispose: async () => {
				const retained = owner();
				mounted = false;
				await tick();
				return retained.read().kind;
			},
		};
		Object.assign(globalThis, { __HOLTBURGER_WORLD_MAP_HARNESS__: api });
		return () => {
			unmount();
			WorldMapRenderer.prototype.draw = originalDraw;

			Reflect.deleteProperty(globalThis, "__HOLTBURGER_WORLD_MAP_HARNESS__");
		};
	});
</script>

{#if mounted}
	<ClientWorldPanel
		bind:this={panel}
		{source}
		{canTeleportFromMap}
		onTeleportToMapPosition={async (position) => {
			mapTeleports.push(position);
		}}
		{visible}
		{viewport}
		{placement}
		{readFrame}
		onClose={() => {
			visible = false;
			closeCount++;
		}}
		onPlacementChange={(value) => (placement = value)}
	/>
{/if}
