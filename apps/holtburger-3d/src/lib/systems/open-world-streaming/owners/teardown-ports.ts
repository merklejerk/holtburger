import type { DynamicEntityId } from "../../../dynamic/contracts";
import type {
	StaticLayerMaterializationOwner,
	RuntimeEntityMaterializationOwner,
} from "./owner-id";

export interface OwnerTeardownPorts {
	readonly runtimeEntities: RuntimeEntityTeardownPort;
	readonly sceneQuery: SceneQueryTeardownPort;
	readonly staticLayers: StaticLayerTeardownPort;
}

/** Imperative renderer/static-layer teardown boundary. */
interface StaticLayerTeardownPort {
	teardownStaticLayer(owner: StaticLayerMaterializationOwner): void;
}

/** Imperative scene-query cleanup boundary, kept separate from renderer mutation. */
interface SceneQueryTeardownPort {
	teardownStaticLayerQuery(owner: StaticLayerMaterializationOwner): void;
}

/** Imperative runtime-entity cleanup boundary. */
interface RuntimeEntityTeardownPort {
	teardownRuntimeEntity(owner: RuntimeEntityMaterializationOwner): void;
}

export function createRecordingOwnerTeardownPorts(): OwnerTeardownPorts & {
	readonly calls: readonly OwnerTeardownCall[];
} {
	const calls: OwnerTeardownCall[] = [];
	return {
		calls,
		runtimeEntities: {
			teardownRuntimeEntity(owner) {
				calls.push({
					dynamicEntityId: owner.dynamicEntityId,
					kind: "runtime-entity",
					ownerId: owner.id,
				});
			},
		},
		sceneQuery: {
			teardownStaticLayerQuery(owner) {
				calls.push({
					kind: "static-layer-query",
					layerKind: owner.layerKind,
					landblockId: owner.landblockId,
					ownerId: owner.id,
				});
			},
		},
		staticLayers: {
			teardownStaticLayer(owner) {
				calls.push({
					kind: "static-layer-renderer",
					layerKind: owner.layerKind,
					landblockId: owner.landblockId,
					ownerId: owner.id,
				});
			},
		},
	};
}

export type OwnerTeardownCall =
	| {
			readonly dynamicEntityId: DynamicEntityId;
			readonly kind: "runtime-entity";
			readonly ownerId: string;
	  }
	| {
			readonly kind: "static-layer-query" | "static-layer-renderer";
			readonly landblockId: number;
			readonly layerKind: string;
			readonly ownerId: string;
	  };
