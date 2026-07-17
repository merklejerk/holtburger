import type { AssetBridge } from "./asset-bridge";
import type {
	HostLandblockLayerSourceDto,
	ResolveLandblockLayerRequestDto,
} from "./host-contracts";
import type { ResolvedLandblockLayerSource } from "../game/resolution/landblock-layer";
import { normalizeHostLandblockLayer } from "../game/resolution/resolve-landblock-layer";
import type { LandblockIdLayer } from "../game/runtime/scene-interest";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";

/** Tauri adapter for the host asset boundary. */
export class TauriAssetBridge implements AssetBridge {
	protected constructor() {}

	static build(): TauriAssetBridge {
		return new TauriAssetBridge();
	}

	async resolveLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<ResolvedLandblockLayerSource> {
		const { invoke } = await import("@tauri-apps/api/core");
		const request: ResolveLandblockLayerRequestDto = {
			landblockId: layer.id,
			layer: layer.layer,
		};
		const dto = await invoke<HostLandblockLayerSourceDto>(
			"resolve_landblock_layer",
			{ request },
		);
		return normalizeHostLandblockLayer(dto, layer);
	}

	async requestTexturePreparationAsset(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		throw new Error(
			`Tauri texture preparation asset service is not implemented for ${request.kind}.`,
		);
	}
}
