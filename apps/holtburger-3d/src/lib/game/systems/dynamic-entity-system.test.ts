import { describe, expect, it } from "vitest";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import { EffectSystem } from "./effect-system";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import {
	createObjectGeometryKey,
	type GeometrySource,
} from "../geometry/types";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import { createRotationMat4 } from "../math/matrices";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "../resolution/presentation";
import { INCLUDE_ALL_SCENE_CULLING_GROUPS, SceneGraph } from "../scene";
import type { DynamicPresentationSample } from "./animation-system";
import { DynamicEntitySystem } from "./dynamic-entity-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
	objectVisualTemplateKey,
	type ObjectVisualTemplateAtlas,
	type ObjectVisualTemplateAtlasClaim,
	type ObjectVisualTemplate,
	type ObjectVisualTemplatePreparer,
} from "./object-visual-template-repository";

describe("DynamicEntitySystem authored ownership", () => {
	it("installs and removes a promoted owner population as one set", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const installation = system.replaceOwner("layer", [
			source("a"),
			source("b"),
		]);

		expect(await installation.ready).toBe("ready");
		commit(installation);
		expect(installation.nodeIds).toHaveLength(2);
		for (const nodeId of installation.nodeIds) {
			expect(system.getRenderable(nodeId)).not.toBeNull();
		}

		system.removeOwner("layer");
		for (const nodeId of installation.nodeIds) {
			expect(system.getRenderable(nodeId)).toBeNull();
		}
	});

	it("keeps the previous owner generation when replacement construction fails", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const previous = system.replaceOwner("layer", [source("previous")]);
		expect(await previous.ready).toBe("ready");
		commit(previous);

		expect(() =>
			system.replaceOwner("layer", [source("invalid", [0, 0])]),
		).toThrow("duplicate part index 0");
		expect(
			system.getRenderable(requiredAt(previous.nodeIds, 0)),
		).not.toBeNull();
	});

	it("does not publish resources from a superseded preparation", async () => {
		const preparer = new DeferredPreparer();
		const { geometry, system } = createSystem(preparer);
		const stale = system.replaceOwner("layer", [source("stale")]);
		const current = system.replaceOwner("layer", [source("current")]);

		preparer.resolveNext(prepared("stale"));
		expect(await stale.ready).toBe("superseded");
		expect(geometry.upserted).toEqual([]);

		preparer.resolveNext(prepared("current"));
		expect(await current.ready).toBe("ready");
		commit(current);
		expect(geometry.upserted).toEqual([
			createObjectGeometryKey("prepared/current"),
		]);
	});

	it("withdraws a current owner generation whose preparation fails", async () => {
		const preparer = new DeferredPreparer();
		const { system } = createSystem(preparer);
		const installation = system.replaceOwner("layer", [source("broken")]);

		preparer.rejectNext(new Error("preparation failed"));
		await expect(installation.ready).rejects.toThrow("preparation failed");
		expect(
			system.getRenderable(requiredAt(installation.nodeIds, 0)),
		).toBeNull();
	});

	it("keeps the committed generation when asynchronous replacement preparation fails", async () => {
		const preparer = new DeferredPreparer();
		const { system } = createSystem(preparer);
		const previous = system.replaceOwner("layer", [source("previous")]);
		preparer.resolveNext(prepared("previous"));
		expect(await previous.ready).toBe("ready");
		commit(previous);

		const replacement = system.replaceOwner("layer", [source("replacement")]);
		preparer.rejectNext(new Error("replacement failed"));
		await expect(replacement.ready).rejects.toThrow("replacement failed");

		expect(
			system.getRenderable(requiredAt(previous.nodeIds, 0)),
		).not.toBeNull();
		expect(system.getRenderable(requiredAt(replacement.nodeIds, 0))).toBeNull();
	});

	it("keeps the committed generation when replacement geometry allocation fails", async () => {
		const { geometry, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const previous = system.replaceOwner("layer", [source("previous")]);
		expect(await previous.ready).toBe("ready");
		commit(previous);
		geometry.failReplacement = true;

		const replacement = system.replaceOwner("layer", [source("replacement")]);
		await expect(replacement.ready).rejects.toThrow(
			"geometry replacement failed",
		);
		expect(
			system.getRenderable(requiredAt(previous.nodeIds, 0)),
		).not.toBeNull();
		expect(system.getRenderable(requiredAt(replacement.nodeIds, 0))).toBeNull();
	});

	it("awaits in-flight preparation before destroying shared repositories", async () => {
		const preparer = new DeferredPreparer();
		const { system } = createSystem(preparer);
		const installation = system.replaceOwner("layer", [source("pending")]);
		let destroyed = false;
		const destruction = system.destroy().then(() => {
			destroyed = true;
		});

		await Promise.resolve();
		expect(destroyed).toBe(false);
		preparer.resolveNext(prepared("pending"));
		expect(await installation.ready).toBe("superseded");
		await destruction;
		expect(destroyed).toBe(true);
	});

	it("releases every acquired animation when prepared-part validation fails", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const installation = system.replaceOwner("layer", [
			source("incomplete-animation", [0, 1]),
		]);

		await expect(installation.ready).rejects.toThrow(
			"has 1 parts but appearance requires part 1",
		);
		expect(system.getDiagnostics().animationResources.referenceCount).toBe(0);
	});

	it("emits shared batch identities with independent scaled instance transforms", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const shared = source("shared");
		const firstPlacement = Mat4.identity();
		firstPlacement.m41 = 12;
		const installation = system.replaceOwner("layer", [
			{
				...shared,
				identity: { kind: "authored", sourceId: "first" },
				placement: { ...shared.placement, localTransform: firstPlacement },
				scale: new Vec3(2, 3, 4),
			},
			{
				...shared,
				identity: { kind: "authored", sourceId: "second" },
				scale: new Vec3(5, 6, 7),
			},
		]);

		expect(await installation.ready).toBe("ready");
		commit(installation);
		const firstNodeId = requiredAt(installation.nodeIds, 0);
		const secondNodeId = requiredAt(installation.nodeIds, 1);
		const first = system.getVisibleContributions(firstNodeId);
		const second = system.getVisibleContributions(secondNodeId);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(first?.[0]?.drawUnit.batchKey).toBe(second?.[0]?.drawUnit.batchKey);
		expect(first?.[0]?.domain).toMatchObject({
			key: "0x0001ffff/outdoor",
			landblockId: "0x0001ffff",
			scope: { kind: "outdoor" },
		});
		expect(first?.[0]?.instance.sourceToLandblock).toMatchObject({
			m11: 2,
			m22: 3,
			m33: 4,
			m41: 12,
		});
		expect(second?.[0]?.instance.sourceToLandblock).toMatchObject({
			m11: 5,
			m22: 6,
			m33: 7,
		});
		expect(
			scene.queryFlatFrustum(
				{ cameraPosition: Vec3.zero(), planes: [] },
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toContain(installation.nodeIds[0]);
	});

	it("publishes translucency through alpha, transparent ordering, sorting, and full suppression", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const shared = source("shared-translucency");
		const installation = system.replaceOwner("layer", [
			{ ...shared, identity: { kind: "authored", sourceId: "first" } },
			{ ...shared, identity: { kind: "authored", sourceId: "second" } },
		]);
		expect(await installation.ready).toBe("ready");
		const prepared = installation.getPreparedEntities();
		const firstPrepared = prepared[0];
		const secondPrepared = prepared[1];
		if (!firstPrepared || !secondPrepared)
			throw new Error("Expected two prepared dynamic entities.");
		installation.prepareCommit([
			presentationSample(firstPrepared, 0.25),
			presentationSample(secondPrepared, 0.5),
		]);
		installation.commit();

		const firstNodeId = requiredAt(installation.nodeIds, 0);
		const secondNodeId = requiredAt(installation.nodeIds, 1);
		const first = system.getVisibleContributions(firstNodeId)?.[0];
		const second = system.getVisibleContributions(secondNodeId)?.[0];
		expect(first).toMatchObject({
			drawUnit: { ordering: "transparent" },
			instance: { color: { a: 0.75 } },
		});
		expect(first?.transparentSort).not.toBeNull();
		expect(second).toMatchObject({
			drawUnit: { ordering: "transparent" },
			instance: { color: { a: 0.5 } },
		});
		expect(first?.drawUnit.batchKey).toBe(second?.drawUnit.batchKey);
		const firstOpaque = presentationSample(firstPrepared, 0);
		expect(() =>
			system.publishPresentation([firstOpaque, firstOpaque]),
		).toThrow(`repeats entity ${firstPrepared.nodeId}`);
		expect(() =>
			system.publishPresentation([
				{ ...firstOpaque, nodeId: "scene-node:999" },
			]),
		).toThrow("scene-node:999 does not exist");

		system.publishPresentation([presentationSample(firstPrepared, 1)]);
		expect(system.getVisibleContributions(firstNodeId)).toEqual([]);

		system.publishPresentation([presentationSample(firstPrepared, 0)]);
		expect(system.getVisibleContributions(firstNodeId)?.[0]).toMatchObject({
			drawUnit: { ordering: "opaque" },
			instance: { color: { a: 1 } },
			transparentSort: null,
		});
		expect(system.getDiagnostics().lastPublishedPresentationCount).toBe(1);
	});

	it("publishes pose-local bounds without changing swept scene bounds", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new FixtureAnimationSource(2),
		);
		const base = source("published-bounds", [0, 1]);
		const firstPart = requiredAt(base.presentation.parts, 0);
		const secondPart = requiredAt(base.presentation.parts, 1);
		const boundedSource: AuthoredDynamicSource = {
			...base,
			presentation: {
				...base.presentation,
				parts: [
					{
						...firstPart,
						geometry: {
							...firstPart.geometry,
							bounds: new AABB3(new Vec3(5, 0, -1), new Vec3(6, 1, 1)),
						},
					},
					{
						...secondPart,
						defaultScale: new Vec3(1, 0.5, 2),
						geometry: {
							...secondPart.geometry,
							bounds: new AABB3(Vec3.zero(), new Vec3(1, 1, 1)),
						},
					},
				],
			},
			scale: new Vec3(2, 3, 4),
		};
		const installation = system.replaceOwner("layer", [boundedSource]);
		expect(await installation.ready).toBe("ready");
		const preparedEntity = requiredAt(installation.getPreparedEntities(), 0);
		const sample = presentationSample(preparedEntity, 0);
		const firstPartTransform = Mat4.identity();
		firstPartTransform.m41 = 1;
		const secondPartTransform = Mat4.identity();
		secondPartTransform.m41 = -5;
		const halfSqrt = Math.sqrt(0.5);
		const rootRotation = createRotationMat4(new Quat(halfSqrt, 0, 0, halfSqrt));
		const rotatedSample: DynamicPresentationSample = {
			...sample,
			articulatedPose: {
				partToObjectTransforms: [firstPartTransform, secondPartTransform],
			},
			effects: { ...sample.effects, rootTransformModifier: rootRotation },
		};
		installation.prepareCommit([rotatedSample]);
		installation.commit();
		const nodeId = requiredAt(installation.nodeIds, 0);

		expectBounds(
			system.getPublishedPresentationBounds(nodeId),
			new AABB3(new Vec3(-3, -10, -4), new Vec3(0, 14, 8)),
		);
		const sweptBounds = scene.getNode(nodeId)?.localBounds;
		system.publishPresentation([sample]);
		expect(system.getPublishedPresentationBounds(nodeId)).toEqual(
			new AABB3(new Vec3(0, 0, -4), new Vec3(12, 3, 8)),
		);
		expect(scene.getNode(nodeId)?.localBounds).toEqual(sweptBounds);
	});

	it("activates a blocked visual clip as valid static presentation", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new BlockedAnimationSource(),
		);
		const installation = system.replaceOwner("layer", [source("blocked")]);
		expect(await installation.ready).toBe("ready");
		commit(installation);
		const nodeId = requiredAt(installation.nodeIds, 0);
		expect(system.getPreparedAnimation(nodeId)).toMatchObject({
			kind: "retain-static-presentation",
		});

		expect(
			scene.queryFlatFrustum(
				{ cameraPosition: Vec3.zero(), planes: [] },
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toContain(nodeId);
	});
});

function commit(
	installation: ReturnType<DynamicEntitySystem<string>["replaceOwner"]>,
): void {
	installation.prepareCommit(
		installation
			.getPreparedEntities()
			.flatMap((prepared) =>
				prepared.animation.kind === "activatable"
					? [presentationSample(prepared, 0)]
					: [],
			),
	);
	installation.commit();
}

function expectBounds(actual: AABB3 | null, expected: AABB3): void {
	if (!actual) throw new Error("Expected published presentation bounds.");
	expect(actual.min.x).toBeCloseTo(expected.min.x);
	expect(actual.min.y).toBeCloseTo(expected.min.y);
	expect(actual.min.z).toBeCloseTo(expected.min.z);
	expect(actual.max.x).toBeCloseTo(expected.max.x);
	expect(actual.max.y).toBeCloseTo(expected.max.y);
	expect(actual.max.z).toBeCloseTo(expected.max.z);
}

function presentationSample(
	prepared: ReturnType<
		ReturnType<
			DynamicEntitySystem<string>["replaceOwner"]
		>["getPreparedEntities"]
	>[number],
	translucency: number,
): DynamicPresentationSample {
	const { animation, nodeId } = prepared;
	if (animation.kind !== "activatable")
		throw new Error("Static fallback has no dynamic presentation sample.");
	return {
		articulatedPose: {
			partToObjectTransforms: Array.from(
				{ length: animation.animation.partCount },
				() => Mat4.identity(),
			),
		},
		effects: {
			partRenderStates: Array.from(
				{ length: animation.animation.partCount },
				() => ({ translucency }),
			),
			rootTransformModifier: Mat4.identity(),
		},
		nodeId,
	};
}

function createSystem(
	preparer: ObjectVisualTemplatePreparer,
	animationSource: AnimationAssetSource = new FixtureAnimationSource(),
) {
	const scene = new SceneGraph();
	const effects = new EffectSystem();
	const geometry = new FixtureGeometry();
	const templates = new ObjectVisualTemplateRepository(
		geometry,
		new ReadyTemplateAtlas(),
		preparer,
	);
	const system = new DynamicEntitySystem<string>(
		scene,
		templates,
		new AnimationAssetRepository(animationSource),
		new PhysicsScriptRepository({
			destroy: () => {},
			loadPhysicsScript: async (scriptId) => {
				throw new Error(`No script fixture for ${scriptId}.`);
			},
		}),
		new ParticleEmitterRepository({
			destroy: () => {},
			loadParticleEmitter: async (emitterInfoId) => {
				throw new Error(`No emitter fixture for ${emitterInfoId}.`);
			},
		}),
		effects,
		(ownerId: string, generation: number) =>
			`${ownerId}:generation:${generation}`,
	);
	return { effects, geometry, scene, system };
}

function source(
	id: string,
	partIndices: readonly number[] = [0],
): AuthoredDynamicSource {
	const presentation: ResolvedObjectPresentation = {
		appearanceKey: `appearance:${id}`,
		lights: [],
		holdingLocations: new Map(),
		id: `presentation:${id}`,
		parts: partIndices.map((partIndex) => ({
			defaultScale: new Vec3(1, 1, 1),
			geometry: geometry(`geometry:${id}`),
			materials: [material(`material:${id}`)],
			partIndex,
		})),
		placementPoses: new Map([
			[
				0,
				{
					partTransforms: Array.from(
						{ length: Math.max(...partIndices) + 1 },
						() => Mat4.identity(),
					),
					placementId: 0,
				},
			],
		]),
		selectionBounds: AABB3.zero(),
		sortingBounds: null,
		sourceAssetId: `setup-model/${id}`,
	};
	return {
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: id },
		localBounds: AABB3.zero(),
		placement: {
			envCellId: null,
			landblockId: "0x0001ffff",
			localTransform: Mat4.identity(),
		},
		presentation,
		scale: new Vec3(1, 1, 1),
		setupId: "0x02000001",
	};
}

function geometry(id: string): ResolvedGeometry {
	return {
		bounds: AABB3.zero(),
		id: id as ResolvedGeometry["id"],
		indices: new Uint32Array([0, 1, 2]),
		materialSideKinds: new Uint8Array([0]),
		materialSideTypes: new Uint8Array([0]),
		materialSlotIndices: new Uint16Array([0]),
		materialStippling: new Uint8Array([0]),
		materialWrapModes: new Uint8Array([0]),
		normals: new Float32Array(9),
		positions: new Float32Array(9),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		textureCoordinates: new Float32Array(6),
	};
}

function material(id: string): ResolvedMaterial {
	return {
		color: [1, 1, 1, 1],
		diffuseScale: 1,
		id: id as ResolvedMaterial["id"],
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags: 0,
		translucency: 0,
	};
}

function prepared(id: string): ObjectVisualTemplate {
	const key = createObjectGeometryKey(`prepared/${id}`);
	const geometrySource: GeometrySource = {
		geometry: {
			indices: new Uint32Array([0, 1, 2]),
			bakedLight: null,
			kind: "object",
			normals: new Float32Array(9),
			positions: new Float32Array(9),
			textureCoordinates: new Float32Array(6),
		},
		key,
	};
	const visualSource = source(id);
	return {
		appearanceKey: visualSource.presentation.appearanceKey,
		baseBounds: AABB3.zero(),
		geometry: [geometrySource],
		key: objectVisualTemplateKey(visualSource),
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				drawUnits: [],
				geometry: key,
				key: `part-visual-template:${id}` as never,
				localBounds: AABB3.zero(),
				partIndex: 0,
			},
		],
		textureRequirements: [],
	};
}

function requiredAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined)
		throw new Error(`Expected test value at index ${index}.`);
	return value;
}

class DeferredPreparer implements ObjectVisualTemplatePreparer {
	readonly #pending: Array<{
		readonly resolve: (value: ObjectVisualTemplate) => void;
		readonly reject: (reason: unknown) => void;
	}> = [];

	prepare(): Promise<ObjectVisualTemplate> {
		return new Promise((resolve, reject) => {
			this.#pending.push({ reject, resolve });
		});
	}

	resolveNext(value: ObjectVisualTemplate): void {
		const pending = this.#pending.shift();
		if (!pending) throw new Error("No dynamic preparation is pending.");
		pending.resolve(value);
	}

	rejectNext(reason: unknown): void {
		const pending = this.#pending.shift();
		if (!pending) throw new Error("No dynamic preparation is pending.");
		pending.reject(reason);
	}

	async destroy(): Promise<void> {}
}

class FixtureGeometry {
	readonly upserted: string[] = [];
	failReplacement = false;

	reserveKeys(): void {}

	replaceOwner(_owner: string, sources: readonly GeometrySource[]): void {
		if (this.failReplacement) throw new Error("geometry replacement failed");
		for (const source of sources) this.upsertGeometry(source);
	}

	upsertGeometry(source: GeometrySource): void {
		this.upserted.push(source.key);
	}

	dropOwner(): void {}
}

class ReadyTemplateAtlasClaim implements ObjectVisualTemplateAtlasClaim {
	readonly completion = Promise.resolve("ready" as const);
}

class ReadyTemplateAtlas implements ObjectVisualTemplateAtlas<ReadyTemplateAtlasClaim> {
	activateOwnerRevision(): Promise<void> {
		return Promise.resolve();
	}

	prepareOwnerRequirements(): ReadyTemplateAtlasClaim {
		return new ReadyTemplateAtlasClaim();
	}

	withdrawOwnerRevision(): Promise<void> {
		return Promise.resolve();
	}
}

class FixtureAnimationSource implements AnimationAssetSource {
	constructor(readonly partCount = 1) {}

	async loadAnimation(
		animationId: "0x03000001",
	): Promise<DecodedAnimationAsset> {
		return {
			frameCount: 1,
			hooks: [],
			id: animationId,
			partCount: this.partCount,
			partFrames: Array.from({ length: this.partCount }, () => Mat4.identity()),
			positionFrames: [],
		};
	}

	destroy(): void {}
}

class BlockedAnimationSource implements AnimationAssetSource {
	async loadAnimation(
		animationId: "0x03000001",
	): Promise<DecodedAnimationAsset> {
		return {
			frameCount: 1,
			hooks: [
				{
					authoredOrder: 0,
					command: "unsupported",
					direction: "both",
					frameIndex: 0,
					blocksActivation: true,
					kind: "unimplemented",
					payload: { bytes: new Uint8Array(), kind: "raw" },
					sourceType: 999,
				},
			],
			id: animationId,
			partCount: 1,
			partFrames: [Mat4.identity()],
			positionFrames: [],
		};
	}

	destroy(): void {}
}
