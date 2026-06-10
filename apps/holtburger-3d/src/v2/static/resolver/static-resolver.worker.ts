/// <reference lib="webworker" />

import { HostBackedAssetService } from "../../assets/asset-service";
import { TerrainStaticScopeResolver } from "../terrain/terrain-resolver";
import { StaticResolverWorkerRuntimeHost } from "./host-bridge";
import { handleStaticResolverWorkerRequest } from "./worker-handler";
import type {
	StaticResolverWorkerGlobalPort,
	StaticResolverWorkerMainMessage,
} from "./protocol";

const workerPort = self as unknown as StaticResolverWorkerGlobalPort;
const host = new StaticResolverWorkerRuntimeHost(workerPort);
const assetService = new HostBackedAssetService({ host });
const resolver = new TerrainStaticScopeResolver({ assetService });

workerPort.addEventListener(
	"message",
	(event: MessageEvent<StaticResolverWorkerMainMessage>) => {
		void handleStaticResolverWorkerRequest(
			resolver,
			event.data,
			(response) => workerPort.postMessage(response),
		);
	},
);
