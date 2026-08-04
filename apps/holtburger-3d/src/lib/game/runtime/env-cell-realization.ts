import type {
	EnvCellLayerArtifact,
	PortalDrawUnit,
	StaticObjectGeometryDiagnostics,
	StaticObjectLayerArtifact,
} from "../commit/artifacts";
import type { EnvCellMaterializationPlan } from "../commit/env-cell-materialization";
import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import { Vec3 } from "../math/types";
import {
	qualifyPortalApertureId,
	qualifyPortalCrossingId,
} from "../resolution/portal-scene-identity";
import { LandblockLayerKind } from "./scene-interest";
import { mergeAssetTextureFacts } from "../textures/texture-facts";
import type { StaticLayerGeometryPreparer } from "./static-layer-realizer";
import type { OwnerId } from "./owner-ids";
import { staticRevisionToInstallNamespace } from "./owner-ids";
import type { SceneInterestRevision } from "./scene-availability";

/** Environment and resident artifacts staged together for one EnvCell layer revision. */
export interface EnvCellRealizationArtifact {
	readonly environment: EnvCellLayerArtifact;
	readonly residents: StaticObjectLayerArtifact | null;
	readonly residentGeometryDiagnostics: StaticObjectGeometryDiagnostics;
}

/** Executes the plan's independent resident partitions without taking scene or atlas ownership. */
export class EnvCellGeometryPreparer {
	readonly #residentGeometry: StaticLayerGeometryPreparer<
		ResolvedStaticObjectLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;

	constructor(
		residentGeometry: StaticLayerGeometryPreparer<
			ResolvedStaticObjectLayerSource,
			StaticObjectLayerArtifact | null,
			OwnerId
		>,
	) {
		this.#residentGeometry = residentGeometry;
	}

	async prepare(options: {
		readonly layer: LandblockLayerKind.EnvCells;
		readonly owner: OwnerId;
		readonly revision: SceneInterestRevision;
		readonly source: EnvCellMaterializationPlan;
		readonly textureRequirements: readonly import("../textures/types").AssetTextureFact[];
	}): Promise<EnvCellRealizationArtifact> {
		const residentArtifacts = await Promise.all(
			options.source.residentJobs.map((job) =>
				this.#residentGeometry.prepare({
					layer: LandblockLayerKind.EnvCells,
					owner: options.owner,
					partition: `cell-${job.source.envCellId}`,
					revision: options.revision,
					source: job.source,
					textureRequirements: job.textureRequirements,
				}),
			),
		);
		return {
			environment: environmentArtifact(options.source),
			residents: mergeResidentArtifacts(
				options.owner,
				options.revision,
				residentArtifacts,
			),
			residentGeometryDiagnostics: mergeGeometryDiagnostics(residentArtifacts),
		};
	}
}

function environmentArtifact(
	plan: EnvCellMaterializationPlan,
): EnvCellLayerArtifact {
	const visibilityIslands = buildVisibilityIslands(plan);
	const apertureGeometry = new Map(
		plan.apertures.map((aperture, index) => [
			aperture.id,
			plan.apertureGeometries[index]?.key,
		]),
	);
	const portalDrawUnits = new Map<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>();
	for (const aperture of plan.apertures) {
		const geometry = apertureGeometry.get(aperture.id);
		if (!geometry) {
			throw new Error(`Portal aperture ${aperture.id} lost its geometry.`);
		}
		const apertureId = qualifyPortalApertureId(plan.landblockId, aperture.id);
		portalDrawUnits.set(apertureId, {
			apertureId,
			geometry,
			indexStart: 0,
			indexCount: aperture.triangleIndices.length,
			landblockId: plan.landblockId,
		});
	}
	return {
		geometry: [...plan.shellGeometries, ...plan.apertureGeometries],
		cellShells: plan.shells.map((shell) => ({
			placement: shell.placement,
			structureLocalBounds: shell.structureLocalBounds,
			renderable: {
				drawUnits: shell.materialRanges.map((range, rangeIndex) => ({
					geometry: shell.geometry,
					indexStart: range.indexStart,
					indexCount: range.indexCount,
					material: range.material,
					ordering: range.ordering,
					transparentSort:
						range.ordering === "transparent"
							? {
									center: new Vec3(
										(shell.structureLocalBounds.min.x +
											shell.structureLocalBounds.max.x) *
											0.5,
										(shell.structureLocalBounds.min.y +
											shell.structureLocalBounds.max.y) *
											0.5,
										(shell.structureLocalBounds.min.z +
											shell.structureLocalBounds.max.z) *
											0.5,
									),
									stableId: `${shell.envCellId}/shell-range:${rangeIndex}`,
								}
							: null,
				})),
			},
		})),
		portalDrawUnits,
		scopes: plan.scopes.map((scope) => ({
			scope: scope.scope,
			landblockBounds: scope.landblockBounds,
			containmentPlanes: scope.containmentPlanes,
			potentiallyVisibleEnvCellIds: scope.potentiallyVisibleEnvCellIds,
			seenOutside: scope.seenOutside,
			structureToLandblock: scope.structureToLandblock,
			visibilityIslandId:
				visibilityIslands.get(scope.scope.envCellId) ??
				`env-cell-island:${scope.scope.landblockId}/${scope.scope.envCellId}`,
		})),
		crossings: plan.crossings.map((crossing) => {
			const sourceAperture = plan.apertures[crossing.sourceApertureIndex];
			if (!sourceAperture) {
				throw new Error(
					`Portal crossing ${crossing.id} lost source aperture ${crossing.sourceApertureIndex}.`,
				);
			}
			const visibilityAperture =
				plan.apertures[crossing.visibilityApertureIndex];
			if (!visibilityAperture) {
				throw new Error(
					`Portal crossing ${crossing.id} lost visibility aperture ${crossing.visibilityApertureIndex}.`,
				);
			}
			return {
				acceptedSide: crossing.acceptedSide,
				exactMatch: crossing.exactMatch,
				id: qualifyPortalCrossingId(plan.landblockId, crossing.id),
				maskDepthPolicy: crossing.maskDepthPolicy,
				reciprocalCrossingId:
					crossing.reciprocalCrossingIndex === null
						? null
						: resolveReciprocalCrossingId(
								plan,
								crossing.reciprocalCrossingIndex,
							),
				source: crossing.source,
				spatialRelationship: resolveSpatialRelationship(
					plan,
					crossing.spatialRelationship,
				),
				target: crossing.target,
				sourceAperture: {
					id: qualifyPortalApertureId(plan.landblockId, sourceAperture.id),
					landblockId: plan.landblockId,
					landblockBounds: sourceAperture.landblockBounds,
					plane: sourceAperture.plane,
					vertices: sourceAperture.positions,
					indices: sourceAperture.triangleIndices,
				},
				visibilityAperture: {
					id: qualifyPortalApertureId(plan.landblockId, visibilityAperture.id),
					landblockId: plan.landblockId,
					landblockBounds: visibilityAperture.landblockBounds,
					plane: visibilityAperture.plane,
					vertices: visibilityAperture.positions,
					indices: visibilityAperture.triangleIndices,
				},
			};
		}),
	};
}

function buildVisibilityIslands(
	plan: EnvCellMaterializationPlan,
): ReadonlyMap<string, `env-cell-island:${string}`> {
	const parents = new Map<string, string>(
		plan.scopes.map(({ scope }) => [scope.envCellId, scope.envCellId]),
	);
	const find = (id: string): string => {
		const parent = parents.get(id);
		if (parent === undefined) {
			throw new Error(`Visibility island references missing EnvCell ${id}.`);
		}
		if (parent === id) return id;
		const root = find(parent);
		parents.set(id, root);
		return root;
	};
	for (const crossing of plan.crossings) {
		if (
			crossing.spatialRelationship.kind !== "indoor-depth-continuous" ||
			crossing.source.kind !== "env-cell" ||
			crossing.target.kind !== "env-cell"
		) {
			continue;
		}
		const sourceRoot = find(crossing.source.envCellId);
		const targetRoot = find(crossing.target.envCellId);
		if (sourceRoot === targetRoot) continue;
		const first =
			sourceRoot.localeCompare(targetRoot) <= 0 ? sourceRoot : targetRoot;
		const second = first === sourceRoot ? targetRoot : sourceRoot;
		parents.set(second, first);
	}
	return new Map(
		[...parents.keys()].map((envCellId) => [
			envCellId,
			`env-cell-island:${plan.landblockId}/${find(envCellId)}`,
		]),
	);
}

function resolveReciprocalCrossingId(
	plan: EnvCellMaterializationPlan,
	index: number,
): EnvCellMaterializationPlan["crossings"][number]["id"] {
	const reciprocal = plan.crossings[index];
	if (!reciprocal) {
		throw new Error(`Portal crossing lost reciprocal crossing ${index}.`);
	}
	return qualifyPortalCrossingId(plan.landblockId, reciprocal.id);
}

function resolveSpatialRelationship(
	plan: EnvCellMaterializationPlan,
	relationship: EnvCellMaterializationPlan["crossings"][number]["spatialRelationship"],
): import("../scene").ScenePortalCrossingInput["spatialRelationship"] {
	if (relationship.kind !== "indoor-depth-continuous") return relationship;
	const reciprocalAperture =
		plan.apertures[relationship.reciprocalApertureIndex];
	if (!reciprocalAperture) {
		throw new Error(
			`Portal relationship lost reciprocal aperture ${relationship.reciprocalApertureIndex}.`,
		);
	}
	return {
		kind: relationship.kind,
		reciprocalApertureId: qualifyPortalApertureId(
			plan.landblockId,
			reciprocalAperture.id,
		),
	};
}

function mergeResidentArtifacts(
	owner: OwnerId,
	revision: SceneInterestRevision,
	artifacts: readonly (StaticObjectLayerArtifact | null)[],
): StaticObjectLayerArtifact | null {
	const present = artifacts.filter(
		(artifact): artifact is StaticObjectLayerArtifact => artifact !== null,
	);
	if (present.length === 0) return null;
	const geometry = deduplicateResidentGeometry(
		present.flatMap((artifact) => artifact.geometry),
	);
	const instanceStreams = present.flatMap(
		(artifact) => artifact.instanceStreams,
	);
	const instanceKeys = new Set(instanceStreams.map(({ key }) => key));
	if (instanceKeys.size !== instanceStreams.length) {
		throw new Error(
			"EnvCell resident partitions emitted duplicate instance-stream keys.",
		);
	}
	return {
		// Interior residents are lit by their bake, not by the runtime set.
		staticLights: [],
		resourceNamespace: staticRevisionToInstallNamespace(
			owner,
			revision,
			"env-cell-residents",
		),
		objects: present.flatMap((artifact) => artifact.objects),
		geometry,
		instanceStreams,
		textureRequirements: mergeAssetTextureFacts(
			present.flatMap((artifact) => artifact.textureRequirements),
			"EnvCell",
		),
		geometryDiagnostics: mergeGeometryDiagnostics(present),
	};
}

function deduplicateResidentGeometry(
	sources: readonly StaticObjectLayerArtifact["geometry"][number][],
): readonly StaticObjectLayerArtifact["geometry"][number][] {
	const unique = new Map<
		StaticObjectLayerArtifact["geometry"][number]["key"],
		StaticObjectLayerArtifact["geometry"][number]
	>();
	for (const source of sources) {
		const existing = unique.get(source.key);
		if (existing && !sameGeometry(existing.geometry, source.geometry)) {
			throw new Error(
				`EnvCell resident geometry ${source.key} has divergent buffers.`,
			);
		}
		if (!existing) unique.set(source.key, source);
	}
	return [...unique.values()];
}

function sameGeometry(
	left: StaticObjectLayerArtifact["geometry"][number]["geometry"],
	right: StaticObjectLayerArtifact["geometry"][number]["geometry"],
): boolean {
	if (left.kind !== right.kind) return false;
	if (!sameNumbers(left.positions, right.positions)) return false;
	if (!sameNumbers(left.indices, right.indices)) return false;
	if (left.kind === "portal-aperture" || right.kind === "portal-aperture") {
		return left.kind === right.kind;
	}
	return (
		sameNumbers(left.normals, right.normals) &&
		sameNumbers(left.textureCoordinates, right.textureCoordinates)
	);
}

function sameNumbers(
	left: ArrayLike<number>,
	right: ArrayLike<number>,
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function mergeGeometryDiagnostics(
	artifacts: readonly (StaticObjectLayerArtifact | null)[],
): StaticObjectGeometryDiagnostics {
	const diagnostics = artifacts.flatMap((artifact) =>
		artifact ? [artifact.geometryDiagnostics] : [],
	);
	const sum = (select: (entry: StaticObjectGeometryDiagnostics) => number) =>
		diagnostics.reduce((total, entry) => total + select(entry), 0);
	const strategies = new Set(diagnostics.map(({ strategy }) => strategy));
	return {
		bakedFallbackRangeCount: sum((entry) => entry.bakedFallbackRangeCount),
		bakedGeometryBytes: sum((entry) => entry.bakedGeometryBytes),
		geometryWorkerDurationMs: sum((entry) => entry.geometryWorkerDurationMs),
		instancedGeometryBytes: sum((entry) => entry.instancedGeometryBytes),
		staticFragmentBytes: sum((entry) => entry.staticFragmentBytes),
		staticFragmentCohortCount: sum((entry) => entry.staticFragmentCohortCount),
		staticFragmentCount: sum((entry) => entry.staticFragmentCount),
		staticFragmentDrawUnitCount: sum(
			(entry) => entry.staticFragmentDrawUnitCount,
		),
		staticFragmentInstanceCount: sum(
			(entry) => entry.staticFragmentInstanceCount,
		),
		sourceMaterialSlotCount: sum((entry) => entry.sourceMaterialSlotCount),
		sourcePartCount: sum((entry) => entry.sourcePartCount),
		sourceRangeCount: sum((entry) => entry.sourceRangeCount),
		sourceResidentCount: sum((entry) => entry.sourceResidentCount),
		strategy:
			diagnostics.length === 0
				? "empty"
				: strategies.size === 1
					? diagnostics[0]!.strategy
					: "mixed",
		transparentTemplateBytes: sum((entry) => entry.transparentTemplateBytes),
		transparentTemplateCohortCount: sum(
			(entry) => entry.transparentTemplateCohortCount,
		),
		transparentTemplateInstanceCount: sum(
			(entry) => entry.transparentTemplateInstanceCount,
		),
	};
}
