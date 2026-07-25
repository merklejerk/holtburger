import { describe, expect, it } from "vitest";
import type { SceneInterestRevision } from "../../runtime/scene-availability";
import type { RenderGeometryData } from "../../renderer/geometry";
import type {
	GeometryResourceKey,
	InstanceStreamResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../../renderer/resource-manager";
import type { StaticInstanceStreamData } from "../../systems/static-resources";
import type { AssetTextureSource } from "../texture-manager";
import type { TexturePreparer } from "../texture-preparer";
import {
	createAssetTextureKey,
	type AssetTextureFact,
	TexturePurpose,
} from "../types";
import {
	type ResidentAtlasLayoutPlanner,
	type ResidentAtlasPageBuilder,
	ResidentTextureAtlas,
} from "./resident-texture-atlas";
import { createAtlasPageId, planStableAtlasLayout } from "./layout";
import { buildAtlasPage, type AtlasPageBuildJob } from "./page-build";

const DIRECT_COLOR = fact(TexturePurpose.ObjectDirectColor, "0x06000001");
const SECOND_DIRECT = fact(TexturePurpose.ObjectDirectColor, "0x06000003");
const INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000002");
const SECOND_INDEX8 = fact(TexturePurpose.ObjectIndex8, "0x06000004");

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

	it("publishes and releases a physical page without transferring its retained source", async () => {
		const resources = new FixtureRendererResources();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new FixtureLayoutPlanner(),
				pageBuilder: new FixturePageBuilder(),
				pageSize: 16,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);

		await expect(handle.completion).resolves.toBe("ready");
		const binding = atlas.getAtlasBinding(DIRECT_COLOR.key);
		expect(binding).not.toBeNull();
		expect(resources.uploads).toHaveLength(1);
		expect(binding!.placement.bounds.min).toMatchObject({ x: 4, y: 4 });
		expect(
			resources.uploads[0]?.data.slice((4 * 16 + 4) * 4, (4 * 16 + 5) * 4),
		).toEqual(Uint8Array.of(1, 2, 3, 4));
		expect(atlas.getPreparedSource(DIRECT_COLOR.key).pixels).toEqual(
			source(DIRECT_COLOR).pixels,
		);

		await atlas.withdrawOwnerRevision(handle);
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
		expect(resources.released).toEqual([binding!.resource]);
	});

	it("does not plan or rebuild when a second owner only claims an existing resident binding", async () => {
		const planner = new CountingLayoutPlanner();
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: 16,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const planCount = planner.planCount;

		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		expect(planner.planCount).toBe(planCount);
	});

	it("accepts a bounded compaction only when it eliminates a page", async () => {
		const resources = new FixtureRendererResources();
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new FragmentingLayoutPlanner(),
				pageBuilder: new FixturePageBuilder(),
				pageSize: 16,
				renderResources: resources,
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);
		await expect(second.completion).resolves.toBe("ready");

		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(1);
		expect(atlas.getAtlasBinding(INDEX8.key)).not.toBeNull();
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)).not.toBeNull();
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
	});

	it("falls back to stable insertion when optional compaction page building fails", async () => {
		const atlas = new ResidentTextureAtlas<"first" | "second">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new FragmentingLayoutPlanner(),
				pageBuilder: new FailingCompactPageBuilder(),
				pageSize: 16,
				renderResources: new FixtureRendererResources(),
			},
		);
		const first = atlas.prepareOwnerRequirements("first", revision(1), [
			INDEX8,
		]);
		await first.completion;
		const second = atlas.prepareOwnerRequirements("second", revision(1), [
			SECOND_INDEX8,
		]);

		await expect(second.completion).resolves.toBe("ready");
		expect(atlas.getAtlasPageDiagnostics()).toHaveLength(2);
		expect(atlas.getAtlasBinding(INDEX8.key)).not.toBeNull();
		expect(atlas.getAtlasBinding(SECOND_INDEX8.key)).not.toBeNull();
	});

	it("rolls back all new resources when a multi-page publication fails", async () => {
		const resources = new FixtureRendererResources(2);
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				layoutPlanner: new FixtureLayoutPlanner(),
				pageBuilder: new FixturePageBuilder(),
				pageSize: 16,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
			SECOND_DIRECT,
		]);

		await expect(handle.completion).resolves.toBe("failed");
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
		expect(atlas.getAtlasBinding(SECOND_DIRECT.key)).toBeNull();
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
	});

	it("rejects a stale layout result without publishing its withdrawn requirement", async () => {
		const planner = new DeferredFirstLayoutPlanner();
		const resources = new FixtureRendererResources();
		const atlas = new ResidentTextureAtlas<"building">(
			new ImmediatePreparer(),
			{
				layoutPlanner: planner,
				pageBuilder: new FixturePageBuilder(),
				pageSize: 16,
				renderResources: resources,
			},
		);
		const handle = atlas.prepareOwnerRequirements("building", revision(1), [
			DIRECT_COLOR,
		]);
		await planner.firstRequest;

		const withdrawal = atlas.withdrawOwnerRevision(handle);
		planner.resolveFirst();
		await withdrawal;
		await expect(handle.completion).resolves.toBe("withdrawn");
		expect(resources.uploads).toEqual([]);
		expect(atlas.getAtlasBinding(DIRECT_COLOR.key)).toBeNull();
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

class FixtureLayoutPlanner implements ResidentAtlasLayoutPlanner {
	destroy(): void {}

	async plan(request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0]) {
		return planStableAtlasLayout(request, { pageSize: 16 });
	}
}

class CountingLayoutPlanner extends FixtureLayoutPlanner {
	planCount = 0;

	override async plan(
		request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0],
	) {
		this.planCount += 1;
		return super.plan(request);
	}
}

/** Deliberately models two fragmented index pages so the resident transaction can prove compaction. */
class FragmentingLayoutPlanner implements ResidentAtlasLayoutPlanner {
	destroy(): void {}

	async plan(request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0]) {
		if (
			!request.correlationId.endsWith(":compact") &&
			request.entries.length === 2
		) {
			return {
				correlationId: request.correlationId,
				insertedKeys: [request.entries[1]!.key],
				pageSize: 16,
				pages: request.entries.map((entry, index) => ({
					pageId: createAtlasPageId(request.purpose, index),
					placements: [
						{
							contentBounds: { height: 1, width: 1, x: 0, y: 0 },
							key: entry.key,
						},
					],
					purpose: request.purpose,
				})),
				purpose: request.purpose,
				releasedKeys: [],
			};
		}
		return planStableAtlasLayout(request, { pageSize: 16 });
	}
}

class DeferredFirstLayoutPlanner implements ResidentAtlasLayoutPlanner {
	readonly firstRequest: Promise<void>;
	#resolveFirstRequest!: () => void;
	#resolvePlan: (() => void) | null = null;
	#requests = 0;

	constructor() {
		this.firstRequest = new Promise<void>((resolve) => {
			this.#resolveFirstRequest = resolve;
		});
	}

	destroy(): void {}

	plan(
		request: Parameters<ResidentAtlasLayoutPlanner["plan"]>[0],
	): Promise<ReturnType<typeof planStableAtlasLayout>> {
		this.#requests += 1;
		if (this.#requests > 1) {
			return Promise.resolve(planStableAtlasLayout(request, { pageSize: 16 }));
		}
		this.#resolveFirstRequest();
		return new Promise((resolve) => {
			this.#resolvePlan = () =>
				resolve(planStableAtlasLayout(request, { pageSize: 16 }));
		});
	}

	resolveFirst(): void {
		if (!this.#resolvePlan)
			throw new Error("First layout request was not pending.");
		this.#resolvePlan();
		this.#resolvePlan = null;
	}
}

class FixturePageBuilder implements ResidentAtlasPageBuilder {
	build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<ReturnType<typeof buildAtlasPage>> {
		void transfer;
		return Promise.resolve(buildAtlasPage(job));
	}

	destroy(): void {}
}

class FailingCompactPageBuilder extends FixturePageBuilder {
	override build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<ReturnType<typeof buildAtlasPage>> {
		if (job.page.pageId.endsWith(":2")) {
			return Promise.reject(new Error("Synthetic compact-page failure."));
		}
		return super.build(job, transfer);
	}
}

class FixtureRendererResources implements RendererResourceManager {
	readonly uploads: Texture2DUpload[] = [];
	readonly released: RenderResourceKey[] = [];
	readonly #failOnCreate: number | null;
	#next = 0;

	constructor(failOnCreate: number | null = null) {
		this.#failOnCreate = failOnCreate;
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		if (this.#next + 1 === this.#failOnCreate) {
			throw new Error("Synthetic page upload failure.");
		}
		this.uploads.push(upload);
		const resource =
			`texture-2d-resource:${this.#next}` as Texture2DResourceKey;
		this.#next += 1;
		return resource;
	}

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		throw new Error("Geometry is outside this fixture.");
	}

	createStaticInstanceStream(
		data: StaticInstanceStreamData,
	): InstanceStreamResourceKey {
		void data;
		throw new Error("Instance streams are outside this fixture.");
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
		throw new Error("Geometry is outside this fixture.");
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
		throw new Error("Texture replacement is outside this fixture.");
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		throw new Error("Texture arrays are outside this fixture.");
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		void key;
		void upload;
		throw new Error("Texture arrays are outside this fixture.");
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
		throw new Error("Texture arrays are outside this fixture.");
	}

	releaseResource(key: RenderResourceKey): boolean {
		this.released.push(key);
		return true;
	}

	async destroy(): Promise<void> {}
}
