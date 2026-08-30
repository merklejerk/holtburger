import { describe, expect, it } from "vitest";
import { expandBounds } from "../math/geometry-utils";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { AUTHORED_SCRIPT_FIXTURES } from "../behavior/authored-script-fixtures";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import { EffectSystem } from "./effect-system";
import { SoundTableRepository } from "../behavior/sound-table-repository";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import type { PlacedDynamicPresentationSource } from "./dynamic-presentation-source";
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
import { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
	objectVisualTemplateKey,
	type ObjectVisualTemplateAtlas,
	type ObjectVisualTemplateAtlasClaim,
	type ObjectVisualTemplate,
	type ObjectVisualTemplatePreparer,
} from "./object-visual-template-repository";
import { RUNTIME_LIGHT_RANGE_SCALE } from "../environment/runtime-lights";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";

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

	it("attaches a child through the parent rigid part and the requested child pose", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const parentBase = source("parent");
		const holdingOffset = Mat4.identity();
		holdingOffset.m41 = 2;
		const parentSource: PlacedDynamicPresentationSource = {
			...parentBase,
			placement: {
				...parentBase.placement,
				localTransform: Object.assign(Mat4.identity(), { m41: 10 }),
			},
			source: {
				...parentBase.source,
				presentation: {
					...parentBase.source.presentation,
					holdingLocations: new Map([
						[
							"right-hand",
							{
								location: "right-hand",
								offsetTransform: holdingOffset,
								partIndex: 0,
							},
						],
					]),
				},
			},
		};
		const childBase = source("child");
		const fallbackPose = Mat4.identity();
		fallbackPose.m41 = 1;
		const requestedPose = Mat4.identity();
		requestedPose.m41 = 4;
		const childSource: PlacedDynamicPresentationSource = {
			...childBase,
			source: {
				...childBase.source,
				presentation: {
					...childBase.source.presentation,
					placementPoses: new Map([
						[0, { placementId: 0, partTransforms: [fallbackPose] }],
						[1, { placementId: 1, partTransforms: [requestedPose] }],
					]),
				},
			},
		};
		const parent = system.replaceOwner("parent", [parentSource]);
		const child = system.replaceOwner("child", [childSource]);
		expect(await parent.ready).toBe("ready");
		expect(await child.ready).toBe("ready");
		commit(parent);
		commit(child);
		const parentRoot = requiredAt(parent.nodeIds, 0);
		const childRoot = requiredAt(child.nodeIds, 0);
		const parentPart = system.resolvePartNode(parentRoot, 0)!;
		const animatedParentPose = Mat4.identity();
		animatedParentPose.m41 = 3;
		scene.updateLocalTransform(parentPart, animatedParentPose);

		system.attachEntity(childRoot, parentRoot, "right-hand", 1);

		const childPart = system.resolvePartNode(childRoot, 0)!;
		expect(scene.getResolvedPlacement(childPart)?.localToLandblock.m41).toBe(
			19,
		);
		system.removeOwner("child");
		system.removeOwner("parent");
	});

	/// A body transitions into clips it has not played, so the whole table stages before activation
	/// — the same rule physics-script closures hold to.
	it("stages the whole motion closure of a resident that animates from a table", async () => {
		const animations = new FixtureAnimationSource();
		const { system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			animations,
		);
		const base = source("motion-table");
		const animated: PlacedDynamicPresentationSource = {
			...base,
			source: {
				...base.source,
				behavior: {
					animationId: "0x03000001",
					kind: "animation-only",
					motionTableId: "0x09000001" as DatAssetId,
					physicsScriptId: null,
					physicsScriptTableId: null,
					soundTableId: null,
				},
			},
		};

		const installation = system.replaceOwner("layer", [animated]);

		expect(await installation.ready).toBe("ready");
		const prepared = installation.getPreparedEntities();
		commit(installation);
		expect([...prepared[0]!.motionClosure!.animations.keys()]).toEqual([
			"0x03000001",
			"0x03000002",
		]);
		expect(animations.loads).toContain("0x03000002");
	});

	/// The runtime clip swap resolves from the staged closure, so it can never trigger a load.
	it("resolves a staged clip by id and refuses one the closure never reached", async () => {
		const animations = new FixtureAnimationSource();
		const { system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			animations,
		);
		const base = source("motion-table");
		const animated: PlacedDynamicPresentationSource = {
			...base,
			source: {
				...base.source,
				behavior: {
					animationId: "0x03000001",
					kind: "animation-only",
					motionTableId: "0x09000001" as DatAssetId,
					physicsScriptId: null,
					physicsScriptTableId: null,
					soundTableId: null,
				},
			},
		};
		const installation = system.replaceOwner("layer", [animated]);
		expect(await installation.ready).toBe("ready");
		const nodeId = installation.nodeIds[0]!;
		commit(installation);
		const loadsAfterActivation = animations.loads.length;

		expect(system.getMotionClip(nodeId, "0x03000002" as DatAssetId)?.id).toBe(
			"0x03000002",
		);
		// Absent from the closure rather than present-and-broken; both leave the current pose.
		expect(system.getMotionClip(nodeId, "0x0300dead" as DatAssetId)).toBeNull();
		expect(animations.loads).toHaveLength(loadsAfterActivation);
	});

	/// The host names a clip only for a body whose table this entity staged, so a mismatch is a
	/// contract defect rather than content the frontend should quietly skip.
	it("rejects a clip named for an entity that staged no motion table", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const installation = system.replaceOwner("layer", [source("plain")]);
		expect(await installation.ready).toBe("ready");
		const nodeId = installation.nodeIds[0]!;
		commit(installation);

		expect(() =>
			system.getMotionClip(nodeId, "0x03000002" as DatAssetId),
		).toThrow("staged no motion table");
	});

	/// A resident with no table stages no closure, so static scenery pays nothing for a mechanism
	/// it does not use.
	it("stages no motion closure for a resident that declares no table", async () => {
		const animations = new FixtureAnimationSource();
		const { system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			animations,
		);

		const installation = system.replaceOwner("layer", [source("plain")]);

		expect(await installation.ready).toBe("ready");
		const prepared = installation.getPreparedEntities();
		commit(installation);
		expect(prepared[0]!.motionClosure).toBeNull();
		expect(animations.loads).not.toContain("0x03000002");
	});

	it("promotes a script-only resident and stages its behavior closure", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		// 0x330003d8 leads into the self-cycling 0x330003cc, so the closure spans two scripts.
		const base = source("script-only");
		const scriptOnly: PlacedDynamicPresentationSource = {
			...base,
			source: {
				...base.source,
				behavior: {
					animationId: null,
					kind: "script-only",
					physicsScriptId: "0x330003d8",
					physicsScriptTableId: null,
					motionTableId: null,
					soundTableId: null,
				},
			},
		};

		const installation = system.replaceOwner("layer", [scriptOnly]);

		expect(await installation.ready).toBe("ready");
		const prepared = installation.getPreparedEntities();
		commit(installation);
		// A resident with no animation is still fully activated; it simply has no playback.
		expect(prepared[0]!.animation.kind).toBe("none");
		expect([...prepared[0]!.scriptClosure!.scripts.keys()].sort()).toEqual([
			"0x330003cc",
			"0x330003d8",
		]);
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

	it("stages a partial animation and releases it with its uncommitted owner", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const installation = system.replaceOwner("layer", [
			source("incomplete-animation", [0, 1]),
		]);

		expect(await installation.ready).toBe("ready");
		expect(installation.getPreparedEntities()[0]?.animation.kind).toBe(
			"activatable",
		);
		installation.release();
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
				placement: { ...shared.placement, localTransform: firstPlacement },
				source: {
					...shared.source,
					identity: "first",
					scale: new Vec3(2, 3, 4),
				},
			},
			{
				...shared,
				source: {
					...shared.source,
					identity: "second",
					scale: new Vec3(5, 6, 7),
				},
			},
		]);

		expect(await installation.ready).toBe("ready");
		commit(installation);
		const firstNodeId = requiredAt(installation.nodeIds, 0);
		const secondNodeId = requiredAt(installation.nodeIds, 1);
		const materialOnly = system.getVisibleContributions(firstNodeId, false);
		expect(materialOnly).toMatchObject({
			depth: [],
			kind: "visible",
			material: [{}],
		});
		const first = system.getVisibleContributions(firstNodeId, true);
		const second = system.getVisibleContributions(secondNodeId, true);
		expect(first).toBe(materialOnly);
		expect(first?.material).toHaveLength(1);
		expect(first?.depth).toHaveLength(1);
		expect(second?.material).toHaveLength(1);
		expect(second?.depth).toHaveLength(1);
		expect(first?.material[0]?.drawUnit.batchKey).toBe(
			second?.material[0]?.drawUnit.batchKey,
		);
		expect(first).toMatchObject({
			landblockId: "0x0001ffff",
			renderScopes: [{ kind: "outdoor" }],
		});
		expect(first?.material[0]?.instance.sourceToLandblock).toMatchObject({
			m11: 2,
			m22: 3,
			m33: 4,
			m41: 12,
		});
		expect(second?.material[0]?.instance.sourceToLandblock).toMatchObject({
			m11: 5,
			m22: 6,
			m33: 7,
		});
		const firstContribution = first?.material[0];
		const firstDepthContribution = first?.depth[0];
		const firstInstance = firstContribution?.instance;
		const firstAgain = system.getVisibleContributions(firstNodeId, true);
		expect(firstAgain).toBe(first);
		expect(firstAgain?.material[0]).toBe(firstContribution);
		expect(firstAgain?.depth[0]).toBe(firstDepthContribution);
		expect(firstAgain?.material[0]?.instance).toBe(firstInstance);
		expect(firstAgain?.depth[0]?.instance).toBe(firstInstance);
		expect(system.getVisibleContributions(firstNodeId, false)).toMatchObject({
			depth: [],
			kind: "visible",
			material: [{ instance: firstInstance }],
		});
		expect(
			scene.queryFlatFrustum(
				{ cameraPosition: Vec3.zero(), planes: [] },
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toContain(installation.nodeIds[0]);
	});

	it("publishes enabled setup lights from the unscaled current object frame", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const base = source("lamp");
		const localTransform = Mat4.identity();
		localTransform.m41 = 12;
		const installation = system.replaceOwner("layer", [
			{
				...base,
				placement: { ...base.placement, localTransform },
				source: {
					...base.source,
					presentation: {
						...base.source.presentation,
						lights: [
							{
								color: { red: 0.1, green: 0.2, blue: 0.3 },
								falloff: 4,
								intensity: 100,
								offset: new Vec3(1, 2, 3),
							},
						],
					},
					// Retail light frames do not inherit CPartArray's gfx-object scale.
					scale: new Vec3(5, 5, 5),
				},
			},
		]);
		expect(await installation.ready).toBe("ready");
		commit(installation);
		const nodeId = requiredAt(installation.nodeIds, 0);
		expect(system.getRuntimeLights()).toEqual([]);

		system.updatePresentationState(nodeId, {
			cloaked: false,
			hidden: false,
			lighting: true,
			noDraw: true,
		});
		expect(system.getRuntimeLights()).toEqual([
			{
				color: { red: 0.1, green: 0.2, blue: 0.3 },
				intensity:
					100 *
					SHARED_FRONTEND_TUNING.rendering.outdoorAuthoredLights.intensityScale,
				position: { x: 13, y: 2, z: -189 },
				range: 4 * RUNTIME_LIGHT_RANGE_SCALE,
			},
		]);

		system.updatePresentationState(nodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
		});
		expect(system.getRuntimeLights()).toEqual([]);
	});

	it("publishes translucency through alpha, transparent ordering, sorting, and full suppression", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const shared = source("shared-translucency");
		const installation = system.replaceOwner("layer", [
			{ ...shared, source: { ...shared.source, identity: "first" } },
			{ ...shared, source: { ...shared.source, identity: "second" } },
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
		const first = system.getVisibleContributions(firstNodeId, true)
			?.material[0];
		const second = system.getVisibleContributions(secondNodeId, true)
			?.material[0];
		// A translucency ramp promotes the part into the transparent phase for this frame without
		// rewriting its authored draw unit, whose identity consumers cache compiled facts against.
		expect(first).toMatchObject({
			drawUnit: { ordering: "opaque" },
			instance: { color: { a: 0.75 } },
			ordering: "transparent",
		});
		expect(first?.transparentSort).not.toBeNull();
		expect(second).toMatchObject({
			drawUnit: { ordering: "opaque" },
			instance: { color: { a: 0.5 } },
			ordering: "transparent",
		});
		// Both parts share one authored draw unit, so the promotion cannot have cloned it.
		expect(first?.drawUnit).toBe(second?.drawUnit);
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
		expect(system.getVisibleContributions(firstNodeId, true)).toEqual({
			depth: [],
			kind: "hidden",
			material: [],
		});

		system.publishPresentation([presentationSample(firstPrepared, 0)]);
		expect(
			system.getVisibleContributions(firstNodeId, true)?.material[0],
		).toMatchObject({
			drawUnit: { ordering: "opaque" },
			instance: { color: { a: 1 } },
			transparentSort: null,
		});
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: true,
		});
		expect(system.getVisibleContributions(firstNodeId, true)).toEqual({
			depth: [],
			kind: "hidden",
			material: [],
		});
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: true,
			lighting: false,
			noDraw: false,
		});
		expect(system.getVisibleContributions(firstNodeId, true)).toEqual({
			depth: [],
			kind: "hidden",
			material: [],
		});

		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
		});
		system.publishPresentation([presentationSample(firstPrepared, 0.2)]);
		system.updatePresentationState(firstNodeId, {
			cloaked: true,
			hidden: false,
			lighting: false,
			noDraw: false,
		});
		// Retail ignores later SetTranslucency writes while cloaked; it does not invent cloak alpha.
		system.publishPresentation([presentationSample(firstPrepared, 0.8)]);
		expect(
			system.getVisibleContributions(firstNodeId, true)?.material[0],
		).toMatchObject({
			instance: { color: { a: 0.8 } },
		});
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
		});
		system.publishPresentation([presentationSample(firstPrepared, 0.8)]);
		expect(
			system.getVisibleContributions(firstNodeId, true)?.material[0]?.instance
				.color.a,
		).toBeCloseTo(0.2);
		expect(system.getDiagnostics()).toMatchObject({
			lastParticleEnvelopeChangeCount: 0,
			lastParticleEnvelopeQueryCount: 1,
			lastPresentationEntityVisitCount: 2,
			lastPublishedPresentationCount: 1,
		});
	});

	it("publishes pose-local bounds without changing swept scene bounds", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new FixtureAnimationSource(2),
		);
		const base = source("published-bounds", [0, 1]);
		const firstPart = requiredAt(base.source.presentation.parts, 0);
		const secondPart = requiredAt(base.source.presentation.parts, 1);
		const boundedSource: PlacedDynamicPresentationSource = {
			...base,
			source: {
				...base.source,
				presentation: {
					...base.source.presentation,
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
			},
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
				authoredRootTransform: null,
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
		expectBounds(
			system.getPublishedRigidPresentationBounds(nodeId),
			new AABB3(new Vec3(-3, -10, -4), new Vec3(0, 14, 8)),
		);
		const sweptBounds = scene.getNode(nodeId)?.localBounds;
		system.publishPresentation([sample]);
		expect(system.getPublishedPresentationBounds(nodeId)).toEqual(
			new AABB3(new Vec3(0, 0, -4), new Vec3(12, 3, 8)),
		);
		expect(system.getPublishedRigidPresentationBounds(nodeId)).toEqual(
			new AABB3(new Vec3(0, 0, -4), new Vec3(12, 3, 8)),
		);
		expect(scene.getNode(nodeId)?.localBounds).toEqual(sweptBounds);
	});

	/**
	 * Two independent culls read two different bounds. An envelope in only the presentation bounds
	 * still loses the swarm, because the broadphase drops the owner before the footprint test runs.
	 */
	it("grows the broadphase bounds by the particle envelope, not only the drawn pose", async () => {
		let envelopeRadius = 0;
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new FixtureAnimationSource(),
			() => envelopeRadius,
		);
		const installation = system.replaceOwner("layer", [source("swarm-owner")]);
		expect(await installation.ready).toBe("ready");
		const prepared = requiredAt(installation.getPreparedEntities(), 0);
		commit(installation);
		const nodeId = requiredAt(installation.nodeIds, 0);
		const meshBounds = scene.getNode(nodeId)?.localBounds?.clone();
		const poseBounds = system.getPublishedPresentationBounds(nodeId)?.clone();
		const rigidBounds = system
			.getPublishedRigidPresentationBounds(nodeId)
			?.clone();
		if (!meshBounds || !poseBounds || !rigidBounds)
			throw new Error("Entity published no bounds.");
		expect(rigidBounds).toEqual(poseBounds);
		const particleOnlyFrustum = {
			cameraPosition: Vec3.zero(),
			// The owner proxy at x=0 is outside; a radius-five particle envelope crosses this plane.
			planes: [{ constant: -2.5, x: 1, y: 0, z: 0 }],
		};
		expect(
			scene.queryFlatFrustum(
				particleOnlyFrustum,
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).not.toContain(nodeId);

		envelopeRadius = 5;
		system.publishPresentation([presentationSample(prepared, 0)]);

		expect(scene.getNode(nodeId)?.localBounds).toEqual(
			expandBounds(meshBounds, 5),
		);
		expect(system.getPublishedPresentationBounds(nodeId)).toEqual(
			expandBounds(poseBounds, 5),
		);
		expect(system.getPublishedRigidPresentationBounds(nodeId)).toEqual(
			rigidBounds,
		);
		expect(
			scene.queryFlatFrustum(
				particleOnlyFrustum,
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toContain(nodeId);
		expect(system.getDiagnostics()).toMatchObject({
			lastParticleEnvelopeChangeCount: 1,
			lastParticleEnvelopeQueryCount: 1,
			lastPresentationEntityVisitCount: 1,
		});
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
			authoredRootTransform: null,
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
	// No emitters in most fixtures, so presentation bounds are the mesh alone.
	particleEnvelopeRadiusOf: () => number = () => 0,
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
		new DynamicEntityPlacementSystem(scene),
		templates,
		new AnimationAssetRepository(animationSource),
		new PhysicsScriptRepository({
			destroy: () => {},
			loadPhysicsScript: async (scriptId) => {
				const fixture = AUTHORED_SCRIPT_FIXTURES[scriptId.toLowerCase()];
				if (!fixture) throw new Error(`No script fixture for ${scriptId}.`);
				return fixture;
			},
		}),
		new ParticleEmitterRepository({
			destroy: () => {},
			loadParticleEmitter: async (emitterInfoId) => {
				throw new Error(`No emitter fixture for ${emitterInfoId}.`);
			},
		}),
		effects,
		new SoundTableRepository({
			destroy: () => {},
			loadSoundTable: async (soundTableId) => {
				throw new Error(`No sound table fixture for ${soundTableId}.`);
			},
		}),
		(ownerId: string, generation: number) =>
			`${ownerId}:generation:${generation}`,
		() => particleEnvelopeRadiusOf(),
	);
	return { effects, geometry, scene, system };
}

function source(
	id: string,
	partIndices: readonly number[] = [0],
): PlacedDynamicPresentationSource {
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
		placement: {
			envCellId: null,
			landblockId: "0x0001ffff",
			localTransform: Mat4.identity(),
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		},
		source: {
			category: "other",
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
			presentation,
			scale: new Vec3(1, 1, 1),
			setupId: "0x02000001",
		},
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
		appearanceKey: visualSource.source.presentation.appearanceKey,
		baseBounds: AABB3.zero(),
		geometry: [geometrySource],
		key: objectVisualTemplateKey(visualSource.source),
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				depthDrawUnits: [],
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
	/// Animations this fixture's motion table reaches, and every id it was asked to load.
	closure: string[] = ["0x03000001", "0x03000002"];
	readonly loads: string[] = [];

	constructor(readonly partCount = 1) {}

	async loadMotionTableClosure() {
		return this.closure as DatAssetId[];
	}

	async loadAnimation(animationId: DatAssetId): Promise<DecodedAnimationAsset> {
		this.loads.push(animationId);
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
	async loadMotionTableClosure(): Promise<DatAssetId[]> {
		return [];
	}

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
