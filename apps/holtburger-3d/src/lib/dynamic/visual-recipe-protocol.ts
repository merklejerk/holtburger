import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import type { DynamicEntityRecipe } from "./contracts";
import type { DynamicVisualRecipeResolutionRequest } from "./visual-recipe-resolver";

export type DynamicVisualRecipeWorkerRequestPayload = Omit<
	DynamicVisualRecipeResolutionRequest,
	"assetReader"
>;

export type DynamicVisualRecipeWorkerMainMessage =
	| {
			readonly kind: "resolve-dynamic-visual-recipe";
			readonly request: DynamicVisualRecipeWorkerRequestPayload;
			readonly requestId: string;
	  }
	| {
			readonly asset: PreparedAsset;
			readonly kind: "prepared-asset-request-resolved";
			readonly requestId: string;
	  }
	| {
			readonly kind: "prepared-asset-request-failed";
			readonly message: string;
			readonly requestId: string;
	  };

export type DynamicVisualRecipeWorkerThreadMessage =
	| {
			readonly kind: "dynamic-visual-recipe-resolved";
			readonly recipe: DynamicEntityRecipe;
			readonly requestId: string;
	  }
	| {
			readonly kind: "dynamic-visual-recipe-resolve-failed";
			readonly message: string;
			readonly requestId: string;
	  }
	| {
			readonly key: HostAssetKey;
			readonly kind: "prepared-asset-requested";
			readonly requestId: string;
	  };

export type DynamicVisualRecipeWorkerResponse = Extract<
	DynamicVisualRecipeWorkerThreadMessage,
	{
		readonly kind:
			| "dynamic-visual-recipe-resolved"
			| "dynamic-visual-recipe-resolve-failed";
	}
>;

export type DynamicVisualRecipePreparedAssetResponse = Extract<
	DynamicVisualRecipeWorkerMainMessage,
	{
		readonly kind:
			| "prepared-asset-request-resolved"
			| "prepared-asset-request-failed";
	}
>;

export interface DynamicVisualRecipeWorkerPort {
	postMessage(message: DynamicVisualRecipeWorkerMainMessage): void;
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
		) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerThreadMessage>,
		) => void,
	): void;
}

export interface DynamicVisualRecipeWorkerGlobalPort {
	postMessage(message: DynamicVisualRecipeWorkerThreadMessage): void;
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>,
		) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (
			event: MessageEvent<DynamicVisualRecipeWorkerMainMessage>,
		) => void,
	): void;
}
