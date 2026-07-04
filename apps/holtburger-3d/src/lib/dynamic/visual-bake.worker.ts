/// <reference lib="webworker" />

import { LocalDynamicVisualBaker } from "./visual-baker";
import type { DynamicVisualBakeWorkerGlobalPort } from "./visual-bake-protocol";
import { installDynamicVisualBakeWorkerHandler } from "./visual-bake-worker-handler";

const workerPort = self as unknown as DynamicVisualBakeWorkerGlobalPort;
const baker = new LocalDynamicVisualBaker();

installDynamicVisualBakeWorkerHandler(baker, workerPort);
