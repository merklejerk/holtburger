import { TerrainGeometryStaticBaker } from "../terrain/bake/terrain-geometry-baker";
import { handleStaticBakeWorkerRequest } from "./worker-handler";
import type { StaticBakeWorkerGlobalPort } from "./protocol";

const workerPort = self as unknown as StaticBakeWorkerGlobalPort;
const baker = new TerrainGeometryStaticBaker();

workerPort.addEventListener("message", (event) => {
	void handleStaticBakeWorkerRequest(
		baker,
		event.data,
		(response) => workerPort.postMessage(response),
	);
});
