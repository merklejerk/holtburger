import { acVector3, acVectorToRender } from "../../assets/ac-frame";
import type { DecodedPhysicsScript } from "../../assets/decode-physics-script-record";
import type { DatAssetId } from "../game-types";
import type { PreparedBehaviorCommand } from "./prepared-behavior-command";

/**
 * The measured representative authored physics-script closure, checked in as source.
 *
 * Transcribed 2026-08-06 from `0xDA55FFFF`/`0xDC58FFFF` via a temporary archive probe that was
 * removed afterwards; the full decoded table is recorded in
 * `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md`. Fixtures are source-first on
 * purpose — no test may depend on the production archive.
 *
 * The set is small but covers every shape the runtime must survive:
 *
 * - three self-cycles (`0x330003CC`, `0x33000711`, `0x33000863`),
 * - two roots that lead *into* a cycle rather than being one (`0x330003D8`, `0x33000862`),
 * - both particle attachment forms (`part = -1` and `part = 0`),
 * - a zero pause (synchronous chaining) and a nonzero pause (random deferral),
 * - and assets shared across scripts, so preparation dedup is observable.
 */
export const AUTHORED_SCRIPT_FIXTURES: Readonly<
	Record<string, DecodedPhysicsScript>
> = buildFixtures({
	"0x33000253": [
		[0, createParticle("0x3200020c", 0, [0, 0, 0])],
		[0, soundTweaked("0x0a00038a", 0.01)],
		[2, callPes("0x330003cc", 0)],
	],
	"0x330003cc": [
		[0, soundTweaked("0x0a00038a", 0.01)],
		[2, callPes("0x330003cc", 0)],
	],
	"0x330003d8": [
		[0, soundTweaked("0x0a00038a", 0.01)],
		[2, callPes("0x330003cc", 0)],
	],
	"0x330003ec": [
		[0, createParticle("0x320002a5", 0, [0, 0, 10])],
		[0, createParticle("0x320002a5", 0, [0, 0, 6])],
	],
	"0x330006ef": [[0, createParticle("0x320003a6", -1, [0, 0, 0])]],
	"0x33000711": [
		[0, soundTweaked("0x0a000341", 0.1)],
		[3, callPes("0x33000711", 0)],
	],
	"0x330007df": [[0, createParticle("0x32000829", -1, [0, 0, 1.2])]],
	"0x33000862": [
		[0, createParticle("0x32000478", -1, [0, 0, 1])],
		[0, callPes("0x33000863", 0)],
	],
	"0x33000863": [
		[0, soundTweaked("0x0a000207", 0.3)],
		// The one nonzero pause in the measured set: a uniform random delay bound, not a delay.
		[2, callPes("0x33000863", 1)],
	],
	"0x33000ba5": [[0, createParticle("0x3200061f", -1, [0, 0, 0.5])]],
	"0x33001013": [[0, createParticle("0x32000894", -1, [0, 0, 0])]],
});

/** Roots reached directly by a setup `default_script` in the measured landblocks. */
export const AUTHORED_SCRIPT_ROOT_IDS = [
	"0x33000253",
	"0x330003d8",
	"0x330003ec",
	"0x330006ef",
	"0x33000711",
	"0x330007df",
	"0x33000862",
	"0x33000ba5",
	"0x33001013",
] as const satisfies readonly DatAssetId[];

/** A fixture authors the semantic command; the builder supplies script-lane provenance. */
type FixtureCommand = PreparedBehaviorCommand;

function createParticle(
	emitterInfoId: string,
	partIndex: number,
	/** Authored AC-space offset, exactly as the archive records it. */
	offsetOrigin: readonly [number, number, number],
): FixtureCommand {
	return {
		emitterId: 0,
		emitterInfoId: emitterInfoId as DatAssetId,
		kind: "create-particle",
		offsetOrigin: acVectorToRender(acVector3(offsetOrigin)),
		partIndex,
	};
}

/** Every measured record authors probability 1.0, which is what proves retail's field order. */
function soundTweaked(soundId: string, volume: number): FixtureCommand {
	return {
		kind: "sound-tweaked",
		probability: 1,
		soundId: soundId as DatAssetId,
		volume,
	};
}

function callPes(scriptId: string, pauseSeconds: number): FixtureCommand {
	return {
		kind: "call-pes",
		pauseSeconds,
		scriptId: scriptId as DatAssetId,
	};
}

function buildFixtures(
	authored: Record<string, readonly (readonly [number, FixtureCommand])[]>,
): Record<string, DecodedPhysicsScript> {
	const fixtures: Record<string, DecodedPhysicsScript> = {};
	for (const [scriptId, records] of Object.entries(authored)) {
		fixtures[scriptId] = {
			id: scriptId as DatAssetId,
			lengthSeconds: records.at(-1)?.[0] ?? 0,
			records: records.map(([startTime, command], authoredOrder) => ({
				authoredOrder,
				startTime,
				...command,
			})),
		};
	}
	return fixtures;
}
