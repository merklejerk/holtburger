import { describe, expect, it } from "vitest";
import type {
	StaticMaterialTableEntry,
	StaticObjectRenderState,
} from "../static/contracts";
import type {
	ObjectVisualRenderInstance,
	ObjectVisualSourceGeometryKey,
} from "./object-visual-install-set";
import {
	createObjectVisualResourceId,
	createObjectVisualResourceKey,
	createObjectVisualResourceKeyString,
	groupObjectVisualRenderInstancesByResource,
	type ObjectVisualResourceKeyInput,
} from "./object-visual-resource-key";

describe("object visual resource keys", () => {
	it("keeps per-instance placement and source identity out of the reusable resource key", () => {
		const key = createObjectVisualResourceKey(createVisualKeyInput());
		const resourceId = createObjectVisualResourceId(key);
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

		expect(createObjectVisualResourceKeyString(key)).toEqual(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(createVisualKeyInput()),
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

	it("normalizes material entry ordering and ignores scoped binding ids", () => {
		const baseInput = createVisualKeyInput({
			materialEntries: [
				createMaterialEntry({
					slot: 1,
					textureBindingId: "binding:landblock-a:slot-b",
					textureKey: "texture-key:b",
				}),
				createMaterialEntry({
					slot: 0,
					textureBindingId: "binding:landblock-a:slot-a",
					textureKey: "texture-key:a",
				}),
			],
		});
		const reorderedInput = createVisualKeyInput({
			materialEntries: [
				createMaterialEntry({
					slot: 0,
					textureBindingId: "binding:landblock-b:slot-a",
					textureKey: "texture-key:a",
				}),
				createMaterialEntry({
					slot: 1,
					textureBindingId: "binding:landblock-b:slot-b",
					textureKey: "texture-key:b",
				}),
			],
		});

		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(baseInput),
			),
		).toEqual(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(reorderedInput),
			),
		);

		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({
						materialEntries: [
							createMaterialEntry({
								textureBindingId: "binding:landblock-a:slot-a",
								textureKey: "texture-key:a",
							}),
						],
					}),
				),
			),
		).not.toEqual(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({
						materialEntries: [
							createMaterialEntry({
								textureBindingId: "binding:landblock-a:slot-a",
								textureKey: "texture-key:different",
							}),
						],
					}),
				),
			),
		);
	});

	it("changes the resource key when geometry, material, render state, or index type changes", () => {
		const base = createObjectVisualResourceKeyString(
			createObjectVisualResourceKey(createVisualKeyInput()),
		);

		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({
						geometry: createGeometryIdentity({ gfxObjDid: 0x01000030 }),
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({
						materialEntries: [createMaterialEntry({ alphaTest: 0.75 })],
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({
						renderState: createRenderState({ depthWrite: false }),
					}),
				),
			),
		).not.toEqual(base);
		expect(
			createObjectVisualResourceKeyString(
				createObjectVisualResourceKey(
					createVisualKeyInput({ indexType: "uint32" }),
				),
			),
		).not.toEqual(base);
	});

	it("groups render instances by shared visual resource id", () => {
		const treeResourceId = createObjectVisualResourceId(
			createObjectVisualResourceKey(createVisualKeyInput()),
		);
		const rockResourceId = createObjectVisualResourceId(
			createObjectVisualResourceKey(
				createVisualKeyInput({
					geometry: createGeometryIdentity({ gfxObjDid: 0x01000040 }),
				}),
			),
		);

		const grouped = groupObjectVisualRenderInstancesByResource([
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
	overrides: Partial<ObjectVisualResourceKeyInput> = {},
): ObjectVisualResourceKeyInput {
	return {
		geometry: createGeometryIdentity(),
		indexType: "uint16",
		materialEntries: [createMaterialEntry()],
		materialFamily: "texture-rgba",
		materialPass: "alpha-test",
		renderState: createRenderState(),
		...overrides,
	};
}

function createGeometryIdentity(
	options: {
		readonly gfxObjDid?: number;
		readonly sourceDid?: number;
		readonly partIndex?: number;
	} = {},
): ObjectVisualSourceGeometryKey {
	return {
		canonical: {
			gfxObj: {
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: options.gfxObjDid ?? 0x01000020,
			},
			kind: "static-object-canonical-geometry",
			partIndex: options.partIndex ?? 0,
		},
		kind: "static-object-source-geometry",
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
		readonly textureBindingId?: string;
		readonly textureKey?: string;
	} = {},
): StaticMaterialTableEntry {
	const textureBindingId = options.textureBindingId ?? "binding:texture-a";
	const textureKey = options.textureKey ?? "texture-key:a";
	return {
		alphaTest: options.alphaTest ?? 0.5,
		detailTextureBindingId: null,
		detailTextureKey: null,
		detailTextureTiling: 1,
		indexedClipThreshold: 0,
		indexedTextureFormat: null,
		indexTextureBindingId: null,
		indexTextureKey: null,
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialIds: [0x08000010],
		paletteTextureBindingId: null,
		paletteTextureKey: null,
		primaryTextureBindingId: textureBindingId,
		primaryTextureKey: textureKey,
		primaryTextureWrapMode: "repeat",
		renderState: createRenderState(),
		slot: options.slot ?? 0,
	};
}

function createRenderInstance(options: {
	readonly instanceId: string;
	readonly resourceId: string;
	readonly x: number;
}): ObjectVisualRenderInstance {
	return {
		bounds: {
			max: { x: options.x + 1, y: 1, z: 1 },
			min: { x: options.x, y: 0, z: 0 },
		},
		domain: "outdoor-generated-scenery",
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
		sourceToLandblockMatrix: new Float32Array(16),
		transform: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: options.x, y: 0, z: 0 },
		},
		transparency: {
			kind: "depth-writing",
		},
	};
}
