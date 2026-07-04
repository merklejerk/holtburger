import { describe, expect, it } from "vitest";
import {
	createRuntimeAuthoredDynamicTexturePlacementBucketKey,
	createTexturePlacementBucketKey,
	type TextureBindingRequirement,
} from "../textures/placement";
import {
	createMaterialTextureSourceKey,
	createTextureBindingId,
	createTextureKey,
	createTextureOwnerId,
	createTexturePageClass,
} from "../textures/identity";
import { createObjectVisualTexturePlacementIntents } from "./object-visual-texture-placement-planner";

describe("object visual texture placement planner", () => {
	it("allocates dense numeric ids while preserving static placement policy", () => {
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "static-object|batch:a",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
					},
					requirement: createRequirement("texture-use:a"),
				},
				{
					policy: {
						affinityKey: "static-object|batch:b",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
					},
					requirement: createRequirement("texture-use:b"),
				},
			],
		});

		expect(intents.map((intent) => intent.itemId)).toEqual([0, 1]);
		expect(intents).toMatchObject([
			{
				affinityKey: "static-object|batch:a",
				domain: "outdoor-generated-scenery",
				textureUseId: "texture-use:a",
			},
			{
				affinityKey: "static-object|batch:b",
				domain: "outdoor-generated-scenery",
				textureUseId: "texture-use:b",
			},
		]);
	});

	it("dedupes texture uses before allocating ids", () => {
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "first",
						domain: "env-cell-system",
						kind: "static-authored",
					},
					requirement: createRequirement("texture-use:shared"),
				},
				{
					policy: {
						affinityKey: "second",
						domain: "env-cell-system",
						kind: "static-authored",
					},
					requirement: createRequirement("texture-use:shared"),
				},
			],
		});

		expect(intents).toHaveLength(1);
		expect(intents[0]).toMatchObject({
			affinityKey: "first",
			itemId: 0,
			textureUseId: "texture-use:shared",
		});
	});

	it("uses explicit dynamic placement buckets", () => {
		const placementBucketKey =
			createRuntimeAuthoredDynamicTexturePlacementBucketKey({
				entityId: "runtime-spawn:1",
				purpose: "object-base-color",
			});
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "setup-model/02000001",
						kind: "dynamic",
						placementBucketKey,
						textureDomain: "runtime-object-material",
					},
					requirement: createRequirement("dynamic-texture-use:a"),
				},
			],
		});

		expect(intents).toMatchObject([
			{
				affinityKey: "setup-model/02000001",
				domain: "runtime-object-material",
				itemId: 0,
				placementBucketKey,
				textureUseId: "dynamic-texture-use:a",
			},
		]);
	});

	it("honors explicit static placement buckets", () => {
		const placementBucketKey = createTexturePlacementBucketKey({
			domain: "env-cell-system",
			lifetime: { kind: "static-authored" },
			purpose: "object-base-color",
		});
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: null,
						domain: "env-cell-system",
						kind: "static-authored",
						placementBucketKey,
					},
					requirement: createRequirement("texture-use:explicit-bucket"),
				},
			],
		});

		expect(intents[0]).toMatchObject({
			itemId: 0,
			placementBucketKey,
			textureUseId: "texture-use:explicit-bucket",
		});
	});
});

function createRequirement(textureUseId: string): TextureBindingRequirement {
	return {
		bindingId: createTextureBindingId({
			resourceId: "fixture-resource",
			role: "object-base-color",
			slot: textureUseId,
		}),
		bindingKey: textureUseId,
		placementItemId: textureUseId,
		ownerIds: [
			createTextureOwnerId({
				kind: "layer",
				layerOwnerId: "fixture-layer",
			}),
		],
		pageClass: createTexturePageClass({
			domain: "outdoor-generated-scenery",
			format: "rgba8",
			gutterPixels: 4,
			purpose: "object-base-color",
			sampleClass: "rgba-color",
		}),
		purpose: "object-base-color",
		samplingPolicy: {
			wrapS: "repeat",
			wrapT: "repeat",
		},
		source: {
			dataUse: {
				kind: "prepared-render-surface-texture-use",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
				},
				usage: "rgba-color",
			},
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "repeat",
			},
		},
		sourceKey: "prepared-render-surface-texture-use:06000010:rgba-color",
		textureKey: createTextureKey({
			outputFormat: "rgba8",
			sampleClass: "rgba-color",
			sourceKey: createMaterialTextureSourceKey({
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
				usage: "rgba-color",
			}),
		}),
		textureUseId,
	};
}
