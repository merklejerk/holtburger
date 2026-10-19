/** Restart the CSS-owned pulse on mount and whenever a cold presentation identity changes. */
export function hudAttention(node: HTMLElement, identity: string) {
	const restart = () => {
		// Cancel the old CSS animation without replacing the focused button or its contents.
		node.classList.remove("ui-hud-attention");
		void node.offsetWidth;
		node.classList.add("ui-hud-attention");
	};
	restart();
	return {
		update(next: string) {
			if (next === identity) return;
			identity = next;
			restart();
		},
	};
}
