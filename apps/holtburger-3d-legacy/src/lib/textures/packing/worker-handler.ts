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
		execute: async (job, context) => {
			const result = await packer.pack(job);
			const transfer = collectTexturePackingResultTransfers(result);
			context.report({
				completedAtEpochMs: Date.now(),
				kind: "result-ready",
				pageCount: result.pages.length,
				pagePixelByteLength: result.pages.reduce(
					(total, page) => total + page.pixels.byteLength,
					0,
				),
				rectCount: result.rects.length,
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
