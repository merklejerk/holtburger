import { describe, expect, it, vi } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../frontend-frame-settings";
import type { NameplateVisual } from "./nameplate-policy";
import {
	WebGL2NameplateTextureCache,
	type NameplateRasterizer,
} from "./webgl2-nameplate-texture-cache";

const APPEARANCE = SHARED_FRAME_SETTINGS.nameplates.appearance;
const PLATE: NameplateVisual = {
	category: "mob",
	content: { level: 42, name: "Drudge" },
};

function createFixture(options: { readonly width?: number } = {}) {
	const createdTextures: WebGLTexture[] = [];
	const deletedTextures: WebGLTexture[] = [];
	const texImage2D = vi.fn();
	const gl = {
		CLAMP_TO_EDGE: 1,
		LINEAR: 2,
		MAX_TEXTURE_SIZE: 3,
		RGBA: 4,
		TEXTURE_2D: 5,
		TEXTURE_MAG_FILTER: 6,
		TEXTURE_MIN_FILTER: 7,
		TEXTURE_WRAP_S: 8,
		TEXTURE_WRAP_T: 9,
		UNSIGNED_BYTE: 10,
		bindTexture: () => undefined,
		createTexture: () => {
			const texture = {} as WebGLTexture;
			createdTextures.push(texture);
			return texture;
		},
		deleteTexture: (texture: WebGLTexture) => deletedTextures.push(texture),
		getParameter: () => 4_096,
		texImage2D,
		texParameteri: () => undefined,
	} as unknown as WebGL2RenderingContext;
	const rasterize = vi.fn(() => ({
		height: 32,
		pixels: {} as TexImageSource,
		width: options.width ?? 128,
	}));
	const rasterizer = { rasterize } satisfies NameplateRasterizer;
	return {
		cache: new WebGL2NameplateTextureCache(gl, rasterizer),
		createdTextures,
		deletedTextures,
		rasterize,
		texImage2D,
	};
}

describe("WebGL2NameplateTextureCache", () => {
	it("requires reconciliation to establish the active raster style", () => {
		const fixture = createFixture();
		expect(() => fixture.cache.acquire(PLATE)).toThrow("no reconciled style");
	});

	it("shares one lazily allocated texture for a complete visual value", () => {
		const fixture = createFixture();
		const equalPlate: NameplateVisual = {
			category: PLATE.category,
			content: { ...PLATE.content },
		};
		fixture.cache.reconcile([PLATE, equalPlate], APPEARANCE, 1);

		const first = fixture.cache.acquire(PLATE);
		const second = fixture.cache.acquire(equalPlate);

		expect(second).toBe(first);
		expect(fixture.rasterize).toHaveBeenCalledOnce();
		expect(fixture.rasterize).toHaveBeenCalledWith(PLATE, APPEARANCE, 1);
		expect(fixture.texImage2D).toHaveBeenCalledOnce();
		expect(fixture.cache.diagnostics()).toEqual({
			byteCount: 128 * 32 * 4,
			hitCount: 1,
			liveEntryCount: 1,
			missCount: 1,
			rasterizationCount: 1,
			rejectedRasterCount: 0,
			releaseCount: 0,
		});
	});

	it("releases a texture only after its last installed visual value disappears", () => {
		const fixture = createFixture();
		fixture.cache.reconcile([PLATE, PLATE], APPEARANCE, 1);
		fixture.cache.acquire(PLATE);

		fixture.cache.reconcile([PLATE, PLATE], APPEARANCE, 1);
		expect(fixture.deletedTextures).toEqual([]);

		fixture.cache.reconcile([], APPEARANCE, 1);
		expect(fixture.deletedTextures).toEqual(fixture.createdTextures);
		expect(fixture.cache.diagnostics()).toMatchObject({
			byteCount: 0,
			liveEntryCount: 0,
			releaseCount: 1,
		});
	});

	it("rerasterizes the active population when raster density changes", () => {
		const fixture = createFixture();

		fixture.cache.reconcile([PLATE], APPEARANCE, 1);
		fixture.cache.acquire(PLATE);
		fixture.cache.reconcile([PLATE], APPEARANCE, 2);
		fixture.cache.acquire(PLATE);

		expect(fixture.rasterize).toHaveBeenCalledTimes(2);
		expect(fixture.cache.diagnostics()).toMatchObject({
			liveEntryCount: 1,
			releaseCount: 1,
		});
	});

	it("keeps category colors and changed appearance in the complete visual key", () => {
		const fixture = createFixture();
		const player = { ...PLATE, category: "player" as const };
		const selfPlayer = { ...PLATE, category: "selfPlayer" as const };
		const italic = {
			...APPEARANCE,
			name: { ...APPEARANCE.name, fontStyle: "italic" as const },
		};

		fixture.cache.reconcile([PLATE, player, selfPlayer], APPEARANCE, 1);
		fixture.cache.acquire(PLATE);
		fixture.cache.acquire(player);
		fixture.cache.acquire(selfPlayer);
		fixture.cache.reconcile([PLATE], italic, 1);
		fixture.cache.acquire(PLATE);

		expect(fixture.rasterize).toHaveBeenCalledTimes(4);
		expect(fixture.cache.diagnostics()).toMatchObject({
			liveEntryCount: 1,
			releaseCount: 3,
		});
	});

	it("records and rejects an oversized raster before allocating a texture", () => {
		const fixture = createFixture({ width: 4_097 });
		fixture.cache.reconcile([PLATE], APPEARANCE, 1);

		expect(() => fixture.cache.acquire(PLATE)).toThrow(
			"Nameplate texture rejected",
		);
		expect(fixture.createdTextures).toEqual([]);
		expect(fixture.cache.diagnostics()).toMatchObject({
			liveEntryCount: 0,
			rejectedRasterCount: 1,
		});
	});

	it("destroys every live texture exactly once and rejects later use", () => {
		const fixture = createFixture();
		const npc = {
			category: "npc" as const,
			content: { level: null, name: "Town Crier" },
		};
		fixture.cache.reconcile([PLATE, npc], APPEARANCE, 1);
		fixture.cache.acquire(PLATE);
		fixture.cache.acquire(npc);

		fixture.cache.destroy();
		fixture.cache.destroy();

		expect(fixture.deletedTextures).toEqual(fixture.createdTextures);
		expect(() => fixture.cache.acquire(PLATE)).toThrow(
			"Nameplate texture cache is destroyed",
		);
	});
});
