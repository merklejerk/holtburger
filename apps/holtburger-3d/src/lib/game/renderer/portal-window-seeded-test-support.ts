import { Vec2 } from "../math/types";

/** Seed retained by the immutable portal-window property corpus. */
export const PORTAL_WINDOW_GEOMETRY_SEED = 0x5eed;

/** One retained deterministic inherited-window/aperture geometry pair. */
export interface SeededPortalTrianglePair {
	/** Portal aperture triangle applied to the inherited window. */
	readonly aperture: readonly Vec2[];
	/** Incoming scope-window triangle. */
	readonly inherited: readonly Vec2[];
}

/** Recreate the retained immutable geometry inputs for differential consumers. */
export function seededPortalTrianglePairs(
	seed: number,
	count: number,
): readonly SeededPortalTrianglePair[] {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(
			"Seeded portal triangle count must be a non-negative integer.",
		);
	}
	const random = seededRandom(seed);
	return Array.from({ length: count }, () => {
		const inherited = randomTriangle(random);
		const aperture = randomTriangle(random);
		return { aperture, inherited };
	});
}

/** Deterministic LCG used only to construct replayable test inputs. */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function randomTriangle(random: () => number): readonly Vec2[] {
	for (;;) {
		const triangle = [
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
		];
		if (Math.abs(signedArea(triangle)) > 0.05) return triangle;
	}
}

function signedArea(vertices: readonly Vec2[]): number {
	return (
		(vertices[0]!.x * (vertices[1]!.y - vertices[2]!.y) +
			vertices[1]!.x * (vertices[2]!.y - vertices[0]!.y) +
			vertices[2]!.x * (vertices[0]!.y - vertices[1]!.y)) /
		2
	);
}
