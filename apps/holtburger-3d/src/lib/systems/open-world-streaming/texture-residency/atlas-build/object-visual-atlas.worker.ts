/// <reference lib="webworker" />

import { createRequestScopedPreparedAssetReader } from "../../../../workers/prepared-asset-service";
import { DirectOpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-builder";
import { installOpenWorldObjectVisualAtlasWorkerHandler } from "./object-visual-atlas-worker-handler";
import type { OpenWorldObjectVisualAtlasWorkerGlobalPort } from "./object-visual-atlas-worker-protocol";

const workerPort =
	self as unknown as OpenWorldObjectVisualAtlasWorkerGlobalPort;

installOpenWorldObjectVisualAtlasWorkerHandler(
	(assetReader) => new DirectOpenWorldObjectVisualAtlasBuilder({ assetReader }),
	createRequestScopedPreparedAssetReader,
	workerPort,
);
