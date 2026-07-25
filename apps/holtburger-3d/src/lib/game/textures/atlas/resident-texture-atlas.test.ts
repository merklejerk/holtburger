import { describe, expect, it } from "vitest";
import type { SceneInterestRevision } from "../../runtime/scene-availability";
import type { AssetTextureSource } from "../texture-manager";
import type { TexturePreparer } from "../texture-preparer";
import {
	createAssetTextureKey,
	type AssetTextureFact,
	TexturePurpose,
} from "../types";
import { ResidentTextureAtlas } from "./resident-texture-atlas";

const DIRECT_COLOR = fact(TexturePurpose.ObjectDirectColor, "0x06000001");
const INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000002");

describe("ResidentTextureAtlas", () => {
	it("coalesces concurrent claims and retains a source until its final release", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"first" | "second">(preparer);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			DIRECT_COLOR,
		]);

		expect(preparer.requests).toEqual([DIRECT_COLOR]);
		preparer.resolve(DIRECT_COLOR);
		await expect(first.completion).resolves.toBe("ready");
		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);

		atlas.withdrawOwnerRevision(first);
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		atlas.withdrawOwnerRevision(second);
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
		expect(atlas.getDiagnostics()).toMatchObject({
			claimedTextureCount: 0,
			residentSourceCount: 0,
		});
	});

	it("retains the published revision until explicit replacement activation", async () => {
		const preparer = new ImmediatePreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const current = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		await current.completion;
		atlas.activateOwnerRevision(current);
		const replacement = atlas.prepareOwnerRequirements(
			"building",
			revision(2),
			[INDEX8],
		);
		await replacement.completion;

		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		expect(atlas.getPreparedSource(INDEX8.key)).toEqual(source(INDEX8));
		atlas.activateOwnerRevision(replacement);
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
		expect(atlas.getPreparedSource(INDEX8.key)).toEqual(source(INDEX8));
	});

	it("cannot let stale cleanup remove a newer same-owner revision", async () => {
		const preparer = new ImmediatePreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const stale = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		const current = atlas.prepareOwnerRequirements("building", revision(2), [
			DIRECT_COLOR,
		]);
		await Promise.all([stale.completion, current.completion]);

		atlas.withdrawOwnerRevision(stale);
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);
		atlas.activateOwnerRevision(current);
		expect(atlas.getDiagnostics().publishedOwnerCount).toBe(1);
	});

	it("withdraws a pending revision without retaining its late result", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"building">(preparer);
		const pending = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		atlas.withdrawOwnerRevision(pending);
		await expect(pending.completion).resolves.toBe("withdrawn");
		preparer.resolve(DIRECT_COLOR);
		await Promise.resolve();

		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
	});

	it("fails one provisional revision without disturbing another owner claim", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"first" | "second">(preparer);
		const failed = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		const surviving = atlas.prepareOwnerRequirements("second", revision(1), [
			INDEX8,
		]);

		preparer.reject(DIRECT_COLOR);
		preparer.resolve(INDEX8);
		await expect(failed.completion).resolves.toBe("failed");
		await expect(surviving.completion).resolves.toBe("ready");
		expect(atlas.getDiagnostics()).toMatchObject({
			claimedTextureCount: 1,
			residentSourceCount: 1,
		});
	});

	it("returns one handle for an identical revision and rejects a conflicting fact set", () => {
		const atlas = new ResidentTextureAtlas<"building">(new DeferredPreparer());
		const first = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);

		expect(
			atlas.prepareOwnerRequirements("building", revision(1), [DIRECT_COLOR]),
		).toBe(first);
		expect(() =>
			atlas.prepareOwnerRequirements("building", revision(1), [INDEX8]),
		).toThrow("conflicting texture facts");
	});

	it("evicts only the authoritative owner revisions and settles pending handles on destroy", async () => {
		const preparer = new DeferredPreparer();
		const atlas = new ResidentTextureAtlas<"first" | "second">(preparer);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			DIRECT_COLOR,
		]);
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			DIRECT_COLOR,
		]);

		atlas.evictOwnerRequirements("first", revision(1));
		atlas.evictOwnerRequirements("first", revision(1));
		await expect(first.completion).resolves.toBe("withdrawn");
		preparer.resolve(DIRECT_COLOR);
		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getPreparedSource(DIRECT_COLOR.key)).toEqual(
			source(DIRECT_COLOR),
		);

		const pending = atlas.prepareOwnerRequirements("first", revision(2), [
			INDEX8,
		]);
		atlas.destroy();
		await expect(pending.completion).resolves.toBe("withdrawn");
		expect(() => atlas.getPreparedSource(DIRECT_COLOR.key)).toThrow(
			"no retained",
		);
	});
});

function fact(
	purpose: TexturePurpose.ObjectDirectColor | TexturePurpose.ObjectIndex8,
	sourceAssetId: `0x${string}`,
): AssetTextureFact {
	return {
		kind: "asset",
		key: createAssetTextureKey(purpose, sourceAssetId),
		purpose,
		sourceAssetId,
	};
}

function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

function source(fact: AssetTextureFact): AssetTextureSource {
	return {
		height: 1,
		key: fact.key,
		pixels: new Uint8Array(
			fact.purpose === TexturePurpose.ObjectDirectColor ? [1, 2, 3, 4] : [1],
		),
		purpose: fact.purpose,
		sourceAssetId: fact.sourceAssetId,
		width: 1,
	};
}

class DeferredPreparer implements TexturePreparer {
	readonly requests: AssetTextureFact[] = [];
	readonly #deferred = new Map<
		AssetTextureFact["key"],
		{
			readonly reject: () => void;
			readonly resolve: () => void;
			readonly promise: Promise<AssetTextureSource>;
		}
	>();

	prepare(fact: AssetTextureFact): Promise<AssetTextureSource> {
		this.requests.push(fact);
		let resolve!: () => void;
		let reject!: () => void;
		const promise = new Promise<AssetTextureSource>((accept, fail) => {
			resolve = () => accept(source(fact));
			reject = () => fail(new Error(`Failed ${fact.key}.`));
		});
		this.#deferred.set(fact.key, { promise, reject, resolve });
		return promise;
	}

	async destroy(): Promise<void> {}

	resolve(fact: AssetTextureFact): void {
		const deferred = this.#deferred.get(fact.key);
		if (!deferred) throw new Error(`No pending preparation for ${fact.key}.`);
		deferred.resolve();
	}

	reject(fact: AssetTextureFact): void {
		const deferred = this.#deferred.get(fact.key);
		if (!deferred) throw new Error(`No pending preparation for ${fact.key}.`);
		deferred.reject();
	}
}

class ImmediatePreparer implements TexturePreparer {
	async prepare(fact: AssetTextureFact): Promise<AssetTextureSource> {
		return source(fact);
	}

	async destroy(): Promise<void> {}
}
