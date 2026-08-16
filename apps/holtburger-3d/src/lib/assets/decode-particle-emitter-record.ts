import { z } from "zod";
import type { DatAssetId } from "../game/game-types";
import { acVector3, type AcVector3 } from "./ac-frame";

const HEADER_LENGTH = 12;
const MAGIC = "HBPE";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);

const manifestSchema = z.object({
	transport: z.literal("holtburger-particle-emitter"),
	byteOrder: z.literal("little-endian"),
	emitterInfoId: datId,
	/** `null` for a `ParticleType` no shipped emitter authors. */
	motionType: z.number().int().positive().nullable(),
	emitsPerSecond: z.boolean(),
	emitsPerMeter: z.boolean(),
	hardwareMesh: z
		.object({
			id: datId,
			radius: finite.nonnegative(),
		})
		.nullable(),
	birthrateSeconds: finite.nonnegative(),
	maxParticles: z.number().int().nonnegative(),
	initialParticles: z.number().int().nonnegative(),
	totalParticles: z.number().int().nonnegative(),
	totalSeconds: finite.nonnegative(),
	isPersistent: z.boolean(),
	lifespan: finite.nonnegative(),
	lifespanRand: finite,
	offsetDir: vec3,
	minOffset: finite,
	maxOffset: finite,
	a: vec3,
	minA: finite,
	maxA: finite,
	b: vec3,
	minB: finite,
	maxB: finite,
	c: vec3,
	minC: finite,
	maxC: finite,
	startScale: finite,
	finalScale: finite,
	scaleRand: finite,
	startTrans: finite,
	finalTrans: finite,
	transRand: finite,
	followsParent: z.boolean(),
});

/**
 * One decoded authored emitter definition.
 *
 * Immutable content, shared across every emitter instance that references it; nothing here is
 * per-activation state.
 */
export type DecodedParticleEmitterInfo = Omit<
	z.infer<typeof manifestSchema>,
	| "transport"
	| "byteOrder"
	| "emitterInfoId"
	| "hardwareMesh"
	| "a"
	| "b"
	| "c"
	| "offsetDir"
> & {
	readonly id: DatAssetId;
	/** Complete drawable-mesh fact, or `null` for retail's zero-hardware-DID inert case. */
	readonly hardwareMesh: {
		readonly id: DatAssetId;
		readonly radius: number;
	} | null;
	/**
	 * Motion constants, deliberately left in AC's authored axes.
	 *
	 * The Swarm and Explode laws treat their components asymmetrically, so their axis meaning lives
	 * in the component index and cannot survive a componentwise conversion here. `particlePosition`
	 * evaluates in this space and converts the resulting displacement once.
	 */
	readonly a: AcVector3;
	readonly b: AcVector3;
	readonly c: AcVector3;
	readonly offsetDir: AcVector3;
};

/** Decode and validate one typed particle-emitter host response. */
export function decodeParticleEmitterRecord(
	response: Uint8Array,
	expectedEmitterInfoId: DatAssetId,
): DecodedParticleEmitterInfo {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error("Particle emitter response is shorter than its header.");
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected particle emitter magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Particle emitter length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, HEADER_LENGTH + manifestLength),
			),
		);
	} catch (cause) {
		throw new Error("Particle emitter manifest is not valid JSON.", { cause });
	}
	const result = manifestSchema.safeParse(parsed);
	if (!result.success)
		throw new Error(
			`Particle emitter manifest is invalid: ${result.error.message}`,
		);
	const manifest = result.data;
	if (
		manifest.emitterInfoId.toLowerCase() !== expectedEmitterInfoId.toLowerCase()
	) {
		throw new Error(
			`Particle emitter host returned ${manifest.emitterInfoId} for ${expectedEmitterInfoId}.`,
		);
	}
	// An emitter with neither trigger bit set can never release a particle; that is a decode fault,
	// not authored content, and silently producing a dead emitter would be worse than failing.
	if (!manifest.emitsPerSecond && !manifest.emitsPerMeter) {
		throw new Error(
			`Particle emitter ${manifest.emitterInfoId} authors no emission trigger.`,
		);
	}
	if (
		manifest.hardwareMesh !== null &&
		!manifest.hardwareMesh.id.toLowerCase().startsWith("0x01")
	) {
		throw new Error(
			`Particle emitter ${manifest.emitterInfoId} hardware mesh ${manifest.hardwareMesh.id} is not a GfxObj.`,
		);
	}
	const { transport, byteOrder, emitterInfoId, hardwareMesh, ...rest } =
		manifest;
	void transport;
	void byteOrder;
	return {
		...rest,
		// Brand the authored Z-up values at the decode boundary; spawn and motion own the later
		// frame rotation and render-axis conversion.
		a: acVector3(manifest.a),
		b: acVector3(manifest.b),
		c: acVector3(manifest.c),
		offsetDir: acVector3(manifest.offsetDir),
		hardwareMesh:
			hardwareMesh === null
				? null
				: { id: hardwareMesh.id as DatAssetId, radius: hardwareMesh.radius },
		id: emitterInfoId as DatAssetId,
	};
}
