import { AABB3, Mat4, Vec3 } from "../math/types";
import {
	type StaticObjectGeometryPreparationJob,
	type StaticObjectGeometryPreparationResult,
} from "./static-object-geometry-worker";
import {
	ClosedWorkerClient,
	type ClosedWorkerPort,
} from "../workers/closed-worker";
import { LandblockLayerKind } from "../runtime/scene-interest";

/** Runtime-owned closed geometry worker used by static-layer realization. */
export class StaticObjectGeometryWorker {
	readonly #geometry: ClosedWorkerClient<
		StaticObjectGeometryPreparationJob,
		StaticObjectGeometryPreparationResult | null
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

	async prepare(
		job: StaticObjectGeometryPreparationJob,
	): Promise<StaticObjectGeometryPreparationResult | null> {
		// Dynamic sources remain runtime-owned. Shared definition buffers must survive static
		// worker transfer so a later dynamic materializer still receives a complete resident.
		const runtimeOwnedBuffers =
			job.layer === LandblockLayerKind.EnvCells
				? geometryBuffers([
						...job.source.staticResidents,
						...job.source.dynamicSources,
					])
				: geometryBuffers(job.source.dynamicSources);
		const workerJob: StaticObjectGeometryPreparationJob = {
			...job,
			source: { ...job.source, dynamicSources: [] },
		};
		const result = await this.#geometry.dispatch(
			workerJob,
			geometryInputTransferables(workerJob, runtimeOwnedBuffers),
		);
		return result === null ? null : hydrateGeometryResult(result);
	}

	destroy(): void {
		this.#geometry.destroy();
	}
}

function geometryInputTransferables(
	job: StaticObjectGeometryPreparationJob,
	runtimeOwnedBuffers: ReadonlySet<ArrayBuffer>,
): Transferable[] {
	const buffers = geometryBuffers(job.source.staticResidents);
	return [...buffers].filter((buffer) => !runtimeOwnedBuffers.has(buffer));
}

function geometryBuffers(
	residents: ResolvedGeometryResidents,
): Set<ArrayBuffer> {
	const buffers = new Set<ArrayBuffer>();
	for (const resident of residents) {
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
	return buffers;
}

function addTransferable(
	target: Set<ArrayBuffer>,
	buffer: ArrayBufferLike,
): void {
	if (!(buffer instanceof ArrayBuffer)) {
		throw new Error(
			"Static-object worker inputs must use transferable ArrayBuffers.",
		);
	}
	target.add(buffer);
}

type ResolvedGeometryResidents =
	StaticObjectGeometryPreparationJob["source"]["staticResidents"];

function hydrateGeometryResult(
	result: StaticObjectGeometryPreparationResult,
): StaticObjectGeometryPreparationResult {
	const bounds = new AABB3(
		new Vec3(result.bounds.min.x, result.bounds.min.y, result.bounds.min.z),
		new Vec3(result.bounds.max.x, result.bounds.max.y, result.bounds.max.z),
	);
	return {
		...result,
		bounds,
		drawUnits: result.drawUnits.map((drawUnit) =>
			drawUnit.kind === "instanced" || drawUnit.transparentSort === null
				? drawUnit
				: {
						...drawUnit,
						transparentSort: {
							...drawUnit.transparentSort,
							center: new Vec3(
								drawUnit.transparentSort.center.x,
								drawUnit.transparentSort.center.y,
								drawUnit.transparentSort.center.z,
							),
						},
					},
		),
		frameStreamedInstances: result.frameStreamedInstances.map((template) => ({
			...template,
			instance: {
				...template.instance,
				sourceToLandblock: hydrateMat4(template.instance.sourceToLandblock),
			},
			transparentSort: {
				...template.transparentSort,
				center: new Vec3(
					template.transparentSort.center.x,
					template.transparentSort.center.y,
					template.transparentSort.center.z,
				),
			},
		})),
		instanceStreams: result.instanceStreams.map((stream) => ({
			...stream,
			data: {
				instances: stream.data.instances.map((instance) => ({
					...instance,
					sourceToLandblock: hydrateMat4(instance.sourceToLandblock),
				})),
			},
		})),
	};
}

function hydrateMat4(matrix: Mat4): Mat4 {
	return new Mat4(
		matrix.m11,
		matrix.m12,
		matrix.m13,
		matrix.m14,
		matrix.m21,
		matrix.m22,
		matrix.m23,
		matrix.m24,
		matrix.m31,
		matrix.m32,
		matrix.m33,
		matrix.m34,
		matrix.m41,
		matrix.m42,
		matrix.m43,
		matrix.m44,
	);
}
