import type { Mat4 } from "../math/types";
import type { StaticInstanceStreamData } from "../systems/static-resources";

/** Conservative screen-space result for one transformed source envelope. */
export type GeneratedInstanceEnvelopeVisibility =
	"visible" | "near-plane-or-ambiguous" | "below-threshold" | "outside-view";

/** Immutable inputs needed to classify one generated instance without renderer resources. */
export interface GeneratedInstanceProjectionInput {
	readonly clipFromAnchor: Mat4;
	readonly sourceToLandblock: Mat4;
	readonly sourceEnvelope: StaticInstanceStreamData["sourceEnvelope"];
	readonly landblockOffsetX: number;
	readonly landblockOffsetY: number;
	readonly landblockOffsetZ: number;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly minimumPixelArea: number;
}

const CLIP_EPSILON = 1e-7;

/**
 * Project all source-envelope corners and remove only instances proven outside or proven small.
 * Any near-plane intersection or non-finite intermediate stays visible by construction.
 */
export function classifyGeneratedInstanceEnvelope(
	input: GeneratedInstanceProjectionInput,
): GeneratedInstanceEnvelopeVisibility {
	if (
		!Number.isFinite(input.minimumPixelArea) ||
		input.minimumPixelArea < 0 ||
		!Number.isFinite(input.viewportWidth) ||
		input.viewportWidth <= 0 ||
		!Number.isFinite(input.viewportHeight) ||
		input.viewportHeight <= 0
	) {
		throw new Error("Generated-instance projection dimensions are invalid.");
	}

	const bounds = input.sourceEnvelope;
	const source = input.sourceToLandblock;
	const clip = input.clipFromAnchor;
	let minimumNdcX = Number.POSITIVE_INFINITY;
	let minimumNdcY = Number.POSITIVE_INFINITY;
	let maximumNdcX = Number.NEGATIVE_INFINITY;
	let maximumNdcY = Number.NEGATIVE_INFINITY;
	let allOutsideLeft = true;
	let allOutsideRight = true;
	let allOutsideBottom = true;
	let allOutsideTop = true;
	let allOutsideFar = true;
	let nearPlaneOrAmbiguous = false;

	for (let corner = 0; corner < 8; corner += 1) {
		const sourceX = (corner & 1) === 0 ? bounds.min.x : bounds.max.x;
		const sourceY = (corner & 2) === 0 ? bounds.min.y : bounds.max.y;
		const sourceZ = (corner & 4) === 0 ? bounds.min.z : bounds.max.z;
		const anchorX =
			source.m11 * sourceX +
			source.m21 * sourceY +
			source.m31 * sourceZ +
			source.m41 +
			input.landblockOffsetX;
		const anchorY =
			source.m12 * sourceX +
			source.m22 * sourceY +
			source.m32 * sourceZ +
			source.m42 +
			input.landblockOffsetY;
		const anchorZ =
			source.m13 * sourceX +
			source.m23 * sourceY +
			source.m33 * sourceZ +
			source.m43 +
			input.landblockOffsetZ;
		const clipX =
			clip.m11 * anchorX + clip.m21 * anchorY + clip.m31 * anchorZ + clip.m41;
		const clipY =
			clip.m12 * anchorX + clip.m22 * anchorY + clip.m32 * anchorZ + clip.m42;
		const clipZ =
			clip.m13 * anchorX + clip.m23 * anchorY + clip.m33 * anchorZ + clip.m43;
		const clipW =
			clip.m14 * anchorX + clip.m24 * anchorY + clip.m34 * anchorZ + clip.m44;
		if (
			!Number.isFinite(clipX) ||
			!Number.isFinite(clipY) ||
			!Number.isFinite(clipZ) ||
			!Number.isFinite(clipW)
		) {
			return "near-plane-or-ambiguous";
		}
		allOutsideLeft &&= clipX < -clipW;
		allOutsideRight &&= clipX > clipW;
		allOutsideBottom &&= clipY < -clipW;
		allOutsideTop &&= clipY > clipW;
		allOutsideFar &&= clipZ > clipW;
		if (clipW <= CLIP_EPSILON || clipZ + clipW <= CLIP_EPSILON) {
			nearPlaneOrAmbiguous = true;
			continue;
		}
		const inverseW = 1 / clipW;
		const ndcX = clipX * inverseW;
		const ndcY = clipY * inverseW;
		minimumNdcX = Math.min(minimumNdcX, ndcX);
		minimumNdcY = Math.min(minimumNdcY, ndcY);
		maximumNdcX = Math.max(maximumNdcX, ndcX);
		maximumNdcY = Math.max(maximumNdcY, ndcY);
	}

	if (nearPlaneOrAmbiguous) return "near-plane-or-ambiguous";
	if (
		allOutsideLeft ||
		allOutsideRight ||
		allOutsideBottom ||
		allOutsideTop ||
		allOutsideFar
	) {
		return "outside-view";
	}

	const visibleNdcWidth = Math.min(1, maximumNdcX) - Math.max(-1, minimumNdcX);
	const visibleNdcHeight = Math.min(1, maximumNdcY) - Math.max(-1, minimumNdcY);
	if (visibleNdcWidth <= 0 || visibleNdcHeight <= 0) return "outside-view";
	const pixelArea =
		visibleNdcWidth *
		(input.viewportWidth / 2) *
		visibleNdcHeight *
		(input.viewportHeight / 2);
	return pixelArea < input.minimumPixelArea ? "below-threshold" : "visible";
}

interface MutableGeneratedInstanceSelection {
	readonly indices: number[];
	landblockOffsetX: number;
	landblockOffsetY: number;
	landblockOffsetZ: number;
}

type EnvelopeClassifier = (
	input: GeneratedInstanceProjectionInput,
) => GeneratedInstanceEnvelopeVisibility;
type MutableGeneratedInstanceProjectionInput = {
	-readonly [
		Key in keyof GeneratedInstanceProjectionInput
	]: GeneratedInstanceProjectionInput[Key];
};

/** Per-view selector that reuses index storage and caches one result per immutable stream. */
export class GeneratedInstanceSelector {
	readonly #classify: EnvelopeClassifier;
	readonly #selections = new Map<
		StaticInstanceStreamData,
		MutableGeneratedInstanceSelection
	>();
	readonly #selectionPool: MutableGeneratedInstanceSelection[] = [];
	#selectionPoolCursor = 0;
	#clipFromAnchor: Mat4 | null = null;
	#viewportWidth = 0;
	#viewportHeight = 0;
	#minimumPixelArea = 0;
	#testedCount = 0;
	#retainedCount = 0;
	#rejectedCount = 0;
	/** Single mutable call contract reused for every classifier invocation. */
	#projectionInput: MutableGeneratedInstanceProjectionInput | null = null;

	constructor(
		classify: EnvelopeClassifier = classifyGeneratedInstanceEnvelope,
	) {
		this.#classify = classify;
	}

	beginView(
		clipFromAnchor: Mat4,
		viewportWidth: number,
		viewportHeight: number,
		minimumPixelArea: number,
	): void {
		if (!Number.isFinite(minimumPixelArea) || minimumPixelArea < 0) {
			throw new Error("Generated-instance minimum pixel area is invalid.");
		}
		this.#clipFromAnchor = clipFromAnchor;
		this.#viewportWidth = viewportWidth;
		this.#viewportHeight = viewportHeight;
		this.#minimumPixelArea = minimumPixelArea;
		this.#selections.clear();
		this.#selectionPoolCursor = 0;
		this.#testedCount = 0;
		this.#retainedCount = 0;
		this.#rejectedCount = 0;
	}

	get testedCount(): number {
		return this.#testedCount;
	}

	get retainedCount(): number {
		return this.#retainedCount;
	}

	get rejectedCount(): number {
		return this.#rejectedCount;
	}

	select(
		stream: StaticInstanceStreamData,
		landblockOffsetX: number,
		landblockOffsetY: number,
		landblockOffsetZ: number,
	): readonly number[] {
		const cached = this.#selections.get(stream);
		if (cached) {
			if (
				cached.landblockOffsetX !== landblockOffsetX ||
				cached.landblockOffsetY !== landblockOffsetY ||
				cached.landblockOffsetZ !== landblockOffsetZ
			) {
				throw new Error(
					"One generated instance stream crossed landblock render frames.",
				);
			}
			return cached.indices;
		}
		const clipFromAnchor = this.#clipFromAnchor;
		if (!clipFromAnchor) {
			throw new Error("Generated-instance selection began without a view.");
		}
		const selection = this.#selectionPool[this.#selectionPoolCursor] ?? {
			indices: [],
			landblockOffsetX,
			landblockOffsetY,
			landblockOffsetZ,
		};
		this.#selectionPool[this.#selectionPoolCursor] = selection;
		this.#selectionPoolCursor += 1;
		selection.indices.length = 0;
		selection.landblockOffsetX = landblockOffsetX;
		selection.landblockOffsetY = landblockOffsetY;
		selection.landblockOffsetZ = landblockOffsetZ;
		if (this.#minimumPixelArea > 0) {
			this.#testedCount += stream.instances.length;
		}
		for (let index = 0; index < stream.instances.length; index += 1) {
			if (this.#minimumPixelArea === 0) {
				selection.indices.push(index);
				continue;
			}
			const instance = stream.instances[index];
			if (!instance) {
				throw new Error("Generated instance stream has a sparse population.");
			}
			const projectionInput = this.#projectionInput ?? {
				clipFromAnchor,
				landblockOffsetX,
				landblockOffsetY,
				landblockOffsetZ,
				minimumPixelArea: this.#minimumPixelArea,
				sourceEnvelope: stream.sourceEnvelope,
				sourceToLandblock: instance.sourceToLandblock,
				viewportHeight: this.#viewportHeight,
				viewportWidth: this.#viewportWidth,
			};
			this.#projectionInput = projectionInput;
			projectionInput.clipFromAnchor = clipFromAnchor;
			projectionInput.landblockOffsetX = landblockOffsetX;
			projectionInput.landblockOffsetY = landblockOffsetY;
			projectionInput.landblockOffsetZ = landblockOffsetZ;
			projectionInput.minimumPixelArea = this.#minimumPixelArea;
			projectionInput.sourceEnvelope = stream.sourceEnvelope;
			projectionInput.sourceToLandblock = instance.sourceToLandblock;
			projectionInput.viewportHeight = this.#viewportHeight;
			projectionInput.viewportWidth = this.#viewportWidth;
			const visibility = this.#classify(projectionInput);
			if (
				visibility === "visible" ||
				visibility === "near-plane-or-ambiguous"
			) {
				selection.indices.push(index);
				this.#retainedCount += 1;
			} else {
				this.#rejectedCount += 1;
			}
		}
		this.#selections.set(stream, selection);
		return selection.indices;
	}
}
