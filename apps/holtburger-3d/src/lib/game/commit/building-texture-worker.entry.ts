import {
	packBuildingTextures,
	type BuildingTexturePackJob,
	type BuildingTexturePackResult,
} from "./building-texture-worker";
import type { ClosedWorkerRequest, ClosedWorkerResponse } from "../workers/closed-worker";

const worker = self as unknown as {
	onmessage: ((event: MessageEvent<ClosedWorkerRequest<BuildingTexturePackJob>>) => void) | null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (event: MessageEvent<ClosedWorkerRequest<BuildingTexturePackJob>>) => {
	const { id, input } = event.data;
	try {
		const result = packBuildingTextures(input);
		const response: ClosedWorkerResponse<BuildingTexturePackResult> = { id, ok: true, result };
		worker.postMessage(response, result.pages.map((page) => page.pageBits.buffer));
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};
