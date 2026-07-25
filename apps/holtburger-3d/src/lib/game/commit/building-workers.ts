import { AABB3, Vec3 } from "../math/types";
import {
	type BuildingGeometryJob,
	type BuildingGeometryResult,
} from "./building-geometry-worker";
import {
	type BuildingTexturePackJob,
	type BuildingTexturePackResult,
} from "./building-texture-worker";
import { ClosedWorkerClient, type ClosedWorkerPort } from "../workers/closed-worker";

/** Owned pair of closed static-building workers used by the commit pipeline. */
export class BuildingWorkers {
	readonly #geometry: ClosedWorkerClient<BuildingGeometryJob, BuildingGeometryResult | null>;
	readonly #textures: ClosedWorkerClient<BuildingTexturePackJob, BuildingTexturePackResult>;

	constructor(options: {
		readonly createGeometryWorker: () => ClosedWorkerPort;
		readonly createTextureWorker: () => ClosedWorkerPort;
	}) {
		this.#geometry = new ClosedWorkerClient(options.createGeometryWorker());
		this.#textures = new ClosedWorkerClient(options.createTextureWorker());
	}

	static build(): BuildingWorkers {
		return new BuildingWorkers({
			createGeometryWorker: () =>
				new Worker(new URL("./building-geometry-worker.entry.ts", import.meta.url), {
					type: "module",
				}) as unknown as ClosedWorkerPort,
			createTextureWorker: () =>
				new Worker(new URL("./building-texture-worker.entry.ts", import.meta.url), {
					type: "module",
				}) as unknown as ClosedWorkerPort,
		});
	}

	async bake(job: BuildingGeometryJob): Promise<BuildingGeometryResult | null> {
		const result = await this.#geometry.dispatch(job, geometryInputTransferables(job));
		return result === null ? null : hydrateGeometryResult(result);
	}

	pack(job: BuildingTexturePackJob): Promise<BuildingTexturePackResult> {
		return this.#textures.dispatch(job, job.inputs.map((input) => input.pixels.buffer));
	}

	destroy(): void {
		this.#geometry.destroy();
		this.#textures.destroy();
	}
}

function geometryInputTransferables(job: BuildingGeometryJob): Transferable[] {
	const buffers = new Set<Transferable>();
	for (const resident of job.source.staticResidents) {
		for (const part of resident.presentation.parts) {
			addTransferable(buffers, part.geometry.positions.buffer);
			addTransferable(buffers, part.geometry.normals.buffer);
			addTransferable(buffers, part.geometry.textureCoordinates.buffer);
			addTransferable(buffers, part.geometry.indices.buffer);
			addTransferable(buffers, part.geometry.materialSlotIndices.buffer);
			addTransferable(buffers, part.geometry.materialWrapModes.buffer);
			addTransferable(buffers, part.geometry.materialSideKinds.buffer);
			addTransferable(buffers, part.geometry.materialSideTypes.buffer);
			addTransferable(buffers, part.geometry.materialStippling.buffer);
		}
	}
	return [...buffers];
}

function addTransferable(target: Set<Transferable>, buffer: ArrayBufferLike): void {
	if (!(buffer instanceof ArrayBuffer)) {
		throw new Error("Building worker inputs must use transferable ArrayBuffers.");
	}
	target.add(buffer);
}

function hydrateGeometryResult(result: BuildingGeometryResult): BuildingGeometryResult {
	const bounds = new AABB3(
		new Vec3(result.bounds.min.x, result.bounds.min.y, result.bounds.min.z),
		new Vec3(result.bounds.max.x, result.bounds.max.y, result.bounds.max.z),
	);
	return {
		...result,
		bounds,
		ranges: result.ranges.map((range) => ({
			...range,
			transparentSort:
				range.transparentSort === null
					? null
					: {
						...range.transparentSort,
						center: new Vec3(
							range.transparentSort.center.x,
							range.transparentSort.center.y,
							range.transparentSort.center.z,
						),
					},
		})),
	};
}
