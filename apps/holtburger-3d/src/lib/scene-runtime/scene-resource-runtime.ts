import type { PreparedAssetResolver } from "../assets/prepared-asset-store";
import type {
	StaticLandblockProductSource,
	StaticLandblockProductSourceListener,
	StaticLandblockProductSourceSubscription,
} from "../world-display/static-landblock-product-source";
import type { SceneResourceInterest } from "./scene-resource-interest";

export interface SceneResourceRuntime {
	readonly assets: ClientAssetRuntime;
	readonly landblockProducts: LandblockProductRuntime;
	syncSceneInterest(sceneInterest: SceneResourceInterest): void;
	dispose(): void;
}

export interface ClientAssetRuntime {
	readonly preparedAssetResolver: PreparedAssetResolver;
	syncSceneInterest(sceneInterest: SceneResourceInterest): void;
	dispose(): void;
}

export interface LandblockProductRuntime {
	readonly productSource: StaticLandblockProductSource;
	syncSceneInterest(sceneInterest: SceneResourceInterest): void;
	subscribeProductEvents(
		listener: StaticLandblockProductSourceListener,
	): StaticLandblockProductSourceSubscription;
	dispose(): void;
}
