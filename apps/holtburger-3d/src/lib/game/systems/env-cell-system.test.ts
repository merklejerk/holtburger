import { describe, expect, it } from "vitest";
import type { EnvCellLayerArtifact } from "../commit/artifacts";
import type { GeometryManager } from "../geometry/geometry-manager";
import { AABB3, Mat4 } from "../math/types";
import type {
	SceneEnvCellScopeInput,
	SceneGraph,
	SceneNodeId,
	ScenePortalCrossingInput,
} from "../scene";
import type { SceneInterestRevision } from "../runtime/scene-availability";
import { EnvCellSystem } from "./env-cell-system";

describe("EnvCellSystem", () => {
	it("restores the visible environment when replacement publication fails", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const system = createSystem(scene, geometry);
		system.replace("owner", revision(1), artifact("old"));
		scene.failNextCreate = true;

		expect(() => system.replace("owner", revision(2), artifact("new"))).toThrow(
			"scene create failed",
		);

		expect(scene.scopeIds).toEqual(["old"]);
		expect(scene.live).toHaveLength(1);
		expect(geometry.dropped).toEqual(["resource:1", "resource:2"]);
	});

	it("returns a transaction rollback that restores the prior revision", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const system = createSystem(scene, geometry);
		system.replace("owner", revision(1), artifact("old"));

		const rollback = system.replace("owner", revision(2), artifact("new"));
		expect(scene.scopeIds).toEqual(["new"]);

		rollback();

		expect(scene.scopeIds).toEqual(["old"]);
		expect(scene.live).toHaveLength(1);
	});

	it("rejects identities already owned by another environment layer", () => {
		const scene = new FixtureScene();
		const geometry = new FixtureGeometry();
		const system = createSystem(scene, geometry);
		system.replace("first", revision(1), artifact("shared"));

		expect(() =>
			system.replace("second", revision(1), artifact("shared")),
		).toThrow("scope identity is owned by another layer");

		expect(scene.scopeIds).toEqual(["shared"]);
		expect(scene.live).toHaveLength(1);
	});
});

function createSystem(scene: FixtureScene, geometry: FixtureGeometry) {
	return new EnvCellSystem<"owner" | "first" | "second", string>(
		scene as unknown as SceneGraph,
		geometry as unknown as GeometryManager<string>,
		(_, value) => `resource:${value}`,
	);
}

function artifact(id: string): EnvCellLayerArtifact {
	const scope: SceneEnvCellScopeInput = {
		containmentPlanes: new Float32Array(),
		landblockBounds: AABB3.zero(),
		potentiallyVisibleEnvCellIds: new Set(),
		scope: {
			envCellId: id,
			kind: "env-cell",
			landblockId: "0x0001ffff",
		},
		structureToLandblock: Mat4.identity(),
		seenOutside: false,
		visibilityIslandId: `env-cell-island:${id}`,
	};
	return {
		cellShells: [
			{
				placement: {
					envCellId: id,
					landblockId: "0x0001ffff",
					localTransform: Mat4.identity(),
				},
				renderable: { drawUnits: [] },
				structureLocalBounds: AABB3.zero(),
			},
		],
		crossings: [],
		geometry: [],
		portalDrawUnits: new Map(),
		scopes: [scope],
	};
}

function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

class FixtureScene {
	readonly live: SceneNodeId[] = [];
	readonly scopeIds: string[] = [];
	failNextCreate = false;
	#nextNode = 0;

	upsertEnvCellScope(input: SceneEnvCellScopeInput): void {
		this.scopeIds.push(input.scope.envCellId);
	}

	removeEnvCellScope(input: SceneEnvCellScopeInput["scope"]): void {
		const index = this.scopeIds.indexOf(input.envCellId);
		if (index >= 0) this.scopeIds.splice(index, 1);
	}

	upsertPortalCrossing(input: ScenePortalCrossingInput): void {
		void input;
	}

	removePortalCrossing(id: ScenePortalCrossingInput["id"]): void {
		void id;
	}

	createNode(): SceneNodeId {
		if (this.failNextCreate) {
			this.failNextCreate = false;
			throw new Error("scene create failed");
		}
		const node = `scene-node:${this.#nextNode++}` as SceneNodeId;
		this.live.push(node);
		return node;
	}

	destroyNode(node: SceneNodeId): void {
		const index = this.live.indexOf(node);
		if (index >= 0) this.live.splice(index, 1);
	}
}

class FixtureGeometry {
	readonly dropped: string[] = [];

	reserveKeys(): void {}

	upsertGeometry(): void {}

	dropOwner(owner: string): void {
		this.dropped.push(owner);
	}
}
