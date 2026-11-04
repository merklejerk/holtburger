import type { AnimationAssetSource } from "../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../assets/decode-animation-record";
import type { DecodedSoundTable } from "../assets/decode-sound-table-record";
import type { DecodedStaticPresentation } from "../assets/decode-static-source-record";
import type { SetupVisualSource } from "../assets/setup-visual-source";
import type { SoundTableSource } from "../assets/sound-table-source";
import type { DatAssetId } from "../game/game-types";
import type { AudioDevice } from "../game/systems/audio-system";
import { optionalPresentationContent } from "../assets/optional-presentation-content";

/**
 * The fixed UIASSET identities proved by the retail mapper and DAT census.
 *
 * Keeping this catalog app-local prevents renderer, audio, tests, and lifecycle code from
 * independently spelling the same asset set. The setup request uses the host's numeric DID shape;
 * the other source adapters use their normal canonical hexadecimal strings.
 */
const PORTAL_TRANSITION_CATALOG = Object.freeze({
	setupDid: 0x0200_0306,
	setupDidText: "0x02000306" as DatAssetId,
	animationId: "0x030005ac" as DatAssetId,
	/** Retail enters this portal sequence at frame 1. */
	animationLowFrame: 1,
	animationFramesPerSecond: 40,
	soundTableId: "0x2000004b" as DatAssetId,
	enterSoundId: "0x0a000246" as DatAssetId,
	exitSoundId: "0x0a000245" as DatAssetId,
	animationHookSoundId: "0x0a000316" as DatAssetId,
	enterSoundType: 0x6a,
	exitSoundType: 0x6b,
});

/** Empty ObjDesc facts select the setup's authored default appearance. */
const PORTAL_TRANSITION_APPEARANCE = Object.freeze({
	paletteDid: null,
	subPalettes: Object.freeze([]),
	textureChanges: Object.freeze([]),
	partChanges: Object.freeze([]),
});

/** Sources for optional authored portal visuals and sounds. */
export interface PortalTransitionAssetSources {
	/** Cold error surface for degraded portal presentation; never native installation recovery. */
	readonly reportContentFailure: (error: Error) => void;
	readonly setupVisual: SetupVisualSource;
	readonly animation: AnimationAssetSource;
	readonly soundTable: SoundTableSource;
	readonly audio: AudioDevice;
}

/** Immutable authored assets retained by the presentation owner for its whole lifetime. */
export interface PortalTransitionAssets {
	readonly catalog: typeof PORTAL_TRANSITION_CATALOG;
	readonly visual: DecodedStaticPresentation;
	readonly animation: DecodedAnimationAsset;
	readonly soundTable: DecodedSoundTable | null;
	readonly waveIds: readonly DatAssetId[];
	/** Exact source bytes retained by the asset set; wave values are decoder-ready payload bytes. */
	readonly sourceBytes: {
		readonly setupVisual: number | null;
		readonly animation: number | null;
		readonly soundTable: number | null;
		readonly waves: number | null;
		/** Sum when every source reports a size, otherwise null rather than a partial total. */
		readonly total: number | null;
	};
}

/** Ready head-locked sounds and their retained decoder-ready byte census. */
export interface PortalTransitionAudio {
	/** Optional authored sound mapping, refreshed together with failed wave readiness. */
	readonly soundTable: DecodedSoundTable | null;
	readonly waveIds: readonly DatAssetId[];
	readonly sourceByteLength: number | null;
}

/** Prewarm failed portal sounds on explicit retry; the audio device retains successful buffers. */
export async function preparePortalTransitionAudio(
	audio: AudioDevice,
	soundTables: SoundTableSource,
	report: (error: Error) => void,
): Promise<PortalTransitionAudio> {
	const requested = [
		PORTAL_TRANSITION_CATALOG.enterSoundId,
		PORTAL_TRANSITION_CATALOG.exitSoundId,
		PORTAL_TRANSITION_CATALOG.animationHookSoundId,
	];
	const soundTable = await optionalPresentationContent(
		soundTables.loadSoundTable(PORTAL_TRANSITION_CATALOG.soundTableId),
		"Portal sound table",
		report,
	);
	if (soundTable !== null) validatePortalSoundTable(soundTable);
	const prepared = await Promise.all(
		requested.map((soundId) =>
			optionalPresentationContent(
				audio.prepare(soundId).then(() => soundId),
				`Portal sound ${soundId}`,
				report,
			),
		),
	);
	const waveIds = Object.freeze(prepared.filter((id) => id !== null));
	const bytes = waveIds.map((id) =>
		audio.getPreparedSourceBytes ? audio.getPreparedSourceBytes(id) : null,
	);
	return { soundTable, waveIds, sourceByteLength: sumKnownBytes(bytes) };
}

/**
 * Prepare authored portal assets; unavailable artwork selects opaque loading presentation.
 *
 * Audio preparation is deliberately part of construction: the loading presentation cannot first
 * discover the sound it exists to cover. The WebAudio device retains decoded buffers until owner
 * teardown, while the returned value retains the source records used by the tunnel renderer.
 */
export async function loadPortalTransitionAssets(
	sources: PortalTransitionAssetSources,
): Promise<PortalTransitionAssets | null> {
	const [visual, animation] = await Promise.all([
		optionalPresentationContent(
			sources.setupVisual.load(
				PORTAL_TRANSITION_CATALOG.setupDid,
				PORTAL_TRANSITION_APPEARANCE,
			),
			"Portal visual",
			sources.reportContentFailure,
		),
		optionalPresentationContent(
			sources.animation.loadAnimation(PORTAL_TRANSITION_CATALOG.animationId),
			"Portal animation",
			sources.reportContentFailure,
		),
	]);
	if (visual === null || animation === null) return null;
	validatePortalVisual(visual);
	validatePortalAnimation(animation);
	return withPortalTransitionAudio(
		{ visual, animation, catalog: PORTAL_TRANSITION_CATALOG },
		await preparePortalTransitionAudio(
			sources.audio,
			sources.soundTable,
			sources.reportContentFailure,
		),
	);
}

/** Replace audio readiness atomically while preserving the valid authored visual and animation. */
export function withPortalTransitionAudio(
	assets: Pick<PortalTransitionAssets, "visual" | "animation" | "catalog">,
	audio: PortalTransitionAudio,
): PortalTransitionAssets {
	const { visual, animation, catalog } = assets;
	const { soundTable } = audio;
	const waveBytes = audio.sourceByteLength;
	const sourceBytes = Object.freeze({
		animation: animation.sourceByteLength ?? null,
		setupVisual: visual.sourceByteLength ?? null,
		soundTable: soundTable?.sourceByteLength ?? null,
		total: sumKnownBytes([
			visual.sourceByteLength ?? null,
			animation.sourceByteLength ?? null,
			soundTable?.sourceByteLength ?? null,
			waveBytes,
		]),
		waves: waveBytes,
	});
	return Object.freeze({
		animation,
		catalog,
		soundTable,
		sourceBytes,
		visual,
		waveIds: audio.waveIds,
	});
}

/** Sum only a complete byte census; an unknown member makes the total explicitly unknown. */
function sumKnownBytes(bytes: readonly (number | null)[]): number | null {
	let total = 0;
	for (const value of bytes) {
		if (value === null) return null;
		total += value;
	}
	if (!Number.isSafeInteger(total)) {
		throw new Error(
			"Portal transition source byte census exceeds safe integers.",
		);
	}
	return total;
}

function validatePortalVisual(visual: DecodedStaticPresentation): void {
	if (
		visual.setupId?.toLowerCase() !== PORTAL_TRANSITION_CATALOG.setupDidText
	) {
		throw new Error(
			`Portal setup visual returned ${visual.setupId ?? "no setup"}; expected ${PORTAL_TRANSITION_CATALOG.setupDidText}.`,
		);
	}
}

function validatePortalAnimation(animation: DecodedAnimationAsset): void {
	if (animation.id.toLowerCase() !== PORTAL_TRANSITION_CATALOG.animationId) {
		throw new Error(
			`Portal animation returned ${animation.id}; expected ${PORTAL_TRANSITION_CATALOG.animationId}.`,
		);
	}
	if (animation.frameCount !== 120 || animation.partCount !== 2) {
		throw new Error(
			`Portal animation ${animation.id} has ${animation.frameCount} frames and ${animation.partCount} parts; expected 120 frames and 2 parts.`,
		);
	}
	if (
		!animation.hooks.some(
			(hook) =>
				hook.kind === "sound-tweaked" &&
				hook.soundId.toLowerCase() ===
					PORTAL_TRANSITION_CATALOG.animationHookSoundId,
		)
	) {
		throw new Error(
			`Portal animation ${animation.id} is missing its authored hook sound ${PORTAL_TRANSITION_CATALOG.animationHookSoundId}.`,
		);
	}
}

function validatePortalSoundTable(soundTable: DecodedSoundTable): void {
	if (soundTable.id.toLowerCase() !== PORTAL_TRANSITION_CATALOG.soundTableId) {
		throw new Error(
			`Portal sound table returned ${soundTable.id}; expected ${PORTAL_TRANSITION_CATALOG.soundTableId}.`,
		);
	}
	const requiredEntries = [
		[
			PORTAL_TRANSITION_CATALOG.enterSoundType,
			PORTAL_TRANSITION_CATALOG.enterSoundId,
		],
		[
			PORTAL_TRANSITION_CATALOG.exitSoundType,
			PORTAL_TRANSITION_CATALOG.exitSoundId,
		],
	] as const;
	for (const [soundType, soundId] of requiredEntries) {
		const candidates = soundTable.entries.get(soundType);
		if (
			candidates === undefined ||
			!candidates.some(
				(candidate) => candidate.soundId.toLowerCase() === soundId,
			)
		) {
			throw new Error(
				`Portal sound table ${soundTable.id} is missing sound ${soundId} for key 0x${soundType.toString(16)}.`,
			);
		}
	}
}
