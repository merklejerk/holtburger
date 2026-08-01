import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type {
	DecodedAnimationAsset,
	DecodedAnimationHook,
} from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import type { Mat4 } from "../math/types";

/** Retail setup-default animation rate installed by `CPartArray::InitDefaults`. */
const STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND = 30;

/** Immutable prepared animation shared independently from entity playback state. */
export interface PreparedAnimation {
	readonly id: DatAssetId;
	readonly frameCount: number;
	readonly partCount: number;
	readonly framesPerSecond: number;
	/** Frame-major rigid-part transforms indexed by `frame * partCount + part`. */
	readonly partFrames: readonly Mat4[];
	/** Optional frame-major root offsets retained but unused by static-default playback. */
	readonly positionFrames: readonly Mat4[];
	readonly hooks: readonly DecodedAnimationHook[];
}

/** One deterministic reference to a shared prepared animation. */
export interface PreparedAnimationHandle {
	readonly animation: PreparedAnimation;
	release(): void;
}

type AnimationEntryState =
	| {
			readonly kind: "preparing";
			readonly completion: Promise<PreparedAnimation>;
	  }
	| { readonly kind: "ready"; readonly animation: PreparedAnimation }
	| { readonly kind: "failed"; readonly cause: unknown };

interface AnimationEntry {
	readonly id: DatAssetId;
	referenceCount: number;
	state: AnimationEntryState;
}

/** Shares immutable animation transfer/preparation and owns exact acquired-handle lifetimes. */
export class AnimationAssetRepository {
	readonly #source: AnimationAssetSource;
	readonly #entries = new Map<DatAssetId, AnimationEntry>();
	#destroyed = false;

	constructor(source: AnimationAssetSource) {
		this.#source = source;
	}

	async acquire(animationId: DatAssetId): Promise<PreparedAnimationHandle> {
		if (this.#destroyed)
			throw new Error("Cannot acquire from a destroyed animation repository.");
		const entry = this.#entries.get(animationId) ?? this.#start(animationId);
		entry.referenceCount += 1;
		let animation: PreparedAnimation;
		try {
			animation = await entryCompletion(entry);
		} catch (cause) {
			entry.referenceCount -= 1;
			throw cause;
		}
		let released = false;
		return {
			animation,
			release: () => {
				if (released)
					throw new Error(`Animation ${animationId} handle released twice.`);
				released = true;
				this.#release(entry);
			},
		};
	}

	getState(animationId: DatAssetId): AnimationEntryState["kind"] | null {
		return this.#entries.get(animationId)?.state.kind ?? null;
	}

	getDiagnostics() {
		const entries = [...this.#entries.values()];
		return {
			animationCount: entries.length,
			failedAnimationCount: entries.filter(
				(entry) => entry.state.kind === "failed",
			).length,
			preparingAnimationCount: entries.filter(
				(entry) => entry.state.kind === "preparing",
			).length,
			readyAnimationCount: entries.filter(
				(entry) => entry.state.kind === "ready",
			).length,
			referenceCount: entries.reduce(
				(total, entry) => total + entry.referenceCount,
				0,
			),
		};
	}

	/** Remove one cached failed load so an explicit later acquisition may retry. */
	evictFailed(animationId: DatAssetId): void {
		const entry = this.#entries.get(animationId);
		if (!entry) return;
		if (entry.state.kind !== "failed" || entry.referenceCount !== 0) {
			throw new Error(
				`Animation ${animationId} is not an unreferenced failure.`,
			);
		}
		this.#entries.delete(animationId);
	}

	destroy(): void {
		if (this.#destroyed) return;
		const referenced = [...this.#entries.values()].find(
			(entry) => entry.referenceCount !== 0,
		);
		if (referenced) {
			throw new Error(
				`Cannot destroy animation repository while ${referenced.id} is referenced.`,
			);
		}
		this.#destroyed = true;
		this.#entries.clear();
		this.#source.destroy();
	}

	#start(animationId: DatAssetId): AnimationEntry {
		const entry: AnimationEntry = {
			id: animationId,
			referenceCount: 0,
			state: {
				cause: new Error("Animation preparation did not start."),
				kind: "failed",
			},
		};
		const completion = this.#source
			.loadAnimation(animationId)
			.then((decoded) => prepareAnimation(decoded, animationId))
			.then((animation) => {
				if (this.#entries.get(animationId) === entry)
					entry.state = { animation, kind: "ready" };
				return animation;
			})
			.catch((cause: unknown) => {
				if (this.#entries.get(animationId) === entry)
					entry.state = { cause, kind: "failed" };
				throw cause;
			});
		entry.state = { completion, kind: "preparing" };
		this.#entries.set(animationId, entry);
		return entry;
	}

	#release(entry: AnimationEntry): void {
		if (entry.referenceCount <= 0)
			throw new Error(`Animation ${entry.id} has no reference to release.`);
		entry.referenceCount -= 1;
		if (entry.referenceCount === 0 && entry.state.kind === "ready")
			this.#entries.delete(entry.id);
	}
}

function entryCompletion(entry: AnimationEntry): Promise<PreparedAnimation> {
	if (entry.state.kind === "preparing") return entry.state.completion;
	if (entry.state.kind === "ready")
		return Promise.resolve(entry.state.animation);
	return Promise.reject(entry.state.cause);
}

function prepareAnimation(
	decoded: DecodedAnimationAsset,
	expectedId: DatAssetId,
): PreparedAnimation {
	if (decoded.id.toLowerCase() !== expectedId.toLowerCase())
		throw new Error(
			`Animation source returned ${decoded.id} for ${expectedId}.`,
		);
	if (decoded.partFrames.length !== decoded.frameCount * decoded.partCount) {
		throw new Error(
			`Animation ${decoded.id} has an incomplete rigid-part frame table.`,
		);
	}
	if (
		decoded.positionFrames.length !== 0 &&
		decoded.positionFrames.length !== decoded.frameCount
	) {
		throw new Error(
			`Animation ${decoded.id} has an incomplete position-frame table.`,
		);
	}
	return {
		frameCount: decoded.frameCount,
		framesPerSecond: STATIC_DEFAULT_ANIMATION_FRAMES_PER_SECOND,
		hooks: decoded.hooks,
		id: decoded.id,
		partCount: decoded.partCount,
		partFrames: decoded.partFrames,
		positionFrames: decoded.positionFrames,
	};
}
