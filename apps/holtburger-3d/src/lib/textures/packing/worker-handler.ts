import type { TexturePacker } from "./packer";
import type { TexturePackingWorkerGlobalPort } from "./protocol";
import {
	installWorkerHandler,
	type InstalledWorkerHandler,
} from "../../workers/handler";
import { collectTexturePackingResultTransfers } from "./transfers";

export function installTexturePackingWorkerHandler(
	packer: TexturePacker,
	port: TexturePackingWorkerGlobalPort,
): InstalledWorkerHandler {
	return installWorkerHandler({
		execute: async (job) => {
			const result = await packer.pack(job);
			return {
				output: result,
				transfer: collectTexturePackingResultTransfers(result),
			};
		},
		port,
	});
}
