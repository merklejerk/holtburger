import type { SceneNodeId } from "./index";

/** The namespace every scene node id is minted into, and the only one this module owns. */
const SCENE_NODE_ID_PREFIX = "scene-node:";

export function createSceneNodeId(id: number): SceneNodeId {
	return `${SCENE_NODE_ID_PREFIX}${id}`;
}

/**
 * Recover the scene node an id names, or null when the id belongs to some other namespace.
 *
 * Behavior targets are minted by whichever module owns them, so an id reaching a scene-keyed
 * consumer is not guaranteed to be a scene node at all — sky targets are not scene residents. This
 * is a positive test rather than a cast, so a foreign id is a value the caller must handle instead
 * of an unchecked assertion that silently addresses nothing.
 */
export function sceneNodeIdOf(id: string): SceneNodeId | null {
	return id.startsWith(SCENE_NODE_ID_PREFIX) ? (id as SceneNodeId) : null;
}

/**
 * Recover the scene node an id names, failing loudly when it names something else.
 *
 * For consumers whose whole state model is keyed by scene node and which therefore cannot serve a
 * non-scene target at all. Making that an explicit throw is the point: the alternative is a lookup
 * that silently misses and reports the target as merely absent, which reads as a content problem
 * rather than as a target reaching a consumer that was never meant to see it.
 */
export function requireSceneNodeId(id: string, consumer: string): SceneNodeId {
	const nodeId = sceneNodeIdOf(id);
	if (nodeId === null) {
		throw new Error(
			`${consumer} received behavior target ${id}, which is not a scene node.`,
		);
	}
	return nodeId;
}
