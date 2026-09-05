import { describe, expect, it } from "vitest";
import type { DynamicPresentationSource } from "./dynamic-presentation-source";
import type { GeometrySource } from "../geometry/types";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { AtlasRequirementCompletion } from "../textures/atlas/resident-texture-atlas";
import type { AssetTextureFact } from "../textures/types";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../resolution/presentation";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
	objectVisualTemplateKey,
	type ObjectVisualTemplateAtlas,
	type ObjectVisualTemplateAtlasClaim,
	type ObjectVisualTemplateResourceOwnerId,
	type ObjectVisualTemplate,
	type ObjectVisualTemplatePreparer,
} from "./object-visual-template-repository";

describe("ObjectVisualTemplateRepository", () => {
	it("rolls back atlas and geometry when renderer appearance staging fails", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new FixtureAtlas();
		const repository = new ObjectVisualTemplateRepository(
			geometry,
			atlas,
			new InlineObjectVisualTemplatePreparer(),
			() => {
				throw new Error("device appearance preparation failed");
			},
		);
		const stage = repository.stageOwner([
			source("failure", "appearance:device-failure"),
		]);
		await expect(stage.completion).rejects.toThrow(
			"device appearance preparation failed",
		);
		expect(geometry.resources.size).toBe(0);
		expect(atlas.activeOwnerCount).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
		stage.release();
		await repository.destroy();
	});
	it("continues releasing source resources after an appearance release failure", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new FixtureAtlas();
		const repository = new ObjectVisualTemplateRepository(
			geometry,
			atlas,
			new InlineObjectVisualTemplatePreparer(),
			() => () => {
				throw new Error("appearance release failed");
			},
		);
		const stage = repository.stageOwner([
			source("failure", "appearance:release-failure"),
		]);
		await stage.completion;
		stage.commit("owner");
		repository.dropOwner("owner");
		expect(geometry.resources.size).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
		await expect(repository.destroy()).rejects.toThrow(
			"visual-template resources failed to release",
		);
	});
	it("keeps logical selectors distinct when equal bindings coalesce authored slots", async () => {
		const base = source("equal-slots", "appearance:equal-slots");
		const same = material("same");
		const visual = {
			...base,
			presentation: {
				...base.presentation,
				parts: base.presentation.parts.map((part) => ({
					...part,
					materials: [same, same],
				})),
			},
		};
		const prepared = await new InlineObjectVisualTemplatePreparer().prepare(
			visual,
		);
		expect(prepared.parts[0]?.drawUnits).toHaveLength(1);
		expect(prepared.appearance.materials).toHaveLength(2);
		expect(prepared.appearance.ranges).toMatchObject([
			{ materialSelector: 0, indexStart: 0, indexCount: 3 },
			{ materialSelector: 1, indexStart: 3, indexCount: 3 },
			{ materialSelector: 0, indexStart: 6, indexCount: 3 },
		]);
		const changed = await new InlineObjectVisualTemplatePreparer().prepare(
			base,
		);
		expect(changed.layout.key).toBe(prepared.layout.key);
		expect(
			changed.appearance.materials.map((binding) => binding.source.id),
		).toEqual(["material:first", "material:second"]);
	});
	it("shares one in-flight preparation across owners and retains complete material ranges", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new FixtureAtlas();
		const preparer = new CountingPreparer();
		let appearanceRetains = 0;
		let appearanceReleases = 0;
		const repository = new ObjectVisualTemplateRepository(
			geometry,
			atlas,
			preparer,
			() => {
				expect(atlas.activeOwnerCount).toBe(1);
				appearanceRetains += 1;
				return () => {
					expect(atlas.activeOwnerCount).toBe(1);
					appearanceReleases += 1;
				};
			},
		);
		const visual = source("shared", "appearance:base");

		const first = repository.stageOwner([visual]);
		const second = repository.stageOwner([visual]);
		const [firstOutcome] = await Promise.all([
			first.completion,
			second.completion,
		]);

		expect(preparer.count).toBe(1);
		expect(appearanceRetains).toBe(1);
		expect(atlas.preparationCount).toBe(1);
		first.commit("first");
		second.commit("second");
		const template = firstOutcome.get(objectVisualTemplateKey(visual));
		expect(template?.parts[0]?.drawUnits).toMatchObject([
			{ indexCount: 3, indexStart: 0, partIndex: 0 },
			{ indexCount: 3, indexStart: 3, partIndex: 0 },
			{ indexCount: 3, indexStart: 6, partIndex: 0 },
		]);
		expect(template?.parts[0]?.depthDrawUnits).toMatchObject([
			{ cullFace: "back", indexCount: 9, indexStart: 0 },
		]);
		if (template === undefined)
			throw new Error("Shared template was not prepared.");
		expect([...geometry.resources.keys()].sort()).toEqual([
			template.layout.key,
		]);
		expect(atlas.activeOwnerCount).toBe(1);

		repository.dropOwner("first");
		expect(appearanceReleases).toBe(0);
		expect([...geometry.resources.keys()].sort()).toEqual([
			template.layout.key,
		]);
		expect(atlas.activeOwnerCount).toBe(1);
		repository.dropOwner("second");
		expect(appearanceReleases).toBe(1);
		expect(geometry.resources.size).toBe(0);
		expect(atlas.activeOwnerCount).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
	});

	it("retains a shared layout until the last distinct appearance owner leaves", async () => {
		const preparer = new CountingPreparer();
		const geometry = new FixtureGeometry();
		const repository = createRepository(geometry, preparer);
		const base = source("base", "appearance:base");
		const changed = source("changed", "appearance:changed");

		const baseStage = repository.stageOwner([base]);
		const changedStage = repository.stageOwner([changed]);
		const [baseOutcome, changedOutcome] = await Promise.all([
			baseStage.completion,
			changedStage.completion,
		]);
		baseStage.commit("base");
		changedStage.commit("changed");

		expect(preparer.count).toBe(2);
		const baseTemplate = baseOutcome.get(objectVisualTemplateKey(base));
		const changedTemplate = changedOutcome.get(
			objectVisualTemplateKey(changed),
		);
		if (baseTemplate === undefined || changedTemplate === undefined)
			throw new Error("Appearance fixtures were not prepared.");
		expect(baseTemplate).not.toBe(changedTemplate);
		expect(baseTemplate.layout).toBe(changedTemplate.layout);
		expect([...geometry.resources.keys()]).toEqual([baseTemplate.layout.key]);
		expect(baseTemplate.parts[0]?.geometryData.positions).toBe(
			base.presentation.parts[0]?.geometry.positions,
		);
		repository.dropOwner("base");
		expect([...geometry.resources.keys()]).toEqual([
			changedTemplate.layout.key,
		]);
		repository.dropOwner("changed");
		expect(geometry.resources.size).toBe(0);
		await repository.destroy();
	});

	it("keeps effective cull changes as material-independent depth boundaries", async () => {
		const preparer = new InlineObjectVisualTemplatePreparer();
		const base = source("mixed-cull", "appearance:mixed-cull");
		const visual: DynamicPresentationSource = {
			...base,
			presentation: {
				...base.presentation,
				parts: base.presentation.parts.map((part) => ({
					...part,
					geometry: {
						...part.geometry,
						materialSideTypes: new Uint8Array([0, 0, 3]),
					},
				})),
			},
		};

		const template = await preparer.prepare(visual);

		expect(template.parts[0]?.depthDrawUnits).toMatchObject([
			{ cullFace: "back", indexCount: 6, indexStart: 0 },
			{ cullFace: "front", indexCount: 3, indexStart: 6 },
		]);
		expect(template.appearance.materials).toHaveLength(2);
		expect(
			template.appearance.materials.every((binding) => !("polygon" in binding)),
		).toBe(true);
		expect(template.appearance.ranges).toMatchObject([
			{ materialSelector: 0, polygon: { cullFace: "back" } },
			{ materialSelector: 1, polygon: { cullFace: "back" } },
			{ materialSelector: 0, polygon: { cullFace: "front" } },
		]);
	});

	it("caches morphology from the resolved appearance's geometry-local carrier", async () => {
		const preparer = new InlineObjectVisualTemplatePreparer();
		const base = source("planar", "appearance:planar");
		const visual: DynamicPresentationSource = {
			...base,
			presentation: {
				...base.presentation,
				parts: base.presentation.parts.map((part) => ({
					...part,
					geometry: {
						...part.geometry,
						bounds: new AABB3(new Vec3(-2, -1, 0), new Vec3(2, 1, 0)),
					},
				})),
			},
			scale: new Vec3(9, 9, 9),
		};

		const template = await preparer.prepare(visual);

		expect(template.selectionGeometryMorphology).toBe("planar-carrier");
	});

	it("uses prepared template texture facts as the atlas requirement", async () => {
		const atlas = new FixtureAtlas();
		const repository = createRepository(
			new FixtureGeometry(),
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const base = source("textured", "appearance:textured");
		const visual: DynamicPresentationSource = {
			...base,
			presentation: {
				...base.presentation,
				parts: base.presentation.parts.map((part) => {
					const retainedMaterial = part.materials[1];
					if (!retainedMaterial)
						throw new Error("Expected the fixture's retained material.");
					return {
						...part,
						materials: [indexedMaterial(), retainedMaterial],
					};
				}),
			},
		};
		const staged = repository.stageOwner([visual]);

		await staged.completion;

		expect(
			atlas.preparedFacts.map(({ sourceAssetId }) => sourceAssetId),
		).toEqual(["0x05000001", "0x04000001"]);
		staged.release();
	});

	it("cannot publish an evicted in-flight template", async () => {
		const inline = new InlineObjectVisualTemplatePreparer();
		const visual = source("stale", "appearance:stale");
		const prepared = await inline.prepare(visual);
		const preparer = new DeferredPreparer();
		const geometry = new FixtureGeometry();
		const repository = createRepository(geometry, preparer);
		const requirement = repository.stageOwner([visual]);

		requirement.release();
		preparer.resolve(prepared);

		await expect(requirement.completion).resolves.toEqual(
			new Map([[prepared.key, prepared]]),
		);
		expect(repository.getState(objectVisualTemplateKey(visual))).toBeNull();
		expect(geometry.resources.size).toBe(0);
	});

	it("releases a failed staged template without disturbing committed ownership", async () => {
		const visual = source("failed", "appearance:failed");
		const repository = createRepository(new FixtureGeometry(), {
			async prepare() {
				throw new Error("template failed");
			},
			async destroy() {},
		});
		const requirement = repository.stageOwner([visual]);

		await expect(requirement.completion).rejects.toThrow("template failed");
		expect(repository.getState(objectVisualTemplateKey(visual))).toBe("failed");

		requirement.release();
		expect(repository.getState(objectVisualTemplateKey(visual))).toBeNull();
	});

	it("rolls geometry back when atlas preparation fails", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new FixtureAtlas({
			cause: new Error("pixels unavailable"),
			kind: "failed",
		});
		const repository = createRepository(
			geometry,
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("atlas-failure", "appearance:atlas-failure"),
		]);

		await expect(staged.completion).rejects.toThrow("pixels unavailable");
		expect(geometry.resources.size).toBe(0);
		expect(atlas.activeOwnerCount).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
		staged.release();
	});

	it("reports atlas rollback failure without leaking geometry", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new FixtureAtlas(
			{ cause: new Error("pixels unavailable"), kind: "failed" },
			new Error("atlas rollback failed"),
		);
		const repository = createRepository(
			geometry,
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("rollback-failure", "appearance:rollback-failure"),
		]);

		await expect(staged.completion).rejects.toThrow(
			"preparation and rollback both failed",
		);
		expect(geometry.resources.size).toBe(0);
		staged.release();
	});

	it("withdraws a superseded stage before atlas activation", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new DeferredAtlas();
		const repository = createRepository(
			geometry,
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("superseded", "appearance:superseded"),
		]);

		await atlas.prepared;
		staged.release();
		atlas.resolve("ready");
		await staged.completion;

		expect(geometry.resources.size).toBe(0);
		expect(atlas.activationCount).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
	});

	it("supports an independent spawned-shaped owner without a static layer", async () => {
		const atlas = new FixtureAtlas();
		const repository = createRepository(
			new FixtureGeometry(),
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("spawned", "appearance:spawned"),
		]);

		await staged.completion;
		staged.commit("spawned-generation:42");

		expect(atlas.activeOwnerCount).toBe(1);
		repository.dropOwner("spawned-generation:42");
		expect(atlas.activeOwnerCount).toBe(0);
	});

	it("surfaces an asynchronous committed-claim release failure at shutdown", async () => {
		const atlas = new FixtureAtlas("ready", new Error("atlas release failed"));
		const repository = createRepository(
			new FixtureGeometry(),
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("release-failure", "appearance:release-failure"),
		]);
		await staged.completion;
		staged.commit("spawned-generation:release-failure");

		repository.dropOwner("spawned-generation:release-failure");
		await expect(repository.destroy()).rejects.toThrow(
			"visual-template resources failed to release",
		);
	});

	it("waits for pending template rollback during shutdown", async () => {
		const geometry = new FixtureGeometry();
		const atlas = new DeferredAtlas();
		const repository = createRepository(
			geometry,
			new InlineObjectVisualTemplatePreparer(),
			atlas,
		);
		const staged = repository.stageOwner([
			source("shutdown", "appearance:shutdown"),
		]);
		await atlas.prepared;

		let destroyed = false;
		const destruction = repository.destroy().then(() => {
			destroyed = true;
		});
		await Promise.resolve();
		expect(destroyed).toBe(false);

		atlas.resolve("ready");
		await Promise.all([staged.completion, destruction]);
		expect(geometry.resources.size).toBe(0);
		expect(atlas.activationCount).toBe(0);
		expect(atlas.withdrawalCount).toBe(1);
	});
});

function createRepository(
	geometry: FixtureGeometry,
	preparer: ObjectVisualTemplatePreparer,
	atlas: ObjectVisualTemplateAtlas<ObjectVisualTemplateAtlasClaim> = new FixtureAtlas(),
) {
	return new ObjectVisualTemplateRepository(
		geometry,
		atlas,
		preparer,
		() => () => {},
	);
}

function source(id: string, appearanceKey: string): DynamicPresentationSource {
	return {
		entityClass: "other",
		nameplate: null,
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			motionTableId: null,
			soundTableId: null,
		},
		identity: id,
		localBounds: AABB3.zero(),
		presentation: {
			appearanceKey,
			lights: [],
			holdingLocations: new Map(),
			id: `presentation:${appearanceKey}`,
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: multiMaterialGeometry(),
					materials: [material("first"), material("second")],
					partIndex: 0,
					retailVisibility: "normally-visible",
				},
			],
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: AABB3.zero(),
			sortingBounds: null,
			sourceAssetId: "setup-model/02000001",
		},
		scale: new Vec3(1, 1, 1),
		setupId: "0x02000001",
	};
}

function multiMaterialGeometry(): ResolvedGeometry {
	return {
		bounds: AABB3.zero(),
		id: "geometry:multi-material",
		indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1]),
		materialSideKinds: new Uint8Array([0, 0, 0]),
		materialSideTypes: new Uint8Array([0, 0, 0]),
		materialSlotIndices: new Uint16Array([0, 1, 0]),
		materialStippling: new Uint8Array([0, 0, 0]),
		materialWrapModes: new Uint8Array([0, 0, 0]),
		normals: new Float32Array(12),
		positions: new Float32Array(12),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		textureCoordinates: new Float32Array(8),
	};
}

function material(id: string): ResolvedMaterial {
	return {
		color: [1, 1, 1, 1],
		diffuseScale: 1,
		id: `material:${id}`,
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags: 0,
		translucency: 0,
	};
}

function indexedMaterial(): ResolvedMaterial {
	return {
		colorTextureId: "0x05000001",
		diffuseScale: 1,
		id: "material:indexed",
		kind: "texture",
		luminosity: 0,
		paletteTextureId: "0x04000001",
		paletteComposite: null,
		rawSurfaceFlags: 0,
		renderSurfaceId: "0x06000001",
		textureEncoding: "index8",
		translucency: 0,
	};
}

class CountingPreparer implements ObjectVisualTemplatePreparer {
	readonly #inline = new InlineObjectVisualTemplatePreparer();
	count = 0;

	prepare(source: DynamicPresentationSource): Promise<ObjectVisualTemplate> {
		this.count += 1;
		return this.#inline.prepare(source);
	}

	async destroy(): Promise<void> {}
}

class DeferredPreparer implements ObjectVisualTemplatePreparer {
	#resolve: ((template: ObjectVisualTemplate) => void) | null = null;

	prepare(): Promise<ObjectVisualTemplate> {
		return new Promise((resolve) => {
			this.#resolve = resolve;
		});
	}

	resolve(template: ObjectVisualTemplate): void {
		const resolve = this.#resolve;
		if (!resolve) throw new Error("No visual template is pending.");
		this.#resolve = null;
		resolve(template);
	}

	async destroy(): Promise<void> {}
}

class FixtureGeometry {
	readonly leases = new Map<string, Set<string>>();
	readonly sources = new Map<string, GeometrySource>();
	readonly resources = new Set<string>();

	reserveKeys(owner: string, keys: readonly string[]): void {
		for (const key of keys) {
			const owners = this.leases.get(key) ?? new Set();
			owners.add(owner);
			this.leases.set(key, owners);
		}
	}

	replaceOwner(owner: string, sources: readonly GeometrySource[]): void {
		this.dropOwner(owner);
		this.reserveKeys(
			owner,
			sources.map((source) => source.key),
		);
		for (const source of sources) this.upsertGeometry(source);
	}

	upsertGeometry(source: GeometrySource): void {
		this.sources.set(source.key, source);
		this.resources.add(source.key);
	}

	dropOwner(owner: string): void {
		for (const [key, owners] of [...this.leases]) {
			owners.delete(owner);
			if (owners.size > 0) continue;
			this.leases.delete(key);
			this.resources.delete(key);
		}
	}
}

class FixtureAtlasClaim implements ObjectVisualTemplateAtlasClaim {
	constructor(
		readonly ownerId: ObjectVisualTemplateResourceOwnerId,
		readonly completion: Promise<AtlasRequirementCompletion>,
	) {}
}

class FixtureAtlas implements ObjectVisualTemplateAtlas<FixtureAtlasClaim> {
	readonly #claims = new Set<FixtureAtlasClaim>();
	readonly #activeOwners = new Set<ObjectVisualTemplateResourceOwnerId>();
	readonly #completion: AtlasRequirementCompletion;
	readonly #withdrawalFailure: unknown | null;
	readonly preparedFacts: AssetTextureFact[] = [];
	activationCount = 0;
	preparationCount = 0;
	withdrawalCount = 0;

	constructor(
		completion: AtlasRequirementCompletion = "ready",
		withdrawalFailure: unknown | null = null,
	) {
		this.#completion = completion;
		this.#withdrawalFailure = withdrawalFailure;
	}

	get activeOwnerCount(): number {
		return this.#activeOwners.size;
	}

	activateOwnerRevision(claim: FixtureAtlasClaim): Promise<void> {
		if (!this.#claims.has(claim)) {
			throw new Error(`Atlas claim for ${claim.ownerId} is not retained.`);
		}
		this.activationCount += 1;
		this.#activeOwners.add(claim.ownerId);
		return Promise.resolve();
	}

	prepareOwnerRequirements(
		ownerId: ObjectVisualTemplateResourceOwnerId,
		revision: number,
		facts: readonly AssetTextureFact[],
	): FixtureAtlasClaim {
		void revision;
		this.preparationCount += 1;
		this.preparedFacts.push(...facts);
		const claim = new FixtureAtlasClaim(
			ownerId,
			Promise.resolve(this.#completion),
		);
		this.#claims.add(claim);
		return claim;
	}

	withdrawOwnerRevision(claim: FixtureAtlasClaim): Promise<void> {
		if (this.#claims.delete(claim)) this.withdrawalCount += 1;
		this.#activeOwners.delete(claim.ownerId);
		return this.#withdrawalFailure
			? Promise.reject(this.#withdrawalFailure)
			: Promise.resolve();
	}
}

class DeferredAtlas implements ObjectVisualTemplateAtlas<FixtureAtlasClaim> {
	readonly #claims = new Set<FixtureAtlasClaim>();
	readonly #resolvePrepared: () => void;
	#resolveCompletion:
		((completion: AtlasRequirementCompletion) => void) | null = null;
	readonly prepared: Promise<void>;
	activationCount = 0;
	withdrawalCount = 0;

	constructor() {
		let resolvePrepared!: () => void;
		this.prepared = new Promise((resolve) => {
			resolvePrepared = resolve;
		});
		this.#resolvePrepared = resolvePrepared;
	}

	activateOwnerRevision(claim: FixtureAtlasClaim): Promise<void> {
		if (!this.#claims.has(claim)) {
			throw new Error(`Atlas claim for ${claim.ownerId} is not retained.`);
		}
		this.activationCount += 1;
		return Promise.resolve();
	}

	prepareOwnerRequirements(
		ownerId: ObjectVisualTemplateResourceOwnerId,
	): FixtureAtlasClaim {
		const completion = new Promise<AtlasRequirementCompletion>((resolve) => {
			this.#resolveCompletion = resolve;
		});
		const claim = new FixtureAtlasClaim(ownerId, completion);
		this.#claims.add(claim);
		this.#resolvePrepared();
		return claim;
	}

	resolve(completion: AtlasRequirementCompletion): void {
		const resolve = this.#resolveCompletion;
		if (!resolve) throw new Error("No atlas claim is pending.");
		this.#resolveCompletion = null;
		resolve(completion);
	}

	withdrawOwnerRevision(claim: FixtureAtlasClaim): Promise<void> {
		if (this.#claims.delete(claim)) this.withdrawalCount += 1;
		return Promise.resolve();
	}
}
