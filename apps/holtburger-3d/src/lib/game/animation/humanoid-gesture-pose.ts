import type { HumanoidBodyLayout } from "./humanoid-body-layout";
import {
	createRotationMat4,
	inverseTransformRigidPoint3,
	multiplyMat4,
	quaternionFromRotationMat4,
} from "../math/matrices";
import { type Mat4, Quat, Vec3 } from "../math/types";
import { interpolateRigidTransform } from "./animation-playback";

/**
 * Attach the gesture upper body to the moving pelvis, then turn the chest toward locomotion.
 * Player parts are object-relative: every upper part receives the same chest correction so
 * shoulders, hands and head retain their gesture-relative arrangement instead of separating.
 * The verified layout assigns every part, including the non-contiguous lower-body extras.
 *
 * RETAIL DIVERGENCE: CPartArray::UpdateParts (acclient.c:314107–314135) uses one sequence's
 * part frames. This frontend composes independent gesture/locomotion poses, preserving their
 * clocks, world collision, and existing hook ownership. Reverting restores the full-body
 * gesture sliding during independent movement. CharGen/SetupModel census (2026-09-16): all
 * 22 humanoid gender entries share these groups; the four Olthoi entries are excluded.
 * The user visually evaluated casting while moving; this policy changes presentation only.
 */
export function composeHumanoidGesturePose(
	gesture: readonly Mat4[],
	locomotion: readonly Mat4[],
	layout: HumanoidBodyLayout,
	chestLocomotionWeight: number,
): readonly Mat4[] {
	if (
		gesture.length !== layout.partSources.length ||
		locomotion.length !== layout.partSources.length
	)
		throw new Error(
			"Humanoid composition requires two complete poses matching the layout.",
		);
	const gesturePelvis = gesture[layout.pelvisPart];
	const movingPelvis = locomotion[layout.pelvisPart];
	const gestureChest = gesture[layout.chestPart];
	const movingChest = locomotion[layout.chestPart];
	if (!gesturePelvis || !movingPelvis || !gestureChest || !movingChest)
		throw new Error(
			"Player body blending requires pelvis and chest poses on both tracks.",
		);
	const pelvisCorrection = multiplyMat4(
		movingPelvis,
		inverseRigidPose(gesturePelvis),
	);
	const alignedChest = multiplyMat4(pelvisCorrection, gestureChest);
	const chestPosition = new Vec3(
		alignedChest.m41,
		alignedChest.m42,
		alignedChest.m43,
	);
	const blendedChest = interpolateRigidTransform(
		{
			translation: chestPosition,
			rotation: quaternionFromRotationMat4(alignedChest),
		},
		{
			translation: chestPosition,
			rotation: quaternionFromRotationMat4(movingChest),
		},
		chestLocomotionWeight,
	);
	// Map directly from the original gesture chest to its aligned/blended destination. Applying
	// this once per upper part includes pelvis alignment without double-applying that correction.
	const upperBodyCorrection = multiplyMat4(
		blendedChest,
		inverseRigidPose(gestureChest),
	);
	return layout.partSources.map((source, index) => {
		const part = source === "locomotion" ? locomotion[index] : gesture[index];
		if (!part)
			throw new Error(`Humanoid composition is missing part ${index}.`);
		return source === "locomotion"
			? part
			: multiplyMat4(upperBodyCorrection, part);
	});
}

/** Invert a rigid sampled pose; animation part matrices carry no model scale. */
function inverseRigidPose(pose: Mat4): Mat4 {
	const rotation = quaternionFromRotationMat4(pose);
	const inverse = createRotationMat4(
		new Quat(rotation.w, -rotation.x, -rotation.y, -rotation.z),
	);
	const translation = inverseTransformRigidPoint3(pose, Vec3.zero());
	inverse.m41 = translation.x;
	inverse.m42 = translation.y;
	inverse.m43 = translation.z;
	return inverse;
}
