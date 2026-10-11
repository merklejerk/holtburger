/** Presentation shared by the inventory readout and HUD warning; gameplay stays world-owned. */
export interface ClientBurdenPresentation {
	/** Retail warning bands, also consumed by inventory theme selectors. */
	readonly level: "pending" | "normal" | "burdened" | "overburdened";
	/** Display percentage, or an ellipsis while the world ratio is unknown. */
	readonly percent: string;
	/** Only encumbered characters have a HUD warning. */
	readonly warning: {
		/** Accessible severity name, independent of color. */
		readonly label: string;
		/** Current extent, movement consequences, and recovery thresholds. */
		readonly tooltip: string;
	} | null;
}

/** Retail HUD thresholds: acclient.c:266761; movement effects: 678658 and 423433. */
export function presentClientBurden(
	burden: number | null,
): ClientBurdenPresentation {
	if (burden === null) return { level: "pending", percent: "…", warning: null };
	const percent = `${Math.round(burden * 100)}%`;
	if (burden < 1) return { level: "normal", percent, warning: null };
	const heavy = burden >= 2;
	const label = heavy ? "Heavily encumbered" : "Encumbered";
	return {
		level: heavy ? "overburdened" : "burdened",
		percent,
		warning: {
			label,
			tooltip: `${label} — ${percent} burden\n${
				heavy
					? "Normal running bonus suppressed. Cannot jump until below 200%."
					: "Above 100%: reduced running bonus and jump height."
			}\nClick to open Inventory.`,
		},
	};
}
