import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeActiveRegionSource } from "../src/lib/assets/active-region-source";
import { decodeEnvCellRecord } from "../src/lib/assets/decode-env-cell-record";
import { decodeLandblockSourceBatch } from "../src/lib/assets/decode-landblock-source-batch";
import { decodeParticleEmitterRecord } from "../src/lib/assets/decode-particle-emitter-record";
import { decodePhysicsScriptRecord } from "../src/lib/assets/decode-physics-script-record";
import {
	acRotationFromRenderTransform,
	sceneVector3,
	type SceneVector3,
} from "../src/lib/assets/ac-frame";
import {
	behaviorTargetId,
	BehaviorEventRouter,
	type BehaviorTarget,
} from "../src/lib/game/behavior/behavior-event-router";
import { ParticleEmitterRepository } from "../src/lib/game/behavior/particle-emitter-repository";
import { PhysicsScriptRepository } from "../src/lib/game/behavior/physics-script-repository";
import type { DatAssetId, LandblockId } from "../src/lib/game/game-types";
import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../src/lib/game/landblocks";
import { createCameraRotationRadians } from "../src/lib/game/math/camera-orientation";
import {
	createPerspectiveMat4,
	createViewMat4,
	multiplyMat4,
	transformPoint3,
} from "../src/lib/game/math/matrices";
import { Vec3 } from "../src/lib/game/math/types";
import { planEnvCellMaterialization } from "../src/lib/game/commit/env-cell-materialization";
import { assembleStaticObjectArtifact } from "../src/lib/game/commit/static-object-artifact";
import { prepareStaticObjectGeometry } from "../src/lib/game/commit/static-object-geometry-worker";
import { collectStaticObjectTextureDependencies } from "../src/lib/game/commit/static-object-texture-inputs";
import type {
	EnvCellLayerArtifact,
	StaticObjectLayerArtifact,
} from "../src/lib/game/commit/artifacts";
import { createEnvCellEnvironmentArtifact } from "../src/lib/game/runtime/env-cell-realization";
import { LandblockLayerKind } from "../src/lib/game/runtime/scene-interest";
import {
	landblockLayerToOwnerId,
	staticRevisionToInstallNamespace,
} from "../src/lib/game/runtime/owner-ids";
import type {
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyView,
} from "../src/lib/game/scene";
import { SceneGraph } from "../src/lib/game/scene";
import { scopeKey } from "../src/lib/game/scene/scope";
import { scopeFor } from "../src/lib/game/scene/scope";
import { createSceneNodeId, sceneNodeIdOf } from "../src/lib/game/scene/utils";
import type { AuthoredDynamicSource } from "../src/lib/game/resolution/landblock-layer";
import { createCameraNearClipVolume } from "../src/lib/game/renderer/portal-near-plane";
import {
	PortalPathViewPlanner,
	type PortalPathViewPlanInput,
} from "../src/lib/game/renderer/portal-path-view-planner";
import {
	PortalRenderGraphPlanner,
	type PortalRenderGraphPlanInput,
} from "../src/lib/game/renderer/portal-render-graph";
import { PORTAL_RENDER_CAPACITY_POLICY } from "../src/lib/game/renderer/portal-render-capacity-policy";
import {
	PortalScopeAtlasPlanner,
	type PortalScopeAtlasFrameView,
	type PortalScopeAtlasResource,
} from "../src/lib/game/renderer/portal-scope-atlas-planner";
import type { PortalScopeWindowCullInput } from "../src/lib/game/renderer/portal-scope-window-culler";
import { portalScopeAtlasTargetByteLength } from "../src/lib/game/renderer/webgl2-portal-scope-atlas-targets";
import {
	createPortalArrivalStateDryScheduleTrace,
	createCurrentPortalDryScheduleTrace,
	createPortalPathViewDrySchedule,
	type PortalDryDeferredSubmission,
	type PortalDryOpaqueBatch,
	type PortalDryParticleSource,
	type PortalDrySceneWorkload,
} from "../src/lib/game/renderer/portal-path-view-schedule";
import { ParticleSystem } from "../src/lib/game/systems/particle-system";
import { PhysicsScriptSystem } from "../src/lib/game/systems/physics-script-system";

const CAMERA = Object.freeze({ far: 10_000, fov: 70, near: 0.1 });
const DEFAULT_DRAWING_BUFFER = Object.freeze({ height: 1_080, width: 1_920 });
const PARTICLE_TRACE_TIME_SECONDS = 1;
/** Largest relative atlas dimension evaluated by the offline fixed-capacity policy search. */
const MAXIMUM_ATLAS_POLICY_MULTIPLIER = 4;
/** Logical no-cutoff capacity used to isolate atlas extent from arrival-id experiments. */
const GUARANTEED_ARRIVAL_STATE_CAPACITY = 0xffff_ffff;
/** Logical no-cutoff capacity used to isolate atlas extent from triangle-stream experiments. */
const GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY = 0xffff_ffff;

interface TraceDrawingBuffer {
	readonly height: number;
	readonly width: number;
}

/** JSON payload emitted by the narrow Rust archive adapter. */
interface ArchiveTraceRecord {
	/** Canonical HBEC source record encoded as lowercase hex. */
	readonly envCellRecordHex: string;
	/** Landblock from which the record was loaded. */
	readonly landblockId: LandblockId;
	/** Closed all-layer source batch used by the dry scheduler. */
	readonly sourceBatchHex: string;
}

/** Complete Rust adapter response shared across requested landblocks. */
interface ArchiveTraceExport {
	/** Canonical active-region response needed by production source decoders. */
	readonly activeRegionHex: string;
	/** Per-landblock topology and workload records. */
	readonly records: readonly ArchiveTraceRecord[];
}

/** One typed behavior asset emitted by the Rust closure adapter. */
interface ArchiveBehaviorRecord {
	readonly id: DatAssetId;
	readonly recordHex: string;
}

/** Transitive physics-script and particle-emitter closure for selected dynamic residents. */
interface ArchiveBehaviorExport {
	readonly particleEmitters: readonly ArchiveBehaviorRecord[];
	readonly physicsScripts: readonly ArchiveBehaviorRecord[];
}

/** Renderer-independent archive census emitted by the Rust content adapter. */
interface ArchivePortalCensusExport {
	readonly failures: readonly {
		readonly detail: string;
		readonly landblockId: LandblockId;
	}[];
	readonly landblocks: readonly ArchivePortalCensusLandblock[];
}

/** One landblock's structural topology dimensions before camera projection. */
interface ArchivePortalCensusLandblock {
	readonly directedPortalCount: number;
	readonly envCellCount: number;
	readonly environmentCount: number;
	readonly internalPortalCount: number;
	readonly landblockId: LandblockId;
	readonly maximumIndoorDistanceFromOutside: number;
	readonly maximumOutgoingPortalCount: number;
	readonly maximumSourceApertureVertexCount: number;
	readonly outsidePortalCount: number;
	readonly outsideTransitionCellCount: number;
	readonly seenOutsideCellCount: number;
	readonly sourceApertureTriangleCount: number;
	readonly sourceApertureVertexCount: number;
	readonly unreachableFromOutsideCellCount: number;
}

/** Exact order statistics retained without assigning guessed CPU weights. */
interface NumericTraceDistribution {
	readonly maximum: number;
	readonly median: number;
	readonly minimum: number;
	readonly p90: number;
	readonly p95: number;
	readonly p99: number;
	readonly p999: number;
}

/** One deterministic archive workload selected because it exercises a named risk dimension. */
interface ArchivePortalRiskSelection {
	readonly landblockId: LandblockId;
	readonly reason: string;
	readonly value: number;
}

type ArchivePortalCensusDimension =
	| "directedPortalCount"
	| "envCellCount"
	| "maximumIndoorDistanceFromOutside"
	| "maximumOutgoingPortalCount"
	| "maximumSourceApertureVertexCount"
	| "outsidePortalCount"
	| "sourceApertureVertexCount";

/** Compact reproducible census report used to choose exact camera-trace workloads. */
interface ArchivePortalCensusReport {
	readonly distributions: Readonly<
		Record<ArchivePortalCensusDimension, NumericTraceDistribution>
	>;
	readonly failureCount: number;
	readonly kind: "holtburger-portal-archive-census";
	readonly landblockCount: number;
	readonly riskSelections: readonly ArchivePortalRiskSelection[];
}

/** One deterministic camera/root-scope input shared by both compared planners. */
interface TracePose {
	/** Landblock defining the render anchor for this camera. */
	readonly anchorLandblockId: LandblockId;
	/** Stable diagnostic identity including the topology stratum. */
	readonly id: string;
	/** Camera position in anchor-relative coordinates. */
	readonly position: Vec3;
	/** Authoritative scope on this side of the sampled portal plane. */
	readonly rootScope: SceneScope;
	/** Camera yaw in renderer convention. */
	readonly yaw: number;
	/** Camera pitch in renderer convention. */
	readonly pitch: number;
}

/** Browser-free trace output; every count is deterministic and unweighted. */
interface PortalWorkTraceReport {
	/** Canonical schema identity for disposable reports. */
	readonly kind: "holtburger-portal-work-trace";
	/** Real archive landblocks contributing resident topology. */
	readonly landblockIds: readonly LandblockId[];
	/** Deterministic live authored-particle population supplied to every dry schedule. */
	readonly particles: ArchiveParticleTrace;
	/** Per-pose matched current/candidate traces. */
	readonly poses: readonly ReturnType<typeof tracePose>[];
	/** Structural source distribution independent from camera placement. */
	readonly topology: {
		readonly apertureIndexCount: number;
		readonly apertureVertexCount: number;
		readonly crossingCount: number;
		readonly maximumOutgoingCrossingCount: number;
		readonly scopeCount: number;
	};
}

/** One fixed atlas extent expressed relative to the drawing buffer. */
interface AtlasCapacityPolicy {
	readonly columnCount: number;
	readonly id: string;
	readonly rowCount: number;
}

/** Browser-free fixed-atlas evidence from the production arena culler and shelf packer. */
interface PortalAtlasCapacityTraceReport {
	readonly drawingBuffer: TraceDrawingBuffer;
	readonly kind: "holtburger-portal-atlas-capacity-trace";
	readonly landblockIds: readonly LandblockId[];
	readonly policies: readonly ReturnType<typeof summarizeAtlasPolicy>[];
	readonly poses: readonly ReturnType<typeof traceAtlasCapacityPose>[];
	/** Production extent and arrival-id policy evaluated beside the extent-only grid. */
	readonly selectedPolicy: ReturnType<typeof summarizeSelectedAtlasPolicy>;
	/** Smallest candidate preserving every baseline pose, or null when the grid is insufficient. */
	readonly smallestFullyPreservingPolicyId: string | null;
	readonly topology: ReturnType<typeof topologyDistribution>;
}

/** Exact CPU artifacts prepared from the same decoded real source records as production. */
interface ArchiveContentArtifacts {
	/** Authored dynamic residents whose scripts can create the live particle workload. */
	readonly dynamics: readonly AuthoredDynamicSource[];
	/** Environment shells paired with their published scope topology. */
	readonly environments: readonly EnvCellLayerArtifact[];
	/** Fixed-time production cohorts reduced to dry-scheduler facts by physical scope. */
	readonly particles: readonly ArchiveScopedParticleWorkload[];
	/** Prepared outdoor and interior-resident static draw artifacts. */
	readonly statics: readonly StaticObjectLayerArtifact[];
	/** Terrain sources represented as one resolved draw domain per resident landblock. */
	readonly terrainLandblockIds: readonly LandblockId[];
}

/** One exact production cohort assigned to its owning authored scene scope. */
interface ArchiveScopedParticleWorkload extends PortalDryParticleSource {
	readonly scopeKey: string;
}

/** Fixed-state particle facts proving packing/upload multiplicity without rendering. */
interface ArchiveParticleTrace {
	readonly cohortCount: number;
	readonly dynamicResidentCount: number;
	readonly instanceCount: number;
	readonly simulationTimeSeconds: number;
}

const options = parseArguments(process.argv.slice(2));
if (options.kind === "census") {
	const appDirectory = fileURLToPath(new URL("..", import.meta.url));
	const census = runArchiveCensusAdapter(appDirectory);
	process.stdout.write(
		`${JSON.stringify(createCensusReport(census), null, 2)}\n`,
	);
	process.exit(0);
}
const archive = await loadArchiveArtifacts(
	options.landblockIds,
	options.archiveRecordsPath,
);
const graph = new SceneGraph();
for (const artifact of archive.artifacts) {
	for (const scope of artifact.scopes) graph.upsertEnvCellScope(scope);
	for (const crossing of artifact.crossings)
		graph.upsertPortalCrossing(crossing);
}
const topology = graph.getPortalTopologyView();
const poses = createTracePoses(topology, archive.artifacts)
	.sort((left, right) => left.id.localeCompare(right.id))
	.slice(0, options.maximumPoseCount);
if (poses.length === 0) {
	throw new Error(
		"Portal trace workload produced no deterministic camera poses.",
	);
}
if (options.mode === "atlas-capacity") {
	const atlasPlanner = new PortalScopeAtlasPlanner(
		PORTAL_RENDER_CAPACITY_POLICY.culler,
	);
	const atlasCapacityPolicies = createAtlasCapacityPolicies(
		options.drawingBuffer,
	);
	const tracedPoses = poses.map((pose) =>
		traceAtlasCapacityPose(
			topology,
			pose,
			atlasPlanner,
			options.drawingBuffer,
			atlasCapacityPolicies,
		),
	);
	const policies = atlasCapacityPolicies.map((policy) =>
		summarizeAtlasPolicy(policy, tracedPoses),
	);
	const smallestFullyPreservingPolicy = policies.find(
		({ baselinePreservationCount }) =>
			baselinePreservationCount === tracedPoses.length,
	);
	const report: PortalAtlasCapacityTraceReport = {
		drawingBuffer: options.drawingBuffer,
		kind: "holtburger-portal-atlas-capacity-trace",
		landblockIds: options.landblockIds,
		policies,
		poses: tracedPoses,
		selectedPolicy: summarizeSelectedAtlasPolicy(tracedPoses),
		smallestFullyPreservingPolicyId: smallestFullyPreservingPolicy
			? smallestFullyPreservingPolicy.id
			: null,
		topology: topologyDistribution(topology),
	};
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	process.exit(0);
}
const currentPlanner = new PortalRenderGraphPlanner();
const candidatePlanner = new PortalPathViewPlanner();
const report: PortalWorkTraceReport = {
	kind: "holtburger-portal-work-trace",
	landblockIds: options.landblockIds,
	particles: particleTrace(archive.content),
	poses: poses.map((pose) =>
		tracePose(
			topology,
			pose,
			archive.content,
			currentPlanner,
			candidatePlanner,
			options.drawingBuffer,
		),
	),
	topology: topologyDistribution(topology),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function parseArguments(arguments_: readonly string[]):
	| {
			readonly archiveRecordsPath: string | null;
			readonly drawingBuffer: TraceDrawingBuffer;
			readonly kind: "workload";
			readonly landblockIds: readonly LandblockId[];
			readonly maximumPoseCount: number;
			readonly mode: "atlas-capacity" | "workload";
	  }
	| { readonly kind: "census" } {
	if (arguments_.length === 1 && arguments_[0] === "--census") {
		return { kind: "census" };
	}
	const landblockIds: LandblockId[] = [];
	let archiveRecordsPath: string | null = null;
	let drawingBuffer: TraceDrawingBuffer = DEFAULT_DRAWING_BUFFER;
	let mode: "atlas-capacity" | "workload" = "workload";
	let maximumPoseCount = 128;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		if (argument === "--atlas-capacity") {
			mode = "atlas-capacity";
			continue;
		}
		if (argument === "--drawing-buffer") {
			const raw = arguments_[index + 1];
			if (!raw) throw new Error("--drawing-buffer requires WIDTHxHEIGHT.");
			drawingBuffer = parseDrawingBuffer(raw);
			index += 1;
			continue;
		}
		if (argument === "--max-poses") {
			const raw = arguments_[index + 1];
			if (!raw) throw new Error("--max-poses requires a positive integer.");
			maximumPoseCount = Number(raw);
			index += 1;
			continue;
		}
		if (argument === "--archive-records") {
			archiveRecordsPath = arguments_[index + 1] ?? null;
			if (!archiveRecordsPath) {
				throw new Error("--archive-records requires a JSON file path.");
			}
			index += 1;
			continue;
		}
		if (!/^0x[0-9a-f]{4}ffff$/i.test(argument)) {
			throw new Error(`Invalid outdoor landblock id ${argument}.`);
		}
		landblockIds.push(argument.toLowerCase() as LandblockId);
	}
	if (landblockIds.length === 0) {
		throw new Error(
			"usage: npm run trace:portals -- <landblock-id> [landblock-id ...] [--max-poses N] [--atlas-capacity] [--drawing-buffer WIDTHxHEIGHT]",
		);
	}
	if (!Number.isSafeInteger(maximumPoseCount) || maximumPoseCount <= 0) {
		throw new Error("--max-poses must be a positive integer.");
	}
	return {
		archiveRecordsPath,
		drawingBuffer,
		kind: "workload",
		landblockIds: Object.freeze([...new Set(landblockIds)].sort()),
		maximumPoseCount,
		mode,
	};
}

function parseDrawingBuffer(raw: string): TraceDrawingBuffer {
	const match = /^(\d+)x(\d+)$/.exec(raw);
	if (!match) throw new Error("--drawing-buffer requires WIDTHxHEIGHT.");
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (
		!Number.isSafeInteger(width) ||
		width <= 0 ||
		!Number.isSafeInteger(height) ||
		height <= 0
	) {
		throw new Error("--drawing-buffer dimensions must be positive integers.");
	}
	return Object.freeze({ height, width });
}

async function loadArchiveArtifacts(
	landblockIds: readonly LandblockId[],
	archiveRecordsPath: string | null,
) {
	const appDirectory = fileURLToPath(new URL("..", import.meta.url));
	const archive = archiveRecordsPath
		? (JSON.parse(
				readFileSync(archiveRecordsPath, "utf8"),
			) as ArchiveTraceExport)
		: runArchiveAdapter(appDirectory, landblockIds);
	const records = archive.records;
	const expected = new Set(landblockIds);
	if (
		records.length !== expected.size ||
		records.some(({ landblockId }) => !expected.has(landblockId))
	) {
		throw new Error(
			"Portal archive records do not match the requested landblocks.",
		);
	}
	const activeRegion = decodeActiveRegionSource(
		Uint8Array.from(Buffer.from(archive.activeRegionHex, "hex")),
	);
	const requestedLayers = new Set([
		LandblockLayerKind.Terrain,
		LandblockLayerKind.Buildings,
		LandblockLayerKind.Objects,
		LandblockLayerKind.Generated,
		LandblockLayerKind.EnvCells,
	]);
	const sources = records.map((record) =>
		decodeLandblockSourceBatch(
			Uint8Array.from(Buffer.from(record.sourceBatchHex, "hex")),
			record.landblockId,
			requestedLayers,
			activeRegion,
		),
	);
	const environments = records.flatMap((record) => {
		const source = decodeEnvCellRecord(
			Uint8Array.from(Buffer.from(record.envCellRecordHex, "hex")),
			record.landblockId,
		);
		if (!source) return [];
		return [
			createEnvCellEnvironmentArtifact(planEnvCellMaterialization(source)),
		];
	});
	const preparedContent = prepareArchiveContentArtifacts(sources, environments);
	const rootScriptIds = [
		...new Set(
			preparedContent.dynamics.flatMap(({ behavior }) =>
				behavior.physicsScriptId === null ? [] : [behavior.physicsScriptId],
			),
		),
	].sort();
	const behavior =
		rootScriptIds.length === 0
			? { particleEmitters: [], physicsScripts: [] }
			: runArchiveBehaviorAdapter(appDirectory, rootScriptIds);
	const particles = await createArchiveParticleWorkload(
		preparedContent.dynamics,
		behavior,
	);
	return {
		artifacts: environments,
		content: { ...preparedContent, particles },
	};
}

function prepareArchiveContentArtifacts(
	sources: readonly ReturnType<typeof decodeLandblockSourceBatch>[],
	environments: readonly EnvCellLayerArtifact[],
): ArchiveContentArtifacts {
	const dynamics: AuthoredDynamicSource[] = [];
	const statics: StaticObjectLayerArtifact[] = [];
	const terrainLandblockIds: LandblockId[] = [];
	for (const batch of sources) {
		if (batch.records.get(LandblockLayerKind.Terrain) !== null) {
			terrainLandblockIds.push(batch.landblockId);
		}
		for (const layer of [
			LandblockLayerKind.Buildings,
			LandblockLayerKind.Objects,
			LandblockLayerKind.Generated,
		] as const) {
			const source = batch.records.get(layer);
			if (!source) continue;
			if (source.kind !== layer) {
				throw new Error(
					`Portal trace source ${source.kind} does not match ${layer}.`,
				);
			}
			dynamics.push(...source.dynamicSources);
			const artifact = prepareStaticArtifact(source, layer);
			if (artifact) statics.push(artifact);
		}
		const envSource = batch.records.get(LandblockLayerKind.EnvCells);
		if (!envSource) continue;
		if (envSource.kind !== LandblockLayerKind.EnvCells) {
			throw new Error("Portal trace EnvCell source has the wrong layer kind.");
		}
		const materialization = planEnvCellMaterialization(envSource);
		for (const job of materialization.residentJobs) {
			dynamics.push(...job.source.dynamicSources);
			const artifact = prepareStaticArtifact(
				job.source,
				LandblockLayerKind.EnvCells,
				job.textureRequirements,
				`cell-${job.source.envCellId}`,
			);
			if (artifact) statics.push(artifact);
		}
	}
	return {
		dynamics,
		environments,
		particles: [],
		statics,
		terrainLandblockIds,
	};
}

function prepareStaticArtifact(
	source: Parameters<typeof collectStaticObjectTextureDependencies>[0],
	layer: Parameters<typeof landblockLayerToOwnerId>[1],
	textureRequirements = collectStaticObjectTextureDependencies(source),
	partition?: string,
): StaticObjectLayerArtifact | null {
	const owner = landblockLayerToOwnerId(source.landblockId, layer);
	const resourceNamespace = staticRevisionToInstallNamespace(
		owner,
		1,
		partition,
	);
	const geometry = prepareStaticObjectGeometry({
		layer: source.kind,
		resourceNamespace,
		source,
	});
	return assembleStaticObjectArtifact({
		geometry,
		resourceNamespace,
		source,
		textureRequirements,
	});
}

function runArchiveAdapter(
	appDirectory: string,
	landblockIds: readonly LandblockId[],
): ArchiveTraceExport {
	return runRustArchiveAdapter<ArchiveTraceExport>(appDirectory, landblockIds);
}

function runArchiveCensusAdapter(
	appDirectory: string,
): ArchivePortalCensusExport {
	return runRustArchiveAdapter<ArchivePortalCensusExport>(appDirectory, [
		"--census",
	]);
}

function runArchiveBehaviorAdapter(
	appDirectory: string,
	rootScriptIds: readonly DatAssetId[],
): ArchiveBehaviorExport {
	return runRustArchiveAdapter<ArchiveBehaviorExport>(appDirectory, [
		"--behavior",
		...rootScriptIds,
	]);
}

function runRustArchiveAdapter<Output>(
	appDirectory: string,
	arguments_: readonly string[],
): Output {
	const result = spawnSync(
		"cargo",
		[
			"run",
			"--quiet",
			"--manifest-path",
			"src-tauri/Cargo.toml",
			"--bin",
			"portal_trace_archive",
			"--",
			...arguments_,
		],
		{
			cwd: appDirectory,
			encoding: "utf8",
			env: {
				...process.env,
				// Package scripts run below the repository root, so content discovery cannot see
				// the portable root `dats` directory unless the caller supplied an installation.
				HOLTBURGER_DATS:
					process.env.HOLTBURGER_DATS ??
					resolve(appDirectory, "../..", "dats/assets.hba"),
			},
			maxBuffer: 256 * 1024 * 1024,
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`Portal archive adapter failed (${result.status}): ${result.stderr.trim()}`,
		);
	}
	return JSON.parse(result.stdout) as Output;
}

function createCensusReport(
	census: ArchivePortalCensusExport,
): ArchivePortalCensusReport {
	if (census.landblocks.length === 0) {
		throw new Error("Portal archive census found no LandblockInfo records.");
	}
	if (census.failures.length > 0) {
		const first = census.failures[0]!;
		throw new Error(
			`Portal archive census has ${census.failures.length} content failures; first: ${first.landblockId}: ${first.detail}`,
		);
	}
	const dimensions = [
		"directedPortalCount",
		"envCellCount",
		"maximumIndoorDistanceFromOutside",
		"maximumOutgoingPortalCount",
		"maximumSourceApertureVertexCount",
		"outsidePortalCount",
		"sourceApertureVertexCount",
	] as const;
	const distributions = Object.fromEntries(
		dimensions.map((dimension) => [
			dimension,
			distribution(census.landblocks.map((record) => record[dimension])),
		]),
	) as Record<ArchivePortalCensusDimension, NumericTraceDistribution>;
	const outdoorTransitions = census.landblocks.filter(
		({ outsidePortalCount }) => outsidePortalCount > 0,
	);
	const indoorOnly = census.landblocks.filter(
		({ outsidePortalCount }) => outsidePortalCount === 0,
	);
	const fieldRepro = census.landblocks.find(
		({ landblockId }) => landblockId === "0xda55ffff",
	);
	if (!fieldRepro) {
		throw new Error("Portal archive census lost field repro 0xda55ffff.");
	}
	const riskSelections = uniqueRiskSelections([
		selectQuantile(
			outdoorTransitions,
			"directedPortalCount",
			0.5,
			"median-outdoor-transition-density",
		),
		selectQuantile(
			outdoorTransitions,
			"directedPortalCount",
			0.95,
			"p95-outdoor-transition-density",
		),
		selectMaximum(
			outdoorTransitions,
			"maximumOutgoingPortalCount",
			"maximum-outdoor-fanout",
		),
		selectMaximum(
			census.landblocks,
			"maximumSourceApertureVertexCount",
			"maximum-source-aperture",
		),
		selectMaximum(
			outdoorTransitions,
			"maximumIndoorDistanceFromOutside",
			"maximum-outdoor-reachable-depth",
		),
		selectMaximum(
			indoorOnly,
			"directedPortalCount",
			"maximum-indoor-only-density",
		),
		{
			landblockId: fieldRepro.landblockId,
			reason: "field-repro",
			value: fieldRepro.directedPortalCount,
		},
	]);
	return Object.freeze({
		distributions: Object.freeze(distributions),
		failureCount: census.failures.length,
		kind: "holtburger-portal-archive-census",
		landblockCount: census.landblocks.length,
		riskSelections,
	});
}

function distribution(input: readonly number[]): NumericTraceDistribution {
	const values = input.toSorted((left, right) => left - right);
	const at = (quantile: number) =>
		values[Math.floor(quantile * (values.length - 1))]!;
	return Object.freeze({
		maximum: at(1),
		median: at(0.5),
		minimum: at(0),
		p90: at(0.9),
		p95: at(0.95),
		p99: at(0.99),
		p999: at(0.999),
	});
}

function selectQuantile(
	landblocks: readonly ArchivePortalCensusLandblock[],
	dimension: ArchivePortalCensusDimension,
	quantile: number,
	reason: string,
): ArchivePortalRiskSelection {
	const ordered = landblocks.toSorted(
		(left, right) =>
			left[dimension] - right[dimension] ||
			left.landblockId.localeCompare(right.landblockId),
	);
	const selected = ordered[Math.floor(quantile * (ordered.length - 1))];
	if (!selected) throw new Error(`Portal census stratum ${reason} is empty.`);
	return Object.freeze({
		landblockId: selected.landblockId,
		reason,
		value: selected[dimension],
	});
}

function selectMaximum(
	landblocks: readonly ArchivePortalCensusLandblock[],
	dimension: ArchivePortalCensusDimension,
	reason: string,
): ArchivePortalRiskSelection {
	const selected = landblocks.toSorted(
		(left, right) =>
			right[dimension] - left[dimension] ||
			left.landblockId.localeCompare(right.landblockId),
	)[0];
	if (!selected) throw new Error(`Portal census stratum ${reason} is empty.`);
	return Object.freeze({
		landblockId: selected.landblockId,
		reason,
		value: selected[dimension],
	});
}

function uniqueRiskSelections(
	selections: readonly ArchivePortalRiskSelection[],
): readonly ArchivePortalRiskSelection[] {
	const byLandblock = new Map<LandblockId, ArchivePortalRiskSelection>();
	for (const selection of selections) {
		const existing = byLandblock.get(selection.landblockId);
		byLandblock.set(
			selection.landblockId,
			existing
				? Object.freeze({
						...existing,
						reason: `${existing.reason},${selection.reason}`,
					})
				: selection,
		);
	}
	return Object.freeze(
		[...byLandblock.values()].sort((left, right) =>
			left.reason.localeCompare(right.reason),
		),
	);
}

async function createArchiveParticleWorkload(
	dynamics: readonly AuthoredDynamicSource[],
	behavior: ArchiveBehaviorExport,
): Promise<readonly ArchiveScopedParticleWorkload[]> {
	const scripts = new Map(
		behavior.physicsScripts.map((record) => [
			record.id,
			decodePhysicsScriptRecord(hexBytes(record.recordHex), record.id),
		]),
	);
	const emitters = new Map(
		behavior.particleEmitters.map((record) => [
			record.id,
			decodeParticleEmitterRecord(hexBytes(record.recordHex), record.id),
		]),
	);
	const scriptRepository = new PhysicsScriptRepository({
		destroy: () => {},
		loadPhysicsScript: async (scriptId) => {
			const script = scripts.get(scriptId);
			if (!script) {
				throw new Error(
					`Particle trace behavior closure is missing script ${scriptId}.`,
				);
			}
			return script;
		},
	});
	const emitterRepository = new ParticleEmitterRepository({
		destroy: () => {},
		loadParticleEmitter: async (emitterInfoId) => {
			const emitter = emitters.get(emitterInfoId);
			if (!emitter) {
				throw new Error(
					`Particle trace behavior closure is missing emitter ${emitterInfoId}.`,
				);
			}
			return emitter;
		},
	});
	const emitterHandles = await Promise.all(
		[...emitters.keys()].sort().map((id) => emitterRepository.acquire(id)),
	);
	const origins = new Map<string, SceneVector3>();
	const rotations = new Map<
		string,
		ReturnType<typeof acRotationFromRenderTransform>
	>();
	const partTargets = new Map<string, BehaviorTarget>();
	const scopeByTargetId = new Map<string, string>();
	const residentTargets = dynamics.map((dynamic, index) => {
		const nodeId = createSceneNodeId(index + 1);
		const target = {
			generation: 1,
			targetId: behaviorTargetId(nodeId),
		};
		const origin = dynamicSceneOrigin(dynamic);
		const rotation = acRotationFromRenderTransform(
			dynamic.placement.localTransform,
		);
		origins.set(target.targetId, origin);
		rotations.set(target.targetId, rotation);
		scopeByTargetId.set(
			target.targetId,
			scopeKey(
				scopeFor(dynamic.placement.landblockId, dynamic.placement.envCellId),
			),
		);
		for (const { partIndex } of dynamic.presentation.parts) {
			const partTarget = {
				generation: target.generation,
				targetId: behaviorTargetId(`${target.targetId}/part:${partIndex}`),
			};
			partTargets.set(`${target.targetId}\0${partIndex}`, partTarget);
			origins.set(partTarget.targetId, origin);
			rotations.set(partTarget.targetId, rotation);
		}
		return { dynamic, target };
	});
	let scriptSystem: PhysicsScriptSystem<string> | null = null;
	const particles = new ParticleSystem({
		clock: () => PARTICLE_TRACE_TIME_SECONDS,
		partFrameOf: (target, partIndex) =>
			partTargets.get(`${target.targetId}\0${partIndex}`) ?? null,
		renderAnchorOrigin: () => sceneVector3([0, 0, 0]),
		resolveEmitter: (id) => emitterRepository.getReady(id),
		roll: seededRoll(7),
		sceneOriginOf: (target) => origins.get(target.targetId) ?? null,
		sceneRotationOf: (target) => rotations.get(target.targetId) ?? null,
	});
	const router = new BehaviorEventRouter(
		{
			audio: {
				playSound: () => "unprepared",
				playSoundTableKey: () => "unprepared",
			},
			effects: {
				applyScale: () => {},
				applySetOmega: () => {},
				applyTransparentPart: () => {},
			},
			particles,
			scheduler: {
				scheduleActivation: (target, activation) => {
					if (!scriptSystem) {
						throw new Error("Particle trace script scheduler is not wired.");
					}
					scriptSystem.scheduleActivation(target, activation);
				},
			},
			targets: {
				isLive: (target) => scriptSystem?.holds(target) ?? false,
			},
		},
		1,
	);
	scriptSystem = new PhysicsScriptSystem(router, seededRoll(11));
	const closures = new Map<
		DatAssetId,
		Awaited<ReturnType<typeof scriptRepository.acquireClosure>>
	>();
	try {
		for (const { dynamic, target } of residentTargets) {
			const scriptId = dynamic.behavior.physicsScriptId;
			if (scriptId === null) continue;
			let closure = closures.get(scriptId);
			if (!closure) {
				closure = await scriptRepository.acquireClosure(scriptId);
				closures.set(scriptId, closure);
			}
			scriptSystem.install(dynamic.identity.sourceId, target, closure, 0);
		}
		scriptSystem.advance(PARTICLE_TRACE_TIME_SECONDS);
		particles.advance(PARTICLE_TRACE_TIME_SECONDS);
		return Object.freeze(
			particles
				.collectCohorts(({ targetId }) => sceneNodeIdOf(targetId))
				.map((cohort) => {
					const key = scopeByTargetId.get(cohort.renderOwner);
					if (!key) {
						throw new Error(
							`Particle cohort owner ${cohort.renderOwner} has no authored scope.`,
						);
					}
					return Object.freeze({
						batchKey: `${cohort.hwGfxObjId}\0${cohort.motionType}`,
						instanceCount: cohort.particles.length,
						scopeKey: key,
						sourceKey: `${cohort.renderOwner}\0${cohort.hwGfxObjId}\0${cohort.motionType}`,
					});
				}),
		);
	} finally {
		scriptSystem.destroy();
		for (const closure of closures.values()) closure.release();
		for (const handle of emitterHandles) handle.release();
		scriptRepository.destroy();
		emitterRepository.destroy();
	}
}

function dynamicSceneOrigin(dynamic: AuthoredDynamicSource): SceneVector3 {
	const local = transformPoint3(dynamic.placement.localTransform, Vec3.zero());
	const landblock = createLandblockWorldOrigin(dynamic.placement.landblockId);
	return sceneVector3([
		landblock.x + local.x,
		landblock.y + local.y,
		landblock.z + local.z,
	]);
}

function seededRoll(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function hexBytes(hexadecimal: string): Uint8Array {
	if (!/^(?:[0-9a-f]{2})+$/i.test(hexadecimal)) {
		throw new Error(
			"Archive behavior record is not non-empty even-length hex.",
		);
	}
	return Uint8Array.from(Buffer.from(hexadecimal, "hex"));
}

function particleTrace(content: ArchiveContentArtifacts): ArchiveParticleTrace {
	return {
		cohortCount: content.particles.length,
		dynamicResidentCount: content.dynamics.length,
		instanceCount: content.particles.reduce(
			(total, cohort) => total + cohort.instanceCount,
			0,
		),
		simulationTimeSeconds: PARTICLE_TRACE_TIME_SECONDS,
	};
}

function createTracePoses(
	topology: SceneTopologyView,
	artifacts: readonly ReturnType<typeof createEnvCellEnvironmentArtifact>[],
): TracePose[] {
	const boundsByScope = new Map(
		artifacts.flatMap((artifact) =>
			artifact.scopes.map(
				({ landblockBounds, scope }) =>
					[scopeKey(scope), landblockBounds] as const,
			),
		),
	);
	const poses: TracePose[] = [];
	for (const topologyScope of topology.scopes) {
		if (topologyScope.scope.kind !== "env-cell") continue;
		const bounds = boundsByScope.get(scopeKey(topologyScope.scope));
		if (!bounds) continue;
		const center = new Vec3(
			(bounds.min.x + bounds.max.x) * 0.5,
			(bounds.min.y + bounds.max.y) * 0.5,
			(bounds.min.z + bounds.max.z) * 0.5,
		);
		const outgoing = topology.outgoing(topologyScope.scope);
		if (outgoing.length === 0) {
			poses.push(
				poseFacing(
					`indoor-settled/${scopeKey(topologyScope.scope)}`,
					topologyScope.scope.landblockId,
					topologyScope.scope,
					center,
					new Vec3(center.x, center.y, center.z - 1),
				),
			);
			continue;
		}
		for (const crossing of outgoing) {
			poses.push(
				poseFacing(
					`indoor-settled/${crossing.id}`,
					topologyScope.scope.landblockId,
					topologyScope.scope,
					center,
					crossingFacingTarget(crossing, center),
				),
			);
		}
	}
	for (const crossing of topology.crossings) {
		const anchorLandblockId = crossing.sourceAperture.landblockId;
		const center = apertureCenter(crossing);
		const direction =
			crossing.acceptedSide === "positive"
				? crossing.sourceAperture.plane.normal
				: new Vec3(
						-crossing.sourceAperture.plane.normal.x,
						-crossing.sourceAperture.plane.normal.y,
						-crossing.sourceAperture.plane.normal.z,
					);
		for (const [sample, distance] of [
			["source-far", 2],
			["source-near", 0.05],
			["target-near", -0.05],
			["target-far", -2],
		] as const) {
			const rootScope = distance >= 0 ? crossing.source : crossing.target;
			const position = new Vec3(
				center.x + direction.x * distance,
				center.y + direction.y * distance,
				center.z + direction.z * distance,
			);
			poses.push(
				poseFacing(
					`motion/${crossing.id}/${sample}`,
					anchorLandblockId,
					rootScope,
					position,
					new Vec3(
						center.x - direction.x * 4,
						center.y - direction.y * 4,
						center.z - direction.z * 4,
					),
				),
			);
		}
	}
	return poses;
}

function crossingFacingTarget(
	crossing: ScenePortalCrossingInput,
	position: Vec3,
): Vec3 {
	const center = apertureCenter(crossing);
	if (
		Math.hypot(
			center.x - position.x,
			center.y - position.y,
			center.z - position.z,
		) > Number.EPSILON
	) {
		return center;
	}
	const normal = crossing.sourceAperture.plane.normal;
	const sourceSign = crossing.acceptedSide === "positive" ? 1 : -1;
	return new Vec3(
		position.x - normal.x * sourceSign,
		position.y - normal.y * sourceSign,
		position.z - normal.z * sourceSign,
	);
}

function poseFacing(
	id: string,
	anchorLandblockId: LandblockId,
	rootScope: SceneScope,
	position: Vec3,
	target: Vec3,
): TracePose {
	const direction = new Vec3(
		target.x - position.x,
		target.y - position.y,
		target.z - position.z,
	);
	const length = Math.hypot(direction.x, direction.y, direction.z);
	if (length <= Number.EPSILON) {
		throw new Error(`Portal trace pose ${id} has no facing direction.`);
	}
	return {
		anchorLandblockId,
		id,
		pitch: Math.asin(direction.y / length),
		position,
		rootScope,
		yaw: Math.atan2(direction.x, -direction.z),
	};
}

function apertureCenter(crossing: ScenePortalCrossingInput): Vec3 {
	const aperture = crossing.sourceAperture;
	const offset = createLandblockOffset(
		getLandblockCoordinates(aperture.landblockId),
		getLandblockCoordinates(aperture.landblockId),
	);
	let x = 0;
	let y = 0;
	let z = 0;
	const vertexCount = aperture.vertices.length / 3;
	for (let index = 0; index < aperture.vertices.length; index += 3) {
		x += aperture.vertices[index]! + offset.x;
		y += aperture.vertices[index + 1]!;
		z += aperture.vertices[index + 2]! + offset.z;
	}
	return new Vec3(x / vertexCount, y / vertexCount, z / vertexCount);
}

interface AtlasPlanSnapshot {
	readonly atlas: PortalScopeAtlasResource["atlas"];
	readonly completedDepth: number;
	readonly declinedDepth: number | null;
	readonly packing: {
		readonly atlasCapacityRetreatCount: number;
		readonly atlasPackedExtentPixelCount: number;
		readonly arrivalStateCapacityRetreatCount: number;
		readonly crossingTriangleVertexCapacityRetreatCount: number;
		readonly frontierRetreatCount: number;
		readonly packingAttemptCount: number;
		readonly tilePixelCount: number;
		readonly tilePlacementAttemptCount: number;
		readonly tileSortComparisonCount: number;
		readonly windowVertexReadCount: number;
	};
	readonly selectedCrossingIds: readonly string[];
	readonly selectedCrossingGeometry: {
		/** Largest expanded triangle-vertex contribution from one retained crossing. */
		readonly maximumTriangleVertexCount: number;
		/** Physical triangles copied once into the proposed non-indexed frame stream. */
		readonly triangleCount: number;
		/** Vertex records uploaded once and reused by every propagation round. */
		readonly triangleVertexCount: number;
	};
	readonly selectedScopeTiles: readonly {
		readonly height: number;
		readonly scopeKey: string;
		readonly width: number;
	}[];
	readonly status: "complete" | "truncated";
	readonly visibilityWork: {
		readonly projectionPrimitiveCount: number;
		readonly queueHighWaterCount: number;
		readonly windowFragmentHighWaterCount: number;
		readonly windowHighWaterCount: number;
		readonly windowVertexHighWaterCount: number;
	};
}

function createAtlasCapacityPolicies(
	drawingBuffer: TraceDrawingBuffer,
): readonly AtlasCapacityPolicy[] {
	const policies: AtlasCapacityPolicy[] = [];
	for (
		let columnCount = 1;
		columnCount <= MAXIMUM_ATLAS_POLICY_MULTIPLIER;
		columnCount += 1
	) {
		for (
			let rowCount = 1;
			rowCount <= MAXIMUM_ATLAS_POLICY_MULTIPLIER;
			rowCount += 1
		) {
			const policy = { columnCount, rowCount };
			policies.push({ ...policy, id: atlasPolicyId(policy) });
		}
	}
	policies.sort((left, right) => {
		const leftResource = atlasResource(
			left,
			drawingBuffer,
			GUARANTEED_ARRIVAL_STATE_CAPACITY,
			GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY,
		);
		const rightResource = atlasResource(
			right,
			drawingBuffer,
			GUARANTEED_ARRIVAL_STATE_CAPACITY,
			GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY,
		);
		const byteDifference =
			portalScopeAtlasTargetByteLength(leftResource) -
			portalScopeAtlasTargetByteLength(rightResource);
		if (byteDifference !== 0) return byteDifference;
		const maximumDimensionDifference =
			Math.max(leftResource.atlas.width, leftResource.atlas.height) -
			Math.max(rightResource.atlas.width, rightResource.atlas.height);
		if (maximumDimensionDifference !== 0) return maximumDimensionDifference;
		return left.id.localeCompare(right.id);
	});
	return Object.freeze(policies);
}

function atlasPolicyId(policy: {
	readonly columnCount: number;
	readonly rowCount: number;
}): string {
	return `${policy.columnCount}x${policy.rowCount}`;
}

function traceAtlasCapacityPose(
	topology: SceneTopologyView,
	pose: TracePose,
	planner: PortalScopeAtlasPlanner,
	drawingBuffer: TraceDrawingBuffer,
	policiesToTrace: readonly AtlasCapacityPolicy[],
) {
	const input = createScopeAtlasCullInput(pose, drawingBuffer);
	const guaranteedResource: PortalScopeAtlasResource = {
		atlas: {
			height: drawingBuffer.height,
			width:
				drawingBuffer.width *
				PORTAL_RENDER_CAPACITY_POLICY.maximumScopeWindowWorkItemCount,
		},
		drawingBuffer,
		maximumArrivalStateCount: GUARANTEED_ARRIVAL_STATE_CAPACITY,
		maximumCrossingTriangleVertexCount:
			GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY,
	};
	const baseline = snapshotAtlasPlan(
		planner.plan(topology, input, guaranteedResource),
		guaranteedResource,
	);
	if (
		baseline.packing.frontierRetreatCount !== 0 ||
		baseline.packing.packingAttemptCount !== 1
	) {
		throw new Error(
			`Portal atlas trace baseline ${pose.id} did not fit its guaranteed single shelf.`,
		);
	}
	const policies = policiesToTrace.map((policy) => {
		const resource = atlasResource(
			policy,
			drawingBuffer,
			GUARANTEED_ARRIVAL_STATE_CAPACITY,
			GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY,
		);
		const candidate = snapshotAtlasPlan(
			planner.plan(topology, input, resource),
			resource,
		);
		return compareAtlasPlan(pose.id, policy, baseline, candidate, resource);
	});
	const selectedPolicy = PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas;
	const selectedResource = atlasResource(
		selectedPolicy,
		drawingBuffer,
		selectedPolicy.maximumArrivalStateCount,
		selectedPolicy.maximumCrossingTriangleVertexCount,
	);
	const selected = snapshotAtlasPlan(
		planner.plan(topology, input, selectedResource),
		selectedResource,
	);
	const baselineTileWidths = baseline.selectedScopeTiles.map(
		({ width }) => width,
	);
	const baselineTileHeights = baseline.selectedScopeTiles.map(
		({ height }) => height,
	);
	return {
		baseline: {
			...publicAtlasPlan(baseline),
			selectedScopeTiles: baseline.selectedScopeTiles,
			singleShelfExtent: {
				height: baselineTileHeights.reduce(
					(maximum, height) => Math.max(maximum, height),
					0,
				),
				width: baselineTileWidths.reduce((total, width) => total + width, 0),
			},
		},
		id: pose.id,
		policies,
		rootScope: scopeKey(pose.rootScope),
		selectedPolicy: compareAtlasPlan(
			pose.id,
			selectedPolicy,
			baseline,
			selected,
			selectedResource,
		),
	};
}

function compareAtlasPlan(
	poseId: string,
	policy: { readonly columnCount: number; readonly rowCount: number },
	baseline: AtlasPlanSnapshot,
	candidate: AtlasPlanSnapshot,
	resource: PortalScopeAtlasResource,
) {
	const id = atlasPolicyId(policy);
	if (
		candidate.completedDepth > baseline.completedDepth ||
		candidate.selectedCrossingIds.length >
			baseline.selectedCrossingIds.length ||
		candidate.selectedScopeTiles.length > baseline.selectedScopeTiles.length
	) {
		throw new Error(
			`Portal atlas policy ${id} expanded the guaranteed baseline for ${poseId}.`,
		);
	}
	return {
		...publicAtlasPlan(candidate),
		baselinePreserved: sameAtlasSelection(baseline, candidate),
		columnCount: policy.columnCount,
		completedDepthLoss: Math.max(
			0,
			baseline.completedDepth - candidate.completedDepth,
		),
		id,
		rowCount: policy.rowCount,
		selectedCrossingLoss:
			baseline.selectedCrossingIds.length -
			candidate.selectedCrossingIds.length,
		selectedScopeLoss:
			baseline.selectedScopeTiles.length - candidate.selectedScopeTiles.length,
		targetBytes: portalScopeAtlasTargetByteLength(resource),
	};
}

function createScopeAtlasCullInput(
	pose: TracePose,
	drawingBuffer: TraceDrawingBuffer,
): PortalScopeWindowCullInput {
	const common = createTraceCameraProjection(pose, drawingBuffer);
	return {
		...common,
		portalFootprint: { drawingBuffer, minimumPixelArea: 0 },
	};
}

function createTraceCameraProjection(
	pose: TracePose,
	drawingBuffer: TraceDrawingBuffer,
) {
	const rotation = createCameraRotationRadians(pose.yaw, pose.pitch);
	const projection = createPerspectiveMat4(
		CAMERA.fov,
		drawingBuffer.width / drawingBuffer.height,
		CAMERA.near,
		CAMERA.far,
	);
	return {
		anchorCoordinates: getLandblockCoordinates(pose.anchorLandblockId),
		clipFromAnchor: multiplyMat4(
			projection,
			createViewMat4(pose.position, rotation),
		),
		nearClipVolume: createCameraNearClipVolume(
			CAMERA,
			{ position: pose.position, rotation },
			drawingBuffer.width / drawingBuffer.height,
		),
		rootScope: pose.rootScope,
	};
}

function snapshotAtlasPlan(
	frame: PortalScopeAtlasFrameView,
	resource: PortalScopeAtlasResource,
): AtlasPlanSnapshot {
	const selectedScopeTiles = Array.from(
		{ length: frame.visibility.selectedScopeCount },
		(_, ordinal) => ({
			height: frame.tileHeight(ordinal),
			scopeKey: scopeKey(frame.visibility.selectedScope(ordinal)),
			width: frame.tileWidth(ordinal),
		}),
	);
	const selectedCrossingIds: string[] = [];
	let maximumTriangleVertexCount = 0;
	let triangleVertexCount = 0;
	for (
		let ordinal = 0;
		ordinal < frame.visibility.selectedCrossingCount;
		ordinal += 1
	) {
		const crossing = frame.visibility.selectedCrossing(ordinal);
		const crossingTriangleVertexCount =
			crossing.visibilityAperture.indices.length;
		if (crossingTriangleVertexCount % 3 !== 0) {
			throw new Error(
				`Portal crossing ${crossing.id} has a non-triangular visibility aperture.`,
			);
		}
		selectedCrossingIds.push(crossing.id);
		maximumTriangleVertexCount = Math.max(
			maximumTriangleVertexCount,
			crossingTriangleVertexCount,
		);
		triangleVertexCount += crossingTriangleVertexCount;
	}
	return {
		atlas: { ...resource.atlas },
		completedDepth: frame.visibility.completedDepth,
		declinedDepth: frame.visibility.declinedDepth,
		packing: {
			atlasCapacityRetreatCount: frame.trace.atlasCapacityRetreatCount,
			atlasPackedExtentPixelCount: frame.trace.atlasPackedExtentPixelCount,
			arrivalStateCapacityRetreatCount:
				frame.trace.arrivalStateCapacityRetreatCount,
			crossingTriangleVertexCapacityRetreatCount:
				frame.trace.crossingTriangleVertexCapacityRetreatCount,
			frontierRetreatCount: frame.trace.frontierRetreatCount,
			packingAttemptCount: frame.trace.packingAttemptCount,
			tilePixelCount: frame.trace.tilePixelCount,
			tilePlacementAttemptCount: frame.trace.tilePlacementAttemptCount,
			tileSortComparisonCount: frame.trace.tileSortComparisonCount,
			windowVertexReadCount: frame.trace.windowVertexReadCount,
		},
		selectedCrossingIds,
		selectedCrossingGeometry: {
			maximumTriangleVertexCount,
			triangleCount: triangleVertexCount / 3,
			triangleVertexCount,
		},
		selectedScopeTiles,
		status: frame.visibility.status,
		visibilityWork: {
			projectionPrimitiveCount: frame.visibility.trace.projectionPrimitiveCount,
			queueHighWaterCount: frame.visibility.trace.queueHighWaterCount,
			windowFragmentHighWaterCount:
				frame.visibility.trace.windowFragmentHighWaterCount,
			windowHighWaterCount: frame.visibility.trace.windowHighWaterCount,
			windowVertexHighWaterCount:
				frame.visibility.trace.windowVertexHighWaterCount,
		},
	};
}

function publicAtlasPlan(snapshot: AtlasPlanSnapshot) {
	const atlasPixelCapacity = snapshot.atlas.width * snapshot.atlas.height;
	return {
		atlas: snapshot.atlas,
		atlasPixelCapacity,
		atlasUtilization: snapshot.packing.tilePixelCount / atlasPixelCapacity,
		completedDepth: snapshot.completedDepth,
		declinedDepth: snapshot.declinedDepth,
		packedExtentUtilization:
			snapshot.packing.tilePixelCount /
			snapshot.packing.atlasPackedExtentPixelCount,
		packing: snapshot.packing,
		selectedCrossingCount: snapshot.selectedCrossingIds.length,
		selectedCrossingGeometry: snapshot.selectedCrossingGeometry,
		selectedScopeCount: snapshot.selectedScopeTiles.length,
		status: snapshot.status,
		visibilityWork: snapshot.visibilityWork,
	};
}

function sameAtlasSelection(
	baseline: AtlasPlanSnapshot,
	candidate: AtlasPlanSnapshot,
): boolean {
	return (
		baseline.status === candidate.status &&
		baseline.completedDepth === candidate.completedDepth &&
		baseline.declinedDepth === candidate.declinedDepth &&
		sameStrings(baseline.selectedCrossingIds, candidate.selectedCrossingIds) &&
		baseline.selectedScopeTiles.length ===
			candidate.selectedScopeTiles.length &&
		baseline.selectedScopeTiles.every((tile, ordinal) => {
			const other = candidate.selectedScopeTiles[ordinal];
			return (
				other !== undefined &&
				tile.scopeKey === other.scopeKey &&
				tile.width === other.width &&
				tile.height === other.height
			);
		})
	);
}

function sameStrings(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function atlasResource(
	policy: { readonly columnCount: number; readonly rowCount: number },
	drawingBuffer: TraceDrawingBuffer,
	maximumArrivalStateCount: number,
	maximumCrossingTriangleVertexCount: number,
): PortalScopeAtlasResource {
	return {
		atlas: {
			height: drawingBuffer.height * policy.rowCount,
			width: drawingBuffer.width * policy.columnCount,
		},
		drawingBuffer,
		maximumArrivalStateCount,
		maximumCrossingTriangleVertexCount,
	};
}

function summarizeAtlasPolicy(
	policy: AtlasCapacityPolicy,
	poses: readonly ReturnType<typeof traceAtlasCapacityPose>[],
) {
	const traces = poses.map((pose) => {
		const trace = pose.policies.find(({ id }) => id === policy.id);
		if (!trace) {
			throw new Error(
				`Portal atlas trace pose ${pose.id} omitted policy ${policy.id}.`,
			);
		}
		return trace;
	});
	return summarizeAtlasTraces(policy, traces);
}

function summarizeSelectedAtlasPolicy(
	poses: readonly ReturnType<typeof traceAtlasCapacityPose>[],
) {
	return summarizeAtlasTraces(
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas,
		poses.map(({ selectedPolicy }) => selectedPolicy),
	);
}

function summarizeAtlasTraces(
	policy: { readonly columnCount: number; readonly rowCount: number },
	traces: readonly ReturnType<typeof compareAtlasPlan>[],
) {
	const id = atlasPolicyId(policy);
	const first = traces[0];
	if (!first) {
		throw new Error(`Portal atlas policy ${id} has no pose traces.`);
	}
	return {
		atlas: first.atlas,
		atlasPixelCapacity: first.atlasPixelCapacity,
		atlasUtilization: distribution(
			traces.map(({ atlasUtilization }) => atlasUtilization),
		),
		baselinePreservationCount: traces.filter(
			({ baselinePreserved }) => baselinePreserved,
		).length,
		columnCount: policy.columnCount,
		completedDepthLoss: distribution(
			traces.map(({ completedDepthLoss }) => completedDepthLoss),
		),
		frontierRetreatCount: distribution(
			traces.map(({ packing }) => packing.frontierRetreatCount),
		),
		atlasCapacityRetreatCount: distribution(
			traces.map(({ packing }) => packing.atlasCapacityRetreatCount),
		),
		arrivalStateCapacityRetreatCount: distribution(
			traces.map(({ packing }) => packing.arrivalStateCapacityRetreatCount),
		),
		crossingTriangleVertexCapacityRetreatCount: distribution(
			traces.map(
				({ packing }) => packing.crossingTriangleVertexCapacityRetreatCount,
			),
		),
		id,
		packedExtentUtilization: distribution(
			traces.map(({ packedExtentUtilization }) => packedExtentUtilization),
		),
		maximumCrossingTriangleVertexCount: distribution(
			traces.map(
				({ selectedCrossingGeometry }) =>
					selectedCrossingGeometry.maximumTriangleVertexCount,
			),
		),
		packingAttemptCount: distribution(
			traces.map(({ packing }) => packing.packingAttemptCount),
		),
		poseCount: traces.length,
		rowCount: policy.rowCount,
		selectedCrossingLoss: distribution(
			traces.map(({ selectedCrossingLoss }) => selectedCrossingLoss),
		),
		selectedCrossingTriangleVertexCount: distribution(
			traces.map(
				({ selectedCrossingGeometry }) =>
					selectedCrossingGeometry.triangleVertexCount,
			),
		),
		selectedScopeLoss: distribution(
			traces.map(({ selectedScopeLoss }) => selectedScopeLoss),
		),
		targetBytes: first.targetBytes,
	};
}

function tracePose(
	topology: SceneTopologyView,
	pose: TracePose,
	content: ArchiveContentArtifacts,
	currentPlanner: PortalRenderGraphPlanner,
	candidatePlanner: PortalPathViewPlanner,
	drawingBuffer: TraceDrawingBuffer,
) {
	const common = createTraceCameraProjection(pose, drawingBuffer);
	const currentInput: PortalRenderGraphPlanInput = {
		...common,
		maximumStencilValue: 0xff,
		portalFootprint: { drawingBuffer, minimumPixelArea: 0 },
		safetyWorkItemLimit: 100_000,
	};
	const candidateInput: PortalPathViewPlanInput = {
		...common,
		budget: {
			maximumConflictPrimitiveCount: 10_000_000,
			maximumOwnershipLabelCount: 0x100,
			maximumPathDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumPathViewCount: 8_192,
			maximumProjectionPrimitiveCount: 10_000_000,
		},
		portalFootprint: {
			drawingBufferHeight: drawingBuffer.height,
			drawingBufferWidth: drawingBuffer.width,
			minimumPixelArea: 0,
		},
	};
	const current = currentPlanner.plan(topology, currentInput);
	const pathReplayReference = candidatePlanner.plan(topology, candidateInput);
	const dryWorkload = createDrySceneWorkload(content, pose);
	const pathReplaySchedule = createPortalPathViewDrySchedule(
		pathReplayReference,
		dryWorkload,
	);
	return {
		candidate:
			current.kind === "planned"
				? {
						drySchedule: createPortalArrivalStateDryScheduleTrace(
							current.plan,
							dryWorkload,
							topology.crossings,
							candidateInput.budget.maximumPathDepth,
							drawingBuffer,
						),
						family: "arrival-state-scope-atlas" as const,
						visibility: current.plan.diagnostics,
					}
				: {
						failure: current,
						family: "arrival-state-scope-atlas" as const,
					},
		current:
			current.kind === "planned"
				? {
						kind: "planned" as const,
						diagnostics: current.plan.diagnostics,
						drySchedule: createCurrentPortalDryScheduleTrace(
							current.plan,
							dryWorkload,
						),
						nodeCount: current.plan.nodes.length,
						renderLayerCount: current.plan.renderLayers.length,
					}
				: current,
		id: pose.id,
		pathReplayReference: {
			contentDomainCount: pathReplayReference.contentDomainIds.length,
			exteriorCacheEligible: pathReplayReference.exteriorCacheDomainId !== null,
			ownershipLabelCount: pathReplayReference.ownershipLabelCount,
			pathViewCount: pathReplayReference.views.length,
			drySchedule: pathReplaySchedule.trace,
			trace: pathReplayReference.trace,
			truncation: pathReplayReference.truncation,
		},
		rootScope: scopeKey(pose.rootScope),
	};
}

interface MutableDryScopeWorkload {
	readonly deferred: PortalDryDeferredSubmission[];
	readonly opaque: PortalDryOpaqueBatch[];
	readonly particles: PortalDryParticleSource[];
	readonly scopeKey: string;
}

function createDrySceneWorkload(
	content: ArchiveContentArtifacts,
	pose: TracePose,
): PortalDrySceneWorkload {
	const byScope = new Map<string, MutableDryScopeWorkload>();
	const requireScope = (scope: SceneScope): MutableDryScopeWorkload => {
		const key = scopeKey(scope);
		const existing = byScope.get(key);
		if (existing) return existing;
		const created: MutableDryScopeWorkload = {
			deferred: [],
			opaque: [],
			particles: [],
			scopeKey: key,
		};
		byScope.set(key, created);
		return created;
	};
	requireScope({ kind: "outdoor" });
	for (const environment of content.environments) {
		for (const { scope } of environment.scopes) requireScope(scope);
		for (const [shellIndex, shell] of environment.cellShells.entries()) {
			const scope = scopeFor(
				shell.placement.landblockId,
				shell.placement.envCellId,
			);
			const target = requireScope(scope);
			for (const [drawIndex, draw] of shell.renderable.drawUnits.entries()) {
				appendDryDraw(target, {
					batchKey: drawCompatibilityKey(draw),
					center:
						draw.transparentSort === null
							? null
							: transformPoint3(
									shell.placement.localTransform,
									draw.transparentSort.center,
								),
					ordering: draw.ordering,
					physicalKey: `env-shell:${shell.placement.landblockId}/${shellIndex}/${drawIndex}`,
					placementLandblockId: shell.placement.landblockId,
					pose,
				});
			}
		}
	}
	for (const [artifactIndex, artifact] of content.statics.entries()) {
		for (const [objectIndex, object] of artifact.objects.entries()) {
			const scope = scopeFor(
				object.placement.landblockId,
				object.placement.envCellId,
			);
			const target = requireScope(scope);
			for (const [drawIndex, draw] of object.renderable.drawUnits.entries()) {
				appendDryDraw(target, {
					batchKey: drawCompatibilityKey(draw),
					center:
						draw.transparentSort === null
							? null
							: transformPoint3(
									object.placement.localTransform,
									draw.transparentSort.center,
								),
					ordering: draw.ordering,
					physicalKey: `static:${artifactIndex}/${objectIndex}/${drawIndex}`,
					placementLandblockId: object.placement.landblockId,
					pose,
				});
			}
			for (const [
				templateIndex,
				template,
			] of object.renderable.frameStreamedInstances.entries()) {
				appendDryDraw(target, {
					batchKey: `${template.cohortKey}\0${materialKey(template.material)}`,
					center: transformPoint3(
						template.instance.sourceToLandblock,
						template.transparentSort.center,
					),
					ordering: "transparent",
					physicalKey: `static-template:${artifactIndex}/${objectIndex}/${templateIndex}`,
					placementLandblockId: object.placement.landblockId,
					pose,
				});
			}
		}
	}
	const outdoor = requireScope({ kind: "outdoor" });
	for (const landblockId of content.terrainLandblockIds) {
		outdoor.opaque.push({
			batchKey: `terrain:${landblockId}`,
			preparationKey: `terrain:${landblockId}`,
		});
	}
	for (const particle of content.particles) {
		const target = byScope.get(particle.scopeKey);
		if (!target) {
			throw new Error(
				`Particle workload scope ${particle.scopeKey} is unavailable.`,
			);
		}
		target.particles.push({
			batchKey: particle.batchKey,
			instanceCount: particle.instanceCount,
			sourceKey: particle.sourceKey,
		});
	}
	return {
		scopes: Object.freeze(
			[...byScope.values()].sort((left, right) =>
				left.scopeKey.localeCompare(right.scopeKey),
			),
		),
	};
}

function appendDryDraw(
	target: MutableDryScopeWorkload,
	input: {
		readonly batchKey: string;
		readonly center: Vec3 | null;
		readonly ordering: "additive" | "alpha-test" | "opaque" | "transparent";
		readonly physicalKey: string;
		readonly placementLandblockId: LandblockId;
		readonly pose: TracePose;
	},
): void {
	if (input.ordering === "opaque" || input.ordering === "alpha-test") {
		target.opaque.push({
			batchKey: input.batchKey,
			preparationKey: input.physicalKey,
		});
		return;
	}
	if (input.center === null) {
		throw new Error(
			`Deferred portal workload ${input.physicalKey} has no sort center.`,
		);
	}
	const offset = createLandblockOffset(
		getLandblockCoordinates(input.placementLandblockId),
		getLandblockCoordinates(input.pose.anchorLandblockId),
	);
	const x = input.center.x + offset.x - input.pose.position.x;
	const y = input.center.y - input.pose.position.y;
	const z = input.center.z + offset.z - input.pose.position.z;
	target.deferred.push({
		batchKey: input.batchKey,
		distanceSquared: x * x + y * y + z * z,
		kind: input.ordering,
		submissionKey: input.physicalKey,
	});
}

function drawCompatibilityKey(draw: {
	readonly geometry: string;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly material: StaticObjectLayerArtifact["objects"][number]["renderable"]["drawUnits"][number]["material"];
}): string {
	return [
		draw.geometry,
		draw.indexStart,
		draw.indexCount,
		materialKey(draw.material),
	].join("\0");
}

function materialKey(
	material: StaticObjectLayerArtifact["objects"][number]["renderable"]["drawUnits"][number]["material"],
): string {
	return [
		material.source.id,
		material.detailRole ?? "none",
		material.textures.base ?? "none",
		material.textures.palette ?? "none",
		material.sampler.wrap,
		material.palettedClipMap ? "clip" : "solid",
		material.polygon.cullFace,
		material.polygon.stippled ? "stippled" : "unstippled",
	].join("/");
}

function topologyDistribution(topology: SceneTopologyView) {
	return {
		apertureIndexCount: topology.crossings.reduce(
			(total, crossing) => total + crossing.visibilityAperture.indices.length,
			0,
		),
		apertureVertexCount: topology.crossings.reduce(
			(total, crossing) =>
				total + crossing.visibilityAperture.vertices.length / 3,
			0,
		),
		crossingCount: topology.crossings.length,
		maximumOutgoingCrossingCount: Math.max(
			0,
			...topology.scopes.map(({ scope }) => topology.outgoing(scope).length),
		),
		scopeCount: topology.scopes.length,
	};
}
