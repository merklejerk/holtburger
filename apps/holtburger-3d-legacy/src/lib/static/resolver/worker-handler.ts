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
	StaticResolverWorkerProgress,
} from "./protocol";

export type StaticResolverFactory = (
	context: WorkerExecuteContext<
		StaticResolverWorkerProgress,
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
		StaticResolverWorkerProgress,
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
			if (input.kind === "stream-landblock-scene-lod-source") {
				if (!resolver.resolveProjectedSources) {
					throw new Error(
						"Static resolver worker does not support projected source streaming.",
					);
				}
				await resolver.resolveProjectedSources(input.sourceRequest, (event) =>
					context.report(event),
				);
				return {
					output: {
						kind: "landblock-scene-lod-source-stream-complete",
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
