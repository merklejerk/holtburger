/// <reference lib="webworker" />

import { createRequestScopedPreparedAssetReader } from "../../../../workers/prepared-asset-service";
import { DirectOpenWorldTexturePageBuilder } from "./direct-page-builder";
import type { OpenWorldTexturePageBuildWorkerGlobalPort } from "./protocol";
import { installOpenWorldTexturePageBuildWorkerHandler } from "./worker-handler";

const workerPort = self as unknown as OpenWorldTexturePageBuildWorkerGlobalPort;

installOpenWorldTexturePageBuildWorkerHandler(
	(assetReader) => new DirectOpenWorldTexturePageBuilder({ assetReader }),
	createRequestScopedPreparedAssetReader,
	workerPort,
);
