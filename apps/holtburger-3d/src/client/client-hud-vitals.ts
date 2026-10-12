/** Shared player/party display order and labels; wire vital tuple order remains independent. */
export const CLIENT_HUD_VITALS = [
	{ kind: "health", label: "Health" },
	{ kind: "mana", label: "Mana" },
	{ kind: "stamina", label: "Stamina" },
] as const;
