import type { PreparedAssetReader } from "../../assets/contracts";
import { createResolverGfxObjPreparedAssetView } from "../../assets/preparation/gfx-obj-views";
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
					asset: createResolverGfxObjPreparedAssetView(asset),
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
