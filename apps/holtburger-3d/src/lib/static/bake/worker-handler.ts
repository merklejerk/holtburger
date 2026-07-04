import type { StaticBaker } from "../contracts";
import type { StaticBakeWorkerGlobalPort } from "./protocol";
import { runWithStaticBakeWorkerTraceSink } from "./worker-trace";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../../workers/handler";

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
			return { output: result };
		},
		port,
	});
}
