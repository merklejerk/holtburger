import type { SceneNodeId } from "./index";

export function createSceneNodeId(id: number): SceneNodeId {
	return `scene-node:${id}`;
}
