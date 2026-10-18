import type { RecallDestination } from "./client-host-contract";

/** App-owned retail recall spellings; core owns destination eligibility and execution. */
export function parseRecallCommand(text: string): RecallDestination | null {
	const command = text.trim();
	if (!command.startsWith("@") && !command.startsWith("/")) return null;
	const [verb, ...args] = command.slice(1).toLowerCase().split(/\s+/);
	let destination: RecallDestination;
	switch (verb) {
		case "lifestone":
		case "lif":
		case "ls":
			destination = "lifestone";
			break;
		case "marketplace":
		case "mar":
		case "mp":
			destination = "marketplace";
			break;
		case "pkarena":
		case "pka":
			destination = "pk-arena";
			break;
		case "pklarena":
		case "pla":
			destination = "pk-lite-arena";
			break;
		case "hor":
		case "hr":
			destination = "house";
			break;
		case "hom":
		case "hoa":
			destination = "allegiance-housing";
			break;
		case "house":
		case "hou":
			switch (args.shift()) {
				case "recall":
				case "re":
					destination = "house";
					break;
				case "mansion_recall":
				case "alleg_recall":
				case "ma":
					destination = "allegiance-housing";
					break;
				default:
					return null;
			}
			break;
		case "allegiance":
		case "all":
			// Retail DoAllegiance dispatches hometown without checking trailing arguments
			// (acclient.c:404233–404245), as did the previous shared parser.
			return ["hometown", "ho"].includes(args[0] ?? "")
				? "allegiance-hometown"
				: null;
		default:
			return null;
	}
	if (args.length > 0)
		throw new Error("Recall commands do not accept extra arguments");
	return destination;
}

/** Consume recognized recalls before ordinary speech; errors remain local to chat UI. */
export async function runRecallCommand(
	text: string,
	recall: (destination: RecallDestination) => Promise<void>,
): Promise<boolean> {
	const destination = parseRecallCommand(text);
	if (destination === null) return false;
	await recall(destination);
	return true;
}
