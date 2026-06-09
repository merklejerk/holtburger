import type { PreparedAssetResolver } from "../assets/prepared-asset-store";

export type RendererAssetReadModel = PreparedAssetResolver;

export function createRendererAssetReadModel(
	resolver: PreparedAssetResolver,
): RendererAssetReadModel {
	return resolver;
}
