import { describe, expect, it } from "vitest";

import type {
	TexturePlacementIntent,
	TexturePlacementPolicy,
} from "../../../../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import { createMaterialTexturePlacementBucketKey } from "./material-texture-placement-policy";

describe("createMaterialTexturePlacementBucketKey", () => {
	it("keeps static object textures in shared static-domain buckets", () => {
		expect(
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "outdoor-buildings",
					policy: staticDomainPolicy(),
					purpose: "object-base-color",
				}),
			),
		).toBe(
			"open-world-texture-bucket|domain=outdoor-buildings|purpose=object-base-color|scope=static-domain",
		);
	});

	it("keeps terrain textures on the same shared static-domain policy", () => {
		expect(
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "outdoor-terrain",
					policy: staticDomainPolicy(),
					purpose: "terrain-color",
				}),
			),
		).toBe(
			"open-world-texture-bucket|domain=outdoor-terrain|purpose=terrain-color|scope=static-domain",
		);
	});

	it("shares content-stable static-authored dynamic textures by static domain", () => {
		expect(
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "outdoor-generated-scenery",
					policy: staticDomainPolicy(),
					purpose: "object-detail",
				}),
			),
		).toBe(
			"open-world-texture-bucket|domain=outdoor-generated-scenery|purpose=object-detail|scope=static-domain",
		);
	});

	it("isolates runtime-authored dynamic textures by runtime owner", () => {
		expect(
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "runtime-object-material",
					policy: runtimeOwnerPolicy("runtime-spawn:1"),
					purpose: "object-index",
				}),
			),
		).toBe(
			"open-world-texture-bucket|domain=runtime-object-material|purpose=object-index|scope=runtime-owner:runtime-spawn%3A1",
		);
	});

	it("isolates owner-specific static-authored textures by static owner", () => {
		expect(
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "outdoor-generated-scenery",
					policy: staticOwnerPolicy("static-layer:generated:da55ffff"),
					purpose: "object-base-color",
				}),
			),
		).toBe(
			"open-world-texture-bucket|domain=outdoor-generated-scenery|purpose=object-base-color|scope=static-owner:static-layer%3Agenerated%3Ada55ffff",
		);
	});

	it("rejects owner-specific content in shared static-domain buckets", () => {
		expect(() =>
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "outdoor-generated-scenery",
					policy: {
						...staticDomainPolicy(),
						sourceStability: {
							kind: "owner-specific",
							reason: "generated",
						},
					},
					purpose: "object-base-color",
				}),
			),
		).toThrow("cannot use a static-domain bucket for owner-specific source");
	});

	it("rejects content-stable sources in owner-scoped buckets", () => {
		expect(() =>
			createMaterialTexturePlacementBucketKey(
				createIntent({
					domain: "runtime-object-material",
					policy: {
						bucketScope: {
							kind: "runtime-owner",
							ownerId: "runtime-spawn:1",
						},
						sourceStability: { kind: "content-stable" },
					},
					purpose: "object-base-color",
				}),
			),
		).toThrow("uses an owner-scoped bucket without owner-specific source");
	});
});

function createIntent(input: {
	readonly domain: TexturePlacementIntent["domain"];
	readonly policy: TexturePlacementPolicy;
	readonly purpose: TexturePlacementIntent["purpose"];
}): TexturePlacementIntent {
	return {
		affinityKey: null,
		bindingId: "binding:fixture" as TextureBindingId,
		domain: input.domain,
		itemId: "item:fixture",
		ownerIds: [],
		pageClass: "page-class:fixture" as TexturePageClass,
		placementPolicy: input.policy,
		purpose: input.purpose,
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
		},
		textureKey: "texture:fixture" as TextureKey,
	};
}

function staticDomainPolicy(): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "static-domain" },
		sourceStability: { kind: "content-stable" },
	};
}

function runtimeOwnerPolicy(ownerId: string): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "runtime-owner", ownerId },
		sourceStability: {
			kind: "owner-specific",
			reason: "runtime-customized",
		},
	};
}

function staticOwnerPolicy(ownerId: string): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "static-owner", ownerId },
		sourceStability: {
			kind: "owner-specific",
			reason: "generated",
		},
	};
}
