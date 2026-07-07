import type { TexturePlacementIntent } from "../../../../textures/placement";
import type { TexturePlacementLookupId } from "../../../../textures/placement";
import { createOpenWorldTextureBucketKey } from "../claims/bucket-key";
import type { OpenWorldTextureBucketKey } from "../claims/bucket-key";

/** Resolves replacement material texture policy into the atlas bucket that owns placement. */
export function createMaterialTexturePlacementBucketKey(
	intent: TexturePlacementIntent<TexturePlacementLookupId>,
): OpenWorldTextureBucketKey {
	validateMaterialTexturePlacementPolicy(intent);
	const scope = intent.placementPolicy.bucketScope;
	switch (scope.kind) {
		case "static-domain":
			return createOpenWorldTextureBucketKey({
				domain: intent.domain,
				purpose: intent.purpose,
				scope: { kind: "static-domain" },
			});
		case "static-owner":
			return createOpenWorldTextureBucketKey({
				domain: intent.domain,
				purpose: intent.purpose,
				scope: { kind: "static-owner", ownerId: scope.ownerId },
			});
		case "runtime-owner":
			return createOpenWorldTextureBucketKey({
				domain: intent.domain,
				purpose: intent.purpose,
				scope: { kind: "runtime-owner", ownerId: scope.ownerId },
			});
	}
}

function validateMaterialTexturePlacementPolicy(
	intent: TexturePlacementIntent<TexturePlacementLookupId>,
): void {
	const { bucketScope, pageBuild, sourceStability } = intent.placementPolicy;
	if (
		bucketScope.kind === "static-domain" &&
		sourceStability.kind !== "content-stable"
	) {
		throw new Error(
			`Texture binding ${intent.bindingId} cannot use a static-domain bucket for owner-specific source content.`,
		);
	}
	if (
		(bucketScope.kind === "static-owner" ||
			bucketScope.kind === "runtime-owner") &&
		sourceStability.kind !== "owner-specific"
	) {
		throw new Error(
			`Texture binding ${intent.bindingId} uses an owner-scoped bucket without owner-specific source content.`,
		);
	}
	if (
		pageBuild.kind === "main-thread-measured-exception" &&
		pageBuild.reason.length === 0
	) {
		throw new Error(
			`Texture binding ${intent.bindingId} declares an empty main-thread page-build exception reason.`,
		);
	}
}
