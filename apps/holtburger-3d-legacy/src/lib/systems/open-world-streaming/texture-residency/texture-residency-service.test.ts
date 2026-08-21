import { describe, expect, it } from "vitest";

import {
	createMaterialTextureSourceKey,
	createTextureBindingId,
	createTextureKey,
	createTexturePageClass,
	type TextureBindingId,
	type TexturePageClass,
} from "../../../textures/identity";
import type { TexturePageSampleClass } from "../../../textures/sampling-policy";
import type { SamplerPolicyUpdate } from "../../../renderer/types";
import type { MaterializationOwnerId } from "../owners/owner-id";
import { createOpenWorldTextureBucketKey } from "./claims/bucket-key";
import { OpenWorldTextureClaimRegistry } from "./claims/texture-claim-registry";
import type { OpenWorldObjectVisualAtlasBuilder } from "./atlas-build/object-visual-atlas-builder";
import { OpenWorldTextureResidencyService } from "./texture-residency-service";

describe("OpenWorldTextureResidencyService", () => {
	it("applies anisotropic sampler policy to resident color pages without changing data pages", () => {
		const textureClaims = new OpenWorldTextureClaimRegistry();
		const colorPage = createResidentPage(textureClaims, {
			bindingId: "color",
			sampleClass: "rgba-color",
		});
		const indexPage = createResidentPage(textureClaims, {
			bindingId: "index",
			sampleClass: "index8",
		});
		const samplerUpdates: SamplerPolicyUpdate[] = [];
		const service = new OpenWorldTextureResidencyService({
			applySamplerPolicyUpdate: (update) => samplerUpdates.push(update),
			applyTextureCommits: () => {},
			objectVisualAtlasBuilder: createUnusedAtlasBuilder(),
			textureAtlasBuilder: createUnusedAtlasBuilder(),
			textureClaims,
		});

		service.applyResidentSamplerPolicy({
			filteringMode: "anisotropic-4x",
			revision: 7,
		});

		expect(samplerUpdates).toEqual([
			{
				policies: expect.arrayContaining([
					{
						anisotropy: 4,
						filteringMode: "anisotropic-4x",
						mipmapsGenerated: true,
						samplerPolicyKey:
							"sample=rgba-color;filter=anisotropic-4x;mips=on;aniso=4",
						textureRefId: colorPage.textureRefId,
					},
					{
						anisotropy: 1,
						filteringMode: "nearest",
						mipmapsGenerated: false,
						samplerPolicyKey: "sample=index8;filter=nearest;mips=off;aniso=1",
						textureRefId: indexPage.textureRefId,
					},
				]),
				revision: 7,
			},
		]);
	});
});

function createResidentPage(
	textureClaims: OpenWorldTextureClaimRegistry,
	options: {
		readonly bindingId: string;
		readonly sampleClass: TexturePageSampleClass;
	},
): ReturnType<OpenWorldTextureClaimRegistry["createPage"]> {
	const bucketKey = createOpenWorldTextureBucketKey({
		domain: "fixture-domain",
		purpose: "base-color",
		scope: { kind: "static-domain" },
	});
	const bindingId = createTextureBindingId({
		resourceId: `fixture:${options.bindingId}`,
		role: "base-color",
		slot: 0,
	}) as TextureBindingId;
	textureClaims.retainTextureBindings(
		`fixture-owner:${options.bindingId}` as MaterializationOwnerId,
		bucketKey,
		[
			{
				bindingId,
				bucketKey,
				pageClass: createPageClass(options.sampleClass),
				purpose: "base-color",
				sourceKey: `fixture-source:${options.bindingId}`,
				textureKey: createTextureKey({
					outputFormat: options.sampleClass === "index8" ? "index8" : "rgba8",
					sampleClass: options.sampleClass,
					sourceKey: createMaterialTextureSourceKey({
						kind: "runtime",
						sourceId: `fixture:${options.bindingId}`,
						usage: options.sampleClass === "index8" ? "index8" : "rgba-color",
					}),
				}),
			},
		],
	);
	const [entry] = textureClaims.createBucketSnapshot(bucketKey).entries;
	if (!entry) {
		throw new Error("Expected retained fixture texture entry.");
	}
	return textureClaims.createPage({
		bucketKey,
		entryIds: [entry.id],
		sampleClass: options.sampleClass,
		state: "resident",
		textureHeight: 64,
		textureWidth: 64,
	});
}

function createPageClass(
	sampleClass: TexturePageSampleClass,
): TexturePageClass {
	return createTexturePageClass({
		domain: "fixture-domain",
		format: sampleClass === "index8" ? "index8" : "rgba8",
		gutterPixels: 0,
		purpose: "base-color",
		sampleClass,
	});
}

function createUnusedAtlasBuilder(): OpenWorldObjectVisualAtlasBuilder {
	return {
		planAtlasPlacement: () => {
			throw new Error("Fixture atlas builder should not be used.");
		},
	};
}
