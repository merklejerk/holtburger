import type { AuthoredDynamicSource } from "./landblock-layer";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";

/** Remove authored-layer residency from the source-neutral dynamic presentation contract. */
export function adaptAuthoredDynamicPresentation(
	authored: AuthoredDynamicSource,
): PlacedDynamicPresentationSource {
	return {
		placement: authored.placement,
		source: {
			behavior: authored.behavior,
			identity: authored.identity.sourceId,
			localBounds: authored.localBounds,
			presentation: authored.presentation,
			scale: authored.scale,
			setupId: authored.setupId,
		},
	};
}
