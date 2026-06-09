import type { FrontendAppState } from "./frontend-state";
import { createSceneResourceInterestFromBrowserMode } from "./browser-scene-resource-interest";
import { describeSceneResourceInterestKey } from "../lib/scene-runtime/scene-resource-interest";
import type { SceneResourceRuntime } from "../lib/scene-runtime/scene-resource-runtime";

interface FrontendStateReadable {
	subscribe(listener: (state: FrontendAppState) => void): () => void;
}

export interface BrowserSceneResourceController {
	dispose(): void;
}

export function createBrowserSceneResourceController(input: {
	frontendState: FrontendStateReadable;
	runtime: SceneResourceRuntime;
	onFrontendState?: (state: FrontendAppState) => void;
}): BrowserSceneResourceController {
	let disposed = false;
	let lastSceneInterestKey: string | null = null;
	const unsubscribe = input.frontendState.subscribe((state) => {
		input.onFrontendState?.(state);
		const sceneInterest = createSceneResourceInterestFromBrowserMode(
			state.browserMode,
		);
		const sceneInterestKey = describeSceneResourceInterestKey(sceneInterest);
		if (sceneInterestKey === lastSceneInterestKey) {
			return;
		}
		lastSceneInterestKey = sceneInterestKey;
		input.runtime.syncSceneInterest(sceneInterest);
	});

	return {
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			unsubscribe();
		},
	};
}
