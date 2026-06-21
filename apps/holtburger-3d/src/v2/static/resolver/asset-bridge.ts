import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import { createResolverEnvCellPreparedAssetView } from "../../assets/preparation/env-cell-views";
import { createResolverGfxObjPreparedAssetView } from "../../assets/preparation/gfx-obj-views";
import { createResolverRenderSurfacePreparedAssetView } from "../../assets/preparation/render-surface-views";
import type {
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";

export interface StaticResolverMainAssetBridge {
	dispose(): void;
}

export function createStaticResolverMainAssetBridge(
	port: StaticResolverWorkerPort,
	assetReader: PreparedAssetReader,
): StaticResolverMainAssetBridge {
	const onMessage = (
		event: MessageEvent<StaticResolverWorkerThreadMessage>,
	): void => {
		const message = event.data;
		if (message.kind !== "prepared-asset-requested") {
			return;
		}

		void assetReader
			.requestPreparedAsset(message.key)
			.then((asset) => {
				port.postMessage({
					asset: createResolverPreparedAssetView(asset),
					kind: "prepared-asset-request-resolved",
					requestId: message.requestId,
				});
			})
			.catch((error: unknown) => {
				port.postMessage({
					kind: "prepared-asset-request-failed",
					message: error instanceof Error ? error.message : String(error),
					requestId: message.requestId,
				});
			});
	};

	port.addEventListener("message", onMessage);

	return {
		dispose: () => {
			port.removeEventListener("message", onMessage);
		},
	};
}

function createResolverPreparedAssetView(asset: PreparedAsset): PreparedAsset {
	return createResolverEnvCellPreparedAssetView(
		createResolverGfxObjPreparedAssetView(
			createResolverRenderSurfacePreparedAssetView(asset),
		),
	);
}
