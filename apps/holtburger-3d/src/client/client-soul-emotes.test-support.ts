import { ClientSoulEmotes } from "./client-soul-emotes";

/** Synthetic content has aliases, a state pose, uppercase motion, and a chat-only gesture. */
export function soulEmoteFixture(): ClientSoulEmotes {
	return new ClientSoulEmotes([
		{
			id: "wave",
			pose: "Wave",
			aliases: ["hello", "hi", "wave"],
			myEmote: "You wave.",
			otherEmote: "waves.",
		},
		{
			id: "bowdeepstate",
			pose: "BowDeepState",
			aliases: ["bow", "bow deep"],
			myEmote: "You bow deeply.",
			otherEmote: "bows deeply.",
		},
		{
			id: "warmhands",
			pose: "WARMHANDS",
			aliases: ["warm hands"],
			myEmote: "You warm your hands.",
			otherEmote: "warms %p hands.",
		},
		{
			id: "shiver",
			pose: "Shiver",
			aliases: ["brrr", "shiver"],
			myEmote: "You shiver.",
			otherEmote: "shivers.",
		},
	]);
}
