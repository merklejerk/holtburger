import { AABB3, Vec3 } from "../math/types";
import {
	type StaticObjectGeometryJob,
	type StaticObjectGeometryResult,
} from "./static-object-geometry-worker";
import {
	ClosedWorkerClient,
	type ClosedWorkerPort,
} from "../workers/closed-worker";

/** Runtime-owned closed geometry worker used by static-layer realization. */
export class StaticObjectGeometryWorker {
	readonly #geometry: ClosedWorkerClient<
		StaticObjectGeometryJob,
		StaticObjectGeometryResult | null
	>;

	constructor(options: {
		readonly createGeometryWorker: () => ClosedWorkerPort;
	}) {
		this.#geometry = new ClosedWorkerClient(options.createGeometryWorker());
	}

	static build(): StaticObjectGeometryWorker {
		return new StaticObjectGeometryWorker({
			createGeometryWorker: () =>
				new Worker(
					new URL("./static-object-geometry-worker.entry.ts", import.meta.url),
					{
						type: "module",
					},
				) as unknown as ClosedWorkerPort,
		});
	}

	async bake(
		job: StaticObjectGeometryJob,
	): Promise<StaticObjectGeometryResult | null> {
		const result = await this.#geometry.dispatch(
			job,
			geometryInputTransferables(job),
		);
		return result === null ? null : hydrateGeometryResult(result);
	}

	destroy(): void {
		this.#geometry.destroy();
	}
}

function geometryInputTransferables(
	job: StaticObjectGeometryJob,
): Transferable[] {
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

function addTransferable(
	target: Set<Transferable>,
	buffer: ArrayBufferLike,
): void {
	if (!(buffer instanceof ArrayBuffer)) {
		throw new Error(
			"Static-object worker inputs must use transferable ArrayBuffers.",
		);
	}
	target.add(buffer);
}

function hydrateGeometryResult(
	result: StaticObjectGeometryResult,
): StaticObjectGeometryResult {
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
