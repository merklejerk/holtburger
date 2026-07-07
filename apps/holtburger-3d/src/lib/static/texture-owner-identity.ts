import type { StaticTextureUseOwner } from "./contracts";
import {
	createTextureOwnerId,
	type TextureOwnerId,
} from "../textures/identity";

/** Converts static texture residency owners into canonical owner ids for texture retention. */
function createStaticTextureOwnerId(
	owner: StaticTextureUseOwner,
): TextureOwnerId {
	switch (owner.kind) {
		case "draw-unit":
			return createTextureOwnerId({
				kind: "layer",
				layerOwnerId: owner.drawUnitId,
			});
		case "static-object-visual-resource":
			return createTextureOwnerId({
				kind: "visual-resource",
				visualResourceId: owner.resourceId,
			});
	}
}

/** Stable owner-id list for a published static texture use. */
export function createStaticTextureOwnerIds(
	owners: readonly StaticTextureUseOwner[],
): readonly TextureOwnerId[] {
	return Array.from(new Set(owners.map(createStaticTextureOwnerId))).sort();
}
