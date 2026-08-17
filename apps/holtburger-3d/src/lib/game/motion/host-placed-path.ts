/** One host-authored placed path leg ending at an authoritative point. */
interface HostPlacedPathLeg<Point> {
	/** Strictly increasing normalized fixed-tick fraction in `(0, 1]`. */
	readonly endFraction: number;
	/** Point and placement facts that become authoritative at this boundary. */
	readonly end: Point;
}

/** Source-neutral nonempty placed path through one fixed host tick. */
export interface HostPlacedPath<Point> {
	/** Authoritative point at normalized fraction zero. */
	readonly initial: Point;
	/** Nonempty placed geometry ending at normalized fraction one. */
	readonly legs: readonly HostPlacedPathLeg<Point>[];
}

/** Point-specific presentation operations applied by the source-neutral path evaluator. */
export interface HostPlacedPathPresenter<Point, Presentation> {
	/** Interpolate inside one half-open placement-stable leg. */
	interpolate(start: Point, end: Point, fraction: number): Presentation;
	/** Present one exact authoritative path boundary. */
	present(point: Point): Presentation;
}

/** Evaluates one validated host path without extending it or reclassifying placement. */
export function evaluateHostPlacedPath<Point, Presentation>(
	path: HostPlacedPath<Point>,
	durationMs: number,
	elapsedMs: number,
	presenter: HostPlacedPathPresenter<Point, Presentation>,
): Presentation {
	validateHostPlacedPath(path, durationMs);
	const progress = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
	let start = path.initial;
	let startFraction = 0;
	for (const leg of path.legs) {
		if (progress < leg.endFraction) {
			const localProgress =
				(progress - startFraction) / (leg.endFraction - startFraction);
			return presenter.interpolate(start, leg.end, localProgress);
		}
		if (progress === leg.endFraction) return presenter.present(leg.end);
		start = leg.end;
		startFraction = leg.endFraction;
	}
	return presenter.present(start);
}

/** Rejects incoherent duration/fraction structure before any point-specific presentation occurs. */
export function validateHostPlacedPath<Point>(
	path: HostPlacedPath<Point>,
	durationMs: number,
): void {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error("Host placed-path duration must be positive and finite.");
	}
	validateHostPlacedPathShape(path);
}

/** Validate nonempty normalized leg structure independently from playback duration. */
export function validateHostPlacedPathShape<Point>(
	path: HostPlacedPath<Point>,
): void {
	if (path.legs.length === 0) {
		throw new Error("Host placed path must contain at least one leg.");
	}
	let previous = 0;
	for (const leg of path.legs) {
		if (
			!Number.isFinite(leg.endFraction) ||
			leg.endFraction <= previous ||
			leg.endFraction > 1
		) {
			throw new Error(
				"Host placed-path fractions must increase through (0, 1].",
			);
		}
		previous = leg.endFraction;
	}
	if (previous !== 1) {
		throw new Error("Host placed path must end at tick fraction one.");
	}
}
