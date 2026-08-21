import type { SceneVec3 } from "../../assets/ac-frame";
import type { EnvCellId } from "../game-types";
import type { Vec3 } from "../math/types";

/** One sphere sweep against static collision, in canonical scene axes. */
export interface BoomSweepRequest {
	readonly origin: SceneVec3;
	/** Interior cell containing `origin`, or `null` while outdoors. */
	readonly envCellId: EnvCellId | null;
	readonly direction: Vec3;
	readonly distance: number;
	readonly radius: number;
}

/** Injectable static-collision query used by app and browser-host boom adapters. */
export interface BoomSweepSource {
	sweep(request: BoomSweepRequest): Promise<number>;
}

/** Lossless plain-data request shared by Tauri and harness transport adapters. */
export function boomSweepWireRequest(request: BoomSweepRequest) {
	return {
		direction: [request.direction.x, request.direction.y, request.direction.z],
		distance: request.distance,
		envCellId: request.envCellId,
		origin: [request.origin.x, request.origin.y, request.origin.z],
		radius: request.radius,
	};
}
