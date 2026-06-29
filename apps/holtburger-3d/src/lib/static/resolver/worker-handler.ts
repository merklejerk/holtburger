import type {
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
} from "../contracts";
import type {
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerResponse,
} from "./protocol";

export type StaticResolverFactory = () => StaticResolver &
	Partial<StaticLandblockSceneLodSourceResolver>;

export async function handleStaticResolverWorkerRequest(
	createResolver: StaticResolverFactory,
	message: StaticResolverWorkerMainMessage,
	postMessage: (response: StaticResolverWorkerResponse) => void,
): Promise<void> {
	if (
		message.kind !== "resolve-static-scope" &&
		message.kind !== "resolve-landblock-scene-lod-source"
	) {
		return;
	}

	try {
		const resolver = createResolver();
		if (message.kind === "resolve-landblock-scene-lod-source") {
			if (!resolver.resolveSource) {
				throw new Error(
					"Static resolver worker does not support source fanout.",
				);
			}
			const resolution = await resolver.resolveSource(message.sourceRequest);
			postMessage({
				kind: "landblock-scene-lod-source-resolved",
				requestId: message.requestId,
				resolution,
			});
			return;
		}

		const payload = await resolver.resolve(message.job);
		postMessage({
			kind: "static-scope-resolved",
			payload,
			requestId: message.requestId,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "static-scope-resolve-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
