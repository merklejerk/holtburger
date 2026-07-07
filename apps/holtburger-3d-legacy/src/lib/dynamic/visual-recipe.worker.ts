/// <reference lib="webworker" />

import type { DynamicVisualRecipeWorkerGlobalPort } from "./visual-recipe-protocol";
import { installDynamicVisualRecipeWorkerHandler } from "./visual-recipe-worker-handler";

const workerPort = self as unknown as DynamicVisualRecipeWorkerGlobalPort;

installDynamicVisualRecipeWorkerHandler(workerPort);
