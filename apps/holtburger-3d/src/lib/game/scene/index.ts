import type { Camera } from "../runtime/types";

export type SceneBundleKey = `scene-bundle:${string}`;

export class SceneGraph {
	setCamera(camera: Camera) {
		void camera;
		// ...
	}

	updateVisibility() {
		// ...
	}
}
