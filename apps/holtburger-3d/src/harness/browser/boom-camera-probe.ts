import { HostKinematicBoomSession } from "../../lib/game/camera/host-kinematic-boom-session";
import { createProjectionClearanceRevision } from "../../lib/game/camera/projection-clearance";
import { decodeHostKinematicBoomTick } from "../../lib/game/motion/host-kinematic-boom-path";

/** Browser playback proof for a blocked camera chord, independent of local content catalogs. */
export async function probeBoomCameraCorrection() {
	const target = { possessionGeneration: 1, guid: 7, entityGeneration: 1 };
	const identity = { ...target, boomGeneration: 1 };
	const projection = createProjectionClearanceRevision(
		1,
		{ fov: 75, near: 0.1 },
		{ width: 1280, height: 720 },
	);
	const session = new HostKinematicBoomSession({
		async invoke(command) {
			if (command === "start_kinematic_boom") return identity;
			if (command === "stop_kinematic_boom") return true;
			throw new Error(`Unexpected boom probe command: ${command}`);
		},
	});
	const point = (x: number) => ({
		position: { landblockId: 0xda550100, coords: { x, y: 20, z: 3 } },
		visualPivot: { landblockId: 0xda550100, coords: { x: 7, y: 20, z: 3 } },
	});
	const path = (
		sequence: number,
		start: number,
		end: number,
		correction: boolean,
	) =>
		decodeHostKinematicBoomTick(
			{
				...identity,
				sequence,
				kind: correction ? "reseeded" : "advanced",
				...(correction ? { reason: "obstructed-path" } : {}),
				targetSphereRole: "primary",
				clearance: {
					projectionRevision: projection.revision,
					radius: projection.clearanceRadius,
				},
				desiredReach: 4.5,
				renderedReach: end - 7,
				path: {
					initial: point(start),
					legs: [{ endFraction: 1, end: point(end) }],
				},
				diagnostics: {
					collisionProof: { status: "covered" },
					controlLegs: 1,
					clearanceSweeps: 2,
					continuitySweeps: 1,
					contactPasses: 0,
				},
			},
			32,
		);
	await session.start(
		target,
		{ initial: 4.5, minimum: 1.2, maximum: 8 },
		[1, 0, 0],
		projection,
	);
	try {
		session.receive(path(1, 10, 11, false), 32, 100);
		session.receive(path(2, 11, 12, false), 32, 101);
		session.receive(path(3, 9, 9, true), 32, 102);
		const frames = [102, 116, 164].map((time) => {
			const frame = session.presentation(time);
			if (frame === null)
				throw new Error("Camera correction was not presented.");
			if (frame.placement.position.x !== 0xda * 192 + 9) {
				throw new Error("Camera correction retained blocked interpolation.");
			}
			if (frame.placement.residency.envCellId !== "0xda550100") {
				throw new Error("Camera correction lost indoor residency.");
			}
			return {
				time,
				x: frame.placement.position.x,
				cell: frame.placement.residency.envCellId,
			};
		});
		return { frames, status: session.status() };
	} finally {
		await session.stop();
	}
}
