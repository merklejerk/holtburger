import type { PreparedParticleEmitter } from "../behavior/particle-emitter-repository";
import type { PreparedPhysicsScriptClosure } from "../behavior/physics-script-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type {
	DynamicEntityPresentationState,
	DynamicPlaybackPolicy,
	DynamicPresentationSource,
	NameplateContent,
} from "./dynamic-presentation-source";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { DatAssetId, LandblockOwnerId } from "../game-types";
import type { SceneChildTransform, SceneNodeId } from "../scene";
import {
	type ParentLocation,
	type ResolvedAttachPoint,
	resolveObjectPresentationBounds,
	type ResolvedObjectPresentation,
	resolvePlacementPose,
} from "../resolution/presentation";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import type {
	ActiveDynamicPart,
	ArticulatedPose,
	DynamicEntityRenderable,
} from "./components";
import type { DynamicPresentationSample } from "./animation-system";
import type {
	ObjectVisualTemplate,
	PartVisualTemplate,
} from "./object-visual-template-repository";
import type {
	PreparedAnimationHandle,
	PreparedMotionAssets,
} from "../animation/animation-asset-repository";
import {
	prepareDynamicAnimation,
	prepareDynamicSequence,
	type PreparedDynamicAnimation,
} from "../animation/prepared-dynamic-animation";
import {
	prepareMotionPlayback,
	type PreparedMotionPlayback,
} from "../animation/prepared-motion-playback";
import type { ObjectGeometryData } from "../renderer/geometry";
import { playingClip } from "../animation/animation-playback";
import { datAssetId } from "../runtime/dynamic-entity-presentation";
import type { SelectionGeometryMorphology } from "../selection/entity-interaction-shape";

/** A requested authored part frame retained until its entity is destroyed. */
export interface DynamicAttachmentFrame extends SceneChildTransform {
	/** Authored identity selecting the rigid pose across appearance replacement. */
	readonly partIndex: number;
}

export interface DynamicEntityRecord {
	/** Stable setup bounds at source scale, independent of animated presentation bounds. */
	setupBounds: AABB3;
	readonly rootNodeId: SceneNodeId;
	readonly visualRootNodeId: SceneNodeId;
	/** Source-neutral visual facts retained for behavior staging and deterministic phase identity. */
	source: DynamicPresentationSource;
	/** Current authoritative whole-object scale, mutable without replacing immutable visual assets. */
	readonly rootScale: Vec3;
	/** Current presentation-only root transform retained so scale-only updates can rebuild bounds. */
	readonly visualRootTransform: Mat4;
	/** Immutable dimensionality copied from the resolved appearance template at preparation. */
	selectionGeometryMorphology: SelectionGeometryMorphology | null;
	/** Mutable display content updated independently from immutable visual setup facts. */
	nameplateContent: NameplateContent | null;
	renderable: DynamicEntityRenderable;
	/** Current effect opacity across all installed parts. */
	allPartsOpaque: boolean;
	/** Local part transform changes, independent of root/ancestor placement and materials. */
	localPartsRevision: number;
	/** Revisions last composed into retained part source-to-landblock matrices. */
	composedTransformRevision: number;
	composedLocalPartsRevision: number;
	/** Sparse attachment nodes and owned rigid matrices published with the visual root atomically. */
	attachmentFrames: DynamicAttachmentFrame[];
	articulatedPose: ArticulatedPose;
	/** Exclusive playback policy chosen at admission, independent of setup behavior provenance. */
	readonly playback: DynamicPlaybackPolicy;
	/** Every directly selected clip retained for this model; motion-table assets are separate. */
	animationHandles: ReadonlyMap<DatAssetId, PreparedAnimationHandle | null>;
	/**
	 * Staged script closure for a resident whose setup owns a default script.
	 *
	 * Held here rather than in the script clock so it is released by the same teardown that frees
	 * every other per-entity resource, and so a superseded generation cannot leak one.
	 */
	scriptClosure: PreparedPhysicsScriptClosure | null;
	/** Script closures reached directly by selected animation hooks. */
	animationScriptClosures: readonly PreparedPhysicsScriptClosure[];
	/** Available animations reached by this entity's motion table, staged before activation. */
	motionAssets: PreparedMotionAssets | null;
	/**
	 * The playable subset of those assets and the one bound covering it.
	 *
	 * Present exactly when the entity animates from a motion table, which is also when its played
	 * clip can change at runtime.
	 */
	motionPlayback: PreparedMotionPlayback | null;
	/**
	 * Emitter definitions named by this resident's script closure.
	 *
	 * Staged with the closure so a `CreateParticle` reached mid-playback resolves from memory; the
	 * particle runtime reads them through the repository rather than holding them itself.
	 */
	emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[];
	/** The resident's installed sound table, staged so a `SoundTable` key resolves from memory. */
	soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null;
	preparedAnimation: PreparedDynamicAnimation | null;
	/** Exact object-local rigid bounds matching the pose currently published to draw. */
	rigidPresentationBounds: AABB3;
	/** Current rigid pose expanded only by its particle-preservation envelope. */
	publishedPresentationBounds: AABB3;
	/**
	 * Pose-independent envelope the scene graph's broadphase culls against, before any particle
	 * envelope. Covers every pose the entity's animation can reach, so it is published once at
	 * install and only revisited when the particle envelope changes.
	 */
	cullingBounds: AABB3 | null;
	/** Envelope already folded into both culling bounds, so a change republishes them. */
	appliedEnvelopeRadius: number;
	/** Binary app-owned opacity composes after retail effects without modifying them. */
	presentationOpacity: 0 | 1;
	presentationState: DynamicEntityPresentationState;
}

/** One currently drawn rigid part borrowed for the duration of an exact-selection visit. */
export interface DynamicEntitySelectionPart {
	readonly geometry: ObjectGeometryData;
	readonly localBounds: AABB3;
	readonly sourceToLandblock: Mat4;
	readonly ranges: readonly {
		readonly cullFace: "back" | "front";
		readonly indexStart: number;
		readonly indexCount: number;
	}[];
}

/** Current realized geometry in the landblock-local frame that owns it. */
export interface DynamicEntitySelectionGeometry {
	readonly landblockId: LandblockOwnerId;
	/** Current object-local rigid bounds used when policy replaces triangles with a sphere. */
	readonly localBounds: AABB3;
	readonly parts: readonly DynamicEntitySelectionPart[];
	/** Current visual-root placement, including attachment ancestry. */
	readonly sourceToLandblock: Mat4;
}

export interface DynamicOwnerRecord<TTemplateOwnerId extends string> {
	/** Monotonic owner generation guarding asynchronous preparation publication. */
	readonly generation: number;
	readonly entities: readonly DynamicEntityRecord[];
	/** Generation-private geometry owner retained until this active generation retires. */
	readonly templateOwnerId: TTemplateOwnerId;
}

/** Prepared mesh replacement, or a topology change requiring full behavior-owner activation. */
export type DynamicVisualReplacement =
	| { readonly kind: "requires-owner-replacement" }
	| {
			readonly kind: "staged";
			/** Stable support/playback prepared from these exact appearance resources at source scale. */
			readonly animation: PreparedDynamicAnimation;
			/** Publish against the still-current owner without resetting behavior or part targets. */
			commit(): void;
			/** Withdraw uncommitted resources; safe after cancellation or commit. */
			release(): void;
	  };

/** Atomic authored-owner installation and its complete visual-staging outcome. */
export interface DynamicOwnerInstallation {
	/**
	 * Monotonic owner generation this installation belongs to.
	 *
	 * Exposed so behavior producers can stamp it onto their dispatch targets: a node id alone is
	 * recycled across generations, and a command must never land on a successor.
	 */
	readonly generation: number;
	readonly nodeIds: readonly SceneNodeId[];
	readonly ready: Promise<"ready" | "superseded">;
	/** Read complete staged animation facts after `ready` resolves successfully. */
	getPreparedEntities(): readonly PreparedDynamicEntity[];
	/** Validate and apply initial samples while staged nodes remain unpublished. */
	prepareCommit(
		initialSamples: readonly DynamicPresentationSample[],
		attachments: readonly DynamicModelAttachment[],
	): void;
	/** Publish the already validated generation and retire its predecessor. */
	commit(): void;
	/** Release a successfully prepared generation that will not be committed. */
	release(): void;
}

/** Direct staged model link; node IDs address this installation, never persistent item identity. */
export interface DynamicModelAttachment {
	/** Staged child whose source already owns its placement pose. */
	readonly childNodeId: SceneNodeId;
	/** Staged parent carrying the named holding location. */
	readonly parentNodeId: SceneNodeId;
	/** Setup-authored holding location to resolve before publication. */
	readonly location: ParentLocation;
}

/** Fully validated link shared by staged groups and live entity attachment. */
export interface PreparedDynamicAttachment {
	/** Child visual and independently scaled part state. */
	readonly child: DynamicEntityRecord;
	/** Parent visual retaining the rigid holding frame. */
	readonly parent: DynamicEntityRecord;
	/** Exact parent part carrying this holding location. */
	readonly parentPart: ActiveDynamicPart;
	/** Resolved rigid offset, independent of geometry scale. */
	readonly attachPoint: ResolvedAttachPoint;
	/** Complete child pose validated against its rendered parts. */
	readonly pose: ArticulatedPose;
}

/** Independently authored sound table and optional script/emitter assets staged before commit. */
export interface StagedBehaviorAssets {
	readonly closure: PreparedPhysicsScriptClosure | null;
	readonly emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[];
	readonly soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null;
	/** Animation-reachable script roots retained beside the default activation closure. */
	readonly animationScriptClosures: readonly PreparedPhysicsScriptClosure[];
}

/** Immutable preparation facts shared with behavior installation and composition framing. */
export interface PreparedDynamicEntity {
	/** Complete emitter definitions retained until this resident is released. */
	readonly emitters: readonly PreparedParticleEmitter[];
	readonly animation: PreparedDynamicAnimation;
	/** Complete setup pose retained beneath any partial-part animation clip. */
	readonly initialPartToObjectTransforms: readonly Mat4[];
	readonly nodeId: SceneNodeId;
	readonly source: DynamicPresentationSource;
	/** Complete default script graph, or `null` when absent or refused. */
	readonly scriptClosure: PreparedPhysicsScriptClosure | null;
	/** Complete animation-triggered graphs borrowed by the script clock without starting them. */
	readonly animationScriptClosures: readonly PreparedPhysicsScriptClosure[];
	readonly motionAssets: PreparedMotionAssets | null;
	/** The resident's installed sound table, or `null` when absent or refused. */
	readonly soundTable: DecodedSoundTable | null;
}

/** Mesh visibility is independent from the eligibility of the model's particle emitters. */
export function dynamicModelIsVisible(
	entity: DynamicEntityRecord,
): entity is DynamicEntityRecord & {
	renderable: Extract<DynamicEntityRenderable, { kind: "ready" }>;
} {
	return (
		entity.renderable.kind !== "preparing" &&
		!entity.presentationState.noDraw &&
		!entity.presentationState.hidden
	);
}

/** Resolve acquisition identities once from the exclusive admission policy. */
export function animationIdsFor(
	source: DynamicPresentationSource,
	playback: DynamicPlaybackPolicy,
): readonly DatAssetId[] {
	if (playback.kind === "resolved")
		return playback.pose.kind === "setup-pose"
			? []
			: playback.pose.clips.map((clip) => datAssetId(clip.animationId));
	return source.behavior.animationId === null
		? []
		: [source.behavior.animationId];
}

/** Rebuild geometry-dependent envelopes from retained assets without starting playback. */
export function prepareEntityVisualState(
	source: DynamicPresentationSource,
	scale: Vec3,
	template: ObjectVisualTemplate,
	animationAssets: ReadonlyMap<DatAssetId, PreparedAnimationHandle | null>,
	playback: DynamicPlaybackPolicy,
	motionAssets: PreparedMotionAssets | null,
): {
	readonly animation: PreparedDynamicAnimation;
	readonly motionPlayback: PreparedMotionPlayback | null;
} {
	const posedSource = { ...source, scale };
	const setupPose = defaultPose(posedSource);
	const staticBounds = presentationBoundsForPose(posedSource, setupPose);
	if (playback.kind === "resolved") {
		const pose = playback.pose;
		const stagedClips =
			pose.kind === "setup-pose"
				? []
				: pose.clips.map((clip, index) => {
						const id = datAssetId(clip.animationId);
						const handle = animationAssets.get(id);
						if (handle === undefined)
							throw new Error(`Resolved animation ${id} was not retained.`);
						if (handle === null) return null;
						return playingClip(
							handle.asset,
							clip.lowFrame,
							clip.highFrame,
							clip.framerate,
							index < pose.firstCyclicClip ? "hold" : "loop",
						);
					});
		// A resolved sequence is coherent as a whole; dropping one transition would change its meaning.
		const clips = stagedClips.some((clip) => clip === null)
			? []
			: stagedClips.filter((clip) => clip !== null);
		return {
			animation: prepareDynamicSequence(
				clips,
				pose.kind === "setup-pose" || clips.length === 0
					? null
					: pose.firstCyclicClip,
				template,
				setupPose.partToObjectTransforms,
				scale,
				staticBounds,
			),
			motionPlayback: null,
		};
	}
	const animationId = source.behavior.animationId;
	const animationHandle =
		animationId === null ? null : animationAssets.get(animationId);
	if (animationHandle === undefined)
		throw new Error(`Default animation ${animationId} was not retained.`);
	const animationAsset =
		animationHandle === null ? null : animationHandle.asset;
	const motionPlayback =
		motionAssets === null
			? null
			: prepareMotionPlayback(motionAssets, template, scale, staticBounds);
	const animation: PreparedDynamicAnimation =
		motionPlayback !== null
			? { kind: "none", localBounds: motionPlayback.localBounds }
			: animationAsset === null
				? { kind: "none", localBounds: staticBounds }
				: prepareDynamicAnimation(
						animationAsset,
						template,
						scale,
						staticBounds,
					);
	return { animation, motionPlayback };
}

export function staticPresentationBounds(source: DynamicPresentationSource) {
	const pose = defaultPose(source);
	return presentationBoundsForPose(source, pose);
}

function presentationBoundsForPose(
	source: DynamicPresentationSource,
	pose: ArticulatedPose,
) {
	const bounds = resolveObjectPresentationBounds(
		source.presentation.parts,
		pose.partToObjectTransforms,
		source.scale,
	);
	if (bounds === null) {
		throw new Error(
			`Dynamic presentation ${source.presentation.id} has no static geometry bounds.`,
		);
	}
	return bounds;
}

/** Build renderer-owned rigid poses without allocating attachment scene identities. */
export function createActiveParts(
	presentation: ResolvedObjectPresentation,
	pose: ArticulatedPose,
	scale: Vec3,
): readonly ActiveDynamicPart[] {
	const parts: ActiveDynamicPart[] = [];
	const partIndices = new Set<number>();
	for (const part of presentation.parts) {
		const partIndex = part.partIndex;
		if (partIndices.has(partIndex)) {
			throw new Error(
				`Presentation ${presentation.id} contains duplicate part index ${partIndex}.`,
			);
		}
		partIndices.add(partIndex);
		const transform = pose.partToObjectTransforms[partIndex];
		if (!transform)
			throw new Error(
				`Presentation ${presentation.id} has no pose for part ${partIndex}.`,
			);
		const localToVisualRoot = composeObjectPartTransform(
			transform,
			scale,
			part.defaultScale,
		);
		parts.push({
			defaultScale: part.defaultScale,
			depthDrawUnits: [],
			frameInstance: {
				color: { a: 1, b: 1, g: 1, r: 1 },
				sourceToLandblock: Mat4.zero(),
			},
			geometryData: null,
			localBounds: requiredPartBounds(part.geometry.bounds, partIndex),
			localToVisualRoot,
			partIndex,
			// Staging-only placeholder. The required effect sample replaces it before the owner
			// can publish, including a nonzero object-translucency baseline.
			renderState: { translucency: 0, textureVelocity: [0, 0] },
		});
	}
	return parts;
}

/** Install dense selector order once; frame consumers do not rejoin authored part identities. */
export function prepareRenderable(
	parts: readonly ActiveDynamicPart[],
	template: Pick<ObjectVisualTemplate, "layout" | "appearance">,
): Extract<DynamicEntityRenderable, { kind: "ready" }> {
	const ordered = [...parts].sort(
		(left, right) => left.partIndex - right.partIndex,
	);
	if (ordered.length !== template.layout.parts.length)
		throw new Error(
			`Dynamic layout ${template.layout.key} has a different active part count.`,
		);
	for (const [selector, part] of ordered.entries()) {
		if (template.layout.parts[selector]?.partIndex !== part.partIndex)
			throw new Error(
				`Dynamic layout ${template.layout.key} selector ${selector} does not address active part ${part.partIndex}.`,
			);
	}
	return {
		kind: "ready",
		parts: ordered,
		layout: template.layout,
		appearance: template.appearance,
	};
}

export function mergePreparedParts(
	activeParts: readonly ActiveDynamicPart[],
	templateParts: readonly PartVisualTemplate[],
): readonly ActiveDynamicPart[] {
	const activeByIndex = new Map(
		activeParts.map((part) => [part.partIndex, part] as const),
	);
	return templateParts.map((template) => {
		const active = activeByIndex.get(template.partIndex);
		if (!active)
			throw new Error(
				`Prepared template has no active part ${template.partIndex}.`,
			);
		const localBounds = requiredPartBounds(
			template.localBounds,
			template.partIndex,
		);
		return {
			...active,
			defaultScale: template.defaultScale,
			depthDrawUnits: template.depthDrawUnits,
			geometryData: template.geometryData,
			localBounds,
		};
	});
}

/** Validate and compose each active part's `localToVisualRoot` matrix in place from an authored pose. */
export function composeValidatedPartTransforms(
	parts: readonly ActiveDynamicPart[],
	partToObjectTransforms: readonly Mat4[],
	rootScale: Vec3,
	missingTransformMessage: string | ((partIndex: number) => string),
): void {
	for (const part of parts) {
		const transform = partToObjectTransforms[part.partIndex];
		if (!transform) {
			throw new Error(
				typeof missingTransformMessage === "string"
					? missingTransformMessage
					: missingTransformMessage(part.partIndex),
			);
		}
		composeObjectPartTransform(
			transform,
			rootScale,
			part.defaultScale,
			part.localToVisualRoot,
		);
	}
}

/** Rescale one origin-relative authored bound without revisiting the geometry or animation sweep. */
export function boundsAtRootScale(
	bounds: AABB3,
	authoredScale: Vec3,
	currentScale: Vec3,
): AABB3 {
	if (
		!Number.isFinite(authoredScale.x) ||
		!Number.isFinite(authoredScale.y) ||
		!Number.isFinite(authoredScale.z) ||
		authoredScale.x <= 0 ||
		authoredScale.y <= 0 ||
		authoredScale.z <= 0
	)
		throw new Error("Authored dynamic root scale must be finite and positive.");
	const ratio = new Vec3(
		currentScale.x / authoredScale.x,
		currentScale.y / authoredScale.y,
		currentScale.z / authoredScale.z,
	);
	return new AABB3(
		new Vec3(
			bounds.min.x * ratio.x,
			bounds.min.y * ratio.y,
			bounds.min.z * ratio.z,
		),
		new Vec3(
			bounds.max.x * ratio.x,
			bounds.max.y * ratio.y,
			bounds.max.z * ratio.z,
		),
	);
}

function requiredPartBounds(bounds: AABB3 | null, partIndex: number): AABB3 {
	if (!bounds)
		throw new Error(
			`Renderable dynamic part ${partIndex} has no local bounds.`,
		);
	return bounds.clone();
}

export function poseFor(
	presentation: ResolvedObjectPresentation,
	placementKey: number,
): ArticulatedPose {
	return {
		// A static placement pose has no clip and therefore no authored root frame.
		authoredRootTransform: null,
		partToObjectTransforms: resolvePlacementPose(presentation, placementKey)
			.partTransforms,
	};
}

export function defaultPose(
	source: DynamicPresentationSource,
): ArticulatedPose {
	return poseFor(source.presentation, source.placementFrame);
}

/** Numeric identity is sufficient for bounds geometry; signed zeros represent the same frame. */
export function isIdentityBoundsRoot(matrix: Mat4): boolean {
	return (
		matrix.m11 === 1 &&
		matrix.m12 === 0 &&
		matrix.m13 === 0 &&
		matrix.m14 === 0 &&
		matrix.m21 === 0 &&
		matrix.m22 === 1 &&
		matrix.m23 === 0 &&
		matrix.m24 === 0 &&
		matrix.m31 === 0 &&
		matrix.m32 === 0 &&
		matrix.m33 === 1 &&
		matrix.m34 === 0 &&
		matrix.m41 === 0 &&
		matrix.m42 === 0 &&
		matrix.m43 === 0 &&
		matrix.m44 === 1
	);
}

/** Keep the original composition/affine rejection for non-finite part coefficients. */
export function hasFiniteBoundsCoefficients(matrix: Mat4): boolean {
	return (
		Number.isFinite(matrix.m11) &&
		Number.isFinite(matrix.m12) &&
		Number.isFinite(matrix.m13) &&
		Number.isFinite(matrix.m21) &&
		Number.isFinite(matrix.m22) &&
		Number.isFinite(matrix.m23) &&
		Number.isFinite(matrix.m31) &&
		Number.isFinite(matrix.m32) &&
		Number.isFinite(matrix.m33) &&
		Number.isFinite(matrix.m41) &&
		Number.isFinite(matrix.m42) &&
		Number.isFinite(matrix.m43)
	);
}
