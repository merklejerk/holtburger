/** Which track supplies a part before the gesture group's rigid chest correction. */
type BodyPartPoseSource = "locomotion" | "gesture";

/** Verified object-relative humanoid anatomy; independent of current movement or activity. */
export interface HumanoidBodyLayout {
	/** Anchor used to align the gesture with the locomotion pelvis. */
	readonly pelvisPart: number;
	/** Anchor whose rotation is blended, carrying its gesture group with it. */
	readonly chestPart: number;
	/** Complete setup-indexed assignment, including clothing/attachment geometry slots. */
	readonly partSources: readonly BodyPartPoseSource[];
}

/**
 * ACE ClothingTable.GetVisualPriority identifies body parts 0–16. A CharGen/SetupModel census
 * (2026-09-16, local assets.hba) found 34 parts on all 22 humanoid gender entries. The four
 * Olthoi entries instead have 25/31 parts and are unsupported. Setup parent indices assign
 * extras 17–20 to pelvis 0, 25/26 to shins 2/6, and all other extras to upper-body anchors.
 * These are group memberships, not a reconstructed skeleton: animation poses stay object-relative.
 */
export const HUMANOID_BODY_LAYOUT: HumanoidBodyLayout = {
	pelvisPart: 0,
	chestPart: 9,
	partSources: [
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"locomotion",
		"locomotion",
		"locomotion",
		"locomotion",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"locomotion",
		"locomotion",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
		"gesture",
	],
};

/** Authored humanoid parent convention; roots use the DAT's unsigned sentinel. */
const HUMANOID_PARENTS = [
	0xffffffff, 0xffffffff, 1, 2, 3, 0xffffffff, 5, 6, 7, 0, 9, 10, 11, 12, 13,
	14, 15, 0, 17, 18, 19, 16, 16, 9, 9, 2, 6, 10, 13, 9, 29, 30, 31, 32,
] as const;

/** Recognize the actual installed setup, including Tumerok's two alternate upper-body parents. */
export function resolveHumanoidBodyLayout(
	partCount: number,
	parents: readonly number[],
): HumanoidBodyLayout | null {
	if (partCount !== HUMANOID_PARENTS.length || parents.length !== partCount)
		return null;
	const compatible = parents.every(
		(parent, index) =>
			parent === HUMANOID_PARENTS[index] ||
			((index === 13 || index === 16) && parent === 9),
	);
	return compatible ? HUMANOID_BODY_LAYOUT : null;
}

/** Frontend presentation policy, resolved separately from track clocks and hook ownership. */
export type AnimationPoseComposition =
	| { readonly kind: "ordinary" }
	| {
			readonly kind: "humanoid-gesture";
			/** Layout verified when the current visual was installed. */
			readonly layout: HumanoidBodyLayout;
			/** Weight toward locomotion chest rotation, within [0, 1]. */
			readonly chestLocomotionWeight: number;
	  };
