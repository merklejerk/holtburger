import { afterEach, describe, expect, it, vi } from "vitest";
import {
	decodeWorldMapManifest,
	decodeWorldMapTiles,
} from "../../assets/decode-world-map";
import { createWorldMapFixture } from "../../../harness/browser/world-map-fixture";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { WorldMapOwner } from "./owner";
import { fitWorldMap, clampWorldMap, worldMapPosition } from "./view";
import {
	WORLD_MAP_TILE_SIDE,
	type WorldMapSource,
	type WorldMapTileBatch,
} from "./types";

function envelope(header: unknown, data = new Uint8Array()): Uint8Array {
	const json = JSON.stringify(header);
	const encoded = new TextEncoder().encode(
		json + " ".repeat((4 - ((12 + json.length) % 4)) % 4),
	);
	const bytes = new Uint8Array(12 + encoded.length + data.length);
	bytes.set(new TextEncoder().encode("HBWT"));
	const view = new DataView(bytes.buffer);
	view.setUint32(4, encoded.length, true);
	view.setUint32(8, bytes.length, true);
	bytes.set(encoded, 12);
	bytes.set(data, 12 + encoded.length);
	return bytes;
}
const flush = async () => {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

/** Canvas calls and frame scheduling are isolated from browser presentation acceptance. */
function canvasFixture() {
	const context = {
		isContextLost: vi.fn(() => false),
		putImageData: vi.fn(),
		clearRect: vi.fn(),
		drawImage: vi.fn(),
	};
	const canvas = Object.assign(new EventTarget(), {
		width: 0,
		height: 0,
		clientWidth: 600,
		clientHeight: 400,
		getContext: vi.fn(() => context),
	});
	const backing = Object.assign(new EventTarget(), {
		width: 0,
		height: 0,
		getContext: vi.fn(() => context),
	});
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	vi.stubGlobal("document", { createElement: () => backing });
	vi.stubGlobal(
		"ImageData",
		class {
			constructor(
				readonly data: Uint8ClampedArray,
				readonly width: number,
				readonly height: number,
			) {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	return {
		canvas: canvas as unknown as HTMLCanvasElement,
		context,
		frames,
		draw() {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		},
	};
}
afterEach(() => vi.unstubAllGlobals());

describe("world-map image boundary", () => {
	it("validates the complete north-up image partition", async () => {
		const value = await createWorldMapFixture().source.open("open");
		expect(decodeWorldMapManifest(value)).toEqual(value);
		expect(() =>
			decodeWorldMapManifest({ ...value, width: value.width / 2 }),
		).toThrow();
		expect(() =>
			decodeWorldMapManifest({ ...value, tiles: [...value.tiles].reverse() }),
		).toThrow("canonical");
	});
	it("decodes unaligned transport bytes and enforces receipts, cursors, RGBA lengths and terminal completion", async () => {
		const manifest = await createWorldMapFixture().source.open("open");
		const header = {
			receiptId: manifest.receiptId,
			firstTile: 0,
			tileCount: 1,
			state: "streaming",
		};
		const payload = new Uint8Array(WORLD_MAP_TILE_SIDE ** 2 * 4).fill(129);
		const bytes = envelope(header, payload);
		const unaligned = new Uint8Array(bytes.length + 1);
		unaligned.set(bytes, 1);
		expect(
			decodeWorldMapTiles(unaligned.subarray(1), manifest, 0).tiles[0],
		).toEqual(new Uint8ClampedArray(payload));
		expect(() =>
			decodeWorldMapTiles(
				envelope({ ...header, receiptId: "stale" }, payload),
				manifest,
				0,
			),
		).toThrow("identity");
		expect(() => decodeWorldMapTiles(bytes, manifest, 1)).toThrow("cursor");
		expect(() => decodeWorldMapTiles(envelope(header), manifest, 0)).toThrow(
			"payload",
		);
		expect(() =>
			decodeWorldMapTiles(
				envelope({ ...header, state: "complete" }, payload),
				manifest,
				0,
			),
		).toThrow("before all");
		expect(() =>
			decodeWorldMapTiles(envelope({ ...header, tileCount: 0 }), manifest, 0),
		).toThrow("no progress");
		const terminal = {
			receiptId: manifest.receiptId,
			firstTile: manifest.tiles.length,
			tileCount: 0,
			state: "complete",
		};
		expect(
			decodeWorldMapTiles(envelope(terminal), manifest, manifest.tiles.length)
				.state,
		).toBe("complete");
		expect(() =>
			decodeWorldMapTiles(bytes.subarray(0, 4), manifest, 0),
		).toThrow("truncated");
	});
	it("fits and clamps views against image-independent world bounds", async () => {
		const { bounds } = await createWorldMapFixture().source.open("open");
		const fit = fitWorldMap(bounds, 2);
		expect(fit.centerX).toBe((bounds.minX + bounds.maxX) / 2);
		expect(fit.centerZ).toBe((bounds.minZ + bounds.maxZ) / 2);
		expect(fit.spanMeters).toBe((bounds.maxZ - bounds.minZ) * 2);
		expect(fitWorldMap(bounds, 0.5).spanMeters).toBe(bounds.maxX - bounds.minX);
		expect(
			fitWorldMap(
				bounds,
				(bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ),
			).spanMeters,
		).toBe(bounds.maxX - bounds.minX);
		expect(
			clampWorldMap({ ...fit, centerX: -100000, centerZ: 100000 }, bounds, 2),
		).toEqual(fit);
	});
	it("clamps viewport edges in both axes and centers only an oversized axis", () => {
		const span = SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters * 4;
		const extent = span * 2.5;
		const bounds = { minX: 0, maxX: extent, minZ: -extent, maxZ: 0 };
		expect(
			clampWorldMap(
				{ centerX: -extent, centerZ: -extent * 2, spanMeters: span },
				bounds,
				2,
			),
		).toEqual({
			centerX: span / 2,
			centerZ: bounds.minZ + span / 4,
			spanMeters: span,
		});
		expect(
			clampWorldMap(
				{ centerX: extent * 2, centerZ: extent, spanMeters: span },
				bounds,
				0.5,
			),
		).toEqual({
			centerX: bounds.maxX - span / 2,
			centerZ: -span,
			spanMeters: span,
		});
		expect(
			clampWorldMap(
				{ centerX: -extent, centerZ: -extent * 2, spanMeters: span * 3 },
				bounds,
				2,
			),
		).toEqual({
			centerX: extent / 2,
			centerZ: bounds.minZ + (span * 3) / 4,
			spanMeters: span * 3,
		});
	});
});

describe("world-map hover projection", () => {
	it("projects north-up CSS pixels and rejects margins and hidden surfaces", () => {
		const bounds = { minX: 0, maxX: 1000, minZ: -1000, maxZ: 0 };
		const view = { centerX: 500, centerZ: -500, spanMeters: 1000 };
		expect(worldMapPosition(100, 50, view, bounds, 200, 100)).toEqual({
			x: 500,
			z: -500,
		});
		expect(worldMapPosition(0, 0, view, bounds, 200, 100)).toEqual({
			x: 0,
			z: -750,
		});
		expect(worldMapPosition(200, 100, view, bounds, 200, 100)).toEqual({
			x: 1000,
			z: -250,
		});
		expect(
			worldMapPosition(0, 0, { ...view, spanMeters: 2000 }, bounds, 200, 100),
		).toBeNull();
		expect(worldMapPosition(-1, 50, view, bounds, 200, 100)).toBeNull();
		expect(worldMapPosition(0, 0, view, bounds, 0, 0)).toBeNull();
	});
});

describe("retained progressive world image", () => {
	it("preserves reset across resizing and retains a user's zoom", async () => {
		const fixture = createWorldMapFixture();
		const browser = canvasFixture();
		const owner = new WorldMapOwner(fixture.source, browser.canvas);
		owner.setVisible(true);
		const loading = owner.load();
		await flush();
		browser.draw();
		await loading;
		expect(owner.isResetView()).toBe(true);
		Object.defineProperty(browser.canvas, "clientWidth", {
			value: 800,
			configurable: true,
		});
		owner.resize();
		expect(owner.isResetView()).toBe(true);
		const view = owner.readView();
		if (!view) throw new Error("Expected a loaded map view.");
		owner.setView({
			...view,
			spanMeters: SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters * 2,
		});
		expect(owner.isResetView()).toBe(false);
		Object.defineProperty(browser.canvas, "clientWidth", {
			value: 600,
			configurable: true,
		});
		owner.resize();
		expect(owner.readView()?.spanMeters).toBe(
			SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters * 2,
		);
		owner.fit();
		expect(owner.isResetView()).toBe(true);
		owner.destroy();
	});

	it("displays partial tiles, coalesces view changes, and applies hidden arrivals without drawing", async () => {
		const fixture = createWorldMapFixture();
		fixture.holdPreparation();
		const browser = canvasFixture();
		const owner = new WorldMapOwner(fixture.source, browser.canvas);
		const drawViews: Array<ReturnType<WorldMapOwner["readView"]>> = [];
		owner.subscribeDraw(() => {
			expect(browser.context.drawImage).toHaveBeenCalled();
			drawViews.push(owner.readView());
		});
		owner.setVisible(true);
		const operation = owner.load();
		await flush();
		expect(owner.read().kind).toBe("streaming");
		expect(owner.diagnostics()?.appliedTiles).toBe(1);
		const view = owner.readView();
		if (!view) throw new Error("Partial image needs a view.");
		owner.setView({ ...view, spanMeters: 20000 });
		owner.setView({ ...view, spanMeters: 10000 });
		expect(browser.frames.size).toBe(1);
		browser.draw();
		expect(owner.readView()?.spanMeters).toBe(10000);
		expect(browser.context.drawImage).toHaveBeenCalledTimes(1);
		expect(drawViews).toEqual([owner.readView()]);
		owner.setVisible(false);
		fixture.advancePreparation();
		await flush();
		expect(owner.diagnostics()?.appliedTiles).toBeGreaterThan(1);
		expect(browser.frames.size).toBe(0);
		expect(drawViews).toHaveLength(1);
		fixture.releasePreparation();
		await operation;
		expect(owner.read().kind).toBe("ready");
		const reads = fixture.read();
		owner.setVisible(true);
		browser.draw();
		expect(fixture.read()).toEqual(reads);
		expect(owner.diagnostics()?.appliedTiles).toBe(reads.expectedTiles);
		owner.destroy();
		expect(owner.read().kind).toBe("disposed");
	});
	it("retries content loss immediately while a prior read is pending and ignores the late reply", async () => {
		const browser = canvasFixture();
		const manifest = await createWorldMapFixture().source.open("open");
		let release: (batch: WorldMapTileBatch) => void = () => {
			throw new Error("Old read is not pending.");
		};
		let opens = 0;
		const source: WorldMapSource = {
			open: async () => {
				opens++;
				return manifest;
			},
			readTiles: async () => {
				if (opens === 1)
					return new Promise((resolve) => {
						release = resolve;
					});
				return {
					firstTile: 0,
					state: "complete",
					tiles: manifest.tiles.map(
						() => new Uint8ClampedArray(WORLD_MAP_TILE_SIDE ** 2 * 4),
					),
				};
			},
		};
		const owner = new WorldMapOwner(source, browser.canvas);
		owner.setVisible(true);
		const old = owner.load();
		await flush();
		browser.canvas.dispatchEvent(new Event("contextlost"));
		expect(owner.read().kind).toBe("load-failed");
		expect(owner.readView()).toBeNull();
		await owner.load();
		expect(opens).toBe(2);
		expect(owner.read().kind).toBe("ready");
		release({
			firstTile: 0,
			state: "streaming",
			tiles: [new Uint8ClampedArray(WORLD_MAP_TILE_SIDE ** 2 * 4)],
		});
		await old;
		expect(owner.diagnostics()?.appliedTiles).toBe(manifest.tiles.length);
		owner.destroy();
	});
	it("clears partial content on source failure and retries the host", async () => {
		const browser = canvasFixture();
		const fixture = createWorldMapFixture();
		let fail = true;
		const source: WorldMapSource = {
			open: fixture.source.open,
			readTiles: async (manifest, cursor) => {
				if (fail && cursor > 0) throw new Error("Image worker failed");
				const batch = await fixture.source.readTiles(manifest, cursor);
				if (fail)
					return {
						...batch,
						tiles: batch.tiles.slice(0, 1),
						state: "streaming",
					};
				return batch;
			},
		};
		const owner = new WorldMapOwner(source, browser.canvas);
		await owner.load();
		expect(owner.read().kind).toBe("load-failed");
		expect(owner.diagnostics()).toBeNull();
		fail = false;
		await owner.load();
		expect(owner.read().kind).toBe("ready");
		owner.destroy();
	});

	it("keeps a lost context retryable until restoration, then replays the image", async () => {
		const browser = canvasFixture();
		browser.context.isContextLost.mockReturnValue(true);
		const fixture = createWorldMapFixture();
		const owner = new WorldMapOwner(fixture.source, browser.canvas);
		await owner.load();
		expect(owner.read().kind).toBe("load-failed");
		browser.context.isContextLost.mockReturnValue(false);
		await owner.load();
		expect(owner.read().kind).toBe("ready");
		expect(owner.diagnostics()?.appliedTiles).toBe(
			fixture.read().expectedTiles,
		);
		owner.destroy();
	});
	it("reports unavailable Canvas2D without an ineffective retry", async () => {
		const browser = canvasFixture();
		browser.canvas.getContext = vi.fn(() => null);
		const fixture = createWorldMapFixture();
		const owner = new WorldMapOwner(fixture.source, browser.canvas);
		await owner.load();
		expect(owner.read().kind).toBe("unavailable");
		await owner.load();
		expect(fixture.read().opens).toBe(1);
		owner.destroy();
	});
});
