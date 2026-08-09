import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import type { ScenePortalCrossingInput } from "../scene";
import { PORTAL_QUERY_EPSILON } from "../scene/planar-aperture";
import {
	portalArrivalPlaneContainsBeyondPoint,
	portalArrivalPlaneDistance,
	writeOrientedPortalArrivalPlane,
} from "./portal-arrival-metadata";

const LEMMA_CASE_COUNT = 2_048;
const SAMPLE_PARAMETERS = [0, 0.5, 1, 1.5, 3] as const;

describe("portal arrival metadata", () => {
	it("orients translated planes toward the directed target half-space", () => {
		const metadata = new Float32Array(4);
		const plane = { d: -2, normal: new Vec3(1, 0, 0) };

		writeOrientedPortalArrivalPlane(metadata, 0, plane, "positive", 10, -5);

		expect(Array.from(metadata)).toEqual([-1, -0, -0, 12]);
		expect(portalArrivalPlaneContainsBeyondPoint(metadata, 0, 11, 0, 0)).toBe(
			true,
		);
		expect(portalArrivalPlaneContainsBeyondPoint(metadata, 0, 13, 0, 0)).toBe(
			false,
		);
	});

	it("is equivalent to strict ray order across deterministic plane and camera cases", () => {
		const random = deterministicRandom(0xa771_9a1e);
		const metadata = new Float32Array(4);
		for (let caseIndex = 0; caseIndex < LEMMA_CASE_COUNT; caseIndex += 1) {
			const normal = randomUnitVector(random);
			const localPlanePoint = randomPoint(random, 20);
			const plane = {
				d: -dot(normal, localPlanePoint),
				normal,
			};
			const acceptedSide: ScenePortalCrossingInput["acceptedSide"] =
				caseIndex % 2 === 0 ? "positive" : "negative";
			const sourceDirection = acceptedSide === "positive" ? 1 : -1;
			const offsetX = integer(random, -4, 4) * 192;
			const offsetZ = integer(random, -4, 4) * 192;
			const planePoint = new Vec3(
				localPlanePoint.x + offsetX,
				localPlanePoint.y,
				localPlanePoint.z + offsetZ,
			);
			const cameraDistance = scalar(random, 1, 20);
			const camera = addScaled(
				planePoint,
				normal,
				sourceDirection * cameraDistance,
			);
			const crossingPoint = addTangentOffset(planePoint, normal, random);
			writeOrientedPortalArrivalPlane(
				metadata,
				0,
				plane,
				acceptedSide,
				offsetX,
				offsetZ,
			);

			for (const parameter of SAMPLE_PARAMETERS) {
				const sample = interpolate(camera, crossingPoint, parameter);
				const distance = portalArrivalPlaneDistance(
					metadata,
					0,
					sample.x,
					sample.y,
					sample.z,
				);
				if (parameter < 1) {
					expect(
						distance,
						`source case ${caseIndex}/${parameter}`,
					).toBeLessThan(-PORTAL_QUERY_EPSILON);
					expect(
						portalArrivalPlaneContainsBeyondPoint(
							metadata,
							0,
							sample.x,
							sample.y,
							sample.z,
						),
					).toBe(false);
				} else if (parameter === 1) {
					expect(
						Math.abs(distance),
						`plane case ${caseIndex}/${parameter}`,
					).toBeLessThan(0.000_2);
				} else {
					expect(
						distance,
						`target case ${caseIndex}/${parameter}`,
					).toBeGreaterThan(PORTAL_QUERY_EPSILON);
					expect(
						portalArrivalPlaneContainsBeyondPoint(
							metadata,
							0,
							sample.x,
							sample.y,
							sample.z,
						),
					).toBe(true);
				}
			}
		}
	});
});

function deterministicRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function randomUnitVector(random: () => number): Vec3 {
	while (true) {
		const candidate = randomPoint(random, 1);
		const length = Math.hypot(candidate.x, candidate.y, candidate.z);
		if (length > 0.1) {
			return new Vec3(
				candidate.x / length,
				candidate.y / length,
				candidate.z / length,
			);
		}
	}
}

function randomPoint(random: () => number, extent: number): Vec3 {
	return new Vec3(
		scalar(random, -extent, extent),
		scalar(random, -extent, extent),
		scalar(random, -extent, extent),
	);
}

function scalar(
	random: () => number,
	minimum: number,
	maximum: number,
): number {
	return minimum + random() * (maximum - minimum);
}

function integer(
	random: () => number,
	minimum: number,
	maximum: number,
): number {
	return Math.floor(scalar(random, minimum, maximum + 1));
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function addScaled(point: Vec3, direction: Vec3, scale: number): Vec3 {
	return new Vec3(
		point.x + direction.x * scale,
		point.y + direction.y * scale,
		point.z + direction.z * scale,
	);
}

function addTangentOffset(
	point: Vec3,
	normal: Vec3,
	random: () => number,
): Vec3 {
	const candidate = randomPoint(random, 5);
	return addScaled(candidate, normal, -dot(candidate, normal)).add(point);
}

function interpolate(start: Vec3, end: Vec3, parameter: number): Vec3 {
	return new Vec3(
		start.x + (end.x - start.x) * parameter,
		start.y + (end.y - start.y) * parameter,
		start.z + (end.z - start.z) * parameter,
	);
}
