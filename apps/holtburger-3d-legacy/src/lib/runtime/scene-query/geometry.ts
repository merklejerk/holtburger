import type { StaticBounds } from "../../static/contracts";
import type { StaticSceneRay, Vec3 } from "./contracts";

interface BvhNodeLike {
	readonly bounds: StaticBounds;
	readonly itemIndices: readonly number[];
	readonly left: number | null;
	readonly right: number | null;
}

export interface BvhCandidate {
	readonly distance: number;
	readonly itemIndices: readonly number[];
	readonly nodeIndex: number;
}

export function normalizeRay(ray: StaticSceneRay): StaticSceneRay {
	return {
		direction: normalizeVec3(ray.direction),
		origin: ray.origin,
	};
}

export function intersectRayBounds(
	ray: StaticSceneRay,
	bounds: StaticBounds,
): number | null {
	let tMin = Number.NEGATIVE_INFINITY;
	let tMax = Number.POSITIVE_INFINITY;

	for (const axis of ["x", "y", "z"] as const) {
		const origin = ray.origin[axis];
		const direction = ray.direction[axis];
		const min = bounds.min[axis];
		const max = bounds.max[axis];

		if (Math.abs(direction) < 1e-8) {
			if (origin < min || origin > max) {
				return null;
			}
			continue;
		}

		const inverse = 1 / direction;
		const t1 = (min - origin) * inverse;
		const t2 = (max - origin) * inverse;
		tMin = Math.max(tMin, Math.min(t1, t2));
		tMax = Math.min(tMax, Math.max(t1, t2));

		if (tMin > tMax) {
			return null;
		}
	}

	if (tMax < 0) {
		return null;
	}

	return Math.max(tMin, 0);
}

export function containsPoint(bounds: StaticBounds, point: Vec3): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

export function boundsCenterDistanceSquared(
	bounds: StaticBounds,
	point: Vec3,
): number {
	const center = {
		x: (bounds.min.x + bounds.max.x) * 0.5,
		y: (bounds.min.y + bounds.max.y) * 0.5,
		z: (bounds.min.z + bounds.max.z) * 0.5,
	};
	const dx = center.x - point.x;
	const dy = center.y - point.y;
	const dz = center.z - point.z;
	return dx * dx + dy * dy + dz * dz;
}

export function pointOnRay(ray: StaticSceneRay, distance: number): Vec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
}

export function translateRay(
	ray: StaticSceneRay,
	translation: readonly [number, number, number],
): StaticSceneRay {
	return {
		direction: ray.direction,
		origin: {
			x: ray.origin.x + translation[0],
			y: ray.origin.y + translation[1],
			z: ray.origin.z + translation[2],
		},
	};
}

export function translatePoint(
	point: Vec3,
	translation: readonly [number, number, number],
): Vec3 {
	return {
		x: point.x + translation[0],
		y: point.y + translation[1],
		z: point.z + translation[2],
	};
}

export function negateTranslation(
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [-translation[0], -translation[1], -translation[2]];
}

export function translateBounds(
	bounds: StaticBounds,
	translation: readonly [number, number, number],
): StaticBounds {
	return {
		max: {
			x: bounds.max.x + translation[0],
			y: bounds.max.y + translation[1],
			z: bounds.max.z + translation[2],
		},
		min: {
			x: bounds.min.x + translation[0],
			y: bounds.min.y + translation[1],
			z: bounds.min.z + translation[2],
		},
	};
}

export function unionBounds(
	left: StaticBounds,
	right: StaticBounds,
): StaticBounds {
	return {
		max: {
			x: Math.max(left.max.x, right.max.x),
			y: Math.max(left.max.y, right.max.y),
			z: Math.max(left.max.z, right.max.z),
		},
		min: {
			x: Math.min(left.min.x, right.min.x),
			y: Math.min(left.min.y, right.min.y),
			z: Math.min(left.min.z, right.min.z),
		},
	};
}

function normalizeVec3(vector: Vec3): Vec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: -1 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

export function traverseBvhNearest(
	nodes: readonly BvhNodeLike[],
	ray: StaticSceneRay,
	options: {
		readonly getMaxDistance: () => number | null;
		readonly visitCandidate: (candidate: BvhCandidate) => void;
	},
): void {
	if (nodes.length === 0) {
		return;
	}

	const root = nodes[0];
	if (!root) {
		return;
	}
	const rootDistance = intersectRayBounds(ray, root.bounds);
	if (rootDistance === null) {
		return;
	}

	const pending: BvhCandidate[] = [
		{ distance: rootDistance, itemIndices: [], nodeIndex: 0 },
	];
	while (pending.length > 0) {
		pending.sort(
			(left, right) =>
				right.distance - left.distance || right.nodeIndex - left.nodeIndex,
		);
		const candidate = pending.pop();
		if (!candidate) {
			continue;
		}
		const maxDistance = options.getMaxDistance();
		if (maxDistance !== null && candidate.distance > maxDistance) {
			continue;
		}

		const node = nodes[candidate.nodeIndex];
		if (!node) {
			continue;
		}
		if (node.itemIndices.length > 0) {
			options.visitCandidate({
				distance: candidate.distance,
				itemIndices: node.itemIndices,
				nodeIndex: candidate.nodeIndex,
			});
		}
		for (const childIndex of [node.left, node.right]) {
			if (childIndex === null) {
				continue;
			}
			const child = nodes[childIndex];
			if (!child) {
				continue;
			}
			const childDistance = intersectRayBounds(ray, child.bounds);
			const updatedMaxDistance = options.getMaxDistance();
			if (
				childDistance === null ||
				(updatedMaxDistance !== null && childDistance > updatedMaxDistance)
			) {
				continue;
			}
			pending.push({
				distance: childDistance,
				itemIndices: [],
				nodeIndex: childIndex,
			});
		}
	}
}

export function traverseBvhPoint(
	nodes: readonly BvhNodeLike[],
	point: Vec3,
): readonly BvhCandidate[] {
	if (nodes.length === 0) {
		return [];
	}

	const candidates: BvhCandidate[] = [];
	const stack = [0];
	while (stack.length > 0) {
		const nodeIndex = stack.pop() ?? 0;
		const node = nodes[nodeIndex];
		if (!node || !containsPoint(node.bounds, point)) {
			continue;
		}

		if (node.itemIndices.length > 0) {
			candidates.push({
				distance: boundsCenterDistanceSquared(node.bounds, point),
				itemIndices: node.itemIndices,
				nodeIndex,
			});
		}
		if (node.right !== null) {
			stack.push(node.right);
		}
		if (node.left !== null) {
			stack.push(node.left);
		}
	}

	return candidates.sort(
		(left, right) =>
			left.distance - right.distance || left.nodeIndex - right.nodeIndex,
	);
}
