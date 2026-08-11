import type { Mat4 } from "../math/types";
import type { StaticInstanceStreamData } from "../systems/static-resources";
import {
	classifyObjectFootprint,
	type ObjectFootprintProjectionInput,
	type ObjectFootprintVisibility,
} from "./object-footprint";

interface MutableGeneratedInstanceSelection {
	readonly indices: number[];
	landblockOffsetX: number;
	landblockOffsetY: number;
	landblockOffsetZ: number;
}

type EnvelopeClassifier = (
	input: ObjectFootprintProjectionInput,
) => ObjectFootprintVisibility;
type MutableGeneratedInstanceProjectionInput = {
	-readonly [Key in keyof ObjectFootprintProjectionInput]: ObjectFootprintProjectionInput[Key];
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

	constructor(classify: EnvelopeClassifier = classifyObjectFootprint) {
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
				bounds: stream.sourceEnvelope,
				minimumPixelArea: this.#minimumPixelArea,
				localToLandblock: instance.sourceToLandblock,
				viewportHeight: this.#viewportHeight,
				viewportWidth: this.#viewportWidth,
			};
			this.#projectionInput = projectionInput;
			projectionInput.clipFromAnchor = clipFromAnchor;
			projectionInput.landblockOffsetX = landblockOffsetX;
			projectionInput.landblockOffsetY = landblockOffsetY;
			projectionInput.landblockOffsetZ = landblockOffsetZ;
			projectionInput.minimumPixelArea = this.#minimumPixelArea;
			projectionInput.bounds = stream.sourceEnvelope;
			projectionInput.localToLandblock = instance.sourceToLandblock;
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
