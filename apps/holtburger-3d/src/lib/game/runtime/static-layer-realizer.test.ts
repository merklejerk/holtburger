import { describe, expect, it } from "vitest";
import type { AtlasRequirementHandle } from "../textures/atlas/resident-texture-atlas";
import { createAssetTextureKey, TexturePurpose } from "../textures/types";
import type { SceneInterestRevision } from "./scene-availability";
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
		expect(publisher.events).toEqual(["replace:1"]);
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
});

function input() {
	return {
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
) {
	return new StaticLayerRealizer<string, string, "buildings">({
		atlas,
		currentness,
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
	#resolve!: (result: "ready") => void;
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
		const completion = new Promise<"ready">((resolve) => {
			this.#resolve = resolve;
		});
		return { completion, owner, revision };
	}
	resolve(): void {
		this.#resolve("ready");
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
	replace(o: { readonly revision: SceneInterestRevision }): Promise<void> {
		if (this.fail) return Promise.reject(new Error("replace failed"));
		this.events.push(`replace:${o.revision}`);
		return Promise.resolve();
	}
}
class FakeCurrentness implements StaticLayerCurrentness<"buildings"> {
	current = true;
	isCurrent(): boolean {
		return this.current;
	}
}
