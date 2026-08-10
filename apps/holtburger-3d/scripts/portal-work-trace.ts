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
import { PORTAL_RENDER_CAPACITY_POLICY } from "../src/lib/game/renderer/portal-render-capacity-policy";
import { compilePortalScopeAtlasWebGLCalls } from "../src/lib/game/renderer/portal-scope-atlas-command-model";
import {
	PortalScopeAtlasPlanner,
	type PortalScopeAtlasFrameView,
	type PortalScopeAtlasResource,
} from "../src/lib/game/renderer/portal-scope-atlas-planner";
import type { PortalScopeWindowCullInput } from "../src/lib/game/renderer/portal-scope-window-culler";
import { portalScopeAtlasTargetByteLength } from "../src/lib/game/renderer/webgl2-portal-scope-atlas-targets";
import {
	createPortalArrivalStateDryScheduleTrace,
	snapshotPortalArrivalStateDryPlan,
	type PortalDryDeferredSubmission,
	type PortalDryOpaqueBatch,
	type PortalDryParticleSource,
	type PortalDrySceneWorkload,
} from "../src/lib/game/renderer/portal-arrival-state-dry-schedule";
import { PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT } from "../src/lib/game/renderer/portal-scope-atlas-metadata-glsl";
import {
	ParticleSystem,
	type ParticleSystemDiagnostics,
} from "../src/lib/game/systems/particle-system";
import { PhysicsScriptSystem } from "../src/lib/game/systems/physics-script-system";

const CAMERA = Object.freeze({ far: 10_000, fov: 70, near: 0.1 });
const DEFAULT_DRAWING_BUFFER = Object.freeze({ height: 1_080, width: 1_920 });
const PARTICLE_TRACE_TIME_SECONDS = 1;
/** Deterministic update cadence used to expose lifetime growth without measuring CPU duration. */
const PARTICLE_LIFETIME_TRACE_STEPS_PER_SECOND = 60;
/** Covers the 15-second field profile twice, exposing steady growth versus bounded turnover. */
const PARTICLE_LIFETIME_TRACE_DURATION_SECONDS = 30;
/** Largest relative atlas dimension evaluated by the offline fixed-capacity policy search. */
const MAXIMUM_ATLAS_POLICY_MULTIPLIER = 4;
/** Logical no-cutoff capacity used to isolate atlas extent from arrival-id experiments. */
const GUARANTEED_ARRIVAL_STATE_CAPACITY = 0xffff_ffff;
/** Logical no-cutoff capacity used to isolate atlas extent from triangle-stream experiments. */
const GUARANTEED_CROSSING_TRIANGLE_VERTEX_CAPACITY = 0xffff_ffff;
/** Camera-stage work counters compared by the authored-PVS counterfactual. */
const PVS_WORK_COUNTERS = [
	"outgoingCrossingInputCount",
	"nearClipClassificationCount",
	"facingTestCount",
	"routeProjectionCount",
	"projectionPrimitiveCount",
	"selectedCrossingInputCount",
	"selectedCrossingMarkerWordInputCount",
] as const satisfies readonly (keyof AtlasPlanSnapshot["visibilityWork"])[];

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
	readonly authoredVisibleReferenceCount: number;
	readonly asymmetricVisibleReferenceCount: number;
	readonly buildingComponentOmissionCount: number;
	readonly buildingPortalCount: number;
	readonly buildingStabMissingTargetCount: number;
	readonly buildingStabReferenceCount: number;
	readonly danglingBuildingStabReferenceCount: number;
	readonly danglingVisibleReferenceCount: number;
	readonly directedPortalCount: number;
	readonly duplicateBuildingStabReferenceCount: number;
	readonly duplicateVisibleReferenceCount: number;
	readonly effectiveBuildingStabCellCount: ArchivePortalCensusDistribution;
	readonly effectivePvsCellCount: ArchivePortalCensusDistribution;
	readonly envCellCount: number;
	readonly environmentCount: number;
	readonly facilityHubFixture: null | {
		readonly roomAfterDoorEnvCellId: string;
		readonly roomAfterDoorListsStaircase: boolean;
		readonly roomToStaircasePortalDistance: number | null;
		readonly staircaseEnvCellId: string;
		readonly staircaseListsRoomAfterDoor: boolean;
		readonly staircaseToRoomPortalDistance: number | null;
	};
	readonly immediateNeighborOmissionCount: number;
	readonly immediateNeighborOmissions: readonly {
		readonly sourceEnvCellId: string;
		readonly targetEnvCellId: string;
	}[];
	readonly internalComponentCellCount: ArchivePortalCensusDistribution;
	readonly internalComponentPortalCount: ArchivePortalCensusDistribution;
	readonly internalPortalCount: number;
	readonly landblockId: LandblockId;
	readonly maximumIndoorDistanceFromOutside: number;
	readonly maximumOutgoingPortalCount: number;
	readonly maximumSourceApertureVertexCount: number;
	readonly outsidePortalCount: number;
	readonly outsideTransitionCellCount: number;
	readonly pvsRetainedInternalPortalCount: ArchivePortalCensusDistribution;
	readonly seenOutsideCellCount: number;
	readonly selfVisibleReferenceCount: number;
	readonly sourceApertureTriangleCount: number;
	readonly sourceApertureVertexCount: number;
	readonly unreachableFromOutsideCellCount: number;
}

/** Exact per-owner integer distribution emitted by the archive adapter. */
interface ArchivePortalCensusDistribution {
	readonly maximum: number;
	readonly median: number;
	readonly minimum: number;
	readonly p90: number;
	readonly total: number;
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
	readonly pvs: ArchivePortalPvsCensusReport;
	readonly riskSelections: readonly ArchivePortalRiskSelection[];
}

/** Compact archive-wide PVS evidence plus the authoritative Facility Hub fixture. */
interface ArchivePortalPvsCensusReport {
	readonly authoredVisibleReferenceCount: number;
	readonly asymmetricVisibleReferenceCount: number;
	readonly buildingComponentOmissionCount: number;
	readonly buildingPortalCount: number;
	readonly buildingStabMissingTargetCount: number;
	readonly buildingStabReferenceCount: number;
	readonly danglingBuildingStabReferenceCount: number;
	readonly danglingVisibleReferenceCount: number;
	readonly duplicateBuildingStabReferenceCount: number;
	readonly duplicateVisibleReferenceCount: number;
	readonly effectiveBuildingStabCellCount: number;
	readonly effectivePvsCellCount: number;
	readonly facilityHub: {
		readonly effectivePvsCellCount: ArchivePortalCensusDistribution;
		readonly fixture: NonNullable<
			ArchivePortalCensusLandblock["facilityHubFixture"]
		>;
		readonly immediateNeighborOmissions: ArchivePortalCensusLandblock["immediateNeighborOmissions"];
		readonly internalComponentCellCount: ArchivePortalCensusDistribution;
		readonly pvsRetainedInternalPortalCount: ArchivePortalCensusDistribution;
		readonly internalComponentPortalCount: ArchivePortalCensusDistribution;
	};
	readonly immediateNeighborOmissionCount: number;
	readonly immediateNeighborOmissionLandblockCount: number;
	readonly internalComponentCellCount: number;
	readonly internalComponentPortalCount: number;
	readonly pvsRetainedInternalPortalCount: number;
	readonly selfVisibleReferenceCount: number;
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

/** One immutable indoor-root topology filtered by that root cell's authored PVS. */
interface PvsCounterfactualTopology {
	/** Resident EnvCell scope keys admitted by the source cell plus its authored PVS. */
	readonly allowedEnvCellScopeKeys: ReadonlySet<string>;
	/** Number of authored PVS ids before intersecting with currently resident topology. */
	readonly authoredPvsCellCount: number;
	readonly topology: SceneTopologyView;
}

/** Browser-free trace output; every count is deterministic and unweighted. */
interface PortalWorkTraceReport {
	/** Canonical schema identity for disposable reports. */
	readonly kind: "holtburger-portal-work-trace";
	/** Real archive landblocks contributing resident topology. */
	readonly landblockIds: readonly LandblockId[];
	/** Deterministic live authored-particle population supplied to every dry schedule. */
	readonly particles: ArchiveParticleTrace;
	/** Route-independent projection reuse ceiling from the unchanged production plan. */
	readonly projectionReuse: ReturnType<typeof summarizeProjectionReuse>;
	/** Aggregate authored-PVS counterfactual evidence emitted before verbose pose records. */
	readonly pvsCounterfactual: ReturnType<typeof summarizePvsCounterfactuals>;
	/** Per-pose production planning and execution traces. */
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

/** Exact non-particle CPU artifacts prepared from the same decoded real source records as production. */
interface ArchivePreparedContentArtifacts {
	/** Authored dynamic residents whose scripts can create the live particle workload. */
	readonly dynamics: readonly AuthoredDynamicSource[];
	/** Environment shells paired with their published scope topology. */
	readonly environments: readonly EnvCellLayerArtifact[];
	/** Prepared outdoor and interior-resident static draw artifacts. */
	readonly statics: readonly StaticObjectLayerArtifact[];
	/** Terrain sources represented as one resolved draw domain per resident landblock. */
	readonly terrainLandblockIds: readonly LandblockId[];
}

/** Complete archive workload after deterministic particle lifetime execution. */
interface ArchiveContentArtifacts extends ArchivePreparedContentArtifacts {
	/** Fixed-time production cohorts reduced to dry-scheduler facts by physical scope. */
	readonly particles: readonly ArchiveScopedParticleWorkload[];
	/** Event- and second-sampled particle ownership evidence over the field-profile horizon. */
	readonly particleLifetime: ArchiveParticleLifetimeTrace;
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

/** One deterministic lifetime observation plus the retired and current presentation work models. */
interface ArchiveParticleLifetimeSnapshot extends ParticleSystemDiagnostics {
	/** One owner aggregate lookup per dynamic presentation publication. */
	readonly ownerAggregateLookupCountPerPresentation: number;
	/** Authored owners whose derived production envelope changed at this retained snapshot. */
	readonly ownerEnvelopeChanges: readonly ArchiveParticleOwnerEnvelopeSnapshot[];
	/** All-emitter inspections the retired lookup performed for the same population. */
	readonly retiredEmitterInspectionCountPerPresentation: number;
	/** Authored simulation time represented by this snapshot. */
	readonly timeSeconds: number;
}

/** Trace-only identity and derived envelope for one authored dynamic resident. */
interface ArchiveParticleOwnerEnvelopeSnapshot {
	/** Current owner-relative conservative radius returned by the production aggregate. */
	readonly envelopeRadius: number;
	/** Stable authored resident identity from the archive. */
	readonly sourceId: string;
	/** Synthetic runtime target identity assigned by this deterministic trace. */
	readonly targetId: string;
}

/** Bounded real-content lifetime evidence independent from browser frame timing. */
interface ArchiveParticleLifetimeTrace {
	/** Authored-time horizon simulated by the trace. */
	readonly durationSeconds: number;
	/** Maximum simultaneous emitter population observed over the horizon. */
	readonly peakEmitterCount: number;
	/** Maximum simultaneous live-particle population observed over the horizon. */
	readonly peakParticleCount: number;
	/** Worst retired all-emitter work for one presentation over the horizon. */
	readonly peakRetiredEmitterInspectionCountPerPresentation: number;
	/** Whole-second observations plus intervening lifetime transitions. */
	readonly snapshots: readonly ArchiveParticleLifetimeSnapshot[];
	/** Deterministic authored-time advancement interval. */
	readonly stepSeconds: number;
}

/** Particle cohorts and their independent lifetime evidence from one production simulation. */
interface ArchiveParticleArtifacts {
	/** Authored-time population and ownership evidence. */
	readonly lifetime: ArchiveParticleLifetimeTrace;
	/** One-second physical particle workload used by the portal dry schedule. */
	readonly workload: readonly ArchiveScopedParticleWorkload[];
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
if (options.mode === "particle-lifetime") {
	process.stdout.write(
		`${JSON.stringify(
			{
				kind: "holtburger-particle-lifetime-trace",
				landblockIds: options.landblockIds,
				particles: {
					...particleTrace(archive.content),
					lifetime: archive.content.particleLifetime,
				},
			},
			null,
			2,
		)}\n`,
	);
	process.exit(0);
}
const graph = new SceneGraph();
for (const artifact of archive.artifacts) {
	for (const scope of artifact.scopes) graph.upsertEnvCellScope(scope);
	for (const crossing of artifact.crossings)
		graph.upsertPortalCrossing(crossing);
}
const topology = graph.getPortalTopologyView();
const poses = selectTracePoses(
	createTracePoses(topology, archive.artifacts).filter(
		(pose) => options.poseId === null || pose.id === options.poseId,
	),
	options.maximumPoseCount,
);
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
const scopeAtlasPlanner = new PortalScopeAtlasPlanner(
	PORTAL_RENDER_CAPACITY_POLICY.culler,
);
const pvsCounterfactualPlanner = new PortalScopeAtlasPlanner(
	PORTAL_RENDER_CAPACITY_POLICY.culler,
);
const pvsTopologiesByRoot = new Map<string, PvsCounterfactualTopology>();
const tracedPoses = poses.map((pose) =>
	tracePose(
		topology,
		pose,
		archive.content,
		scopeAtlasPlanner,
		pvsCounterfactualPlanner,
		pvsTopologiesByRoot,
		options.drawingBuffer,
	),
);
const report: PortalWorkTraceReport = {
	kind: "holtburger-portal-work-trace",
	landblockIds: options.landblockIds,
	particles: particleTrace(archive.content),
	projectionReuse: summarizeProjectionReuse(tracedPoses),
	pvsCounterfactual: summarizePvsCounterfactuals(tracedPoses),
	poses: tracedPoses,
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
			readonly mode: "atlas-capacity" | "particle-lifetime" | "workload";
			/** Optional exact deterministic camera identity retained for a focused trace. */
			readonly poseId: string | null;
	  }
	| { readonly kind: "census" } {
	if (arguments_.length === 1 && arguments_[0] === "--census") {
		return { kind: "census" };
	}
	const landblockIds: LandblockId[] = [];
	let archiveRecordsPath: string | null = null;
	let drawingBuffer: TraceDrawingBuffer = DEFAULT_DRAWING_BUFFER;
	let mode: "atlas-capacity" | "particle-lifetime" | "workload" = "workload";
	let maximumPoseCount = 128;
	let poseId: string | null = null;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		if (argument === "--atlas-capacity") {
			mode = "atlas-capacity";
			continue;
		}
		if (argument === "--particle-lifetime") {
			mode = "particle-lifetime";
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
		if (argument === "--pose-id") {
			const raw = arguments_[index + 1];
			if (!raw) {
				throw new Error("--pose-id requires a deterministic trace pose id.");
			}
			poseId = raw;
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
			"usage: npm run trace:portals -- <landblock-id> [landblock-id ...] [--max-poses N] [--pose-id ID] [--atlas-capacity | --particle-lifetime] [--drawing-buffer WIDTHxHEIGHT]",
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
		poseId,
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
	const particleArtifacts = await createArchiveParticleArtifacts(
		preparedContent.dynamics,
		behavior,
	);
	return {
		artifacts: environments,
		content: {
			...preparedContent,
			particleLifetime: particleArtifacts.lifetime,
			particles: particleArtifacts.workload,
		},
	};
}

function prepareArchiveContentArtifacts(
	sources: readonly ReturnType<typeof decodeLandblockSourceBatch>[],
	environments: readonly EnvCellLayerArtifact[],
): ArchivePreparedContentArtifacts {
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
	const facilityHub = census.landblocks.find(
		({ landblockId }) => landblockId === "0x8a02ffff",
	);
	if (!facilityHub) {
		throw new Error("Portal archive census lost Facility Hub 0x8a02ffff.");
	}
	if (!facilityHub.facilityHubFixture) {
		throw new Error("Portal archive census lost the Facility Hub PVS fixture.");
	}
	if (
		facilityHub.facilityHubFixture.staircaseListsRoomAfterDoor ||
		!facilityHub.facilityHubFixture.roomAfterDoorListsStaircase
	) {
		throw new Error(
			"Facility Hub no longer matches the authoritative staircase/door PVS asymmetry.",
		);
	}
	const sum = (
		select: (record: ArchivePortalCensusLandblock) => number,
	): number =>
		census.landblocks.reduce((total, record) => total + select(record), 0);
	const pvs = Object.freeze({
		authoredVisibleReferenceCount: sum(
			({ authoredVisibleReferenceCount }) => authoredVisibleReferenceCount,
		),
		asymmetricVisibleReferenceCount: sum(
			({ asymmetricVisibleReferenceCount }) => asymmetricVisibleReferenceCount,
		),
		buildingComponentOmissionCount: sum(
			({ buildingComponentOmissionCount }) => buildingComponentOmissionCount,
		),
		buildingPortalCount: sum(({ buildingPortalCount }) => buildingPortalCount),
		buildingStabMissingTargetCount: sum(
			({ buildingStabMissingTargetCount }) => buildingStabMissingTargetCount,
		),
		buildingStabReferenceCount: sum(
			({ buildingStabReferenceCount }) => buildingStabReferenceCount,
		),
		danglingBuildingStabReferenceCount: sum(
			({ danglingBuildingStabReferenceCount }) =>
				danglingBuildingStabReferenceCount,
		),
		danglingVisibleReferenceCount: sum(
			({ danglingVisibleReferenceCount }) => danglingVisibleReferenceCount,
		),
		duplicateBuildingStabReferenceCount: sum(
			({ duplicateBuildingStabReferenceCount }) =>
				duplicateBuildingStabReferenceCount,
		),
		duplicateVisibleReferenceCount: sum(
			({ duplicateVisibleReferenceCount }) => duplicateVisibleReferenceCount,
		),
		effectiveBuildingStabCellCount: sum(
			({ effectiveBuildingStabCellCount }) =>
				effectiveBuildingStabCellCount.total,
		),
		effectivePvsCellCount: sum(
			({ effectivePvsCellCount }) => effectivePvsCellCount.total,
		),
		facilityHub: Object.freeze({
			effectivePvsCellCount: facilityHub.effectivePvsCellCount,
			fixture: facilityHub.facilityHubFixture,
			immediateNeighborOmissions: facilityHub.immediateNeighborOmissions,
			internalComponentCellCount: facilityHub.internalComponentCellCount,
			internalComponentPortalCount: facilityHub.internalComponentPortalCount,
			pvsRetainedInternalPortalCount:
				facilityHub.pvsRetainedInternalPortalCount,
		}),
		immediateNeighborOmissionCount: sum(
			({ immediateNeighborOmissionCount }) => immediateNeighborOmissionCount,
		),
		immediateNeighborOmissionLandblockCount: census.landblocks.filter(
			({ immediateNeighborOmissionCount }) =>
				immediateNeighborOmissionCount > 0,
		).length,
		internalComponentCellCount: sum(
			({ internalComponentCellCount }) => internalComponentCellCount.total,
		),
		internalComponentPortalCount: sum(
			({ internalComponentPortalCount }) => internalComponentPortalCount.total,
		),
		pvsRetainedInternalPortalCount: sum(
			({ pvsRetainedInternalPortalCount }) =>
				pvsRetainedInternalPortalCount.total,
		),
		selfVisibleReferenceCount: sum(
			({ selfVisibleReferenceCount }) => selfVisibleReferenceCount,
		),
	}) satisfies ArchivePortalPvsCensusReport;
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
		pvs,
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

async function createArchiveParticleArtifacts(
	dynamics: readonly AuthoredDynamicSource[],
	behavior: ArchiveBehaviorExport,
): Promise<ArchiveParticleArtifacts> {
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
	let timeSeconds = 0;
	const particles = new ParticleSystem({
		clock: () => timeSeconds,
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
		const snapshots: ArchiveParticleLifetimeSnapshot[] = [];
		const previousOwnerEnvelopeRadii = new Map<string, number>();
		let previousLifetimeSignature = "";
		let peakEmitterCount = 0;
		let peakParticleCount = 0;
		let peakRetiredEmitterInspectionCountPerPresentation = 0;
		let workload: readonly ArchiveScopedParticleWorkload[] | null = null;
		const stepCount =
			PARTICLE_LIFETIME_TRACE_DURATION_SECONDS *
			PARTICLE_LIFETIME_TRACE_STEPS_PER_SECOND;
		for (let step = 0; step <= stepCount; step += 1) {
			timeSeconds = step / PARTICLE_LIFETIME_TRACE_STEPS_PER_SECOND;
			scriptSystem.advance(timeSeconds);
			particles.advance(timeSeconds);
			const diagnostics = particles.getDiagnostics();
			const retiredEmitterInspectionCountPerPresentation =
				dynamics.length * diagnostics.emitterCount;
			peakEmitterCount = Math.max(peakEmitterCount, diagnostics.emitterCount);
			peakParticleCount = Math.max(
				peakParticleCount,
				diagnostics.particleCount,
			);
			peakRetiredEmitterInspectionCountPerPresentation = Math.max(
				peakRetiredEmitterInspectionCountPerPresentation,
				retiredEmitterInspectionCountPerPresentation,
			);
			const lifetimeSignature = particleLifetimeSignature(diagnostics);
			if (
				step % PARTICLE_LIFETIME_TRACE_STEPS_PER_SECOND === 0 ||
				lifetimeSignature !== previousLifetimeSignature
			) {
				const ownerEnvelopeChanges = residentTargets.flatMap(
					({ dynamic, target }) => {
						const envelopeRadius = particles.envelopeRadiusFor(target.targetId);
						if (
							previousOwnerEnvelopeRadii.get(target.targetId) === envelopeRadius
						) {
							return [];
						}
						previousOwnerEnvelopeRadii.set(target.targetId, envelopeRadius);
						return [
							Object.freeze({
								envelopeRadius,
								sourceId: dynamic.identity.sourceId,
								targetId: target.targetId,
							}),
						];
					},
				);
				snapshots.push(
					Object.freeze({
						...diagnostics,
						ownerAggregateLookupCountPerPresentation: dynamics.length,
						ownerEnvelopeChanges: Object.freeze(ownerEnvelopeChanges),
						retiredEmitterInspectionCountPerPresentation,
						timeSeconds,
					}),
				);
				previousLifetimeSignature = lifetimeSignature;
			}
			if (timeSeconds === PARTICLE_TRACE_TIME_SECONDS) {
				workload = snapshotArchiveParticleWorkload(particles, scopeByTargetId);
			}
		}
		if (workload === null) {
			throw new Error(
				"Particle lifetime trace did not reach its workload time.",
			);
		}
		return Object.freeze({
			lifetime: Object.freeze({
				durationSeconds: PARTICLE_LIFETIME_TRACE_DURATION_SECONDS,
				peakEmitterCount,
				peakParticleCount,
				peakRetiredEmitterInspectionCountPerPresentation,
				snapshots: Object.freeze(snapshots),
				stepSeconds: 1 / PARTICLE_LIFETIME_TRACE_STEPS_PER_SECOND,
			}),
			workload,
		});
	} finally {
		scriptSystem.destroy();
		for (const closure of closures.values()) closure.release();
		for (const handle of emitterHandles) handle.release();
		scriptRepository.destroy();
		emitterRepository.destroy();
	}
}

/** Lifetime facts whose changes deserve a snapshot between whole-second observations. */
function particleLifetimeSignature(
	diagnostics: ParticleSystemDiagnostics,
): string {
	return [
		diagnostics.createdEmitterTotal,
		diagnostics.destroyedEmitterTotal,
		diagnostics.emitterCount,
		diagnostics.emitterOwnerCount,
		diagnostics.explicitlyStoppedEmitterTotal,
		diagnostics.lostTargetEmitterTotal,
		diagnostics.maximumEmitterCountPerOwner,
		diagnostics.ownerAggregateRepairTotal,
		diagnostics.reapedEmitterCount,
		diagnostics.replacedEmitterTotal,
	].join("/");
}

/** Copy reused production cohort storage into immutable archive work facts at one trace instant. */
function snapshotArchiveParticleWorkload(
	particles: ParticleSystem,
	scopeByTargetId: ReadonlyMap<string, string>,
): readonly ArchiveScopedParticleWorkload[] {
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

/** Deterministically spread a bounded trace across settled and crossing-motion camera strata. */
function selectTracePoses(
	poses: readonly TracePose[],
	maximumPoseCount: number,
): TracePose[] {
	const buckets = new Map<string, TracePose[]>();
	for (const pose of poses.toSorted((left, right) =>
		left.id.localeCompare(right.id),
	)) {
		const sample = pose.id.startsWith("indoor-settled/")
			? "indoor-settled"
			: `motion/${pose.id.slice(pose.id.lastIndexOf("/") + 1)}`;
		const stratum = `${sample}/${pose.rootScope.kind}`;
		const bucket = buckets.get(stratum) ?? [];
		bucket.push(pose);
		buckets.set(stratum, bucket);
	}
	const orderedBuckets = [...buckets.entries()].sort(([left], [right]) =>
		left.localeCompare(right),
	);
	const selected: TracePose[] = [];
	for (let ordinal = 0; selected.length < maximumPoseCount; ordinal += 1) {
		let appended = false;
		for (const [, bucket] of orderedBuckets) {
			const pose = bucket[ordinal];
			if (!pose) continue;
			selected.push(pose);
			appended = true;
			if (selected.length === maximumPoseCount) break;
		}
		if (!appended) break;
	}
	return selected;
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
	/** Canonical authored scopes retained by cell-granular traversal. */
	readonly selectedScopeKeys: readonly string[];
	/** Packed render domains after depth-continuous visibility-island collapse. */
	readonly selectedRenderDomainTiles: readonly {
		readonly height: number;
		readonly memberScopeKeys: readonly string[];
		readonly width: number;
	}[];
	readonly status: "complete" | "truncated";
	readonly visibilityWork: {
		readonly executedProjectionPrimitiveCount: number;
		readonly facingTestCount: number;
		readonly nearClipClassificationCount: number;
		readonly nearPlaneRouteProjectionCount: number;
		readonly projectionPrimitiveExecutionDelta: number;
		readonly ordinaryRouteProjectionCount: number;
		readonly outgoingCrossingInputCount: number;
		readonly projectionCacheCapacityBytes: number;
		readonly projectionCacheCapacityBypassCount: number;
		readonly projectionCacheColdBypassCount: number;
		readonly projectionCacheDeclinedPromotionCount: number;
		readonly projectionCacheFragmentHighWaterCount: number;
		readonly projectionCacheHitCount: number;
		readonly projectionCachePromotionCount: number;
		readonly projectionCacheVertexHighWaterCount: number;
		readonly projectionPrimitiveCount: number;
		readonly queueHighWaterCount: number;
		readonly routeProjectionCount: number;
		readonly selectedCrossingInputCount: number;
		readonly selectedCrossingMarkerWordInputCount: number;
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
	const baselineTileWidths = baseline.selectedRenderDomainTiles.map(
		({ width }) => width,
	);
	const baselineTileHeights = baseline.selectedRenderDomainTiles.map(
		({ height }) => height,
	);
	return {
		baseline: {
			...publicAtlasPlan(baseline),
			selectedRenderDomainTiles: baseline.selectedRenderDomainTiles,
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
		candidate.selectedScopeKeys.length > baseline.selectedScopeKeys.length ||
		candidate.selectedRenderDomainTiles.length >
			baseline.selectedRenderDomainTiles.length
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
		selectedRenderDomainLoss:
			baseline.selectedRenderDomainTiles.length -
			candidate.selectedRenderDomainTiles.length,
		selectedScopeLoss:
			baseline.selectedScopeKeys.length - candidate.selectedScopeKeys.length,
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
	const selectedScopeKeys = Array.from(
		{ length: frame.visibility.selectedScopeCount },
		(_, ordinal) => scopeKey(frame.visibility.selectedScope(ordinal)),
	);
	const memberScopeKeysByRenderDomain = Array.from(
		{ length: frame.tileCount },
		() => [] as string[],
	);
	for (let ordinal = 0; ordinal < selectedScopeKeys.length; ordinal += 1) {
		const renderDomainOrdinal =
			frame.visibility.selectedScopeRenderDomainOrdinal(ordinal);
		memberScopeKeysByRenderDomain[renderDomainOrdinal]!.push(
			selectedScopeKeys[ordinal]!,
		);
	}
	const selectedRenderDomainTiles = memberScopeKeysByRenderDomain.map(
		(memberScopeKeys, ordinal) => ({
			height: frame.tileHeight(ordinal),
			memberScopeKeys: Object.freeze(memberScopeKeys),
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
		selectedRenderDomainTiles,
		selectedScopeKeys,
		status: frame.visibility.status,
		visibilityWork: {
			executedProjectionPrimitiveCount:
				frame.visibility.trace.executedProjectionPrimitiveCount,
			facingTestCount: frame.visibility.trace.facingTestCount,
			nearClipClassificationCount:
				frame.visibility.trace.nearClipClassificationCount,
			nearPlaneRouteProjectionCount:
				frame.visibility.trace.nearPlaneRouteProjectionCount,
			projectionPrimitiveExecutionDelta:
				frame.visibility.trace.projectionPrimitiveExecutionDelta,
			ordinaryRouteProjectionCount:
				frame.visibility.trace.ordinaryRouteProjectionCount,
			outgoingCrossingInputCount:
				frame.visibility.trace.outgoingCrossingInputCount,
			projectionCacheCapacityBytes:
				frame.visibility.trace.projectionCacheCapacityBytes,
			projectionCacheCapacityBypassCount:
				frame.visibility.trace.projectionCacheCapacityBypassCount,
			projectionCacheColdBypassCount:
				frame.visibility.trace.projectionCacheColdBypassCount,
			projectionCacheDeclinedPromotionCount:
				frame.visibility.trace.projectionCacheDeclinedPromotionCount,
			projectionCacheFragmentHighWaterCount:
				frame.visibility.trace.projectionCacheFragmentHighWaterCount,
			projectionCacheHitCount: frame.visibility.trace.projectionCacheHitCount,
			projectionCachePromotionCount:
				frame.visibility.trace.projectionCachePromotionCount,
			projectionCacheVertexHighWaterCount:
				frame.visibility.trace.projectionCacheVertexHighWaterCount,
			projectionPrimitiveCount: frame.visibility.trace.projectionPrimitiveCount,
			queueHighWaterCount: frame.visibility.trace.queueHighWaterCount,
			routeProjectionCount: frame.visibility.trace.routeProjectionCount,
			selectedCrossingInputCount:
				frame.visibility.trace.selectedCrossingInputCount,
			selectedCrossingMarkerWordInputCount:
				frame.visibility.trace.selectedCrossingMarkerWordInputCount,
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
		selectedRenderDomainCount: snapshot.selectedRenderDomainTiles.length,
		selectedRenderDomainScopeKeys: snapshot.selectedRenderDomainTiles.map(
			({ memberScopeKeys }) => memberScopeKeys,
		),
		selectedScopeCount: snapshot.selectedScopeKeys.length,
		selectedScopeKeys: snapshot.selectedScopeKeys,
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
		sameStrings(baseline.selectedScopeKeys, candidate.selectedScopeKeys) &&
		baseline.selectedRenderDomainTiles.length ===
			candidate.selectedRenderDomainTiles.length &&
		baseline.selectedRenderDomainTiles.every((tile, ordinal) => {
			const other = candidate.selectedRenderDomainTiles[ordinal];
			return (
				other !== undefined &&
				sameStrings(tile.memberScopeKeys, other.memberScopeKeys) &&
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

function tracePvsCounterfactual(
	topology: SceneTopologyView,
	pose: TracePose,
	projection: ReturnType<typeof createTraceCameraProjection>,
	resource: PortalScopeAtlasResource,
	baseline: AtlasPlanSnapshot,
	planner: PortalScopeAtlasPlanner,
	topologiesByRoot: Map<string, PvsCounterfactualTopology>,
) {
	if (pose.rootScope.kind === "outdoor") {
		return Object.freeze({
			kind: "unavailable" as const,
			reason: "building-stab-list-not-published" as const,
		});
	}
	const filtered = getPvsCounterfactualTopology(
		topology,
		pose.rootScope,
		topologiesByRoot,
	);
	const candidate = snapshotAtlasPlan(
		planner.plan(
			filtered.topology,
			{
				...projection,
				portalFootprint: {
					drawingBuffer: resource.drawingBuffer,
					minimumPixelArea: 0,
				},
			},
			resource,
		),
		resource,
	);
	const workDelta = Object.fromEntries(
		PVS_WORK_COUNTERS.map((counter) => {
			const baselineMinusCandidate =
				baseline.visibilityWork[counter] - candidate.visibilityWork[counter];
			return [counter, baselineMinusCandidate];
		}),
	) as Readonly<Record<(typeof PVS_WORK_COUNTERS)[number], number>>;
	const candidateCrossingIds = new Set(candidate.selectedCrossingIds);
	const selectedScopeKeysOutsidePvs = baseline.selectedScopeKeys.filter(
		(key) => key !== "outdoor" && !filtered.allowedEnvCellScopeKeys.has(key),
	);
	return Object.freeze({
		applicableResidentEnvCellCount: filtered.allowedEnvCellScopeKeys.size,
		authoredPvsCellCount: filtered.authoredPvsCellCount,
		baselineSelectedCrossingIdsRejected: Object.freeze(
			baseline.selectedCrossingIds.filter(
				(id) => !candidateCrossingIds.has(id),
			),
		),
		baselineSelectedScopeKeysOutsidePvs: Object.freeze(
			selectedScopeKeysOutsidePvs,
		),
		candidate: publicAtlasPlan(candidate),
		kind: "indoor-root-authored-pvs" as const,
		selectedCrossingLoss:
			baseline.selectedCrossingIds.length -
			candidate.selectedCrossingIds.length,
		selectedScopeLoss:
			baseline.selectedScopeKeys.length - candidate.selectedScopeKeys.length,
		selectionPreserved: sameAtlasSelection(baseline, candidate),
		/** Positive values remove work; negative values expose a stage regression. */
		workDelta,
	});
}

function getPvsCounterfactualTopology(
	topology: SceneTopologyView,
	rootScope: Extract<SceneScope, { readonly kind: "env-cell" }>,
	cache: Map<string, PvsCounterfactualTopology>,
): PvsCounterfactualTopology {
	const rootKey = scopeKey(rootScope);
	const cached = cache.get(rootKey);
	if (cached) return cached;
	const root = topology.scopes.find(({ scope }) => scopeKey(scope) === rootKey);
	if (!root || root.scope.kind !== "env-cell") {
		throw new Error(`Authored PVS root scope ${rootKey} is unavailable.`);
	}
	const residentEnvCellScopeKeys = new Set(
		topology.scopes.flatMap(({ scope }) =>
			scope.kind === "env-cell" ? [scopeKey(scope)] : [],
		),
	);
	const allowedEnvCellScopeKeys = new Set<string>([rootKey]);
	for (const envCellId of root.potentiallyVisibleEnvCellIds) {
		if (residentEnvCellScopeKeys.has(envCellId)) {
			allowedEnvCellScopeKeys.add(envCellId);
		}
	}
	const scopes = topology.scopes.filter(
		({ scope }) =>
			scope.kind === "outdoor" || allowedEnvCellScopeKeys.has(scopeKey(scope)),
	);
	const crossings = topology.crossings.flatMap((crossing) => {
		if (crossing.source.kind === "outdoor") return [];
		if (!allowedEnvCellScopeKeys.has(scopeKey(crossing.source))) return [];
		if (
			crossing.target.kind === "env-cell" &&
			!allowedEnvCellScopeKeys.has(scopeKey(crossing.target))
		) {
			return [];
		}
		if (
			crossing.target.kind === "outdoor" &&
			crossing.reciprocalCrossingId !== null
		) {
			return [{ ...crossing, reciprocalCrossingId: null }];
		}
		return [crossing];
	});
	const outgoingByScope = new Map<string, ScenePortalCrossingInput[]>();
	for (const crossing of crossings) {
		const key = scopeKey(crossing.source);
		const outgoing = outgoingByScope.get(key);
		if (outgoing) outgoing.push(crossing);
		else outgoingByScope.set(key, [crossing]);
	}
	const frozenOutgoing = new Map(
		[...outgoingByScope].map(([key, outgoing]) => [
			key,
			Object.freeze(
				outgoing.toSorted((left, right) => left.id.localeCompare(right.id)),
			),
		]),
	);
	const filteredTopology: SceneTopologyView = {
		crossings: Object.freeze(crossings),
		outgoing: (scope) => frozenOutgoing.get(scopeKey(scope)) ?? [],
		revision: topology.revision + cache.size + 1,
		scopes: Object.freeze(scopes),
	};
	const result = Object.freeze({
		allowedEnvCellScopeKeys,
		authoredPvsCellCount: root.potentiallyVisibleEnvCellIds.size,
		topology: filteredTopology,
	});
	cache.set(rootKey, result);
	return result;
}

function summarizePvsCounterfactuals(
	poses: readonly ReturnType<typeof tracePose>[],
) {
	const workDeltaTotals = Object.fromEntries(
		PVS_WORK_COUNTERS.map((counter) => [counter, 0]),
	) as Record<(typeof PVS_WORK_COUNTERS)[number], number>;
	const counterexamplePoseIds: string[] = [];
	let indoorPoseCount = 0;
	let outdoorUnavailablePoseCount = 0;
	let selectedCrossingLoss = 0;
	let selectedScopeLoss = 0;
	let selectionPreservingPoseCount = 0;
	for (const pose of poses) {
		const counterfactual = pose.pvsCounterfactual;
		if (counterfactual.kind === "unavailable") {
			outdoorUnavailablePoseCount += 1;
			continue;
		}
		indoorPoseCount += 1;
		selectedCrossingLoss += counterfactual.selectedCrossingLoss;
		selectedScopeLoss += counterfactual.selectedScopeLoss;
		if (counterfactual.selectionPreserved) selectionPreservingPoseCount += 1;
		if (counterfactual.baselineSelectedScopeKeysOutsidePvs.length > 0) {
			counterexamplePoseIds.push(pose.id);
		}
		for (const counter of PVS_WORK_COUNTERS) {
			workDeltaTotals[counter] += counterfactual.workDelta[counter];
		}
	}
	return Object.freeze({
		counterexamplePoseIds: Object.freeze(counterexamplePoseIds),
		selectedScopeCounterexamplePoseCount: counterexamplePoseIds.length,
		indoorPoseCount,
		outdoorUnavailablePoseCount,
		selectedCrossingLoss,
		selectedScopeLoss,
		selectionPreservingPoseCount,
		/** Positive values remove work; negative values expose a stage regression. */
		workDeltaTotals: Object.freeze(workDeltaTotals),
	});
}

function summarizeProjectionReuse(
	poses: readonly ReturnType<typeof tracePose>[],
) {
	const replayablePoses = poses
		.map((pose) => {
			const work = pose.execution.planning.visibilityWork;
			return {
				cacheHitCount: work.projectionCacheHitCount,
				id: pose.id,
				projectionPrimitiveExecutionDelta:
					work.projectionPrimitiveExecutionDelta,
				promotionCount: work.projectionCachePromotionCount,
				rootScope: pose.rootScope,
				routeProjectionCount: work.routeProjectionCount,
			};
		})
		.filter(
			({ cacheHitCount, promotionCount }) =>
				cacheHitCount > 0 || promotionCount > 0,
		)
		.toSorted(
			(left, right) =>
				right.projectionPrimitiveExecutionDelta -
					left.projectionPrimitiveExecutionDelta ||
				left.id.localeCompare(right.id),
		);
	const totals = poses.reduce(
		(result, pose) => {
			const work = pose.execution.planning.visibilityWork;
			result.nearPlaneRouteProjectionCount +=
				work.nearPlaneRouteProjectionCount;
			result.executedProjectionPrimitiveCount +=
				work.executedProjectionPrimitiveCount;
			result.projectionPrimitiveExecutionDelta +=
				work.projectionPrimitiveExecutionDelta;
			result.ordinaryRouteProjectionCount += work.ordinaryRouteProjectionCount;
			result.projectionCacheCapacityBytes = Math.max(
				result.projectionCacheCapacityBytes,
				work.projectionCacheCapacityBytes,
			);
			result.projectionCacheCapacityBypassCount +=
				work.projectionCacheCapacityBypassCount;
			result.projectionCacheColdBypassCount +=
				work.projectionCacheColdBypassCount;
			result.projectionCacheDeclinedPromotionCount +=
				work.projectionCacheDeclinedPromotionCount;
			result.projectionCacheFragmentWriteCount +=
				work.projectionCacheFragmentHighWaterCount;
			result.projectionCacheHitCount += work.projectionCacheHitCount;
			result.projectionCachePromotionCount +=
				work.projectionCachePromotionCount;
			result.projectionCacheVertexWriteCount +=
				work.projectionCacheVertexHighWaterCount;
			result.projectionPrimitiveCount += work.projectionPrimitiveCount;
			return result;
		},
		{
			executedProjectionPrimitiveCount: 0,
			nearPlaneRouteProjectionCount: 0,
			projectionPrimitiveExecutionDelta: 0,
			ordinaryRouteProjectionCount: 0,
			projectionCacheCapacityBytes: 0,
			projectionCacheCapacityBypassCount: 0,
			projectionCacheColdBypassCount: 0,
			projectionCacheDeclinedPromotionCount: 0,
			projectionCacheFragmentWriteCount: 0,
			projectionCacheHitCount: 0,
			projectionCachePromotionCount: 0,
			projectionCacheVertexWriteCount: 0,
			projectionPrimitiveCount: 0,
		},
	);
	const routeProjectionCount =
		totals.ordinaryRouteProjectionCount + totals.nearPlaneRouteProjectionCount;
	return Object.freeze({
		...totals,
		poseCount: poses.length,
		posesWithProjectionCacheReuse: replayablePoses.length,
		replayableMaximums: Object.freeze(replayablePoses.slice(0, 16)),
		routeProjectionCount,
	});
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
		selectedRenderDomainLoss: distribution(
			traces.map(({ selectedRenderDomainLoss }) => selectedRenderDomainLoss),
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
	scopeAtlasPlanner: PortalScopeAtlasPlanner,
	pvsCounterfactualPlanner: PortalScopeAtlasPlanner,
	pvsTopologiesByRoot: Map<string, PvsCounterfactualTopology>,
	drawingBuffer: TraceDrawingBuffer,
) {
	const common = createTraceCameraProjection(pose, drawingBuffer);
	const scopeAtlasResource = atlasResource(
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas,
		drawingBuffer,
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumCrossingTriangleVertexCount,
	);
	let scopeAtlasFrame: PortalScopeAtlasFrameView;
	try {
		scopeAtlasFrame = scopeAtlasPlanner.plan(
			topology,
			{
				...common,
				portalFootprint: { drawingBuffer, minimumPixelArea: 0 },
			},
			scopeAtlasResource,
		);
	} catch (cause) {
		throw new Error(`Portal scope-atlas planner failed pose ${pose.id}.`, {
			cause,
		});
	}
	const scopeAtlasPlanning = snapshotAtlasPlan(
		scopeAtlasFrame,
		scopeAtlasResource,
	);
	const pvsCounterfactual = tracePvsCounterfactual(
		topology,
		pose,
		common,
		scopeAtlasResource,
		scopeAtlasPlanning,
		pvsCounterfactualPlanner,
		pvsTopologiesByRoot,
	);
	const dryWorkload = createDrySceneWorkload(content, pose);
	const scopeAtlasDrySchedule = createPortalArrivalStateDryScheduleTrace(
		snapshotPortalArrivalStateDryPlan(scopeAtlasFrame),
		dryWorkload,
		drawingBuffer,
	);
	const expectedTargetBytes =
		portalScopeAtlasTargetByteLength(scopeAtlasResource);
	if (scopeAtlasDrySchedule.portalTargetBytes !== expectedTargetBytes) {
		throw new Error(
			`Portal scope-atlas dry target bytes ${scopeAtlasDrySchedule.portalTargetBytes} disagree with production allocation ${expectedTargetBytes}.`,
		);
	}
	const scopeAtlasExecutor = compilePortalScopeAtlasWebGLCalls({
		crossingVertexCount: scopeAtlasFrame.trace.crossingTriangleVertexCount,
		metadataBindingPoint: PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
		renderDomainCount: scopeAtlasFrame.visibility.selectedRenderDomainCount,
		traversalDepth: scopeAtlasFrame.commands.traversalDepth,
	});
	return {
		camera: traceCameraEvidence(pose),
		execution: {
			drySchedule: scopeAtlasDrySchedule,
			executor: scopeAtlasExecutor.trace,
			family: "arrival-state-scope-atlas" as const,
			planning: publicAtlasPlan(scopeAtlasPlanning),
		},
		id: pose.id,
		pvsCounterfactual,
		rootScope: scopeKey(pose.rootScope),
	};
}

/** Convert one anchor-local trace pose into the canonical coordinates accepted by the harness. */
function traceCameraEvidence(pose: TracePose) {
	const origin = createLandblockWorldOrigin(pose.anchorLandblockId);
	return Object.freeze({
		pitchDegrees: (pose.pitch * 180) / Math.PI,
		position: Object.freeze([
			origin.x + pose.position.x,
			origin.y + pose.position.y,
			origin.z + pose.position.z,
		] as const),
		yawDegrees: (pose.yaw * 180) / Math.PI,
	});
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
			kind: "terrain",
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
			kind: "object",
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
