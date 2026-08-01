import { describe, expect, it } from "vitest";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import {
	createObjectGeometryKey,
	type GeometrySource,
} from "../geometry/types";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "../resolution/presentation";
import { SceneGraph } from "../scene";
import { DynamicEntitySystem } from "./dynamic-entity-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateManager,
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
	type ObjectVisualTemplatePreparer,
} from "./object-visual-template-manager";

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
		expect(system.getRenderable(previous.nodeIds[0]!)).not.toBeNull();
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
		expect(system.getRenderable(installation.nodeIds[0]!)).toBeNull();
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

		expect(system.getRenderable(previous.nodeIds[0]!)).not.toBeNull();
		expect(system.getRenderable(replacement.nodeIds[0]!)).toBeNull();
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
		expect(system.getRenderable(previous.nodeIds[0]!)).not.toBeNull();
		expect(system.getRenderable(replacement.nodeIds[0]!)).toBeNull();
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
		const first = system.getVisibleContributions(installation.nodeIds[0]!);
		const second = system.getVisibleContributions(installation.nodeIds[1]!);
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
			).entries,
		).toContain(installation.nodeIds[0]);
	});

	it("activates a blocked visual clip as valid static presentation", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new BlockedAnimationSource(),
		);
		const installation = system.replaceOwner("layer", [source("blocked")]);
		expect(await installation.ready).toBe("ready");
		commit(installation);
		const nodeId = installation.nodeIds[0]!;
		expect(system.getPreparedAnimation(nodeId)).toMatchObject({
			kind: "retain-static-presentation",
		});

		expect(
			scene.queryFlatFrustum(
				{ cameraPosition: Vec3.zero(), planes: [] },
				"0x0001ffff",
			).entries,
		).toContain(nodeId);
	});
});

function commit(
	installation: ReturnType<DynamicEntitySystem<string>["replaceOwner"]>,
): void {
	installation.prepareCommit(
		installation.getPreparedEntities().flatMap(({ animation, nodeId }) =>
			animation.kind === "activatable"
				? [
						{
							nodeId,
							pose: {
								partToObjectTransforms: Array.from(
									{ length: animation.animation.partCount },
									() => Mat4.identity(),
								),
							},
							visualRootTransform: Mat4.identity(),
						},
					]
				: [],
		),
	);
	installation.commit();
}

function createSystem(
	preparer: ObjectVisualTemplatePreparer,
	animationSource: AnimationAssetSource = new FixtureAnimationSource(),
) {
	const scene = new SceneGraph();
	const geometry = new FixtureGeometry();
	const templates = new ObjectVisualTemplateManager(geometry, preparer);
	const system = new DynamicEntitySystem<string>(
		scene,
		templates,
		new AnimationAssetRepository(animationSource),
		(ownerId, generation) => `${ownerId}:generation:${generation}`,
	);
	return { geometry, scene, system };
}

function source(
	id: string,
	partIndices: readonly number[] = [0],
): AuthoredDynamicSource {
	const presentation: ResolvedObjectPresentation = {
		appearanceKey: `appearance:${id}`,
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

class FixtureAnimationSource implements AnimationAssetSource {
	async loadAnimation(
		animationId: "0x03000001",
	): Promise<DecodedAnimationAsset> {
		return {
			frameCount: 1,
			hooks: [],
			id: animationId,
			partCount: 1,
			partFrames: [Mat4.identity()],
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
					kind: "unsupported-visual",
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
