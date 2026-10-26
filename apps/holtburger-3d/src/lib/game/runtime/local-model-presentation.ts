import { completePresentationOperations } from "./presentation-teardown";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import { Vec3 } from "../math/types";
import type { SceneNodeId, SceneSpatialPlacement } from "../scene";
import type { DynamicModelAttachment } from "../systems/dynamic-entity-system";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import { datAssetId } from "./dynamic-entity-presentation";
import type { LocalSceneModelSource } from "./local-scene-model";
import type { ObjectPreviewVisual } from "./object-preview-source";
import type { LocalSceneModelOwnerId } from "./owner-ids";
import type { SetupVisualAssetRepository } from "./presentation-asset-service";

/** One complete body/equipment source with CPU leases retained until its installed group retires. */
export interface LocalModelPresentation {
	/** Body first, then direct children; ordinals address this disposable staging group only. */
	readonly sources: readonly [
		PlacedDynamicPresentationSource,
		...PlacedDynamicPresentationSource[],
	];
	/** Resolve ephemeral scene addresses after dynamic preparation has allocated roots. */
	attachments(
		nodeIds: readonly SceneNodeId[],
	): readonly DynamicModelAttachment[];
	/** Release all setup leases, including when one release reports a failure. */
	release(): void;
}

/** Load every setup before returning ownership; partial failures release every successful lease. */
export async function prepareLocalModelPresentation(
	repository: SetupVisualAssetRepository,
	owner: LocalSceneModelOwnerId,
	source: LocalSceneModelSource,
	placement: SceneSpatialPlacement,
): Promise<LocalModelPresentation> {
	const visuals = [
		source.body,
		...source.attachments.map((item) => item.visual),
	];
	const results = await Promise.allSettled(
		visuals.map((visual) =>
			repository.acquire(visual.setupDid, visual.appearance),
		),
	);
	const leases: PreparedAssetHandle<DecodedStaticPresentation>[] = [];
	const failures: unknown[] = [];
	for (const result of results) {
		if (result.status === "fulfilled") leases.push(result.value);
		else failures.push(result.reason);
	}
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		completePresentationOperations(
			leases.map((lease) => () => lease.release()),
		);
	};
	try {
		if (failures.length > 0)
			throw new AggregateError(
				failures,
				"Local model setup preparation failed.",
			);
		const sources = leases.map((lease, index) => {
			const visual = visuals[index];
			if (visual === undefined)
				throw new Error("Local model lease has no visual source.");
			const attachment = index === 0 ? null : source.attachments[index - 1];
			if (attachment === undefined)
				throw new Error("Local equipment lease has no attachment source.");
			return adaptLocalModelVisual(
				visual,
				lease.asset,
				`${owner}/${index === 0 ? "body" : `equipment:${index - 1}`}`,
				attachment === null ? 0 : attachment.placement,
				placement,
			);
		});
		const [bodySource, ...equipmentSources] = sources;
		if (bodySource === undefined)
			throw new Error("Local composition preparation produced no body.");
		return {
			sources: [bodySource, ...equipmentSources],
			attachments: (nodeIds) => {
				const [body, ...children] = nodeIds;
				if (body === undefined || children.length !== source.attachments.length)
					throw new Error(
						"Local composition scene roots differ from its resolved sources.",
					);
				return children.map((childNodeId, index) => {
					const attachment = source.attachments[index];
					if (attachment === undefined)
						throw new Error("Local scene child has no attachment source.");
					return {
						childNodeId,
						parentNodeId: body,
						location: attachment.parentLocation,
					};
				});
			},
			release,
		};
	} catch (cause) {
		try {
			release();
		} catch (cleanup) {
			throw new AggregateError(
				[cause, cleanup],
				"Local model setup preparation and cleanup failed.",
				{ cause: cleanup },
			);
		}
		throw cause;
	}
}

/** Body appearance may change without restarting clocks only when playback and all child facts match. */
export function canReplaceLocalModelAppearance(
	current: LocalSceneModelSource,
	next: LocalSceneModelSource,
	currentPresentation: LocalModelPresentation,
	nextPresentation: LocalModelPresentation,
): boolean {
	const oldBody = currentPresentation.sources[0];
	const newBody = nextPresentation.sources[0];
	if (
		current.body.setupDid !== next.body.setupDid ||
		current.body.scale !== next.body.scale ||
		current.body.translucency !== next.body.translucency
	)
		return false;
	// These resolved source records contain ordered scalar data; order is meaningful for clips/equipment.
	if (
		JSON.stringify(current.body.pose) !== JSON.stringify(next.body.pose) ||
		JSON.stringify(current.attachments) !== JSON.stringify(next.attachments)
	)
		return false;
	if (
		JSON.stringify(oldBody.source.behavior) !==
		JSON.stringify(newBody.source.behavior)
	)
		return false;
	return next.attachments.every(({ parentLocation }) => {
		const previous =
			oldBody.source.presentation.holdingLocations.get(parentLocation);
		const replacement =
			newBody.source.presentation.holdingLocations.get(parentLocation);
		return (
			previous !== undefined &&
			replacement !== undefined &&
			previous.partIndex === replacement.partIndex &&
			JSON.stringify(previous.offsetTransform) ===
				JSON.stringify(replacement.offsetTransform)
		);
	});
}

/** Scene sources carry real setup facts and presentation identity, without fabricating host entities. */
function adaptLocalModelVisual(
	visual: ObjectPreviewVisual,
	decoded: DecodedStaticPresentation,
	identity: string,
	placementFrame: number,
	placement: SceneSpatialPlacement,
): PlacedDynamicPresentationSource {
	const setupId = datAssetId(visual.setupDid);
	if (decoded.setupId?.toLowerCase() !== setupId)
		throw new Error(
			`Local model resolved ${decoded.setupId ?? "no setup"}, expected ${setupId}.`,
		);
	return {
		placement,
		playback: { kind: "resolved", pose: visual.pose },
		initialPresentationState: {
			noDraw: true,
			hidden: false,
			cloaked: false,
			lighting: true,
			translucency: visual.translucency,
		},
		source: {
			entityClass: "other",
			identity,
			nameplate: null,
			setupId,
			presentation: decoded.presentation,
			placementFrame,
			behavior: decoded.behavior,
			scale: new Vec3(visual.scale, visual.scale, visual.scale),
			localBounds: decoded.localBounds,
		},
	};
}
