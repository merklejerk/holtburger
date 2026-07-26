import { describe, expect, it } from "vitest";
import type { AtlasRequirementHandle } from "../textures/atlas/resident-texture-atlas";
import type { AtlasRequirementCompletion } from "../textures/atlas/resident-texture-atlas";
import { createAssetTextureKey, TexturePurpose } from "../textures/types";
import type { SceneInterestRevision } from "./scene-availability";
import { LandblockLayerKind } from "./scene-interest";
import {
	type StaticLayerAtlas,
	type StaticLayerCurrentness,
	type StaticLayerPublisher,
	StaticLayerRealizer,
} from "./static-layer-realizer";

const FACT = {
	kind: "asset" as const,
	key: createAssetTextureKey(TexturePurpose.ObjectDirectColor, "0x06000001"),
	purpose: TexturePurpose.ObjectDirectColor,
	sourceAssetId: "0x06000001",
};

describe("StaticLayerRealizer", () => {
	it("overlaps geometry and atlas preparation, then publishes before activation", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const publisher = new FakePublisher();
		const current = new FakeCurrentness();
		const realizer = createRealizer(atlas, geometry, publisher, current);
		const pending = realizer.realize(input());

		expect(atlas.prepared).toBe(1);
		expect(geometry.started).toBe(true);
		atlas.resolve("ready");
		geometry.resolve("geometry");
		await expect(pending).resolves.toEqual({
			geometry: "geometry",
			kind: "published",
		});
		expect(publisher.events).toEqual(["replace:buildings:1"]);
		expect(current.layers).toEqual([
			LandblockLayerKind.Buildings,
			LandblockLayerKind.Buildings,
		]);
		expect(atlas.events).toEqual(["prepare:1", "activate:1"]);
	});

	it("withdraws the exact provisional claim when currentness turns stale", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const current = new FakeCurrentness();
		const realizer = createRealizer(
			atlas,
			geometry,
			new FakePublisher(),
			current,
		);
		const pending = realizer.realize(input());
		current.current = false;
		atlas.resolve("ready");
		geometry.resolve("geometry");

		await expect(pending).resolves.toEqual({ kind: "stale" });
		expect(atlas.events).toEqual(["prepare:1", "withdraw:1"]);
	});

	it("logs a current atlas failure and leaves no durable realization state", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const reporter = new FakeFailureReporter();
		const realizer = createRealizer(
			atlas,
			geometry,
			new FakePublisher(),
			new FakeCurrentness(),
			reporter,
		);
		const pending = realizer.realize(input());
		const failure = new Error("atlas upload failed");
		atlas.fail(failure);
		geometry.resolve("geometry");

		await expect(pending).resolves.toEqual({ kind: "stale" });
		expect(reporter.failures).toEqual([
			{
				cause: failure,
				layer: LandblockLayerKind.Buildings,
				owner: "buildings",
				revision: revision(1),
			},
		]);
		expect(atlas.events).toEqual(["prepare:1", "withdraw:1"]);
	});

	it("does not log a stale atlas failure", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const currentness = new FakeCurrentness();
		const reporter = new FakeFailureReporter();
		const realizer = createRealizer(
			atlas,
			geometry,
			new FakePublisher(),
			currentness,
			reporter,
		);
		const pending = realizer.realize(input());
		currentness.current = false;
		atlas.fail(new Error("obsolete atlas failure"));
		geometry.resolve("geometry");

		await expect(pending).resolves.toEqual({ kind: "stale" });
		expect(reporter.failures).toEqual([]);
	});

	it("withdraws the provisional atlas revision when atomic publication fails", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const publisher = new FakePublisher(true);
		const realizer = createRealizer(
			atlas,
			geometry,
			publisher,
			new FakeCurrentness(),
		);
		const pending = realizer.realize(input());
		atlas.resolve();
		geometry.resolve("geometry");

		await expect(pending).rejects.toThrow("failed to realize");
		expect(atlas.events).toEqual(["prepare:1", "withdraw:1"]);
	});

	it("suppresses pending publication after shutdown", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const publisher = new FakePublisher();
		const realizer = createRealizer(
			atlas,
			geometry,
			publisher,
			new FakeCurrentness(),
		);
		const pending = realizer.realize(input());
		realizer.destroy();
		atlas.resolve();
		geometry.resolve("geometry");

		await expect(pending).resolves.toEqual({ kind: "stale" });
		expect(publisher.events).toEqual([]);
	});

	it("routes coordinator eviction through both authoritative exact-revision ports", async () => {
		const atlas = new FakeAtlas();
		const publisher = new FakePublisher();
		const realizer = createRealizer(
			atlas,
			deferred<string>(),
			publisher,
			new FakeCurrentness(),
		);

		await realizer.evict("buildings", revision(7));
		expect(atlas.events).toEqual(["evict:7"]);
		expect(publisher.events).toEqual(["evict:7"]);
	});

	it("publishes an explicit-object realization into its exact typed layer", async () => {
		const atlas = new FakeAtlas();
		const geometry = deferred<string>();
		const publisher = new FakePublisher();
		const realizer = createRealizer(
			atlas,
			geometry,
			publisher,
			new FakeCurrentness(),
		);
		const pending = realizer.realize(input(LandblockLayerKind.Objects));

		atlas.resolve();
		geometry.resolve("geometry");

		await expect(pending).resolves.toMatchObject({ kind: "published" });
		expect(publisher.events).toEqual(["replace:objects:1"]);
	});
});

function input(layer = LandblockLayerKind.Buildings) {
	return {
		layer,
		owner: "buildings" as const,
		revision: revision(1),
		source: "source",
		textureRequirements: [FACT],
	};
}

function createRealizer(
	atlas: FakeAtlas,
	geometry: ReturnType<typeof deferred<string>>,
	publisher: FakePublisher,
	currentness: FakeCurrentness,
	reporter = new FakeFailureReporter(),
) {
	return new StaticLayerRealizer<string, string, "buildings">({
		atlas,
		currentness,
		failureReporter: reporter,
		geometry,
		publisher,
	});
}

function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

function deferred<T>() {
	let accept!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		accept = resolve;
	});
	const state = {
		started: false,
		prepare: () => {
			state.started = true;
			return promise;
		},
		promise,
		resolve: accept,
	};
	return state;
}

class FakeAtlas implements StaticLayerAtlas<"buildings"> {
	events: string[] = [];
	prepared = 0;
	#resolve!: (result: AtlasRequirementCompletion) => void;
	activateOwnerRevision(
		handle: AtlasRequirementHandle<"buildings">,
	): Promise<void> {
		this.events.push(`activate:${handle.revision}`);
		return Promise.resolve();
	}
	evictOwnerRequirements(
		_: "buildings",
		revision: SceneInterestRevision,
	): Promise<void> {
		this.events.push(`evict:${revision}`);
		return Promise.resolve();
	}
	prepareOwnerRequirements(
		owner: "buildings",
		revision: SceneInterestRevision,
	): AtlasRequirementHandle<"buildings"> {
		this.prepared += 1;
		this.events.push(`prepare:${revision}`);
		const completion = new Promise<AtlasRequirementCompletion>((resolve) => {
			this.#resolve = resolve;
		});
		return { completion, owner, revision };
	}
	resolve(): void {
		this.#resolve("ready");
	}
	fail(cause: unknown): void {
		this.#resolve({ cause, kind: "failed" });
	}
	withdrawOwnerRevision(
		handle: AtlasRequirementHandle<"buildings">,
	): Promise<void> {
		this.events.push(`withdraw:${handle.revision}`);
		return Promise.resolve();
	}
}
class FakePublisher implements StaticLayerPublisher<string, "buildings"> {
	events: string[] = [];
	constructor(private readonly fail = false) {}
	evict(_: "buildings", revision: SceneInterestRevision): Promise<void> {
		this.events.push(`evict:${revision}`);
		return Promise.resolve();
	}
	removeExact(): Promise<void> {
		return Promise.resolve();
	}
	replace(o: {
		readonly layer: LandblockLayerKind;
		readonly revision: SceneInterestRevision;
	}): Promise<void> {
		if (this.fail) return Promise.reject(new Error("replace failed"));
		this.events.push(`replace:${o.layer}:${o.revision}`);
		return Promise.resolve();
	}
}
class FakeCurrentness implements StaticLayerCurrentness<"buildings"> {
	current = true;
	layers: LandblockLayerKind[] = [];
	isCurrent(_: "buildings", layer: LandblockLayerKind): boolean {
		this.layers.push(layer);
		return this.current;
	}
}

class FakeFailureReporter {
	failures: Array<{
		readonly cause: unknown;
		readonly layer: LandblockLayerKind;
		readonly owner: "buildings";
		readonly revision: SceneInterestRevision;
	}> = [];

	reportAtlasFailure(options: {
		readonly cause: unknown;
		readonly owner: "buildings";
		readonly revision: SceneInterestRevision;
	}): void {
		this.failures.push(options);
	}
}
