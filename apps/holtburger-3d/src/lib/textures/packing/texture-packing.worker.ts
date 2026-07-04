/// <reference lib="webworker" />

import { AtlasTexturePacker } from "./packer";
import type { TexturePackingWorkerGlobalPort } from "./protocol";
import { installTexturePackingWorkerHandler } from "./worker-handler";

const workerPort = self as unknown as TexturePackingWorkerGlobalPort;
const packer = new AtlasTexturePacker();

installTexturePackingWorkerHandler(packer, workerPort);
