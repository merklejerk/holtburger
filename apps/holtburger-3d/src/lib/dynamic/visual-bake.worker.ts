/// <reference lib="webworker" />

import { LocalDynamicVisualBaker } from "./visual-baker";
import type {
	DynamicVisualBakeWorkerGlobalPort,
	DynamicVisualBakeWorkerMainMessage,
} from "./visual-bake-protocol";
import { handleDynamicVisualBakeWorkerRequest } from "./visual-bake-worker-handler";

const workerPort = self as unknown as DynamicVisualBakeWorkerGlobalPort;
const baker = new LocalDynamicVisualBaker();

workerPort.addEventListener(
	"message",
	(event: MessageEvent<DynamicVisualBakeWorkerMainMessage>) => {
		void handleDynamicVisualBakeWorkerRequest(baker, event.data, (response) =>
			workerPort.postMessage(response),
		);
	},
);
