import { describe, expect, it } from "vitest";
import { ShelfTexturePacker } from "./packer";
import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerRequest,
	TexturePackingWorkerResponse,
	TexturePackingWorkerPort,
} from "./protocol";
import { TexturePackingWorkerClient } from "./worker-client";
import { handleTexturePackingWorkerRequest } from "./worker-handler";

describe("V2 texture packing worker protocol", () => {
	it("posts typed packing jobs and resolves atlas page pixels plus rect metadata", async () => {
		const port = new FixtureWorkerPort();
		const client = new TexturePackingWorkerClient(port);
		const job = createPackingJob();
		const handle = client.pack(job);

		expect(handle.requestId).toBe("texture-pack:0");
		expect(port.requests).toEqual([
			{
				job,
				kind: "pack-textures",
				requestId: "texture-pack:0",
			},
		]);
		expect(JSON.stringify(port.requests[0])).not.toContain("texture-ref");
		expect(JSON.stringify(port.requests[0])).not.toContain("drawUnit");

		port.emit({
			kind: "textures-packed",
			requestId: "texture-pack:0",
			result: createPackingResult(job),
		});

		await expect(handle.result).resolves.toMatchObject({
			domain: "outdoor-terrain",
			jobId: "pack-job:1",
			pages: [
				{
					format: "rgba8",
					height: 2,
					pageId: "pack-job:1:page:0",
					width: 2,
				},
			],
			rects: [
				{
					pageId: "pack-job:1:page:0",
					rect: [0, 0, 1, 1],
					textureUseId: "terrain-a:prepared-texture:06000010",
				},
			],
		});
		client.dispose();
	});

	it("rejects canceled requests and discards late worker responses", async () => {
		const port = new FixtureWorkerPort();
		const client = new TexturePackingWorkerClient(port);
		const job = createPackingJob();
		const handle = client.pack(job);

		handle.cancel();

		expect(port.requests.at(-1)).toEqual({
			kind: "cancel-texture-pack",
			requestId: "texture-pack:0",
		});
		await expect(handle.result).rejects.toThrow(
			"Texture packing request was canceled.",
		);

		port.emit({
			kind: "textures-packed",
			requestId: "texture-pack:0",
			result: createPackingResult(job),
		});

		const nextHandle = client.pack(job);
		port.emit({
			kind: "textures-packed",
			requestId: "texture-pack:1",
			result: createPackingResult(job),
		});
		await expect(nextHandle.result).resolves.toMatchObject({
			jobId: "pack-job:1",
		});
		client.dispose();
	});

	it("packs direct rgba sources in the worker handler", async () => {
		const responses: TexturePackingWorkerResponse[] = [];

		await handleTexturePackingWorkerRequest(
			new ShelfTexturePacker(),
			{
				job: createPackingJob(),
				kind: "pack-textures",
				requestId: "texture-pack:7",
			},
			(response) => responses.push(response),
		);

		expect(responses).toHaveLength(1);
		expect(responses[0]).toMatchObject({
			kind: "textures-packed",
			requestId: "texture-pack:7",
			result: {
				pages: [
					{
						format: "rgba8",
						height: 2,
						pageId: "pack-job:1:page:0",
						width: 2,
					},
				],
				rects: [
					{
						pageId: "pack-job:1:page:0",
						rect: [0, 0, 1, 1],
						textureUseId: "terrain-a:prepared-texture:06000010",
					},
				],
			},
		});
		expect(
			Array.from(
				(responses[0] as { result: TexturePackingResult }).result.pages[0]
					?.pixels ?? [],
			),
		).toEqual([255, 128, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("turns packer failures into typed worker responses", async () => {
		const responses: TexturePackingWorkerResponse[] = [];

		await handleTexturePackingWorkerRequest(
			{
				async pack(): Promise<TexturePackingResult> {
					throw new Error("source does not fit");
				},
			},
			{
				job: createPackingJob(),
				kind: "pack-textures",
				requestId: "texture-pack:8",
			},
			(response) => responses.push(response),
		);

		expect(responses).toEqual([
			{
				kind: "texture-pack-failed",
				message: "source does not fit",
				requestId: "texture-pack:8",
			},
		]);
	});
});

class FixtureWorkerPort implements TexturePackingWorkerPort {
	readonly requests: TexturePackingWorkerRequest[] = [];
	readonly #listeners = new Set<
		(event: MessageEvent<TexturePackingWorkerResponse>) => void
	>();

	postMessage(message: TexturePackingWorkerRequest): void {
		this.requests.push(message);
	}

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<TexturePackingWorkerResponse>) => void,
	): void {
		this.#listeners.add(listener);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<TexturePackingWorkerResponse>) => void,
	): void {
		this.#listeners.delete(listener);
	}

	emit(response: TexturePackingWorkerResponse): void {
		const event = {
			data: response,
		} as MessageEvent<TexturePackingWorkerResponse>;
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function createPackingJob(): TexturePackingJob {
	return {
		domain: "outdoor-terrain",
		jobId: "pack-job:1",
		page: {
			format: "rgba8",
			height: 2,
			width: 2,
		},
		placementRevision: 3,
		sources: [
			{
				source: {
					height: 1,
					kind: "direct-rgba-texture-source",
					outputFormat: "rgba8",
					pixels: new Uint8Array([255, 128, 0, 255]),
					renderSurfaceId: 0x06000010,
					usage: "color",
					width: 1,
				},
				textureUseId: "terrain-a:prepared-texture:06000010",
			},
		],
	};
}

function createPackingResult(job: TexturePackingJob): TexturePackingResult {
	return {
		domain: job.domain,
		jobId: job.jobId,
		pages: [
			{
				format: "rgba8",
				height: 2,
				pageId: "pack-job:1:page:0",
				pixels: new Uint8Array(16),
				width: 2,
			},
		],
		placementRevision: job.placementRevision,
		rects: [
			{
				pageId: "pack-job:1:page:0",
				rect: [0, 0, 1, 1],
				textureUseId: "terrain-a:prepared-texture:06000010",
			},
		],
	};
}
