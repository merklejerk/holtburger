import type { TexturePacker } from "./packer";
import type {
	TexturePackingWorkerMainMessage,
	TexturePackingWorkerResponse,
} from "./protocol";

export async function handleTexturePackingWorkerRequest(
	packer: TexturePacker,
	message: TexturePackingWorkerMainMessage,
	postMessage: (response: TexturePackingWorkerResponse) => void,
): Promise<void> {
	if (message.kind === "cancel-texture-pack") {
		return;
	}

	try {
		const result = await packer.pack(message.job);
		postMessage({
			kind: "textures-packed",
			requestId: message.requestId,
			result,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "texture-pack-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
