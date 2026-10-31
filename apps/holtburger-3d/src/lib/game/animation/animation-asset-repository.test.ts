import { describe, expect, it } from "vitest";
import { HostCommandError } from "../../host/host-command-result";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import { Mat4 } from "../math/types";
import {
	AnimationAssetRepository,
	prepareAnimation,
} from "./animation-asset-repository";

describe("AnimationAssetRepository", () => {
	it("allows a caller to retain the authored traversal rate", () => {
		const prepared = prepareAnimation(animation(), "0x03000001", 40);

		expect(prepared.framesPerSecond).toBe(40);
	});

	it("shares one in-flight load and releases the prepared value exactly", async () => {
		const source = new DeferredAnimationSource();
		const repository = new AnimationAssetRepository(source);
		const first = repository.acquire("0x03000001");
		const second = repository.acquire("0x03000001");
		expect(source.loads).toEqual(["0x03000001"]);

		source.resolveNext(animation());
		const [firstHandle, secondHandle] = await Promise.all([first, second]);
		expect(firstHandle.asset).toBe(secondHandle.asset);
		expect(firstHandle.asset.framesPerSecond).toBe(30);
		expect(repository.getState("0x03000001")).toBe("ready");

		firstHandle.release();
		expect(repository.getState("0x03000001")).toBe("ready");
		secondHandle.release();
		expect(repository.getState("0x03000001")).toBeNull();
	});

	it("retains an explicit failed state until it is evicted for retry", async () => {
		const source = new DeferredAnimationSource();
		const repository = new AnimationAssetRepository(source);
		const pending = repository.acquire("0x03000001");
		source.rejectNext(new Error("missing animation"));

		await expect(pending).rejects.toThrow("missing animation");
		expect(repository.getState("0x03000001")).toBe("failed");
		await expect(repository.acquire("0x03000001")).rejects.toThrow(
			"missing animation",
		);
		expect(source.loads).toHaveLength(1);

		repository.evictFailed("0x03000001");
		const retry = repository.acquire("0x03000001");
		expect(source.loads).toHaveLength(2);
		source.resolveNext(animation());
		(await retry).release();
	});
});

function animation(): DecodedAnimationAsset {
	return {
		frameCount: 1,
		hooks: [],
		id: "0x03000001",
		partCount: 1,
		partFrames: [Mat4.identity()],
		positionFrames: [],
	};
}

class DeferredAnimationSource implements AnimationAssetSource {
	readonly loads: string[] = [];

	async loadMotionTableClosure(): Promise<DatAssetId[]> {
		throw new Error("The deferred fixture serves no motion assets.");
	}

	readonly #pending: Array<{
		readonly resolve: (animation: DecodedAnimationAsset) => void;
		readonly reject: (cause: unknown) => void;
	}> = [];

	loadAnimation(animationId: DatAssetId) {
		this.loads.push(animationId);
		return new Promise<DecodedAnimationAsset>((resolve, reject) => {
			this.#pending.push({ reject, resolve });
		});
	}

	resolveNext(animation: DecodedAnimationAsset): void {
		const pending = this.#pending.shift();
		if (!pending) throw new Error("No animation load is pending.");
		pending.resolve(animation);
	}

	rejectNext(cause: unknown): void {
		const pending = this.#pending.shift();
		if (!pending) throw new Error("No animation load is pending.");
		pending.reject(cause);
	}

	destroy(): void {}
}

describe("motion assets", () => {
	class MotionSource {
		readonly loads: string[] = [];
		animationIds: string[] = ["0x03000001", "0x03000002", "0x03000003"];
		failOn: string | null = null;
		contentFailure = false;

		async loadAnimation(animationId: DatAssetId) {
			this.loads.push(animationId);
			if (animationId === this.failOn && this.contentFailure)
				throw new HostCommandError({
					code: "application_error",
					message: `Missing animation ${animationId}`,
					resource: {
						kind: "missing",
						namespace: "eor/portal",
						file_id: Number(animationId),
					},
				});
			if (animationId === this.failOn)
				throw new Error(`refusing ${animationId}`);
			return { ...animation(), id: animationId };
		}

		async loadMotionTableClosure(): Promise<DatAssetId[]> {
			return this.animationIds as DatAssetId[];
		}

		destroy(): void {}
	}

	it("stages every animation the table reaches before returning the staged assets", async () => {
		const source = new MotionSource();
		const repository = new AnimationAssetRepository(source);

		const assets = await repository.acquireMotionAssets(
			"0x09000001" as DatAssetId,
		);

		expect([...assets.animations.keys()]).toEqual(source.animationIds);
		expect(source.loads).toEqual(source.animationIds);
		assets.release();
	});

	it("shares one preparation across two entities on the same table", async () => {
		const source = new MotionSource();
		const repository = new AnimationAssetRepository(source);

		const first = await repository.acquireMotionAssets(
			"0x09000001" as DatAssetId,
		);
		const second = await repository.acquireMotionAssets(
			"0x09000001" as DatAssetId,
		);

		expect(source.loads).toEqual(source.animationIds);
		expect(second.animations.get("0x03000002" as DatAssetId)).toBe(
			first.animations.get("0x03000002" as DatAssetId),
		);
		first.release();
		second.release();
	});

	it("releases every acquired sibling when an operational failure rejects staging", async () => {
		const source = new MotionSource();
		source.failOn = "0x03000002";
		const repository = new AnimationAssetRepository(source);

		await expect(
			repository.acquireMotionAssets("0x09000001" as DatAssetId),
		).rejects.toThrow("Animation batch acquisition failed");

		// The animation staged before the failure holds no handle, so the partial assets retained
		// nothing. The failed one keeps its explicit failed state, which is the repository's own
		// contract and needs an eviction to retry.
		expect(repository.getState("0x03000001" as DatAssetId)).toBeNull();
		expect(repository.getState("0x03000002" as DatAssetId)).toBe("failed");
		expect(repository.getState("0x03000003")).toBeNull();
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});

	it("retains available clips and retries a refused source only after explicit eviction", async () => {
		const source = new MotionSource();
		source.failOn = "0x03000002";
		source.contentFailure = true;
		const repository = new AnimationAssetRepository(source);
		const staged = await repository.acquireMotionAssets("0x09000001");
		expect([...staged.animations.keys()]).toEqual(["0x03000001", "0x03000003"]);
		staged.release();
		const second = await repository.acquireMotionAssets("0x09000001");
		expect(source.loads.filter((id) => id === source.failOn)).toHaveLength(1);
		second.release();
		repository.evictFailed("0x03000002");
		source.failOn = null;
		const retry = await repository.acquireMotionAssets("0x09000001");
		expect([...retry.animations.keys()]).toEqual(source.animationIds);
		retry.release();
		expect(repository.getDiagnostics().referenceCount).toBe(0);
		repository.destroy();
	});

	it("refuses a double release rather than dropping a shared refcount twice", async () => {
		const source = new MotionSource();
		const repository = new AnimationAssetRepository(source);
		const assets = await repository.acquireMotionAssets(
			"0x09000001" as DatAssetId,
		);

		assets.release();
		expect(() => assets.release()).toThrow("released twice");
	});
});
