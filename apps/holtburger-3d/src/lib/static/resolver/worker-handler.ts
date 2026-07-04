import type {
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
} from "../contracts";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
	type WorkerExecuteContext,
} from "../../workers/handler";
import type {
	PreparedAssetServiceRequest,
	PreparedAssetServiceResponse,
} from "../../workers/prepared-asset-service";
import type { StaticResolverWorkerGlobalPort } from "./protocol";
import type {
	StaticResolverWorkerInput,
	StaticResolverWorkerOutput,
} from "./protocol";

export type StaticResolverFactory = (
	context: WorkerExecuteContext<
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>,
) => StaticResolver & Partial<StaticLandblockSceneLodSourceResolver>;

export function installStaticResolverWorkerHandler(
	createResolver: StaticResolverFactory,
	port: StaticResolverWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		StaticResolverWorkerInput,
		StaticResolverWorkerOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>({
		execute: async (input, context) => {
			const resolver = createResolver(context);
			if (input.kind === "resolve-landblock-scene-lod-source") {
				if (!resolver.resolveSource) {
					throw new Error(
						"Static resolver worker does not support source fanout.",
					);
				}
				return {
					output: {
						kind: "landblock-scene-lod-source-resolved",
						resolution: await resolver.resolveSource(input.sourceRequest),
					},
				};
			}

			return {
				output: {
					kind: "static-scope-resolved",
					payload: await resolver.resolve(input.job),
				},
			};
		},
		port,
	});
}
