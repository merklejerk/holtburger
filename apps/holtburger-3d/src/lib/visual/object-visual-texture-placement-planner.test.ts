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
		const firstRequirement = createRequirement("texture-use:a");
		const secondRequirement = createRequirement("texture-use:b");
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "static-object|batch:a",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
					},
					requirement: firstRequirement,
				},
				{
					policy: {
						affinityKey: "static-object|batch:b",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
					},
					requirement: secondRequirement,
				},
			],
		});

		expect(intents.map((intent) => intent.itemId)).toEqual([0, 1]);
		expect(intents).toMatchObject([
			{
				affinityKey: "static-object|batch:a",
				domain: "outdoor-generated-scenery",
				bindingId: firstRequirement.bindingId,
			},
			{
				affinityKey: "static-object|batch:b",
				domain: "outdoor-generated-scenery",
				bindingId: secondRequirement.bindingId,
			},
		]);
	});

	it("dedupes texture uses before allocating ids", () => {
		const requirement = createRequirement("texture-use:shared");
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "first",
						domain: "env-cell-system",
						kind: "static-authored",
					},
					requirement,
				},
				{
					policy: {
						affinityKey: "second",
						domain: "env-cell-system",
						kind: "static-authored",
					},
					requirement,
				},
			],
		});

		expect(intents).toHaveLength(1);
		expect(intents[0]).toMatchObject({
			affinityKey: "first",
			bindingId: requirement.bindingId,
			itemId: 0,
		});
	});

	it("uses explicit dynamic placement buckets", () => {
		const placementBucketKey =
			createRuntimeAuthoredDynamicTexturePlacementBucketKey({
				entityId: "runtime-spawn:1",
				purpose: "object-base-color",
			});
		const requirement = createRequirement("dynamic-texture-use:a");
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "setup-model/02000001",
						kind: "dynamic",
						placementBucketKey,
						textureDomain: "runtime-object-material",
					},
					requirement,
				},
			],
		});

		expect(intents).toMatchObject([
			{
				affinityKey: "setup-model/02000001",
				domain: "runtime-object-material",
				bindingId: requirement.bindingId,
				itemId: 0,
				placementBucketKey,
			},
		]);
	});

	it("honors explicit static placement buckets", () => {
		const placementBucketKey = createTexturePlacementBucketKey({
			domain: "env-cell-system",
			lifetime: { kind: "static-authored" },
			purpose: "object-base-color",
		});
		const requirement = createRequirement("texture-use:explicit-bucket");
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: null,
						domain: "env-cell-system",
						kind: "static-authored",
						placementBucketKey,
					},
					requirement,
				},
			],
		});

		expect(intents[0]).toMatchObject({
			bindingId: requirement.bindingId,
			itemId: 0,
			placementBucketKey,
		});
	});
});

function createRequirement(
	textureBindingId: string,
): TextureBindingRequirement {
	return {
		bindingId: createTextureBindingId({
			resourceId: "fixture-resource",
			role: "object-base-color",
			slot: textureBindingId,
		}),
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
	};
}
