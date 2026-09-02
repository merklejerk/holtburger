import type { AuthoredDynamicSource } from "./landblock-layer";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import { scopeFor } from "../scene/scope";

/** Remove authored-layer residency from the source-neutral dynamic presentation contract. */
export function adaptAuthoredDynamicPresentation(
	authored: AuthoredDynamicSource,
): PlacedDynamicPresentationSource {
	return {
		initialPresentationState: {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
		},
		placement: {
			...authored.placement,
			spatialMembership: {
				scopes: [
					scopeFor(
						authored.placement.landblockId,
						authored.placement.envCellId,
					),
				],
			},
		},
		source: {
			entityClass: "other",
			nameplate: null,
			behavior: authored.behavior,
			identity: authored.identity.sourceId,
			localBounds: authored.localBounds,
			presentation: authored.presentation,
			scale: authored.scale,
			setupId: authored.setupId,
		},
	};
}
