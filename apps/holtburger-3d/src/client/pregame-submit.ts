/** Submit the page's primary form while preserving unrelated controls' native Enter behavior. */
export function submitPregameOnEnter(
	event: KeyboardEvent,
	button: HTMLButtonElement | undefined,
	selectionTarget: boolean,
): void {
	if (
		event.key !== "Enter" ||
		event.defaultPrevented ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		button === undefined ||
		!(event.target instanceof HTMLElement)
	)
		return;
	const target = event.target;
	const credential =
		target instanceof HTMLInputElement &&
		target.form === button.form &&
		(target.type === "text" || target.type === "password");
	if (
		!selectionTarget &&
		target !== button &&
		!credential &&
		target.closest(
			"button, input, select, option, textarea, a, summary, [tabindex], [role], [contenteditable]:not([contenteditable=false])",
		) !== null
	)
		return;
	// Suppress native implicit submission and button clicks, including held-key repeats.
	event.preventDefault();
	if (!event.repeat && !button.disabled) button.form?.requestSubmit(button);
}
