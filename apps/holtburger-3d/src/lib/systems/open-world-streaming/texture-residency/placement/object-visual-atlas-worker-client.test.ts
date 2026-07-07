import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../../assets/contracts";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../../../static/contracts";
import type { OpenWorldTextureEntryId } from "../claims/texture-claim-registry";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "./object-visual-atlas-builder";
import { WorkerPoolOpenWorldObjectVisualAtlasBuilder } from "./object-visual-atlas-worker-client";
import type {
	OpenWorldObjectVisualAtlasWorkerPort,
	OpenWorldObjectVisualAtlasWorkerRequest,
	OpenWorldObjectVisualAtlasWorkerResponse,
} from "./object-visual-atlas-worker-protocol";

describe("WorkerPoolOpenWorldObjectVisualAtlasBuilder", () => {
	it("dispatches placement layout jobs through the worker pool", async () => {
		const port = new FixtureObjectVisualAtlasWorkerPort();
		const builder = new WorkerPoolOpenWorldObjectVisualAtlasBuilder({
			assetReader: createUnusedAssetReader(),
			createWorker: () => port,
			workerCount: 1,
		});
		const input = createLayoutInput();
		const result = builder.planAtlasPlacement(input);

		expect(port.requests).toEqual([
			{
				input,
				kind: "job",
				requestId: "open-world-texture-layout:0",
			},
		]);

		port.emit({
			kind: "result",
			output: createLayoutOutput(),
			requestId: "open-world-texture-layout:0",
		});

		await expect(result).resolves.toEqual(createLayoutOutput());
		builder.dispose();
	});
});

class FixtureObjectVisualAtlasWorkerPort
	implements OpenWorldObjectVisualAtlasWorkerPort
{
	readonly requests: OpenWorldObjectVisualAtlasWorkerRequest[] = [];
	readonly responses: OpenWorldObjectVisualAtlasWorkerResponse[] = [];
	readonly #requestListeners = new Set<
		(event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>) => void
	>();
	readonly #responseListeners = new Set<
		(event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>) => void
	>();

	postMessage(
		message:
			| OpenWorldObjectVisualAtlasWorkerRequest
			| OpenWorldObjectVisualAtlasWorkerResponse,
	): void {
		if (message.kind === "job" || message.kind === "cancel") {
			this.requests.push(message);
			return;
		}
		this.responses.push(message);
	}

	addEventListener(
		_type: "message",
		listener:
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			  ) => void)
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			  ) => void),
	): void {
		this.#responseListeners.add(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			) => void,
		);
		this.#requestListeners.add(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			) => void,
		);
	}

	removeEventListener(
		_type: "message",
		listener:
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			  ) => void)
			| ((
					event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			  ) => void),
	): void {
		this.#responseListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>,
			) => void,
		);
		this.#requestListeners.delete(
			listener as (
				event: MessageEvent<OpenWorldObjectVisualAtlasWorkerRequest>,
			) => void,
		);
	}

	emit(response: OpenWorldObjectVisualAtlasWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<OpenWorldObjectVisualAtlasWorkerResponse>;
		for (const listener of this.#responseListeners) {
			listener(event);
		}
	}
}

function createLayoutInput(): OpenWorldObjectVisualAtlasBuildInput {
	return {
		domain: "outdoor-terrain",
		entries: [
			{
				dataUse: createTextureUse(),
				entryId: "entry:terrain" as OpenWorldTextureEntryId,
				gutterEdgeMode: "clamp",
			},
		],
		jobId: "layout:terrain",
		page: {
			format: "rgba8",
			gutterEdgeMode: "clamp",
			gutterPixels: 0,
			height: 1,
			pageRunway: "none",
			pageSelection: "minimize-textures",
			width: 1,
		},
	};
}

function createLayoutOutput(): OpenWorldObjectVisualAtlasPlacementOutput {
	return {
		pages: [{ height: 1, pageId: "layout:terrain:page:0", width: 1 }],
		rects: [
			{
				entryKey: "entry:terrain" as OpenWorldTextureEntryId,
				pageId: "layout:terrain:page:0",
				rect: [0, 0, 1, 1],
			},
		],
		stageTimings: [],
	};
}

function createTextureUse(): PreparedRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function createUnusedAssetReader(): PreparedAssetReader {
	return {
		requestPreparedAsset(): Promise<never> {
			throw new Error("Fixture asset reader should not be used.");
		},
	};
}
