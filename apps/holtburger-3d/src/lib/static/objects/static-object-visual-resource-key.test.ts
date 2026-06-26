import { describe, expect, it } from "vitest";
import type {
	StaticMaterialTableEntry,
	StaticObjectRenderInstance,
	StaticObjectRenderState,
	StaticObjectSourceGeometryIdentity,
} from "../contracts";
import {
	createStaticObjectVisualResourceId,
	createStaticObjectVisualResourceKey,
	createStaticObjectVisualResourceKeyString,
	groupStaticObjectRenderInstancesByVisualResource,
	type StaticObjectVisualResourceKeyInput,
} from "./static-object-visual-resource-key";

describe("static object visual resource keys", () => {
	it("keeps per-instance placement and source identity out of the reusable resource key", () => {
		const key = createStaticObjectVisualResourceKey(createVisualKeyInput());
		const resourceId = createStaticObjectVisualResourceId(key);
		const firstInstance = createRenderInstance({
			instanceId: "generated-a",
			resourceId,
			x: 10,
		});
		const secondInstance = createRenderInstance({
			instanceId: "generated-b",
			resourceId,
			x: 42,
		});

		expect(createStaticObjectVisualResourceKeyString(key)).toEqual(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(createVisualKeyInput()),
			),
		);
		expect(firstInstance.transform.origin.x).not.toBe(
			secondInstance.transform.origin.x,
		);
		expect(firstInstance.source.instanceId).not.toBe(
			secondInstance.source.instanceId,
		);
		expect(firstInstance.resourceId).toBe(secondInstance.resourceId);
	});

	it("normalizes material entry and texture-use ordering without dropping visual facts", () => {
		const baseInput = createVisualKeyInput({
			materialEntries: [
				createMaterialEntry({ slot: 1, textureUseId: "texture-b" }),
				createMaterialEntry({ slot: 0, textureUseId: "texture-a" }),
			],
			textureUseIds: ["texture-b", "texture-a", "texture-b"],
		});
		const reorderedInput = createVisualKeyInput({
			materialEntries: [
				createMaterialEntry({ slot: 0, textureUseId: "texture-a" }),
				createMaterialEntry({ slot: 1, textureUseId: "texture-b" }),
			],
			textureUseIds: ["texture-a", "texture-b"],
		});

		expect(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(baseInput),
			),
		).toEqual(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(reorderedInput),
			),
		);
	});

	it("changes the resource key when geometry, material, render state, or index type changes", () => {
		const base = createStaticObjectVisualResourceKeyString(
			createStaticObjectVisualResourceKey(createVisualKeyInput()),
		);

		expect(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(
					createVisualKeyInput({
						geometry: createGeometryIdentity({ gfxObjDid: 0x01000030 }),
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(
					createVisualKeyInput({
						materialEntries: [createMaterialEntry({ alphaTest: 0.75 })],
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(
					createVisualKeyInput({
						renderState: createRenderState({ depthWrite: false }),
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createStaticObjectVisualResourceKeyString(
				createStaticObjectVisualResourceKey(
					createVisualKeyInput({ indexType: "uint32" }),
				),
			),
		).not.toEqual(base);
	});

	it("groups render instances by shared visual resource id", () => {
		const treeResourceId = createStaticObjectVisualResourceId(
			createStaticObjectVisualResourceKey(createVisualKeyInput()),
		);
		const rockResourceId = createStaticObjectVisualResourceId(
			createStaticObjectVisualResourceKey(
				createVisualKeyInput({
					geometry: createGeometryIdentity({ gfxObjDid: 0x01000040 }),
				}),
			),
		);

		const grouped = groupStaticObjectRenderInstancesByVisualResource([
			createRenderInstance({
				instanceId: "tree-a",
				resourceId: treeResourceId,
				x: 0,
			}),
			createRenderInstance({
				instanceId: "tree-b",
				resourceId: treeResourceId,
				x: 8,
			}),
			createRenderInstance({
				instanceId: "rock-a",
				resourceId: rockResourceId,
				x: 16,
			}),
		]);

		expect(grouped.get(treeResourceId)).toHaveLength(2);
		expect(grouped.get(rockResourceId)).toHaveLength(1);
	});
});

function createVisualKeyInput(
	overrides: Partial<StaticObjectVisualResourceKeyInput> = {},
): StaticObjectVisualResourceKeyInput {
	return {
		geometry: createGeometryIdentity(),
		indexType: "uint16",
		materialEntries: [createMaterialEntry()],
		materialFamily: "texture-rgba",
		materialPass: "alpha-test",
		renderState: createRenderState(),
		textureUseIds: ["texture-a"],
		...overrides,
	};
}

function createGeometryIdentity(
	options: {
		readonly gfxObjDid?: number;
		readonly sourceDid?: number;
		readonly partIndex?: number;
	} = {},
): StaticObjectSourceGeometryIdentity {
	return {
		gfxObj: {
			kind: "static-object-source",
			sourceAssetKind: "gfx-obj",
			sourceDid: options.gfxObjDid ?? 0x01000020,
		},
		kind: "static-object-source-geometry",
		partIndex: options.partIndex ?? 0,
		source: {
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: options.sourceDid ?? 0x02000010,
		},
	};
}

function createRenderState(
	overrides: Partial<StaticObjectRenderState> = {},
): StaticObjectRenderState {
	return {
		blend: {
			dstFactor: "one-minus-src-alpha",
			enabled: false,
			mode: "clipmap",
			srcFactor: "src-alpha",
		},
		depthTest: true,
		depthWrite: true,
		...overrides,
	};
}

function createMaterialEntry(
	options: {
		readonly alphaTest?: number;
		readonly slot?: number;
		readonly textureUseId?: string;
	} = {},
): StaticMaterialTableEntry {
	const textureUseId = options.textureUseId ?? "texture-a";
	return {
		alphaTest: options.alphaTest ?? 0.5,
		detailTextureTiling: 1,
		detailTextureUseId: null,
		indexedClipThreshold: 0,
		indexedTextureFormat: null,
		indexTextureUseId: null,
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialIds: [0x08000010],
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		primaryTextureUseId: textureUseId,
		primaryTextureWrapMode: "repeat",
		renderState: createRenderState(),
		slot: options.slot ?? 0,
	};
}

function createRenderInstance(options: {
	readonly instanceId: string;
	readonly resourceId: string;
	readonly x: number;
}): StaticObjectRenderInstance {
	return {
		bounds: {
			max: { x: options.x + 1, y: 1, z: 1 },
			min: { x: options.x, y: 0, z: 0 },
		},
		domain: "outdoor-detail",
		generated: {
			sceneId: 7,
			sceneTemplateIndex: 3,
			terrainIndex: 11,
		},
		instanceId: options.instanceId,
		kind: "static-object-render-instance",
		landblockId: 0xda56ffff,
		resourceId: options.resourceId,
		sortCenter: { x: options.x + 0.5, y: 0.5, z: 0.5 },
		source: {
			instanceId: options.instanceId,
			kind: "static-object-instance",
			landblockId: 0xda56ffff,
			objectKind: "generated-scenery",
		},
		transform: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: options.x, y: 0, z: 0 },
		},
		transparency: {
			kind: "depth-writing",
		},
	};
}
