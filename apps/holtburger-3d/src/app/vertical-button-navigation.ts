/** Select a vertical list destination; callers retain ownership of button activation. */
export function navigateVerticalButtons(
	event: KeyboardEvent,
	buttons: Iterable<HTMLButtonElement>,
): HTMLButtonElement | null {
	if (!(event.target instanceof HTMLButtonElement)) return null;
	const options = Array.from(buttons).filter(
		(button) =>
			!button.disabled && button.getAttribute("aria-disabled") !== "true",
	);
	const index = options.indexOf(event.target);
	if (index === -1) return null;
	let destination: number;
	switch (event.key) {
		case "ArrowUp":
			destination = (index + options.length - 1) % options.length;
			break;
		case "ArrowDown":
			destination = (index + 1) % options.length;
			break;
		case "Home":
			destination = 0;
			break;
		case "End":
			destination = options.length - 1;
			break;
		default:
			return null;
	}
	event.preventDefault();
	const next = options[destination];
	next.focus();
	return next;
}
