import {
	animationHookBlocksActivation,
	animationHookCommand,
} from "../../assets/decode-animation-record";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { PreparedAnimationHandle } from "../animation/animation-asset-repository";
import {
	playingClip,
	turnsVisualRoot,
	type PlayingClip,
} from "../animation/animation-playback";
import type {
	PreparedPhysicsScript,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import type { PreparedParticleEmitter } from "../behavior/particle-emitter-repository";
import type { DatAssetId } from "../game-types";
import { Vec3, type Mat4 } from "../math/types";
import { resolvePlacementPose } from "../resolution/presentation";
import { datAssetId } from "../runtime/dynamic-entity-presentation";
import type { ObjectPreviewSource } from "../runtime/object-preview-source";
import type { PresentationAssetService } from "../runtime/presentation-asset-service";
import type { DynamicPresentationSource } from "../systems/dynamic-presentation-source";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import {
	createObjectPreviewFit,
	type ObjectPreviewFit,
} from "./object-preview-fit";

/** Complete immutable preparation result borrowed by preview presentation and renderer. */
export interface PreparedObjectPreviewAssets {
	readonly source: DynamicPresentationSource;
	readonly template: ObjectVisualTemplate;
	readonly setupPose: readonly Mat4[];
	readonly scale: Vec3;
	readonly translucency: number;
	readonly clips: readonly PlayingClip[];
	readonly firstCyclicClip: number | null;
	readonly defaultScriptRoot: DatAssetId | null;
	readonly scripts: ReadonlyMap<DatAssetId, PreparedPhysicsScript>;
	readonly emitters: ReadonlyMap<DatAssetId, PreparedParticleEmitter>;
	readonly particleMeshIds: readonly DatAssetId[];
	readonly fit: ObjectPreviewFit;
}

/** One rollback-safe CPU lease; device and presentation borrowers do not release internals. */
export interface ObjectPreviewAssetLease {
	readonly assets: PreparedObjectPreviewAssets;
	release(): void;
}

/** Prepare every immutable dependency before preview behavior can execute. */
export async function acquireObjectPreviewAssets(
	service: PresentationAssetService,
	request: ObjectPreviewSource,
): Promise<ObjectPreviewAssetLease> {
	let setup: PreparedAssetHandle<DecodedStaticPresentation> | null = null;
	let template: PreparedAssetHandle<ObjectVisualTemplate> | null = null;
	let animations: ReadonlyMap<DatAssetId, PreparedAnimationHandle> | null =
		null;
	const scriptClosures: PreparedPhysicsScriptClosure[] = [];
	let emitters: ReadonlyMap<
		DatAssetId,
		PreparedAssetHandle<PreparedParticleEmitter>
	> | null = null;
	try {
		const setupHandle = await service.setupVisuals.acquire(
			request.setupDid,
			request.appearance,
		);
		setup = setupHandle;
		const expectedSetupId = datAssetId(request.setupDid);
		if (setupHandle.asset.setupId?.toLowerCase() !== expectedSetupId)
			throw new Error(
				`Object preview visual resolved ${setupHandle.asset.setupId ?? "no setup"}, expected ${expectedSetupId}.`,
			);
		const scale = new Vec3(request.scale, request.scale, request.scale);
		const source: DynamicPresentationSource = {
			behavior: setupHandle.asset.behavior,
			entityClass: "other",
			identity: `object-preview:${request.guid}`,
			localBounds: setupHandle.asset.localBounds,
			nameplate: null,
			placementFrame: 0,
			presentation: setupHandle.asset.presentation,
			scale,
			setupId: expectedSetupId,
		};
		const templateHandle = await service.objectTemplates.acquire(source);
		template = templateHandle;

		const requestedAnimationIds =
			request.pose.kind === "default-idle"
				? request.pose.clips.map((clip) => datAssetId(clip.animationId))
				: [];
		const animationHandles = await service.animations.acquireAll(
			requestedAnimationIds,
		);
		animations = animationHandles;
		for (const handle of animationHandles.values()) {
			const blocking = handle.asset.hooks.filter(animationHookBlocksActivation);
			if (blocking.length > 0)
				throw new Error(
					`Object preview animation ${handle.asset.id} contains unsupported visual hooks: ${blocking.map(animationHookCommand).join(", ")}.`,
				);
		}

		const scriptRoots = new Set<DatAssetId>();
		if (setupHandle.asset.behavior.physicsScriptId !== null)
			scriptRoots.add(setupHandle.asset.behavior.physicsScriptId);
		for (const handle of animationHandles.values())
			for (const hook of handle.asset.hooks)
				if (hook.kind === "call-pes") scriptRoots.add(hook.scriptId);
		for (const root of scriptRoots)
			scriptClosures.push(await service.physicsScripts.acquireClosure(root));

		const preparedScripts = new Map<DatAssetId, PreparedPhysicsScript>();
		for (const closure of scriptClosures)
			for (const [id, script] of closure.scripts)
				preparedScripts.set(id, script);
		const emitterIds = new Set<DatAssetId>();
		for (const handle of animationHandles.values())
			for (const id of handle.asset.emitterInfoIds) emitterIds.add(id);
		for (const script of preparedScripts.values())
			for (const id of script.dependencies.emitterInfoIds) emitterIds.add(id);
		const emitterHandles =
			await service.particleEmitters.acquireAll(emitterIds);
		emitters = emitterHandles;
		const preparedEmitters = new Map(
			[...emitterHandles].map(([id, handle]) => [id, handle.asset]),
		);

		const setupPose = resolvePlacementPose(
			setupHandle.asset.presentation,
			0,
		).partTransforms;
		let clips: readonly PlayingClip[] = [];
		if (request.pose.kind === "default-idle") {
			const pose = request.pose;
			clips = pose.clips.map((clip, index) => {
				const animation = animationHandles.get(
					datAssetId(clip.animationId),
				)?.asset;
				if (!animation)
					throw new Error(
						`Object preview animation ${datAssetId(clip.animationId)} was not retained.`,
					);
				return playingClip(
					animation,
					clip.lowFrame,
					clip.highFrame,
					clip.framerate,
					index < pose.firstCyclicClip ? "hold" : "loop",
				);
			});
		}
		const fit = createObjectPreviewFit(
			templateHandle.asset.parts,
			setupPose,
			scale,
			clips,
			[...animationHandles.values()].some((handle) =>
				turnsVisualRoot(handle.asset),
			),
		);
		const particleMeshIds = [
			...new Set(
				[...preparedEmitters.values()].flatMap((emitter) =>
					emitter.kind === "drawable" ? [emitter.mesh.id] : [],
				),
			),
		];

		const assets: PreparedObjectPreviewAssets = {
			clips,
			defaultScriptRoot: setupHandle.asset.behavior.physicsScriptId,
			emitters: preparedEmitters,
			firstCyclicClip:
				request.pose.kind === "default-idle"
					? request.pose.firstCyclicClip
					: null,
			fit,
			particleMeshIds,
			scale,
			scripts: preparedScripts,
			setupPose,
			source,
			template: templateHandle.asset,
			translucency: request.translucency,
		};
		let released = false;
		return {
			assets,
			release: () => {
				if (released)
					throw new Error("Object preview asset lease released twice.");
				released = true;
				const failures = releasePreviewAssets(
					emitterHandles,
					scriptClosures,
					animationHandles,
					templateHandle,
					setupHandle,
				);
				if (failures.length > 0)
					throw new AggregateError(
						failures,
						"Object preview asset lease could not release every handle.",
					);
			},
		};
	} catch (cause) {
		const failures = releasePreviewAssets(
			emitters,
			scriptClosures,
			animations,
			template,
			setup,
		);
		if (failures.length === 0) throw cause;
		throw new AggregateError(
			failures,
			"Object preview preparation and rollback both failed.",
			{ cause },
		);
	}
}

function releasePreviewAssets(
	emitters: ReadonlyMap<
		DatAssetId,
		PreparedAssetHandle<PreparedParticleEmitter>
	> | null,
	scriptClosures: readonly PreparedPhysicsScriptClosure[],
	animations: ReadonlyMap<DatAssetId, PreparedAnimationHandle> | null,
	template: PreparedAssetHandle<ObjectVisualTemplate> | null,
	setup: PreparedAssetHandle<DecodedStaticPresentation> | null,
): unknown[] {
	const failures: unknown[] = [];
	if (emitters)
		for (const handle of emitters.values())
			attemptRelease(() => handle.release(), failures);
	for (const closure of [...scriptClosures].reverse())
		attemptRelease(() => closure.release(), failures);
	if (animations)
		for (const handle of animations.values())
			attemptRelease(() => handle.release(), failures);
	if (template) attemptRelease(() => template.release(), failures);
	if (setup) attemptRelease(() => setup.release(), failures);
	return failures;
}

function attemptRelease(operation: () => void, failures: unknown[]): void {
	try {
		operation();
	} catch (cause) {
		failures.push(cause);
	}
}
