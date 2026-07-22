import type { AABB3 } from "../math/types";
import type {
	SceneEnvCellScopeInput,
	SceneGraph,
	SceneNodeId,
	ScenePlacement,
	ScenePortalCrossingInput,
} from "../scene";
import type { EnvCellRenderable, PortalDrawUnit } from "./components";

/** Bounded cell-shell presentation published as a scene resident. */
export interface EnvCellShellArtifact {
	/** Root placement mapping source structure space into its landblock. */
	readonly placement: ScenePlacement;
	/** Bounds in the reusable cell structure's local geometry frame. */
	readonly structureLocalBounds: AABB3;
	readonly renderable: EnvCellRenderable;
}

/** Complete env-cell contribution produced for one committed owner. */
export interface EnvCellSystemArtifact {
	readonly cellShells: readonly EnvCellShellArtifact[];
	readonly portalDrawUnits: ReadonlyMap<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>;
	readonly scopes: readonly SceneEnvCellScopeInput[];
	readonly crossings: readonly ScenePortalCrossingInput[];
}

interface EnvCellOwnerRecord {
	readonly crossings: readonly ScenePortalCrossingInput["id"][];
	readonly nodes: readonly SceneNodeId[];
	readonly scopes: readonly SceneEnvCellScopeInput["scope"][];
	readonly apertures: readonly `portal-aperture:${string}`[];
}

/** Owns canonical env-cell topology, shell nodes, and portal draw contributions. */
export class EnvCellSystem<TOwnerId extends string> {
	readonly #scene: SceneGraph;
	readonly #owners = new Map<TOwnerId, EnvCellOwnerRecord>();
	readonly #renderables = new Map<SceneNodeId, EnvCellRenderable>();
	readonly #portalDrawUnits = new Map<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>();

	constructor(scene: SceneGraph) {
		this.#scene = scene;
	}

	install(ownerId: TOwnerId, artifact: EnvCellSystemArtifact): void {
		this.removeOwner(ownerId);
		for (const scope of artifact.scopes) this.#scene.upsertEnvCellScope(scope);
		for (const crossing of artifact.crossings)
			this.#scene.upsertPortalCrossing(crossing);
		const nodes = artifact.cellShells.map((shell) => {
			const nodeId = this.#scene.createNode({
				...shell.placement,
				localBounds: shell.structureLocalBounds,
				parentId: null,
			});
			this.#renderables.set(nodeId, shell.renderable);
			return nodeId;
		});
		for (const [apertureId, drawUnit] of artifact.portalDrawUnits) {
			this.#portalDrawUnits.set(apertureId, drawUnit);
		}
		this.#owners.set(ownerId, {
			apertures: [...artifact.portalDrawUnits.keys()],
			crossings: artifact.crossings.map(({ id }) => id),
			nodes,
			scopes: artifact.scopes.map(({ scope }) => scope),
		});
	}

	removeOwner(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (!owner) return;
		for (const crossingId of owner.crossings)
			this.#scene.removePortalCrossing(crossingId);
		for (const nodeId of owner.nodes) {
			this.#renderables.delete(nodeId);
			this.#scene.destroyNode(nodeId);
		}
		for (const apertureId of owner.apertures)
			this.#portalDrawUnits.delete(apertureId);
		for (const scope of owner.scopes) this.#scene.removeEnvCellScope(scope);
		this.#owners.delete(ownerId);
	}

	getCellRenderable(nodeId: SceneNodeId): EnvCellRenderable | null {
		return this.#renderables.get(nodeId) ?? null;
	}

	getPortalDrawUnit(
		apertureId: `portal-aperture:${string}`,
	): PortalDrawUnit | null {
		return this.#portalDrawUnits.get(apertureId) ?? null;
	}

	destroy(): void {
		for (const ownerId of [...this.#owners.keys()]) this.removeOwner(ownerId);
	}
}
