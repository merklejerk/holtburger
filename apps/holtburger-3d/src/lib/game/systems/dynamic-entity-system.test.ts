import { describe, expect, it } from "vitest";
import { expandBounds } from "../math/geometry-utils";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import { compileDynamicLayout } from "../geometry/dynamic-layout";
import type { DecodedAnimationAsset } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { AUTHORED_SCRIPT_FIXTURES } from "../behavior/authored-script-fixtures";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import { EffectSystem } from "./effect-system";
import { behaviorTargetId } from "../behavior/behavior-event-router";
import { SoundTableRepository } from "../behavior/sound-table-repository";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import type { PlacedDynamicPresentationSource } from "./dynamic-presentation-source";
import {
	createObjectGeometryKey,
	type GeometrySource,
} from "../geometry/types";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import { createRotationMat4 } from "../math/matrices";
import type { ObjectGeometryData } from "../renderer/geometry";
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
	it("initializes a late part request from the current pose and retains its frame until eviction", async () => {
		const { system, scene } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
			new FixtureAnimationSource(3),
		);
		const installation = system.replaceOwner("owner", [
			source("late", [0, 1, 2]),
		]);
		await installation.ready;
		const prepared = requiredAt(installation.getPreparedEntities(), 0);
		commit(installation);
		const root = requiredAt(installation.nodeIds, 0);
		const sample = presentationSample(prepared, 0);
		const partPose = createRotationMat4(
			new Quat(0, 0, Math.SQRT1_2, Math.SQRT1_2),
		);
		partPose.m41 = 7;
		system.publishPresentation([
			{
				...sample,
				articulatedPose: {
					authoredRootTransform: null,
					partToObjectTransforms: [Mat4.identity(), Mat4.identity(), partPose],
				},
			},
		]);
		// The renderable pose is current before any attachment asks for a frame.
		expect(
			system.getVisiblePresentation(root)?.visual.parts[2]?.localToVisualRoot,
		).toEqual(partPose);
		expect(system.requestPartNode(root, 3)).toBeNull();
		const frame = system.requestPartNode(root, 2);
		if (frame === null) throw new Error("Fixture part frame was not created.");
		expect(scene.getResolvedPlacement(frame)?.localToLandblock).toEqual(
			partPose,
		);
		expect(system.requestPartNode(root, 2)).toBe(frame);
		system.publishPresentation([sample]);
		expect(scene.getResolvedPlacement(frame)?.localToLandblock).toEqual(
			Mat4.identity(),
		);
		const rootTransform = Mat4.identity();
		rootTransform.m41 = 3;
		system.updatePlacement(root, {
			envCellId: null,
			landblockId: "0x0002ffff",
			localTransform: rootTransform,
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		});
		expect(scene.getResolvedOrigin(frame)?.landblockId).toBe("0x0002ffff");
		expect(scene.getResolvedOrigin(frame)?.landblockOrigin).toEqual(
			new Vec3(3, 0, 0),
		);
		system.removeOwner("owner");
		expect(scene.hasNode(frame)).toBe(false);
		expect(system.requestPartNode(root, 2)).toBeNull();
		await system.destroy();
	});

	it("replaces appearance while preserving part targets, effects, pose, and owner siblings", async () => {
		const { system, effects } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const base = source("original");
		const installation = system.replaceOwner("group", [
			base,
			source("sibling"),
		]);
		expect(
			system.getVisiblePresentation(requiredAt(installation.nodeIds, 0)),
		).toBeNull();
		await installation.ready;
		const prepared = requiredAt(installation.getPreparedEntities(), 0);
		commit(installation);
		const root = requiredAt(installation.nodeIds, 0);
		const sibling = requiredAt(installation.nodeIds, 1);
		const partNode = system.requestPartNode(root, 0);
		const siblingRenderable = system.getRenderable(sibling);
		effects.applyTransparentPart(
			{ generation: installation.generation, targetId: behaviorTargetId(root) },
			{ partIndex: 0, start: 0.4, end: 0.4, durationSeconds: 0 },
		);
		const replacement = {
			...base.source,
			presentation: {
				...base.source.presentation,
				appearanceKey: "changed",
				parts: base.source.presentation.parts.map((part) => ({
					...part,
					geometry: {
						...part.geometry,
						id: "geometry:changed" as const,
						positions: new Float32Array([-2, 0, 0, 2, 0, 0, 0, 2, 0]),
						bounds: new AABB3(new Vec3(-2, 0, 0), new Vec3(2, 2, 0)),
					},
				})),
			},
		};
		const previous = system.getRenderable(root);
		const previousPresentation = system.getVisiblePresentation(root);
		expect(previousPresentation?.visual).toBe(previous);
		const stage = await system.stageVisualReplacement(
			"group",
			root,
			replacement,
		);
		expect(stage.kind).toBe("staged");
		if (stage.kind !== "staged")
			throw new Error("Fixture replacement requires stable part frames.");
		expect(system.getRenderable(root)).toBe(previous);
		expect(system.getVisiblePresentation(root)?.visual).toBe(
			previousPresentation?.visual,
		);
		// A replacement must use the pose at commit, not the pose when loading began.
		const sample = presentationSample(prepared, 0.4);
		const advancedPart = Mat4.identity();
		advancedPart.m41 = 5;
		system.publishPresentation([
			{
				...sample,
				articulatedPose: {
					authoredRootTransform: null,
					partToObjectTransforms: [advancedPart],
				},
			},
		]);
		const pose = system.getPartToObjectTransforms(root);
		stage.commit();
		stage.release();
		const currentPresentation = system.getVisiblePresentation(root);
		expect(currentPresentation?.visual).not.toBe(previousPresentation?.visual);
		expect(currentPresentation?.visual.layout.key).not.toBe(
			previousPresentation?.visual.layout.key,
		);
		expect(currentPresentation?.visual.parts[0]?.partIndex).toBe(
			currentPresentation?.visual.layout.parts[0]?.partIndex,
		);
		expect(currentPresentation?.visual.parts[0]?.frameInstance.color.a).toBe(
			0.6,
		);
		expect(system.requestPartNode(root, 0)).toBe(partNode);
		expect(system.getPartToObjectTransforms(root)).toBe(pose);
		expect(system.getRenderable(sibling)).toBe(siblingRenderable);
		expect(
			effects.samplePresentation(root).partRenderStates[0]?.translucency,
		).toBe(0.4);
		expect(
			system.getRenderable(root)?.parts[0]?.geometryData?.positions,
		).toEqual(replacement.presentation.parts[0]?.geometry.positions);
		expectBounds(
			system.getPublishedRigidPresentationBounds(root),
			new AABB3(new Vec3(3, 0, 0), new Vec3(7, 2, 0)),
		);
		system.publishPresentation([presentationSample(prepared, 1)]);
		const hiddenPartPresentation = system.getVisiblePresentation(root);
		expect(hiddenPartPresentation?.visual).toBe(currentPresentation?.visual);
		expect(hiddenPartPresentation?.visual.parts).toHaveLength(1);
		expect(hiddenPartPresentation?.visual.parts[0]?.frameInstance.color.a).toBe(
			0,
		);
		await system.destroy();
	});

	it("rejects superseded and evicted visual stages without publishing their meshes", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const base = source("original");
		const installation = system.replaceOwner("owner", [base]);
		await installation.ready;
		commit(installation);
		const root = requiredAt(installation.nodeIds, 0);
		const first = await system.stageVisualReplacement("owner", root, {
			...base.source,
			presentation: { ...base.source.presentation, appearanceKey: "first" },
		});
		const second = await system.stageVisualReplacement("owner", root, {
			...base.source,
			presentation: { ...base.source.presentation, appearanceKey: "second" },
		});
		if (first.kind !== "staged" || second.kind !== "staged")
			throw new Error("Fixture stages changed topology.");
		expect(() => first.commit()).toThrow("superseded visual replacement");
		first.release();
		second.commit();
		const evicted = await system.stageVisualReplacement(
			"owner",
			root,
			base.source,
		);
		if (evicted.kind !== "staged")
			throw new Error("Fixture stage changed topology.");
		system.removeOwner("owner");
		expect(() => evicted.commit()).toThrow("superseded visual replacement");
		evicted.release();
		expect(system.getRenderable(root)).toBeNull();
		await system.destroy();
	});

	it("retains the installed mesh when replacement resource preparation fails", async () => {
		const { system, geometry } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const base = source("original");
		const installation = system.replaceOwner("owner", [base]);
		await installation.ready;
		commit(installation);
		const root = requiredAt(installation.nodeIds, 0);
		const previous = system.getRenderable(root);
		geometry.failReplacement = true;
		await expect(
			system.stageVisualReplacement("owner", root, {
				...base.source,
				presentation: { ...base.source.presentation, appearanceKey: "failed" },
			}),
		).rejects.toThrow("geometry replacement failed");
		expect(system.getRenderable(root)).toBe(previous);
		await system.destroy();
	});

	it("reconciles installed nameplate content without replacing entity ownership", async () => {
		const { system } = createSystem(new InlineObjectVisualTemplatePreparer());
		const base = source("named");
		const installation = system.replaceOwner("layer", [
			{
				...base,
				source: {
					...base.source,
					nameplate: { level: 12, name: "Drudge" },
				},
			},
		]);
		expect(await installation.ready).toBe("ready");
		commit(installation);
		const nodeId = requiredAt(installation.nodeIds, 0);
		const installedRevision = system.getNameplatePopulationRevision();
		const values: unknown[] = [];
		system.forEachNameplateVisual((identity, visual) =>
			values.push({ identity, visual }),
		);
		expect(values).toEqual([
			{
				identity: base.source.identity,
				visual: {
					entityClass: base.source.entityClass,
					content: { level: 12, name: "Drudge" },
				},
			},
		]);

		system.updateNameplateContent(nodeId, { level: 13, name: "Drudge" });
		expect(system.getNameplatePopulationRevision()).toBe(installedRevision + 1);
		expect(system.getNameplateFacts(nodeId)?.content).toEqual({
			level: 13,
			name: "Drudge",
		});
		expect(system.getRenderable(nodeId)).not.toBeNull();

		system.updateNameplateContent(nodeId, { level: 13, name: "Drudge" });
		expect(system.getNameplatePopulationRevision()).toBe(installedRevision + 1);
		system.removeOwner("layer");
		expect(system.getNameplatePopulationRevision()).toBe(installedRevision + 2);
	});

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

	it("keeps held-child poses and picking coherent through parent and child appearance replacement", async () => {
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
		const parentPrepared = requiredAt(parent.getPreparedEntities(), 0);
		commit(parent);
		commit(child);
		const parentRoot = requiredAt(parent.nodeIds, 0);
		const childRoot = requiredAt(child.nodeIds, 0);
		const publishParentPose = (x: number) => {
			const transform = Mat4.identity();
			transform.m41 = x;
			system.publishPresentation([
				{
					...presentationSample(parentPrepared, 0),
					articulatedPose: {
						authoredRootTransform: null,
						partToObjectTransforms: [transform],
					},
				},
			]);
		};
		publishParentPose(3);

		system.attachEntity(childRoot, parentRoot, "right-hand", 1);

		const parentPart = system.requestPartNode(parentRoot, 0);
		if (parentPart === null) throw new Error("Parent part was not installed.");
		const childPart = system.requestPartNode(childRoot, 0);
		if (childPart === null) throw new Error("Child part was not installed.");
		expect(scene.getResolvedPlacement(childPart)?.localToLandblock.m41).toBe(
			19,
		);
		expect(
			system.withSelectionGeometry(
				childRoot,
				(geometry) => geometry.parts[0]?.sourceToLandblock.m41,
			),
		).toBe(19);
		const originalChildGeometry = system.withSelectionGeometry(
			childRoot,
			({ parts }) => parts[0]?.geometry,
		);
		const replaceGeometry = (original: PlacedDynamicPresentationSource) => ({
			...original.source,
			presentation: {
				...original.source.presentation,
				appearanceKey: `${original.source.presentation.appearanceKey}:replacement`,
				parts: original.source.presentation.parts.map((part) => ({
					...part,
					geometry: {
						...part.geometry,
						id: `${part.geometry.id}:replacement` as typeof part.geometry.id,
						positions: new Float32Array([-2, 0, 0, 2, 0, 0, 0, 2, 0]),
						bounds: new AABB3(new Vec3(-2, 0, 0), new Vec3(2, 2, 0)),
					},
				})),
			},
		});
		const parentVisual = replaceGeometry(parentSource);
		const childVisual = replaceGeometry(childSource);
		const parentStage = await system.stageVisualReplacement(
			"parent",
			parentRoot,
			parentVisual,
		);
		const childStage = await system.stageVisualReplacement(
			"child",
			childRoot,
			childVisual,
		);
		if (parentStage.kind !== "staged" || childStage.kind !== "staged")
			throw new Error(
				"Compatible part geometry must retain attachment frames.",
			);
		publishParentPose(6);
		expect(
			system.withSelectionGeometry(
				childRoot,
				({ parts }) => parts[0]?.geometry,
			),
		).toBe(originalChildGeometry);
		expect(
			system.withSelectionGeometry(
				childRoot,
				({ parts }) => parts[0]?.sourceToLandblock.m41,
			),
		).toBe(22);
		childStage.commit();
		childStage.release();
		parentStage.commit();
		parentStage.release();
		expect(system.requestPartNode(parentRoot, 0)).toBe(parentPart);
		expect(system.requestPartNode(childRoot, 0)).toBe(childPart);
		expect(
			system.withSelectionGeometry(
				childRoot,
				({ parts }) => parts[0]?.geometry.positions,
			),
		).toBe(childVisual.presentation.parts[0]?.geometry.positions);
		expect(
			system.withSelectionGeometry(
				parentRoot,
				({ parts }) => parts[0]?.geometry.positions,
			),
		).toBe(parentVisual.presentation.parts[0]?.geometry.positions);
		for (const [parentX, childX] of [
			[6, 22],
			[9, 25],
		] as const) {
			publishParentPose(parentX);
			expect(scene.getResolvedPlacement(childPart)?.localToLandblock.m41).toBe(
				childX,
			);
			expect(
				system.getVisiblePresentation(childRoot)?.visual.parts[0]?.frameInstance
					.sourceToLandblock.m41,
			).toBe(childX);
			expect(
				system.withSelectionGeometry(
					childRoot,
					({ parts }) => parts[0]?.sourceToLandblock.m41,
				),
			).toBe(childX);
		}
		system.removeOwner("child");
		system.removeOwner("parent");
		await system.destroy();
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

		const currentTemplate = prepared("current");
		preparer.resolveNext(currentTemplate);
		expect(await current.ready).toBe("ready");
		commit(current);
		expect(geometry.upserted).toEqual([currentTemplate.layout.key]);
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

	it("publishes shared layouts and appearances with independent reusable part poses", async () => {
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
		const compact = system.getVisiblePresentation(firstNodeId);
		expect(compact?.visual.layout).toBe(
			system.getVisiblePresentation(secondNodeId)?.visual.layout,
		);
		expect(compact).toMatchObject({
			identity: "first",
			landblockId: "0x0001ffff",
			renderScopes: [{ kind: "outdoor" }],
		});
		if (compact === null)
			throw new Error("Expected installed compact presentation.");
		const second = system.getVisiblePresentation(secondNodeId);
		expect(second?.visual.appearance).toBe(compact.visual.appearance);
		const firstPart = requiredAt(compact.visual.parts, 0);
		const secondPart = second?.visual.parts[0];
		expect(secondPart).toBeDefined();
		expect(secondPart?.frameInstance).not.toBe(firstPart.frameInstance);
		expect(secondPart?.frameInstance.sourceToLandblock).not.toBe(
			firstPart.frameInstance.sourceToLandblock,
		);
		expect(firstPart.frameInstance.sourceToLandblock).toMatchObject({
			m11: 2,
			m22: 3,
			m33: 4,
			m41: 12,
		});
		expect(secondPart?.frameInstance.sourceToLandblock).toMatchObject({
			m11: 5,
			m22: 6,
			m33: 7,
		});
		const firstAgain = system.getVisiblePresentation(firstNodeId);
		expect(firstAgain?.visual).toBe(compact.visual);
		expect(firstAgain?.visual.parts[0]?.frameInstance).toBe(
			firstPart.frameInstance,
		);
		expect(firstAgain?.visual.parts[0]?.frameInstance.sourceToLandblock).toBe(
			firstPart.frameInstance.sourceToLandblock,
		);
		expect(secondPart?.frameInstance.sourceToLandblock).toMatchObject({
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
			translucency: 0,
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
			translucency: 0,
		});
		expect(system.getRuntimeLights()).toEqual([]);
	});

	it("publishes independent part opacity while preserving shared appearance and cloak semantics", async () => {
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
		const first = system.getVisiblePresentation(firstNodeId);
		const second = system.getVisiblePresentation(secondNodeId);
		expect(first?.visual.parts[0]?.frameInstance.color.a).toBe(0.75);
		expect(second?.visual.parts[0]?.frameInstance.color.a).toBe(0.5);
		// Effects change dense pose payloads; authored material ordering stays immutable.
		expect(first?.visual.appearance).toBe(second?.visual.appearance);
		expect(first?.visual.appearance.ranges[0]?.ordering).toBe("opaque");
		const firstPart = first?.visual.parts[0];
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
		expect(
			system.getVisiblePresentation(firstNodeId)?.visual.parts,
		).toHaveLength(1);
		expect(
			system.getVisiblePresentation(firstNodeId)?.visual.parts[0]?.frameInstance
				.color.a,
		).toBe(0);
		expect(
			system.withSelectionGeometry(firstNodeId, ({ parts }) => parts.length),
		).toBe(0);

		system.publishPresentation([presentationSample(firstPrepared, 0)]);
		expect(system.getVisiblePresentation(firstNodeId)?.visual.parts[0]).toBe(
			firstPart,
		);
		expect(firstPart?.frameInstance.color.a).toBe(1);
		expect(system.getVisiblePresentation(firstNodeId)?.visual.appearance).toBe(
			first?.visual.appearance,
		);
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: true,
			translucency: 0,
		});
		expect(system.getVisiblePresentation(firstNodeId)).toBeNull();
		expect(system.withSelectionGeometry(firstNodeId, () => true)).toBeNull();
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: true,
			lighting: false,
			noDraw: false,
			translucency: 0,
		});
		expect(system.getVisiblePresentation(firstNodeId)).toBeNull();

		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
		});
		system.publishPresentation([presentationSample(firstPrepared, 0.2)]);
		system.updatePresentationState(firstNodeId, {
			cloaked: true,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
		});
		// Retail ignores later SetTranslucency writes while cloaked; it does not invent cloak alpha.
		system.publishPresentation([presentationSample(firstPrepared, 0.8)]);
		expect(
			system.getVisiblePresentation(firstNodeId)?.visual.parts[0],
		).toMatchObject({
			frameInstance: { color: { a: 0.8 } },
		});
		system.updatePresentationState(firstNodeId, {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
		});
		system.publishPresentation([presentationSample(firstPrepared, 0.8)]);
		expect(
			system.getVisiblePresentation(firstNodeId)?.visual.parts[0]?.frameInstance
				.color.a,
		).toBeCloseTo(0.2);
		expect(system.getDiagnostics()).toMatchObject({
			lastParticleEnvelopeChangeCount: 0,
			lastParticleEnvelopeQueryCount: 1,
			lastPresentationEntityVisitCount: 2,
			lastPublishedPresentationCount: 1,
		});
	});

	it("applies object translucency without replacing resident or visual identity", async () => {
		const { effects, geometry, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const base = source("object-translucency");
		const installation = system.replaceOwner("layer", [
			{
				...base,
				initialPresentationState: {
					...base.initialPresentationState,
					translucency: 0.5,
				},
			},
		]);
		expect(await installation.ready).toBe("ready");
		const prepared = requiredAt(installation.getPreparedEntities(), 0);
		const nodeId = prepared.nodeId;
		const sample = presentationSample(prepared, 0);
		installation.prepareCommit([
			{ ...sample, effects: effects.samplePresentation(nodeId) },
		]);
		installation.commit();

		const initial = system.getVisiblePresentation(nodeId)?.visual.parts[0];
		expect(initial?.frameInstance.color.a).toBe(0.5);
		const visual = system.getVisiblePresentation(nodeId)?.visual;
		const geometryUpserts = geometry.upserted.length;

		system.updatePresentationState(nodeId, {
			...base.initialPresentationState,
			translucency: 0.25,
		});
		system.publishPresentation([
			{ ...sample, effects: effects.samplePresentation(nodeId) },
		]);
		const updated = system.getVisiblePresentation(nodeId)?.visual.parts[0];
		expect(updated?.frameInstance.color.a).toBe(0.75);
		expect(updated).toBe(initial);
		expect(system.getVisiblePresentation(nodeId)?.visual).toBe(visual);
		expect(system.getRenderable(nodeId)).not.toBeNull();
		expect(geometry.upserted).toHaveLength(geometryUpserts);

		// A whole-object write received while cloaked is ignored and is not replayed when cloak
		// clears (CPhysicsPart::SetTranslucency and CPhysicsObj::set_state,
		// acclient.c:303936-303962, 310307-310336).
		system.updatePresentationState(nodeId, {
			...base.initialPresentationState,
			cloaked: true,
			translucency: 0.75,
		});
		system.updatePresentationState(nodeId, {
			...base.initialPresentationState,
			// A different carried value on the uncloak snapshot is still not a new uncloaked
			// SetTranslucency write; retail does not replay it while clearing the cloak bit.
			translucency: 0.5,
		});
		system.publishPresentation([
			{ ...sample, effects: effects.samplePresentation(nodeId) },
		]);
		expect(
			system.getVisiblePresentation(nodeId)?.visual.parts[0]?.frameInstance
				.color.a,
		).toBe(0.75);

		system.updatePresentationState(nodeId, {
			...base.initialPresentationState,
			translucency: 1,
		});
		system.publishPresentation([
			{ ...sample, effects: effects.samplePresentation(nodeId) },
		]);
		expect(system.getVisiblePresentation(nodeId)?.visual.parts).toHaveLength(1);
		expect(
			system.getVisiblePresentation(nodeId)?.visual.parts[0]?.frameInstance
				.color.a,
		).toBe(0);
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

	it("applies an absolute root scale without replacing prepared visual resources", async () => {
		const { scene, system } = createSystem(
			new InlineObjectVisualTemplatePreparer(),
		);
		const base = source("root-scale");
		const part = requiredAt(base.source.presentation.parts, 0);
		const scaledSource: PlacedDynamicPresentationSource = {
			...base,
			source: {
				...base.source,
				presentation: {
					...base.source.presentation,
					parts: [
						{
							...part,
							geometry: {
								...part.geometry,
								bounds: new AABB3(new Vec3(1, 0, 0), new Vec3(2, 1, 1)),
							},
						},
					],
				},
			},
		};
		const installation = system.replaceOwner("layer", [scaledSource]);
		expect(await installation.ready).toBe("ready");
		commit(installation);
		const nodeId = requiredAt(installation.nodeIds, 0);
		const partNodeId = system.requestPartNode(nodeId, 0);
		if (partNodeId === null)
			throw new Error("Scale fixture part is unavailable.");
		const prepared = system.getPreparedAnimation(nodeId);
		const initialCullingBounds = scene.getNode(nodeId)?.localBounds?.clone();
		if (!initialCullingBounds) throw new Error("Entity has no culling bounds.");

		system.updateRootScale(nodeId, 2);

		expect(system.getPreparedAnimation(nodeId)).toBe(prepared);
		expect(scene.getResolvedPlacement(partNodeId)?.localToLandblock.m11).toBe(
			2,
		);
		expectBounds(
			system.getPublishedRigidPresentationBounds(nodeId),
			new AABB3(new Vec3(2, 0, 0), new Vec3(4, 2, 2)),
		);
		expectBounds(
			scene.getNode(nodeId)?.localBounds ?? null,
			new AABB3(
				new Vec3(
					initialCullingBounds.min.x * 2,
					initialCullingBounds.min.y * 2,
					initialCullingBounds.min.z * 2,
				),
				new Vec3(
					initialCullingBounds.max.x * 2,
					initialCullingBounds.max.y * 2,
					initialCullingBounds.max.z * 2,
				),
			),
		);
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
		const retainedPoseBounds = system.getPublishedPresentationBounds(nodeId);
		const retainedRigidBounds =
			system.getPublishedRigidPresentationBounds(nodeId);
		expect(retainedPoseBounds).not.toBe(retainedRigidBounds);
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
		expect(system.getPublishedPresentationBounds(nodeId)).toBe(
			retainedPoseBounds,
		);
		expect(system.getPublishedRigidPresentationBounds(nodeId)).toBe(
			retainedRigidBounds,
		);

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
		envelopeRadius = 0;
		system.publishPresentation([presentationSample(prepared, 0)]);
		expect(system.getPublishedPresentationBounds(nodeId)).toBe(
			retainedPoseBounds,
		);
		expect(retainedPoseBounds).toEqual(rigidBounds);
		expect(retainedRigidBounds).toEqual(rigidBounds);
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
		() => () => {},
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
			retailVisibility: "normally-visible",
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
		initialPresentationState: {
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
		},
		placement: {
			envCellId: null,
			landblockId: "0x0001ffff",
			localTransform: Mat4.identity(),
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		},
		source: {
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
	const geometryData: ObjectGeometryData = {
		indices: new Uint32Array([0, 1, 2]),
		bakedLight: null,
		kind: "object",
		normals: new Float32Array(9),
		positions: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
	};
	const visualSource = source(id);
	return {
		layout: compileDynamicLayout(visualSource.source.presentation.parts),
		appearance: { materials: [], ranges: [] },
		appearanceKey: visualSource.source.presentation.appearanceKey,
		baseBounds: AABB3.zero(),
		key: objectVisualTemplateKey(visualSource.source),
		selectionGeometryMorphology: "volumetric",
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				depthDrawUnits: [],
				drawUnits: [],
				geometry: key,
				geometryData,
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
