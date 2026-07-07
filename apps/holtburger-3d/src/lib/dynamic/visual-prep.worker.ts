/// <reference lib="webworker" />

import type { DynamicVisualPrepWorkerGlobalPort } from "./visual-prep-protocol";
import { installDynamicVisualPrepWorkerHandler } from "./visual-prep-worker-handler";

const workerPort = self as unknown as DynamicVisualPrepWorkerGlobalPort;

installDynamicVisualPrepWorkerHandler(workerPort);
