import type { StaticBaker } from "../contracts";
import type { StaticBakeWorkerGlobalPort } from "./protocol";
import { runWithStaticBakeWorkerTraceSink } from "./worker-trace";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../../workers/handler";
import { collectStaticBakeJobResultTransfers } from "./transfers";

export function installStaticBakeWorkerHandler(
	baker: StaticBaker,
	port: StaticBakeWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler({
		execute: async (input, context) => {
			context.report({ kind: "started" });
			const result = await runWithStaticBakeWorkerTraceSink(
				(event) => context.report({ event, kind: "trace" }),
				() => baker.bake(input),
			);
			const transfer = collectStaticBakeJobResultTransfers(result);
			context.report({
				completedAtEpochMs: Date.now(),
				drawUnitCount: result.drawUnits.length,
				kind: "result-ready",
				objectVisualResourceCount:
					result.objectVisualInstallSet.visualResources.length,
				transferByteLength: sumTransferByteLength(transfer),
				transferCount: transfer.length,
			});
			return {
				output: result,
				transfer,
			};
		},
		port,
	});
}

function sumTransferByteLength(transfers: readonly Transferable[]): number {
	let total = 0;
	for (const transfer of transfers) {
		if (transfer instanceof ArrayBuffer) {
			total += transfer.byteLength;
		}
	}
	return total;
}
