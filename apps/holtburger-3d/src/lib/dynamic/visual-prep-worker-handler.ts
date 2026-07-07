import type { DynamicVisualPrepWorkerGlobalPort } from "./visual-prep-protocol";
import { LocalDynamicVisualPrepper } from "./visual-prepper";
import { collectDynamicVisualBakeResultTransfers } from "./visual-bake-transfers";
import {
	createRequestScopedPreparedAssetReader,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../workers/prepared-asset-service";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../workers/handler";

export function installDynamicVisualPrepWorkerHandler(
	port: DynamicVisualPrepWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler<
		Parameters<LocalDynamicVisualPrepper["prepare"]>[0],
		Awaited<ReturnType<LocalDynamicVisualPrepper["prepare"]>>,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>({
		execute: async (input, context) => {
			const prepper = new LocalDynamicVisualPrepper(
				createRequestScopedPreparedAssetReader(context),
			);
			const result = await prepper.prepare(input);
			return {
				output: result,
				transfer: collectDynamicVisualBakeResultTransfers(result),
			};
		},
		port,
	});
}
