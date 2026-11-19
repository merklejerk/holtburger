/** Signed edge proximity on one axis; short viewports keep non-overlapping bands. */
export function dragEdgeScrollFactor(
	pointer: number,
	start: number,
	end: number,
	edgeWidth: number,
): number {
	const edge = Math.min(edgeWidth, (end - start) / 2);
	if (edge <= 0 || pointer < start || pointer > end) return 0;
	return (
		Math.max(0, 1 - (end - pointer) / edge) -
		Math.max(0, 1 - (pointer - start) / edge)
	);
}
