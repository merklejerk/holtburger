import type { AnimationAssetSource } from "../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../assets/decode-animation-record";
import type { DecodedSoundTable } from "../assets/decode-sound-table-record";
import type { DecodedStaticPresentation } from "../assets/decode-static-source-record";
import type { SetupVisualSource } from "../assets/setup-visual-source";
import type { SoundTableSource } from "../assets/sound-table-source";
import type { DatAssetId } from "../game/game-types";
import type { AudioDevice } from "../game/systems/audio-system";

/**
 * The fixed UIASSET identities proved by the retail mapper and DAT census.
 *
 * Keeping this catalog app-local prevents renderer, audio, tests, and lifecycle code from
 * independently spelling the same closure. The setup request uses the host's numeric DID shape;
 * the other source adapters use their normal canonical hexadecimal strings.
 */
const PORTAL_TRANSITION_CATALOG = Object.freeze({
	setupDid: 0x0200_0306,
	setupDidText: "0x02000306" as DatAssetId,
	animationId: "0x030005ac" as DatAssetId,
	/** Retail enters this portal sequence at frame 1 (`acclient.c:252663-252668`). */
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

/** Sources needed to prepare the one mandatory portal closure. */
export interface PortalTransitionAssetSources {
	readonly setupVisual: SetupVisualSource;
	readonly animation: AnimationAssetSource;
	readonly soundTable: SoundTableSource;
	readonly audio: AudioDevice;
}

/** Immutable decoded closure retained by the presentation owner for its whole lifetime. */
export interface PortalTransitionAssets {
	readonly catalog: typeof PORTAL_TRANSITION_CATALOG;
	readonly visual: DecodedStaticPresentation;
	readonly animation: DecodedAnimationAsset;
	readonly soundTable: DecodedSoundTable;
	readonly waveIds: readonly DatAssetId[];
	/** Exact source bytes retained by the closure; wave values are decoder-ready payload bytes. */
	readonly sourceBytes: {
		readonly setupVisual: number | null;
		readonly animation: number | null;
		readonly soundTable: number | null;
		readonly waves: number | null;
		/** Sum when every source reports a size, otherwise null rather than a partial total. */
		readonly total: number | null;
	};
}

/**
 * Load and validate the complete authored portal closure before a 3D mode can start.
 *
 * Audio preparation is deliberately part of construction: the loading presentation cannot first
 * discover the sound it exists to cover. The WebAudio device retains decoded buffers until owner
 * teardown, while the returned value retains the source records used by the tunnel renderer.
 */
export async function loadPortalTransitionAssets(
	sources: PortalTransitionAssetSources,
): Promise<PortalTransitionAssets> {
	const [visual, animation, soundTable] = await Promise.all([
		sources.setupVisual.load(
			PORTAL_TRANSITION_CATALOG.setupDid,
			PORTAL_TRANSITION_APPEARANCE,
		),
		sources.animation.loadAnimation(PORTAL_TRANSITION_CATALOG.animationId),
		sources.soundTable.loadSoundTable(PORTAL_TRANSITION_CATALOG.soundTableId),
	]);
	validatePortalVisual(visual);
	validatePortalAnimation(animation);
	validatePortalSoundTable(soundTable);
	const waveIds = Object.freeze([
		PORTAL_TRANSITION_CATALOG.enterSoundId,
		PORTAL_TRANSITION_CATALOG.exitSoundId,
		PORTAL_TRANSITION_CATALOG.animationHookSoundId,
	]);
	await Promise.all(waveIds.map((soundId) => sources.audio.prepare(soundId)));
	const getPreparedSourceBytes = sources.audio.getPreparedSourceBytes;
	const waveSourceBytes = getPreparedSourceBytes
		? waveIds.map((soundId) =>
				getPreparedSourceBytes.call(sources.audio, soundId),
			)
		: waveIds.map(() => null);
	const waveBytes = sumKnownBytes(waveSourceBytes);
	const sourceBytes = Object.freeze({
		animation: animation.sourceByteLength ?? null,
		setupVisual: visual.sourceByteLength ?? null,
		soundTable: soundTable.sourceByteLength ?? null,
		total: sumKnownBytes([
			visual.sourceByteLength ?? null,
			animation.sourceByteLength ?? null,
			soundTable.sourceByteLength ?? null,
			waveBytes,
		]),
		waves: waveBytes,
	});
	return Object.freeze({
		animation,
		catalog: PORTAL_TRANSITION_CATALOG,
		soundTable,
		sourceBytes,
		visual,
		waveIds,
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
