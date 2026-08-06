import type {
	DecodedPhysicsScript,
	DecodedPhysicsScriptRecord,
} from "../../assets/decode-physics-script-record";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import type { DatAssetId } from "../game-types";
import {
	PreparedAssetRepository,
	type PreparedAssetHandle,
} from "./prepared-asset-repository";

/** Assets one script references directly, discovered once during preparation. */
interface PhysicsScriptDependencies {
	/** `CallPES` targets. These edges may be cyclic and are preserved, not pruned. */
	readonly scriptIds: readonly DatAssetId[];
	/** 0x32 `ParticleEmitterInfo` DIDs named by `CreateParticle`. */
	readonly emitterInfoIds: readonly DatAssetId[];
	/** 0x0A `Wave` DIDs named directly by `SoundTweaked`. */
	readonly soundIds: readonly DatAssetId[];
}

/** Immutable prepared physics script shared independently from per-entity clock state. */
export interface PreparedPhysicsScript {
	readonly id: DatAssetId;
	/** Interval at which a self-`CallPES` repeats, with no drift. */
	readonly lengthSeconds: number;
	/** Records in execution order: by time, ties broken by authored order. */
	readonly records: readonly DecodedPhysicsScriptRecord[];
	readonly dependencies: PhysicsScriptDependencies;
}

type PreparedPhysicsScriptHandle = PreparedAssetHandle<PreparedPhysicsScript>;

/**
 * Every script reachable from one root, held together and released as one unit.
 *
 * Activation needs the whole closure staged before the first record runs, because a `CallPES`
 * reached mid-playback must not trigger a load at frame time.
 */
export interface PreparedPhysicsScriptClosure {
	readonly rootId: DatAssetId;
	/** Every reachable script keyed by id, including the root. */
	readonly scripts: ReadonlyMap<DatAssetId, PreparedPhysicsScript>;
	release(): void;
}

/** Shares immutable physics-script transfer/preparation over the common asset lifecycle. */
export class PhysicsScriptRepository extends PreparedAssetRepository<
	DecodedPhysicsScript,
	PreparedPhysicsScript
> {
	constructor(source: PhysicsScriptSource) {
		super({
			destroySource: () => source.destroy(),
			label: "PhysicsScript",
			load: (scriptId) => source.loadPhysicsScript(scriptId),
			prepare: preparePhysicsScript,
		});
	}

	/**
	 * Acquire a root script and everything its `CallPES` edges reach.
	 *
	 * Traversal terminates on a visited set, so the shipped cyclic graphs — self-calls and mutual
	 * two-script cycles alike — prepare finitely. The cyclic *runtime* edges survive untouched in
	 * each script's records; only the traversal is acyclic.
	 *
	 * Acquisition is all-or-nothing: a failure anywhere releases every handle taken so far, so a
	 * partially staged closure can never reach activation.
	 */
	async acquireClosure(
		rootId: DatAssetId,
	): Promise<PreparedPhysicsScriptClosure> {
		const handles = new Map<DatAssetId, PreparedPhysicsScriptHandle>();
		const releaseAll = () => {
			for (const handle of handles.values()) handle.release();
			handles.clear();
		};
		try {
			const pending: DatAssetId[] = [rootId];
			while (pending.length > 0) {
				const scriptId = pending.pop()!;
				if (handles.has(scriptId)) continue;
				let handle: PreparedPhysicsScriptHandle;
				try {
					handle = await this.acquire(scriptId);
				} catch (cause) {
					throw new Error(
						`Physics script closure for ${rootId} could not stage ${scriptId}.`,
						{ cause },
					);
				}
				// Record before recursing so a cycle back to this script terminates.
				handles.set(scriptId, handle);
				pending.push(...handle.asset.dependencies.scriptIds);
			}
		} catch (cause) {
			releaseAll();
			throw cause;
		}

		const scripts = new Map<DatAssetId, PreparedPhysicsScript>(
			[...handles].map(([scriptId, handle]) => [scriptId, handle.asset]),
		);
		let released = false;
		return {
			release: () => {
				if (released)
					throw new Error(
						`Physics script closure for ${rootId} released twice.`,
					);
				released = true;
				releaseAll();
			},
			rootId,
			scripts,
		};
	}
}

function preparePhysicsScript(
	decoded: DecodedPhysicsScript,
	expectedId: DatAssetId,
): PreparedPhysicsScript {
	if (decoded.id.toLowerCase() !== expectedId.toLowerCase()) {
		throw new Error(
			`Physics script source returned ${decoded.id} for ${expectedId}.`,
		);
	}
	return {
		dependencies: collectDependencies(decoded.records),
		id: decoded.id,
		lengthSeconds: decoded.lengthSeconds,
		records: decoded.records,
	};
}

/**
 * Derive one script's direct asset references from its own records.
 *
 * Deliberately derived rather than transported: a separate dependency list in the manifest could
 * disagree with the records it describes, and there is exactly one right answer.
 */
function collectDependencies(
	records: readonly DecodedPhysicsScriptRecord[],
): PhysicsScriptDependencies {
	const scriptIds = new Set<DatAssetId>();
	const emitterInfoIds = new Set<DatAssetId>();
	const soundIds = new Set<DatAssetId>();
	for (const record of records) {
		if (record.kind === "call-pes") scriptIds.add(record.scriptId);
		if (record.kind === "create-particle")
			emitterInfoIds.add(record.emitterInfoId);
		if (record.kind === "sound-tweaked") soundIds.add(record.soundId);
	}
	return {
		emitterInfoIds: [...emitterInfoIds],
		scriptIds: [...scriptIds],
		soundIds: [...soundIds],
	};
}
