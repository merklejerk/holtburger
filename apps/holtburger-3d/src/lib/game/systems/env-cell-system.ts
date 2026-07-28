import type {
	EnvCellLayerArtifact,
	EnvCellRenderable,
	PortalDrawUnit,
} from "../commit/artifacts";
import type { SceneGraph, SceneNodeId } from "../scene";
import { scopeKey } from "../scene/scope";
import type { GeometryManager } from "../geometry/geometry-manager";
import type { SceneInterestRevision } from "../runtime/scene-availability";

interface EnvCellOwnerRecord<TResourceOwner extends string> {
	readonly artifact: EnvCellLayerArtifact;
	readonly crossings: readonly EnvCellLayerArtifact["crossings"][number]["id"][];
	readonly nodes: readonly SceneNodeId[];
	readonly resourceOwner: TResourceOwner;
	readonly revision: SceneInterestRevision;
	readonly scopes: readonly EnvCellLayerArtifact["scopes"][number]["scope"][];
	readonly apertures: readonly `portal-aperture:${string}`[];
}

/** Owns canonical env-cell topology, shell nodes, and portal draw contributions. */
export class EnvCellSystem<
	TOwnerId extends string,
	TResourceOwner extends string = TOwnerId,
> {
	readonly #scene: SceneGraph;
	readonly #geometry: GeometryManager<TResourceOwner>;
	readonly #resourceOwner: (
		owner: TOwnerId,
		revision: SceneInterestRevision,
	) => TResourceOwner;
	readonly #owners = new Map<TOwnerId, EnvCellOwnerRecord<TResourceOwner>>();
	readonly #renderables = new Map<SceneNodeId, EnvCellRenderable>();
	readonly #portalDrawUnits = new Map<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>();

	constructor(
		scene: SceneGraph,
		geometry: GeometryManager<TResourceOwner>,
		resourceOwner: (
			owner: TOwnerId,
			revision: SceneInterestRevision,
		) => TResourceOwner,
	) {
		this.#scene = scene;
		this.#geometry = geometry;
		this.#resourceOwner = resourceOwner;
	}

	/**
	 * Replace one complete environment transaction and return a synchronous rollback for a later
	 * resident-publication failure in the same JavaScript turn.
	 */
	replace(
		ownerId: TOwnerId,
		revision: SceneInterestRevision,
		artifact: EnvCellLayerArtifact,
	): () => void {
		validateArtifact(artifact);
		this.#validateGlobalIdentity(ownerId, artifact);
		const previous = this.#owners.get(ownerId) ?? null;
		const resourceOwner = this.#resourceOwner(ownerId, revision);
		this.#geometry.reserveKeys(
			resourceOwner,
			artifact.geometry.map(({ key }) => key),
		);
		try {
			for (const source of artifact.geometry)
				this.#geometry.upsertGeometry(source);
		} catch (cause) {
			this.#geometry.dropOwner(resourceOwner);
			throw cause;
		}
		if (previous) this.#removeRecord(ownerId, previous);
		try {
			this.#installRecord(ownerId, revision, resourceOwner, artifact);
		} catch (cause) {
			this.#geometry.dropOwner(resourceOwner);
			if (previous) this.#restoreRecord(ownerId, previous);
			throw cause;
		}
		return () => {
			const current = this.#owners.get(ownerId);
			if (current?.revision === revision) this.#removeRecord(ownerId, current);
			if (previous) this.#restoreRecord(ownerId, previous);
		};
	}

	removeOwner(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (!owner) return;
		this.#removeRecord(ownerId, owner);
	}

	removeExact(ownerId: TOwnerId, revision: SceneInterestRevision): void {
		const owner = this.#owners.get(ownerId);
		if (owner?.revision === revision) this.#removeRecord(ownerId, owner);
	}

	evict(ownerId: TOwnerId, revision: SceneInterestRevision): void {
		const owner = this.#owners.get(ownerId);
		if (owner && owner.revision <= revision) this.#removeRecord(ownerId, owner);
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

	#installRecord(
		ownerId: TOwnerId,
		revision: SceneInterestRevision,
		resourceOwner: TResourceOwner,
		artifact: EnvCellLayerArtifact,
	): void {
		const scopes: EnvCellLayerArtifact["scopes"][number]["scope"][] = [];
		const crossings: EnvCellLayerArtifact["crossings"][number]["id"][] = [];
		const apertures: `portal-aperture:${string}`[] = [];
		const nodes: SceneNodeId[] = [];
		try {
			for (const scopeInput of artifact.scopes) {
				this.#scene.upsertEnvCellScope(scopeInput);
				scopes.push(scopeInput.scope);
			}
			for (const crossing of artifact.crossings) {
				this.#scene.upsertPortalCrossing(crossing);
				crossings.push(crossing.id);
			}
			for (const shell of artifact.cellShells) {
				const nodeId = this.#scene.createNode({
					...shell.placement,
					cullingGroup: "env-cell-shell",
					localBounds: shell.structureLocalBounds,
					parentId: null,
				});
				this.#renderables.set(nodeId, shell.renderable);
				nodes.push(nodeId);
			}
			for (const [apertureId, drawUnit] of artifact.portalDrawUnits) {
				this.#portalDrawUnits.set(apertureId, drawUnit);
				apertures.push(apertureId);
			}
		} catch (cause) {
			this.#removePartial(nodes, crossings, apertures, scopes);
			throw cause;
		}
		this.#owners.set(ownerId, {
			apertures,
			artifact,
			crossings,
			nodes,
			resourceOwner,
			revision,
			scopes,
		});
	}

	#validateGlobalIdentity(
		ownerId: TOwnerId,
		artifact: EnvCellLayerArtifact,
	): void {
		const incomingScopes = new Set(
			artifact.scopes.map(({ scope }) => scopeKey(scope)),
		);
		const incomingCrossings = new Set(artifact.crossings.map(({ id }) => id));
		const incomingApertures = new Set(artifact.portalDrawUnits.keys());
		for (const [otherOwnerId, record] of this.#owners) {
			if (otherOwnerId === ownerId) continue;
			if (record.scopes.some((scope) => incomingScopes.has(scopeKey(scope)))) {
				throw new Error("EnvCell scope identity is owned by another layer.");
			}
			if (record.crossings.some((id) => incomingCrossings.has(id))) {
				throw new Error("EnvCell crossing identity is owned by another layer.");
			}
			if (record.apertures.some((id) => incomingApertures.has(id))) {
				throw new Error("EnvCell aperture identity is owned by another layer.");
			}
		}
	}

	#restoreRecord(
		ownerId: TOwnerId,
		record: EnvCellOwnerRecord<TResourceOwner>,
	): void {
		this.#geometry.reserveKeys(
			record.resourceOwner,
			record.artifact.geometry.map(({ key }) => key),
		);
		for (const source of record.artifact.geometry)
			this.#geometry.upsertGeometry(source);
		this.#installRecord(
			ownerId,
			record.revision,
			record.resourceOwner,
			record.artifact,
		);
	}

	#removeRecord(
		ownerId: TOwnerId,
		record: EnvCellOwnerRecord<TResourceOwner>,
	): void {
		this.#removePartial(
			record.nodes,
			record.crossings,
			record.apertures,
			record.scopes,
		);
		this.#owners.delete(ownerId);
		this.#geometry.dropOwner(record.resourceOwner);
	}

	#removePartial(
		nodes: readonly SceneNodeId[],
		crossings: readonly EnvCellLayerArtifact["crossings"][number]["id"][],
		apertures: readonly `portal-aperture:${string}`[],
		scopes: readonly EnvCellLayerArtifact["scopes"][number]["scope"][],
	): void {
		for (const crossingId of crossings)
			this.#scene.removePortalCrossing(crossingId);
		for (const nodeId of nodes) {
			this.#renderables.delete(nodeId);
			this.#scene.destroyNode(nodeId);
		}
		for (const apertureId of apertures)
			this.#portalDrawUnits.delete(apertureId);
		for (const scope of scopes) this.#scene.removeEnvCellScope(scope);
	}
}

function validateArtifact(artifact: EnvCellLayerArtifact): void {
	const scopeKeys = artifact.scopes.map(({ scope }) => scopeKey(scope));
	if (new Set(scopeKeys).size !== scopeKeys.length) {
		throw new Error("EnvCell artifact contains duplicate scopes.");
	}
	const scopes = new Set(scopeKeys);
	const geometryKeys = artifact.geometry.map(({ key }) => key);
	if (new Set(geometryKeys).size !== geometryKeys.length) {
		throw new Error("EnvCell artifact contains duplicate geometry keys.");
	}
	const crossingIds = artifact.crossings.map(({ id }) => id);
	if (new Set(crossingIds).size !== crossingIds.length) {
		throw new Error("EnvCell artifact contains duplicate crossing identities.");
	}
	const crossings = new Map(
		artifact.crossings.map((crossing) => [crossing.id, crossing]),
	);
	const geometry = new Set(artifact.geometry.map(({ key }) => key));
	for (const crossing of artifact.crossings) {
		for (const scope of [crossing.source, crossing.target]) {
			if (scope.kind === "env-cell" && !scopes.has(scopeKey(scope))) {
				throw new Error(
					`EnvCell crossing ${crossing.id} references an unavailable scope.`,
				);
			}
		}
		if (
			!artifact.portalDrawUnits.has(crossing.sourceAperture.id) ||
			!artifact.portalDrawUnits.has(crossing.visibilityAperture.id)
		) {
			throw new Error(
				`EnvCell crossing ${crossing.id} references an unavailable source or visibility aperture.`,
			);
		}
		const reciprocal =
			crossing.reciprocalCrossingId === null
				? null
				: crossings.get(crossing.reciprocalCrossingId);
		if (
			crossing.reciprocalCrossingId !== null &&
			(!reciprocal || reciprocal.reciprocalCrossingId !== crossing.id)
		) {
			throw new Error(
				`EnvCell crossing ${crossing.id} has an inconsistent reciprocal link.`,
			);
		}
		if (crossing.spatialRelationship.kind === "indoor-depth-continuous") {
			if (
				!crossing.exactMatch ||
				!reciprocal?.exactMatch ||
				reciprocal.spatialRelationship.kind !== "indoor-depth-continuous" ||
				reciprocal.sourceAperture.id !==
					crossing.spatialRelationship.reciprocalApertureId ||
				reciprocal.spatialRelationship.reciprocalApertureId !==
					crossing.sourceAperture.id
			) {
				throw new Error(
					`EnvCell crossing ${crossing.id} has invalid depth-continuity proof.`,
				);
			}
		}
	}
	for (const drawUnit of artifact.portalDrawUnits.values()) {
		if (!geometry.has(drawUnit.geometry)) {
			throw new Error(
				`EnvCell aperture ${drawUnit.apertureId} references unavailable geometry.`,
			);
		}
	}
	for (const shell of artifact.cellShells) {
		if (
			shell.placement.envCellId === null ||
			!scopes.has(
				scopeKey({
					kind: "env-cell",
					landblockId: shell.placement.landblockId,
					envCellId: shell.placement.envCellId,
				}),
			)
		) {
			throw new Error("EnvCell shell has no matching scope.");
		}
		for (const drawUnit of shell.renderable.drawUnits) {
			if (!geometry.has(drawUnit.geometry)) {
				throw new Error(
					`EnvCell shell references unavailable geometry ${drawUnit.geometry}.`,
				);
			}
		}
	}
}
