/// <reference lib="webworker" />

import { AtlasTexturePacker } from "./packer";
import type {
	TexturePackingWorkerGlobalPort,
	TexturePackingWorkerMainMessage,
} from "./protocol";
import { handleTexturePackingWorkerRequest } from "./worker-handler";

const workerPort = self as unknown as TexturePackingWorkerGlobalPort;
const packer = new AtlasTexturePacker();

workerPort.addEventListener(
	"message",
	(event: MessageEvent<TexturePackingWorkerMainMessage>) => {
		void handleTexturePackingWorkerRequest(packer, event.data, (response) =>
			workerPort.postMessage(response),
		);
	},
);
