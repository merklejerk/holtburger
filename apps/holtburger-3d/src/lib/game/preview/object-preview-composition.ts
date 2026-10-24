import type { DatAssetId } from "../game-types";
import type { Mat4 } from "../math/types";
import { compileDynamicLayout } from "../geometry/dynamic-layout";
import { compileDynamicAppearance } from "../systems/dynamic-appearance";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import type { ObjectPreviewSource } from "../runtime/object-preview-source";
import {
	acquireObjectPreviewVisual,
	type PreparedObjectPreviewVisualAssets,
	type ObjectPreviewVisualLease,
} from "./object-preview-assets";
import type { PresentationAssetService } from "../runtime/presentation-asset-service";
import {
	composeObjectPreviewFit,
	type ObjectPreviewFit,
} from "./object-preview-fit";

/** One model retains local animation indices; the draw bundle uses its explicit part offset. */
export interface PreparedObjectPreviewModel {
	/** Complete immutable model facts and runtime dependencies. */
	readonly visual: PreparedObjectPreviewVisualAssets;
	/** First index reserved for this model in the combined pose payload. */
	readonly partOffset: number;
}

/** Holding-point interpretation happens once during preparation, shared by pose and fit. */
export interface PreparedObjectPreviewAttachment {
	/** Child model and its reserved draw-part offset stay together. */
	readonly model: PreparedObjectPreviewModel;
	/** Subject part carrying the holding location; independent of its geometry scale. */
	readonly parentPartIndex: number;
	/** Authored rigid frame relative to that subject part. */
	readonly offsetTransform: Mat4;
}

/** One visual bundle for the existing merged object draw path and its private model runtimes. */
export interface PreparedObjectPreviewAssets {
	/** The only subject; its original part indices start at zero. */
	readonly body: PreparedObjectPreviewModel;
	/** Resolved direct attachments; no arbitrary hierarchy is retained. */
	readonly attachments: readonly PreparedObjectPreviewAttachment[];
	/** Optional independent model, excluded from subject heading and framing. */
	readonly background: PreparedObjectPreviewModel | null;
	/** One global part/material layout preserves draw-phase ordering across every model. */
	readonly template: Pick<
		ObjectVisualTemplate,
		"layout" | "appearance" | "textureRequirements"
	>;
	/** Stable body/equipment support envelope; backgrounds affect clipping only. */
	readonly fit: ObjectPreviewFit;
	/** Shared particle mesh closure for every model in this installed bundle. */
	readonly particleMeshIds: readonly DatAssetId[];
}

/** Retire the entire CPU composition after all its device/presentation borrowers close. */
export interface ObjectPreviewAssetLease {
	/** Immutable prepared composition. */
	readonly assets: PreparedObjectPreviewAssets;
	/** Release every acquired model exactly once. */
	release(): void;
}

/** Prepare one body, flat attachments and optional backdrop without creating a game scene. */
export async function acquireObjectPreviewAssets(
	service: PresentationAssetService,
	request: ObjectPreviewSource,
): Promise<ObjectPreviewAssetLease> {
	const leases: ObjectPreviewVisualLease[] = [];
	try {
		const body = await acquireObjectPreviewVisual(service, request.body, 0);
		leases.push(body);
		const subject: PreparedObjectPreviewModel = {
			visual: body.assets,
			partOffset: 0,
		};
		const models: PreparedObjectPreviewModel[] = [subject];
		const attachments: PreparedObjectPreviewAttachment[] = [];
		let nextPart = body.assets.setupPose.length;
		for (const attachment of request.attachments) {
			const point = body.assets.source.presentation.holdingLocations.get(
				attachment.parentLocation,
			);
			if (point === undefined)
				throw new Error(
					`Preview body has no holding location ${attachment.parentLocation}.`,
				);
			const child = await acquireObjectPreviewVisual(
				service,
				attachment.visual,
				attachment.placement,
			);
			leases.push(child);
			const model = { visual: child.assets, partOffset: nextPart };
			attachments.push({
				model,
				parentPartIndex: point.partIndex,
				offsetTransform: point.offsetTransform,
			});
			models.push(model);
			nextPart += child.assets.setupPose.length;
		}
		let background: PreparedObjectPreviewModel | null = null;
		if (request.background !== null) {
			const backdrop = await acquireObjectPreviewVisual(
				service,
				request.background,
				0,
			);
			leases.push(backdrop);
			background = { visual: backdrop.assets, partOffset: nextPart };
			models.push(background);
		}
		const textures = new Map<AssetTextureKey, AssetTextureFact>();
		for (const model of models)
			for (const fact of model.visual.template.textureRequirements)
				textures.set(fact.key, fact);
		const flatParts = models.flatMap(({ visual, partOffset }) =>
			visual.source.presentation.parts.map((part) => ({
				...part,
				partIndex: part.partIndex + partOffset,
			})),
		);
		const flatTemplates = models.flatMap(({ visual, partOffset }, modelIndex) =>
			visual.template.parts.map((part) => ({
				...part,
				partIndex: part.partIndex + partOffset,
				drawUnits: part.drawUnits.map((unit) => ({
					...unit,
					partIndex: unit.partIndex + partOffset,
					batchKey: `preview-model:${modelIndex}/${unit.batchKey}`,
				})),
			})),
		);
		const layout =
			models.length === 1
				? body.assets.template.layout
				: compileDynamicLayout(flatParts);
		const fit = composeObjectPreviewFit(
			body.assets,
			attachments.map((attachment) => ({
				parentPartIndex: attachment.parentPartIndex,
				offsetTransform: attachment.offsetTransform,
				fit: attachment.model.visual.fit,
			})),
		);
		const assets: PreparedObjectPreviewAssets = {
			body: subject,
			attachments,
			background,
			fit,
			template: {
				layout,
				appearance:
					models.length === 1
						? body.assets.template.appearance
						: compileDynamicAppearance(layout, flatTemplates),
				textureRequirements: [...textures.values()],
			},
			particleMeshIds: [
				...new Set(models.flatMap((model) => model.visual.particleMeshIds)),
			],
		};
		let released = false;
		return {
			assets,
			release: () => {
				if (released)
					throw new Error("Object preview composition lease released twice.");
				released = true;
				releaseModels(leases);
			},
		};
	} catch (cause) {
		try {
			releaseModels(leases);
		} catch (cleanupCause) {
			throw new AggregateError(
				[cause, cleanupCause],
				"Preview composition preparation and rollback failed.",
				{ cause: cleanupCause },
			);
		}
		throw cause;
	}
}

function releaseModels(leases: readonly ObjectPreviewVisualLease[]): void {
	const failures: unknown[] = [];
	for (const lease of [...leases].reverse()) {
		try {
			lease.release();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length > 0)
		throw new AggregateError(
			failures,
			"Preview composition could not release every model.",
		);
}
