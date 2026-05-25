import { describe, expect, it } from "vitest";

import {
	RuntimeAppearanceCache,
	describeRuntimeAppearanceKey,
	type RuntimeAppearanceInput,
	type RuntimeAppearanceResolvedFacts,
} from "./runtime-appearance-cache";

describe("runtime appearance cache", () => {
	it("describes appearance keys structurally instead of as asset routes", () => {
		expect(
			describeRuntimeAppearanceKey({
				setupModelId: 0x02000001,
				objDesc: {
					paletteId: 0x04000001,
					subPalettes: [{ subId: 0x04000002, offset: 0x10, numColors: 0x18 }],
					textureChanges: [
						{ partIndex: 0, oldTexture: 0x05000001, newTexture: 0x05000002 },
					],
					animPartChanges: [{ partIndex: 1, partId: 0x01000003 }],
				},
			}),
		).toBe(
			"setup:02000001|pal=04000001|sub=[04000002:00000010:00000018]|tex=[0:05000001->05000002]|anim=[1:01000003]",
		);
	});

	it("dedupes repeated and concurrent resolutions", async () => {
		const cache = new RuntimeAppearanceCache({ maxEntries: 8 });
		const input = createInput(0x02000001, 0x05000001);
		let resolveCount = 0;
		const resolver = async (
			request: RuntimeAppearanceInput,
		): Promise<RuntimeAppearanceResolvedFacts> => {
			resolveCount += 1;
			return createFacts(request);
		};

		const [first, second] = await Promise.all([
			cache.getOrResolve(input, resolver),
			cache.getOrResolve(input, resolver),
		]);
		const third = await cache.getOrResolve(input, resolver);

		expect(first).toBe(second);
		expect(third).toBe(first);
		expect(resolveCount).toBe(1);
		expect(cache.diagnostics()).toMatchObject({
			size: 1,
			hits: 2,
			misses: 1,
			evictions: 0,
		});
	});

	it("evicts least recently used appearance facts when bounded", async () => {
		const cache = new RuntimeAppearanceCache({ maxEntries: 2 });
		const resolver = async (
			request: RuntimeAppearanceInput,
		): Promise<RuntimeAppearanceResolvedFacts> => createFacts(request);
		const first = createInput(0x02000001, 0x05000001);
		const second = createInput(0x02000002, 0x05000002);
		const third = createInput(0x02000003, 0x05000003);

		await cache.getOrResolve(first, resolver);
		await cache.getOrResolve(second, resolver);
		await cache.getOrResolve(first, resolver);
		await cache.getOrResolve(third, resolver);

		expect(cache.peek(first)).not.toBeNull();
		expect(cache.peek(second)).toBeNull();
		expect(cache.peek(third)).not.toBeNull();
		expect(cache.diagnostics()).toMatchObject({
			size: 2,
			evictions: 1,
			distinctObjDescKeys: 2,
		});
	});

	it("does not retain failed in-flight resolutions", async () => {
		const cache = new RuntimeAppearanceCache({ maxEntries: 2 });
		const input = createInput(0x02000001, 0x05000001);
		let resolveCount = 0;

		await expect(
			cache.getOrResolve(input, async () => {
				resolveCount += 1;
				throw new Error("appearance resolve failed");
			}),
		).rejects.toThrow("appearance resolve failed");

		await cache.getOrResolve(input, async (request) => {
			resolveCount += 1;
			return createFacts(request);
		});

		expect(resolveCount).toBe(2);
		expect(cache.diagnostics()).toMatchObject({
			size: 1,
			inFlight: 0,
			misses: 2,
		});
	});
});

function createInput(
	setupModelId: number,
	oldTexture: number,
): RuntimeAppearanceInput {
	return {
		setupModelId,
		objDesc: {
			paletteId: null,
			subPalettes: [],
			textureChanges: [
				{ partIndex: 0, oldTexture, newTexture: oldTexture + 1 },
			],
			animPartChanges: [],
		},
	};
}

function createFacts(
	input: RuntimeAppearanceInput,
): RuntimeAppearanceResolvedFacts {
	return {
		setupModelId: input.setupModelId,
		appearanceKey: describeRuntimeAppearanceKey(input),
		selectedGfxObjAssetIds: ["gfx-obj/01000001"],
		materialAssetIds: ["material/08000001"],
		paletteAssetIds: [],
		textureChanges: input.objDesc?.textureChanges ?? [],
		animPartChanges: input.objDesc?.animPartChanges ?? [],
		paletteId: input.objDesc?.paletteId ?? null,
		subPalettes: input.objDesc?.subPalettes ?? [],
		selectedPartsSignature: "0:gfx-obj/01000001",
		textureSwapSignature: "0:05000001>05000002",
		paletteViewSignature: null,
	};
}
