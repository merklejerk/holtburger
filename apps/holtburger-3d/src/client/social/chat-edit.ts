/** Find the native deletion range: selected text, or trailing whitespace and one word. */
export function chatWordDeletionStart(
	text: string,
	start: number,
	end: number,
): number {
	if (start !== end) return start;
	let boundary = start;
	while (boundary > 0 && /\s/u.test(text.charAt(boundary - 1))) boundary--;
	while (boundary > 0 && !/\s/u.test(text.charAt(boundary - 1))) boundary--;
	return boundary;
}
