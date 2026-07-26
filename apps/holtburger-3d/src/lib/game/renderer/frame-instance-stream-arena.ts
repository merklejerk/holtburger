import type { StaticInstanceData } from "../systems/static-resources";
import {
	WebGL2InstanceBuffer,
	type WebGL2InstanceBufferBinding,
} from "./webgl2-instance-buffer";

/** One validated contiguous draw range inside the current view's frame instance stream. */
export interface FrameInstanceStreamRange {
	readonly binding: WebGL2InstanceBufferBinding;
	readonly firstInstance: number;
	readonly instanceCount: number;
}

/** Renderer-owned reusable storage for one sequential view's ordered instance population. */
export class FrameInstanceStreamArena {
	readonly #buffer: WebGL2InstanceBuffer;
	#growthCount = 0;
	#viewHighWaterMark = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.#buffer = new WebGL2InstanceBuffer(gl, "frame-dynamic");
	}

	/** Orphan and upload the complete ordered population for one sequentially rendered view. */
	prepareView(instances: readonly StaticInstanceData[]): void {
		if (this.#buffer.resetFrame(instances.length)) this.#growthCount += 1;
		this.#buffer.updateRange(0, instances);
		this.#viewHighWaterMark = Math.max(
			this.#viewHighWaterMark,
			instances.length,
		);
	}

	/** Select one contiguous run without allocating another backend resource. */
	getRange(
		firstInstance: number,
		instanceCount: number,
	): FrameInstanceStreamRange {
		const binding = this.#buffer.getBinding();
		if (
			!Number.isInteger(firstInstance) ||
			!Number.isInteger(instanceCount) ||
			firstInstance < 0 ||
			instanceCount < 0 ||
			firstInstance + instanceCount > binding.populatedInstanceCount
		) {
			throw new Error(
				`Frame instance range ${firstInstance}+${instanceCount} exceeds populated count ${binding.populatedInstanceCount}.`,
			);
		}
		return { binding, firstInstance, instanceCount };
	}

	/** Return renderer diagnostics without exposing mutable arena storage. */
	getDiagnostics(): {
		readonly capacity: number;
		readonly growthCount: number;
		readonly populatedInstanceCount: number;
		readonly viewHighWaterMark: number;
	} {
		const binding = this.#buffer.getBinding();
		return {
			capacity: binding.capacity,
			growthCount: this.#growthCount,
			populatedInstanceCount: binding.populatedInstanceCount,
			viewHighWaterMark: this.#viewHighWaterMark,
		};
	}

	destroy(): void {
		this.#buffer.destroy();
	}
}
