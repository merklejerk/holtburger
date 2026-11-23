/** Pulse on mount and cold identity changes; null keeps empty layout previews still. */
export function hudAttention(
	node: HTMLElement,
	identity: string | number | null,
) {
	const restart = () => {
		// Cancel the old CSS animation without replacing the element or its focused contents.
		node.classList.remove("ui-hud-attention");
		if (identity === null) return;
		void node.offsetWidth;
		node.classList.add("ui-hud-attention");
	};
	restart();
	return {
		update(next: string | number | null) {
			if (next === identity) return;
			identity = next;
			restart();
		},
	};
}
