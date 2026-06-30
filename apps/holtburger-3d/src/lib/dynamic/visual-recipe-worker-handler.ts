import type { PreparedAssetReader } from "../assets/contracts";
import type {
	DynamicVisualRecipeWorkerMainMessage,
	DynamicVisualRecipeWorkerResponse,
} from "./visual-recipe-protocol";
import { resolveDynamicVisualRecipe } from "./visual-recipe-resolver";

export async function handleDynamicVisualRecipeWorkerRequest(
	assetReader: PreparedAssetReader,
	message: DynamicVisualRecipeWorkerMainMessage,
	postMessage: (response: DynamicVisualRecipeWorkerResponse) => void,
): Promise<void> {
	if (message.kind !== "resolve-dynamic-visual-recipe") {
		return;
	}

	try {
		const recipe = await resolveDynamicVisualRecipe({
			...message.request,
			assetReader,
		});
		postMessage({
			kind: "dynamic-visual-recipe-resolved",
			recipe,
			requestId: message.requestId,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "dynamic-visual-recipe-resolve-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
