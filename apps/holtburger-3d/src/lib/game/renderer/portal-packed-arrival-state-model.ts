import {
	createPortalModelFootprint,
	portalModelDepth,
	validatePortalModelScene,
	type PortalModelCrossing,
	type PortalModelDepth,
	type PortalModelScene,
	type PortalModelScopeId,
} from "./portal-model";
import {
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
} from "./portal-arrival-metadata";
import type { PortalScopeVisibilityEnvelope } from "./portal-visibility-envelope";

const UNCOVERED_STATE_ID = 0;
const ROOT_STATE_ID = 1;
const FIRST_CROSSING_STATE_ID = ROOT_STATE_ID + 1;
const ROUTE_SCOPE_SLOT =
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const ROUTE_RECIPROCAL_STATE_SLOT =
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES /
	Uint32Array.BYTES_PER_ELEMENT;
const ROUTE_FLAGS_SLOT =
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const ROUTE_JUNCTION_SLOT =
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES / Uint32Array.BYTES_PER_ELEMENT;
const METADATA_UINT32_SLOT_COUNT =
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;

/** Exact structural work of the packed frontier/metadata candidate. */
interface PortalPackedArrivalStateDiagnostics {
	/** Fixed UBO-sized metadata storage selected by the R8UI state capacity. */
	readonly arrivalMetadataCapacityBytes: number;
	/** Root plus crossing records populated for this symbolic scene. */
	readonly arrivalMetadataPopulatedBytes: number;
	/** Physical aperture samples presented to the propagation fragment algebra. */
	readonly crossingApertureSampleReadCount: number;
	/** Fixed logical crossing evaluations represented by the batched round draws. */
	readonly crossingRoundEvaluationCount: number;
	/** Current-frontier state pixels sampled by envelope reduction. */
	readonly envelopeSourcePixelReductionCount: number;
	/** One complete output-state/depth clear per propagation round. */
	readonly frontierClearCommandCount: number;
	/** Nonzero frontier pixels inspected across all rounds. */
	readonly frontierPixelReadCount: number;
	/** Candidates rejected because the source scope differs from the current arrival. */
	readonly sourceScopeRejectionCount: number;
	/** Candidates rejected because they do not lie strictly beyond the entry plane. */
	readonly entryPlaneRejectionCount: number;
	/** Equal-depth advances admitted because both crossings share one junction group. */
	readonly junctionAdmittedCount: number;
	/** Candidates rejected by explicit immediate-reciprocal suppression. */
	readonly reciprocalRejectionCount: number;
	/** Winning transitions rejected by nearer local opaque or passing alpha-test depth. */
	readonly localOpaqueDepthRejectionCount: number;
	/** Successful nearest-crossing state writes. */
	readonly nextFrontierStateWriteCount: number;
	/** One batched crossing-stream draw per complete propagation round. */
	readonly propagationCommandCount: number;
	/** State records populated once during metadata preparation. */
	readonly metadataStateWriteCount: number;
	/** Proof-only observer; strict entry ordering requires this to remain zero. */
	readonly repeatedArrivalStatePixelCount: number;
	/** One batched scope-envelope draw per propagation round. */
	readonly scopeEnvelopeReductionCommandCount: number;
	/** Final-round destination pixels folded into their scope as unbounded. */
	readonly terminalDestinationPixelReductionCount: number;
}

/** Shader-shaped finite result retaining only completed authored-scope envelopes. */
export interface PortalPackedArrivalStateFrame {
	readonly diagnostics: PortalPackedArrivalStateDiagnostics;
	readonly envelopes: readonly PortalScopeVisibilityEnvelope[];
	readonly family: "packed-arrival-state-frontiers";
}

/**
 * Execute the proposed R8UI frontier and fixed metadata algebra without WebGL.
 *
 * This is intentionally independent from the accepted work-queue compositor. One state id exists
 * per pixel and round. Strictly increasing entry depth makes every directed-crossing state unique
 * on that ray, so the final round can fold its new destination into the envelope without a visited
 * state texture or an additional reduction command.
 */
export function executePackedPortalArrivalStateModel(
	scene: PortalModelScene,
	maximumPathDepth: number,
): PortalPackedArrivalStateFrame {
	validatePortalModelScene(scene);
	if (!Number.isSafeInteger(maximumPathDepth) || maximumPathDepth < 0) {
		throw new Error(
			"Packed portal arrival-state depth must be a non-negative safe integer.",
		);
	}
	const stateArrayLength = FIRST_CROSSING_STATE_ID + scene.crossings.length;
	const populatedStateCount = ROOT_STATE_ID + scene.crossings.length;
	if (stateArrayLength - 1 > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT) {
		throw new Error("Packed portal arrival states exceed the R8UI format.");
	}
	const scopeOrdinalById = new Map<PortalModelScopeId, number>();
	for (let ordinal = 0; ordinal < scene.scopes.length; ordinal += 1) {
		scopeOrdinalById.set(scene.scopes[ordinal]!.id, ordinal);
	}
	const crossingStateById = new Map(
		scene.crossings.map((crossing, ordinal) => [
			crossing.id,
			FIRST_CROSSING_STATE_ID + ordinal,
		]),
	);
	const metadataBuffer = new ArrayBuffer(
		PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
	);
	const metadata = new Uint32Array(metadataBuffer);
	writeRoute(
		metadata,
		ROOT_STATE_ID,
		requireScopeOrdinal(scopeOrdinalById, scene.rootScopeId),
		UNCOVERED_STATE_ID,
		false,
		0,
	);
	for (let ordinal = 0; ordinal < scene.crossings.length; ordinal += 1) {
		const crossing = scene.crossings[ordinal]!;
		const reciprocalState =
			crossing.reciprocalCrossingId === null
				? UNCOVERED_STATE_ID
				: requireCrossingState(
						crossingStateById,
						crossing.reciprocalCrossingId,
					);
		writeRoute(
			metadata,
			FIRST_CROSSING_STATE_ID + ordinal,
			requireScopeOrdinal(scopeOrdinalById, crossing.targetScopeId),
			reciprocalState,
			true,
			// Null means "no junction"; zero is its packed sentinel, exactly as uploaded to the GPU.
			crossing.junctionGroupId === null ? 0 : crossing.junctionGroupId,
		);
	}

	const localOpaqueDepth = buildLocalOpaqueDepth(scene, scopeOrdinalById);
	const envelopeDepth = new Float64Array(
		scene.scopes.length * scene.pixelCount,
	);
	envelopeDepth.fill(Number.NaN);
	const envelopeCovered = new Uint8Array(envelopeDepth.length);
	const envelopeUnbounded = new Uint8Array(envelopeDepth.length);
	const observedStatePixel = new Uint8Array(
		stateArrayLength * scene.pixelCount,
	);
	let current = new Uint8Array(scene.pixelCount);
	let next = new Uint8Array(scene.pixelCount);
	current.fill(ROOT_STATE_ID);
	for (let pixel = 0; pixel < scene.pixelCount; pixel += 1) {
		observedStatePixel[ROOT_STATE_ID * scene.pixelCount + pixel] = 1;
	}

	const propagationRoundCount =
		scene.crossings.length === 0 ? 0 : maximumPathDepth;
	let crossingApertureSampleReadCount = 0;
	let envelopeSourcePixelReductionCount = 0;
	let entryPlaneRejectionCount = 0;
	let junctionAdmittedCount = 0;
	let frontierPixelReadCount = 0;
	let localOpaqueDepthRejectionCount = 0;
	let nextFrontierStateWriteCount = 0;
	let reciprocalRejectionCount = 0;
	let repeatedArrivalStatePixelCount = 0;
	let sourceScopeRejectionCount = 0;
	let terminalDestinationPixelReductionCount = 0;

	if (propagationRoundCount === 0) {
		const rootScopeOrdinal = routeScope(metadata, ROOT_STATE_ID);
		for (let pixel = 0; pixel < scene.pixelCount; pixel += 1) {
			reduceEnvelope(
				envelopeCovered,
				envelopeDepth,
				envelopeUnbounded,
				scene.pixelCount,
				rootScopeOrdinal,
				pixel,
				null,
			);
			envelopeSourcePixelReductionCount += 1;
		}
	}

	for (let round = 0; round < propagationRoundCount; round += 1) {
		next.fill(UNCOVERED_STATE_ID);
		for (let pixel = 0; pixel < scene.pixelCount; pixel += 1) {
			const currentState = current[pixel]!;
			if (currentState === UNCOVERED_STATE_ID) continue;
			frontierPixelReadCount += 1;
			const currentScopeOrdinal = routeScope(metadata, currentState);
			const reciprocalState = routeReciprocalState(metadata, currentState);
			const entryDepth = routeHasEntryPlane(metadata, currentState)
				? requireApertureDepth(
						scene.crossings[currentState - FIRST_CROSSING_STATE_ID]!,
						pixel,
					)
				: null;
			let nearestCrossingOrdinal = -1;
			let nearestCrossingDepth: PortalModelDepth | null = null;
			for (
				let crossingOrdinal = 0;
				crossingOrdinal < scene.crossings.length;
				crossingOrdinal += 1
			) {
				const crossing = scene.crossings[crossingOrdinal]!;
				const depth = crossing.aperture.depthByPixel[pixel];
				if (depth === null) continue;
				crossingApertureSampleReadCount += 1;
				if (
					requireScopeOrdinal(scopeOrdinalById, crossing.sourceScopeId) !==
					currentScopeOrdinal
				) {
					sourceScopeRejectionCount += 1;
					continue;
				}
				const outputState = FIRST_CROSSING_STATE_ID + crossingOrdinal;
				if (outputState === reciprocalState) {
					reciprocalRejectionCount += 1;
					continue;
				}
				if (entryDepth !== null && depth <= entryDepth) {
					// Mirrors the propagation shader: a shared host-proven junction id licenses
					// the equal-depth advance through a zero-thickness transit.
					const junction = routeJunctionGroup(metadata, currentState);
					const sameJunction =
						junction !== 0 &&
						junction ===
							routeJunctionGroup(
								metadata,
								FIRST_CROSSING_STATE_ID + crossingOrdinal,
							);
					if (!sameJunction || depth < entryDepth) {
						entryPlaneRejectionCount += 1;
						continue;
					}
					junctionAdmittedCount += 1;
				}
				if (nearestCrossingDepth === null || depth < nearestCrossingDepth) {
					nearestCrossingOrdinal = crossingOrdinal;
					nearestCrossingDepth = depth;
				}
			}

			const opaqueDepth =
				localOpaqueDepth[currentScopeOrdinal * scene.pixelCount + pixel]!;
			const crossingWins =
				nearestCrossingDepth !== null && opaqueDepth >= nearestCrossingDepth;
			if (nearestCrossingDepth !== null && !crossingWins) {
				localOpaqueDepthRejectionCount += 1;
			}
			const outputState = crossingWins
				? FIRST_CROSSING_STATE_ID + nearestCrossingOrdinal
				: UNCOVERED_STATE_ID;
			next[pixel] = outputState;
			if (outputState !== UNCOVERED_STATE_ID) {
				nextFrontierStateWriteCount += 1;
				const observedIndex = outputState * scene.pixelCount + pixel;
				if (observedStatePixel[observedIndex] !== 0) {
					repeatedArrivalStatePixelCount += 1;
				} else {
					observedStatePixel[observedIndex] = 1;
				}
			}
			reduceEnvelope(
				envelopeCovered,
				envelopeDepth,
				envelopeUnbounded,
				scene.pixelCount,
				currentScopeOrdinal,
				pixel,
				crossingWins ? nearestCrossingDepth : null,
			);
			envelopeSourcePixelReductionCount += 1;

			if (
				round === propagationRoundCount - 1 &&
				outputState !== UNCOVERED_STATE_ID
			) {
				reduceEnvelope(
					envelopeCovered,
					envelopeDepth,
					envelopeUnbounded,
					scene.pixelCount,
					routeScope(metadata, outputState),
					pixel,
					null,
				);
				terminalDestinationPixelReductionCount += 1;
			}
		}
		const previous = current;
		current = next;
		next = previous;
	}

	if (repeatedArrivalStatePixelCount !== 0) {
		throw new Error(
			"Packed portal propagation repeated an arrival state on one pixel ray.",
		);
	}

	return Object.freeze({
		diagnostics: Object.freeze({
			arrivalMetadataCapacityBytes: metadataBuffer.byteLength,
			arrivalMetadataPopulatedBytes:
				populatedStateCount * PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
			crossingApertureSampleReadCount,
			crossingRoundEvaluationCount:
				propagationRoundCount * scene.crossings.length,
			envelopeSourcePixelReductionCount,
			entryPlaneRejectionCount,
			junctionAdmittedCount,
			frontierClearCommandCount: propagationRoundCount,
			frontierPixelReadCount,
			localOpaqueDepthRejectionCount,
			metadataStateWriteCount: populatedStateCount,
			nextFrontierStateWriteCount,
			propagationCommandCount: propagationRoundCount,
			reciprocalRejectionCount,
			repeatedArrivalStatePixelCount,
			scopeEnvelopeReductionCommandCount: propagationRoundCount,
			sourceScopeRejectionCount,
			terminalDestinationPixelReductionCount,
		}),
		envelopes: materializeEnvelopes(
			scene,
			envelopeCovered,
			envelopeDepth,
			envelopeUnbounded,
		),
		family: "packed-arrival-state-frontiers" as const,
	});
}

function writeRoute(
	metadata: Uint32Array,
	stateId: number,
	scopeOrdinal: number,
	reciprocalStateId: number,
	hasEntryPlane: boolean,
	junctionGroup: number,
): void {
	const base = metadataRecordBase(stateId);
	metadata[base + ROUTE_SCOPE_SLOT] = scopeOrdinal;
	metadata[base + ROUTE_RECIPROCAL_STATE_SLOT] = reciprocalStateId;
	metadata[base + ROUTE_FLAGS_SLOT] = hasEntryPlane
		? PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE
		: 0;
	metadata[base + ROUTE_JUNCTION_SLOT] = junctionGroup;
}

function routeJunctionGroup(metadata: Uint32Array, stateId: number): number {
	return metadata[metadataRecordBase(stateId) + ROUTE_JUNCTION_SLOT]!;
}

function routeScope(metadata: Uint32Array, stateId: number): number {
	return metadata[metadataRecordBase(stateId) + ROUTE_SCOPE_SLOT]!;
}

function routeReciprocalState(metadata: Uint32Array, stateId: number): number {
	return metadata[metadataRecordBase(stateId) + ROUTE_RECIPROCAL_STATE_SLOT]!;
}

function routeHasEntryPlane(metadata: Uint32Array, stateId: number): boolean {
	return (
		(metadata[metadataRecordBase(stateId) + ROUTE_FLAGS_SLOT]! &
			PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE) !==
		0
	);
}

function metadataRecordBase(stateId: number): number {
	if (
		!Number.isInteger(stateId) ||
		stateId <= UNCOVERED_STATE_ID ||
		stateId > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT
	) {
		throw new Error(`Packed portal metadata state ${stateId} is unavailable.`);
	}
	return (stateId - ROOT_STATE_ID) * METADATA_UINT32_SLOT_COUNT;
}

function requireScopeOrdinal(
	ordinals: ReadonlyMap<PortalModelScopeId, number>,
	scopeId: PortalModelScopeId,
): number {
	const ordinal = ordinals.get(scopeId);
	if (ordinal === undefined) {
		throw new Error(`Packed portal metadata is missing scope ${scopeId}.`);
	}
	return ordinal;
}

function requireCrossingState(
	states: ReadonlyMap<string, number>,
	crossingId: string,
): number {
	const state = states.get(crossingId);
	if (state === undefined) {
		throw new Error(
			`Packed portal metadata is missing crossing ${crossingId}.`,
		);
	}
	return state;
}

function requireApertureDepth(
	crossing: PortalModelCrossing,
	pixel: number,
): PortalModelDepth {
	const depth = crossing.aperture.depthByPixel[pixel];
	if (depth === null) {
		throw new Error(
			`Packed portal state ${crossing.id} is uncovered at pixel ${pixel}.`,
		);
	}
	return depth;
}

function buildLocalOpaqueDepth(
	scene: PortalModelScene,
	scopeOrdinalById: ReadonlyMap<PortalModelScopeId, number>,
): Float64Array {
	const depths = new Float64Array(scene.scopes.length * scene.pixelCount);
	depths.fill(Number.POSITIVE_INFINITY);
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			if (
				fragment.kind !== "opaque" &&
				(fragment.kind !== "alpha-test" || !fragment.passes)
			) {
				continue;
			}
			const scopeOrdinal = requireScopeOrdinal(
				scopeOrdinalById,
				fragment.scopeId,
			);
			const index = scopeOrdinal * scene.pixelCount + fragment.pixel;
			depths[index] = Math.min(depths[index]!, fragment.depth);
		}
	}
	return depths;
}

function reduceEnvelope(
	covered: Uint8Array,
	depths: Float64Array,
	unbounded: Uint8Array,
	pixelCount: number,
	scopeOrdinal: number,
	pixel: number,
	exitDepth: PortalModelDepth | null,
): void {
	const index = scopeOrdinal * pixelCount + pixel;
	covered[index] = 1;
	if (exitDepth === null) {
		unbounded[index] = 1;
		depths[index] = Number.NaN;
		return;
	}
	if (unbounded[index] !== 0) return;
	const previous = depths[index]!;
	if (Number.isNaN(previous) || exitDepth > previous) {
		depths[index] = exitDepth;
	}
}

function materializeEnvelopes(
	scene: PortalModelScene,
	covered: Uint8Array,
	depths: Float64Array,
	unbounded: Uint8Array,
): readonly PortalScopeVisibilityEnvelope[] {
	const envelopes: PortalScopeVisibilityEnvelope[] = [];
	for (
		let scopeOrdinal = 0;
		scopeOrdinal < scene.scopes.length;
		scopeOrdinal += 1
	) {
		const pixels: number[] = [];
		const maximumExitDepthByPixel = Array<PortalModelDepth | null>(
			scene.pixelCount,
		).fill(null);
		for (let pixel = 0; pixel < scene.pixelCount; pixel += 1) {
			const index = scopeOrdinal * scene.pixelCount + pixel;
			if (covered[index] === 0) continue;
			pixels.push(pixel);
			if (unbounded[index] === 0) {
				maximumExitDepthByPixel[pixel] = portalModelDepth(depths[index]!);
			}
		}
		if (pixels.length === 0) continue;
		envelopes.push(
			Object.freeze({
				coverage: createPortalModelFootprint(scene.pixelCount, pixels),
				maximumExitDepthByPixel: Object.freeze(maximumExitDepthByPixel),
				scopeId: scene.scopes[scopeOrdinal]!.id,
			}),
		);
	}
	return Object.freeze(
		envelopes.sort((left, right) => left.scopeId.localeCompare(right.scopeId)),
	);
}
