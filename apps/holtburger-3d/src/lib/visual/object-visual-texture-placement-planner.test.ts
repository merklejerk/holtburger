import { describe, expect, it } from "vitest";
import type {
	TextureBindingRequirement,
	TexturePlacementPolicy,
} from "../textures/placement";
import { createStaticDomainTexturePlacementPolicy } from "../textures/placement";
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
		const placementPolicy = createStaticDomainTexturePlacementPolicy();
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "static-object|batch:a",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
						placementPolicy,
					},
					requirement: firstRequirement,
				},
				{
					policy: {
						affinityKey: "static-object|batch:b",
						domain: "outdoor-generated-scenery",
						kind: "static-authored",
						placementPolicy,
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
				placementPolicy,
			},
			{
				affinityKey: "static-object|batch:b",
				domain: "outdoor-generated-scenery",
				bindingId: secondRequirement.bindingId,
				placementPolicy,
			},
		]);
	});

	it("dedupes texture uses before allocating ids", () => {
		const requirement = createRequirement("texture-use:shared");
		const placementPolicy = createStaticDomainTexturePlacementPolicy();
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "first",
						domain: "env-cell-system",
						kind: "static-authored",
						placementPolicy,
					},
					requirement,
				},
				{
					policy: {
						affinityKey: "second",
						domain: "env-cell-system",
						kind: "static-authored",
						placementPolicy,
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

	it("preserves explicit dynamic placement policy", () => {
		const placementPolicy = runtimeOwnerPolicy("runtime-spawn:1");
		const requirement = createRequirement("dynamic-texture-use:a");
		const intents = createObjectVisualTexturePlacementIntents({
			requirements: [
				{
					policy: {
						affinityKey: "setup-model/02000001",
						kind: "dynamic",
						placementPolicy,
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
				placementPolicy,
			},
		]);
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

function runtimeOwnerPolicy(ownerId: string): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "runtime-owner", ownerId },
		ownerCurrentness: { kind: "placement-plan-owner" },
		pageBuild: { kind: "worker-owned" },
		sourceStability: {
			kind: "owner-specific",
			reason: "runtime-customized",
		},
	};
}
