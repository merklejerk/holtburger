import { CLIENT_GRAPHICS_DEFAULTS } from "../../client/client-settings-policy";
import { CLIENT_TUNING } from "../../client/client-tuning";
import { createCameraRotationRadians } from "../../lib/game/math/camera-orientation";
import type { Camera } from "../../lib/game/runtime/types";
import type { FrameSelectionMetrics } from "../../lib/game/renderer/renderer";
import {
	runPortalTraversalInvestigation,
	settlePortalFrames,
} from "./portal-traversal-investigation";

/** Only the existing browser operations needed to replay the reported Facility Hub poses. */
interface CoverageProbeApi {
	state(): {
		readonly camera:
			| (Pick<Camera, "fov" | "near" | "far"> & {
					readonly landblockId: string;
					readonly envCellId: string | null;
					readonly position: readonly [number, number, number];
					readonly yawDegrees: number;
					readonly pitchDegrees: number;
			  })
			| null;
		readonly metrics: FrameSelectionMetrics | null;
	};
	setEnvCellCameraProjection(
		cell: string,
		position: readonly [number, number, number],
		yaw: number,
		pitch: number,
		projection: Pick<Camera, "fov" | "near" | "far">,
	): void;
	portalProbeContainsPoint(
		cell: string,
		position: readonly [number, number, number],
	): boolean | null;
}

/** Saved user inputs; quaternion components were reported rounded to four decimal places. */
const POSES = [
	{
		name: "missing",
		cell: "0x8a0201c8",
		position: [26556.624, 2.634, -310.044],
		quaternion: [0.9997, 0.016, -0.0202, 0.0003],
	},
	{
		name: "visible",
		cell: "0x8a0201c9",
		position: [26556.553, 5.208, -308.627],
		quaternion: [0.9551, -0.2954, -0.0212, -0.0066],
	},
] as const;

/** Work-count proof only: no screenshots, profiling, or hardware timing assertions. */
export async function runStaticCellCoverageProbe(api: CoverageProbeApi) {
	const initial = api.state().camera;
	if (
		initial === null ||
		initial.landblockId !== "0x8a02ffff" ||
		initial.envCellId === null
	) {
		throw new Error(
			"Static coverage probe requires an interior camera in resident Facility Hub content.",
		);
	}
	const clientProjection = {
		fov: CLIENT_GRAPHICS_DEFAULTS.verticalFovDegrees,
		near: CLIENT_TUNING.camera.near,
		far: CLIENT_TUNING.camera.far,
	};
	const projectionCases = [
		{
			name: "harness",
			projection: { fov: initial.fov, near: initial.near, far: initial.far },
		},
		{
			name: "client-default",
			projection: clientProjection,
		},
	];
	const capture = () => {
		const state = api.state();
		if (state.camera === null || state.metrics === null)
			throw new Error("Static coverage frame is unavailable.");
		const traversal = runPortalTraversalInvestigation();
		if (
			!traversal.queriedStaticNodesByScope.some((s) => s.scope === "0x8a0201c9")
		)
			throw new Error("Static coverage lost the reported staircase batch.");
		if (traversal.lostScopes.length !== 0)
			throw new Error("Static coverage lost reference portal scopes.");
		return { camera: state.camera, metrics: state.metrics, traversal };
	};
	const cases = [];
	try {
		for (const { name, projection } of projectionCases) {
			for (const pose of POSES) {
				const orientation = reportedOrientation(pose.quaternion);
				api.setEnvCellCameraProjection(
					pose.cell,
					pose.position,
					orientation.yawDegrees,
					orientation.pitchDegrees,
					projection,
				);
				await settlePortalFrames();
				const evidence = capture();
				cases.push({
					pose: pose.name,
					projection: name,
					reportedQuaternion: pose.quaternion,
					orientation,
					...evidence,
				});
			}
		}
		const from = POSES[0],
			to = POSES[1];
		const fromLook = reportedOrientation(from.quaternion),
			toLook = reportedOrientation(to.quaternion);
		const transition = [];
		for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) {
			const interpolate = (a: number, b: number) => a + (b - a) * fraction;
			const position = [
				interpolate(from.position[0], to.position[0]),
				interpolate(from.position[1], to.position[1]),
				interpolate(from.position[2], to.position[2]),
			] as const;
			const cells = [from.cell, to.cell].filter(
				(cell) => api.portalProbeContainsPoint(cell, position) === true,
			);
			if (cells.length !== 1)
				throw new Error(
					`Static coverage transition has ${cells.length} containing cells.`,
				);
			api.setEnvCellCameraProjection(
				cells[0]!,
				position,
				interpolate(fromLook.yawDegrees, toLook.yawDegrees),
				interpolate(fromLook.pitchDegrees, toLook.pitchDegrees),
				clientProjection,
			);
			await settlePortalFrames();
			const evidence = capture();
			transition.push({ fraction, ...evidence });
		}
		return { cases, transition };
	} finally {
		api.setEnvCellCameraProjection(
			initial.envCellId,
			initial.position,
			initial.yawDegrees,
			initial.pitchDegrees,
			{ far: initial.far, fov: initial.fov, near: initial.near },
		);
		await settlePortalFrames();
	}
}

/** Renderer yaw has the inverse quaternion Y sign; verify the omitted roll against input rounding. */
function reportedOrientation(raw: readonly [number, number, number, number]) {
	const [w, x, y] = raw;
	const yaw = -2 * Math.atan2(y, w),
		pitch = 2 * Math.atan2(x, w);
	const q = createCameraRotationRadians(yaw, pitch);
	const reconstructed = [q.w, q.x, q.y, q.z];
	const magnitude = Math.hypot(...raw);
	const maximumComponentError = Math.max(
		...raw.map((value, i) => Math.abs(value / magnitude - reconstructed[i]!)),
	);
	if (maximumComponentError > 10 ** -4)
		throw new Error(
			"Reported camera rotation has more than rounded roll error.",
		);
	return {
		yawDegrees: (yaw * 180) / Math.PI,
		pitchDegrees: (pitch * 180) / Math.PI,
		reconstructed,
		maximumComponentError,
	};
}
