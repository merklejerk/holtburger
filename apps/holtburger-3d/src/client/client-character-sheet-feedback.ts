import { formatQuantity } from "../app/quantity-format";
import type {
	ProgressionRejection,
	ProgressionUnavailable,
} from "./client-character-sheet-contract";

/** Readable availability shared by purchase controls and rejected-action warnings. */
export function progressionUnavailableReason(
	value: ProgressionUnavailable,
): string {
	if (value === "AwaitingTargetUpdate")
		return "Awaiting a server update for this stat";
	if (value === "CharacterNotReady")
		return "The character must finish entering the world before purchasing upgrades";
	const world = value.World;
	if (typeof world === "object") {
		if ("InsufficientXp" in world)
			return `Requires ${formatQuantity(world.InsufficientXp.required)} XP; ${formatQuantity(BigInt(world.InsufficientXp.available))} available`;
		return `Requires ${world.InsufficientCredits.required} skill credits; ${world.InsufficientCredits.available} available`;
	}
	switch (world) {
		case "CharacterUnavailable":
			return "Character details are unavailable";
		case "TargetUnavailable":
			return "This stat is unavailable";
		case "NotTrainable":
			return "This skill cannot be trained";
		case "AlreadyTrained":
			return "Already trained";
		case "SkillNotTrained":
			return "Train this skill first";
		case "InvalidRankCount":
			return "The requested number of ranks is invalid";
		case "RankCap":
			return "Rank cap reached";
		case "InconsistentExperience":
			return "This stat's experience does not match its purchased ranks";
	}
}

/** Explain admission failures without exposing wire enum names or serialized objects. */
export function progressionRejectionReason(
	value: ProgressionRejection,
): string {
	if (typeof value === "object")
		return progressionUnavailableReason({ World: value.Unavailable });
	switch (value) {
		case "CharacterNotReady":
		case "AwaitingTargetUpdate":
			return progressionUnavailableReason(value);
		case "WrongScope":
			return "This quote belongs to an earlier character session";
		case "WrongCharacter":
			return "This quote belongs to a different character";
		case "StaleQuote":
			return "The purchase cost or character stats changed; please try again";
	}
}
