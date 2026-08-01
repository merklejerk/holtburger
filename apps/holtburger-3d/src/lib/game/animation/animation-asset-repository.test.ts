import { describe, expect, it } from "vitest";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import { Mat4 } from "../math/types";
import { AnimationAssetRepository } from "./animation-asset-repository";

describe("AnimationAssetRepository", () => {
	it("shares one in-flight load and releases the prepared value exactly", async () => {
		const source = new DeferredAnimationSource();
		const repository = new AnimationAssetRepository(source);
		const first = repository.acquire("0x03000001");
		const second = repository.acquire("0x03000001");
		expect(source.loads).toEqual(["0x03000001"]);

		source.resolveNext(animation());
		const [firstHandle, secondHandle] = await Promise.all([first, second]);
		expect(firstHandle.animation).toBe(secondHandle.animation);
		expect(firstHandle.animation.framesPerSecond).toBe(30);
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
	readonly #pending: Array<{
		readonly resolve: (animation: DecodedAnimationAsset) => void;
		readonly reject: (cause: unknown) => void;
	}> = [];

	loadAnimation(animationId: "0x03000001") {
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
