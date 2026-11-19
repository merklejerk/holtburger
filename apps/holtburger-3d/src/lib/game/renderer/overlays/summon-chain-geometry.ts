/** A small tubular oval link, generated once and reused by instanced chain draws. */
export function createSummonChainLink(): Float32Array {
	const ringSegments = 16;
	const tubeSegments = 6;
	const vertices: number[] = [];
	const vertex = (ring: number, tube: number) => {
		const a = (ring * Math.PI * 2) / ringSegments;
		const b = (tube * Math.PI * 2) / tubeSegments;
		const radius = 0.13 * Math.cos(b);
		vertices.push(
			(1 + radius) * Math.cos(a),
			(0.55 + radius) * Math.sin(a),
			0.13 * Math.sin(b),
		);
	};
	for (let ring = 0; ring < ringSegments; ring++) {
		for (let tube = 0; tube < tubeSegments; tube++) {
			vertex(ring, tube);
			vertex(ring + 1, tube);
			vertex(ring + 1, tube + 1);
			vertex(ring, tube);
			vertex(ring + 1, tube + 1);
			vertex(ring, tube + 1);
		}
	}
	return new Float32Array(vertices);
}
