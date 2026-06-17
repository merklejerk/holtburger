import type {
	LandblockPortalLinkFacts,
	StaticPlane,
	StaticPortalInteriorRecord,
	StaticVec3,
	TransitionApertureBatch,
	TransitionApertureExteriorEndpoint,
	TransitionApertureRange,
} from "../../contracts";

type TransitionPortalVisibleSide = "positive" | "negative";

interface TransitionPortalEndpointPair {
	readonly exterior: TransitionApertureExteriorEndpoint;
	readonly indoor: {
		readonly envCellId: number;
		readonly envCellPortalId: string;
	};
}

type TransitionApertureOmissionReason =
	| "missing-env-cell-summary"
	| "missing-env-cell-portal"
	| "not-outside-transition-portal"
	| "missing-portal-aperture"
	| "malformed-portal-aperture";

export function deriveTransitionApertureBatch(
	landblockId: number,
	records: readonly StaticPortalInteriorRecord[],
): TransitionApertureBatch | null {
	const vertices: StaticVec3[] = [];
	const indices: number[] = [];
	const ranges: TransitionApertureRange[] = [];
	const planes: (StaticPlane | null)[] = [];
	const sortedRecords = [...records].sort((left, right) =>
		left.owner.workId.localeCompare(right.owner.workId),
	);

	for (const record of sortedRecords) {
		const envCellsById = new Map(
			record.envCells.map((envCell) => [envCell.envCellId, envCell] as const),
		);
		const sortedLinks = [...record.portalLinks].sort((left, right) =>
			left.linkId.localeCompare(right.linkId),
		);
		for (const link of sortedLinks) {
			const endpoints = createTransitionEndpointPair(link);
			if (!endpoints) {
				continue;
			}

			appendTransitionAperture({
				endpoints,
				envCellsById,
				indices,
				landblockId,
				link,
				planes,
				ranges,
				vertices,
			});
		}
	}

	if (indices.length === 0) {
		return null;
	}

	return {
		apertureBatchId: createTransitionApertureBatchId(landblockId),
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices,
		kind: "transition-aperture-batch",
		landblockId,
		planes,
		ranges,
		vertices,
	};
}

function appendTransitionAperture(options: {
	readonly endpoints: TransitionPortalEndpointPair;
	readonly envCellsById: ReadonlyMap<
		number,
		StaticPortalInteriorRecord["envCells"][number]
	>;
	readonly indices: number[];
	readonly landblockId: number;
	readonly link: LandblockPortalLinkFacts;
	readonly planes: (StaticPlane | null)[];
	readonly ranges: TransitionApertureRange[];
	readonly vertices: StaticVec3[];
}): void {
	const envCell = options.envCellsById.get(options.endpoints.indoor.envCellId);
	if (!envCell) {
		logTransitionApertureOmission(options, "missing-env-cell-summary");
		return;
	}

	const portal = envCell.portals.find(
		(candidate) =>
			candidate.portalId === options.endpoints.indoor.envCellPortalId,
	);
	if (!portal) {
		logTransitionApertureOmission(options, "missing-env-cell-portal");
		return;
	}
	if (!portal.isOutsideTransition) {
		logTransitionApertureOmission(options, "not-outside-transition-portal");
		return;
	}

	const aperture = envCell.portalApertures.find(
		(candidate) => candidate.portalId === portal.portalId,
	);
	if (!aperture) {
		logTransitionApertureOmission(options, "missing-portal-aperture");
		return;
	}

	const placementMatrix = buildLandblockRenderLocalPlacementMatrix(
		envCell.localPlacement,
	);
	const apertureVertices = aperture.points.map((point) =>
		transformRenderLocalPoint(point, placementMatrix),
	);
	const apertureIndices = triangulatePortalApertureFan(
		apertureVertices,
		decodeTransitionPortalVisibleSide(portal.flags),
	);
	if (apertureIndices.length === 0) {
		logTransitionApertureOmission(options, "malformed-portal-aperture");
		return;
	}

	const firstIndex = options.indices.length;
	const firstVertex = options.vertices.length;
	options.vertices.push(...apertureVertices);
	options.indices.push(...apertureIndices.map((index) => firstVertex + index));
	options.ranges.push({
		envCellId: options.endpoints.indoor.envCellId,
		exterior: options.endpoints.exterior,
		firstIndex,
		indexCount: apertureIndices.length,
		portalId: createTransitionAperturePortalId({
			endpoints: options.endpoints,
			landblockId: options.landblockId,
		}),
	});
	options.planes.push(
		transformPortalAperturePlane(aperture.plane, placementMatrix),
	);
}

function createTransitionApertureBatchId(landblockId: number): string {
	return `transition-apertures:${landblockId >>> 0}`;
}

function createTransitionAperturePortalId(options: {
	readonly endpoints: TransitionPortalEndpointPair;
	readonly landblockId: number;
}): string {
	return [
		"transition-portal",
		options.landblockId >>> 0,
		describeTransitionExteriorEndpointId(options.endpoints.exterior),
		options.endpoints.indoor.envCellId >>> 0,
		options.endpoints.indoor.envCellPortalId,
	].join(":");
}

function describeTransitionExteriorEndpointId(
	endpoint: TransitionApertureExteriorEndpoint,
): string {
	return endpoint.kind === "landblock-building"
		? `building:${endpoint.buildingInstanceId}:${endpoint.buildingPortalId}`
		: `outside:${endpoint.landblockId >>> 0}`;
}

function triangulatePortalApertureFan(
	vertices: readonly StaticVec3[],
	insideVisibleSide: TransitionPortalVisibleSide,
): readonly number[] {
	if (vertices.length < 3) {
		return [];
	}

	const indices: number[] = [];
	for (let index = 1; index < vertices.length - 1; index += 1) {
		if (insideVisibleSide === "positive") {
			indices.push(0, index, index + 1);
		} else {
			indices.push(0, index + 1, index);
		}
	}
	return indices;
}

function decodeTransitionPortalVisibleSide(
	flags: number,
): TransitionPortalVisibleSide {
	return (flags & 0x2) === 0 ? "negative" : "positive";
}

function logTransitionApertureOmission(
	options: {
		readonly endpoints: TransitionPortalEndpointPair;
		readonly landblockId: number;
		readonly link: LandblockPortalLinkFacts;
	},
	reason: TransitionApertureOmissionReason,
): void {
	console.error("Failed to derive transition aperture batch geometry.", {
		envCellId: options.endpoints.indoor.envCellId,
		envCellPortalId: options.endpoints.indoor.envCellPortalId,
		exterior: options.endpoints.exterior,
		landblockId: options.landblockId,
		linkId: options.link.linkId,
		reason,
	});
}

function transformPortalAperturePlane(
	plane: {
		readonly constant: number;
		readonly normal: StaticVec3;
	} | null,
	matrix: Float32Array,
): StaticPlane | null {
	if (!plane) {
		return null;
	}

	const localPointOnPlane = {
		x: plane.normal.x * plane.constant,
		y: plane.normal.y * plane.constant,
		z: plane.normal.z * plane.constant,
	};
	const pointOnPlane = transformRenderLocalPoint(localPointOnPlane, matrix);
	const normalEndpoint = transformRenderLocalPoint(
		{
			x: localPointOnPlane.x + plane.normal.x,
			y: localPointOnPlane.y + plane.normal.y,
			z: localPointOnPlane.z + plane.normal.z,
		},
		matrix,
	);
	const transformedNormal = {
		x: normalEndpoint.x - pointOnPlane.x,
		y: normalEndpoint.y - pointOnPlane.y,
		z: normalEndpoint.z - pointOnPlane.z,
	};
	const transformedNormalLength = Math.hypot(
		transformedNormal.x,
		transformedNormal.y,
		transformedNormal.z,
	);
	if (transformedNormalLength === 0) {
		return null;
	}
	const normalizedNormal = {
		x: transformedNormal.x / transformedNormalLength,
		y: transformedNormal.y / transformedNormalLength,
		z: transformedNormal.z / transformedNormalLength,
	};
	return {
		constant: dotVec3(normalizedNormal, pointOnPlane),
		normal: normalizedNormal,
	};
}

function buildLandblockRenderLocalPlacementMatrix(
	placement: StaticPortalInteriorRecord["envCells"][number]["localPlacement"],
): Float32Array {
	const acRotation = buildQuaternionRotationMatrix(placement.orientation);
	const acToRender = new Float32Array([
		1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
	]);
	const renderToAc = new Float32Array([
		1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1,
	]);
	const transform = multiplyMat4(
		multiplyMat4(acToRender, acRotation),
		renderToAc,
	);
	transform[12] = placement.origin.x;
	transform[13] = placement.origin.z;
	transform[14] = -placement.origin.y;
	return transform;
}

function transformRenderLocalPoint(
	point: StaticVec3,
	matrix: Float32Array,
): StaticVec3 {
	return {
		x:
			matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12],
		y:
			matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13],
		z:
			matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14],
	};
}

function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
	const output = new Float32Array(16);
	const left00 = left[0];
	const left01 = left[1];
	const left02 = left[2];
	const left03 = left[3];
	const left10 = left[4];
	const left11 = left[5];
	const left12 = left[6];
	const left13 = left[7];
	const left20 = left[8];
	const left21 = left[9];
	const left22 = left[10];
	const left23 = left[11];
	const left30 = left[12];
	const left31 = left[13];
	const left32 = left[14];
	const left33 = left[15];
	const right00 = right[0];
	const right01 = right[1];
	const right02 = right[2];
	const right03 = right[3];
	const right10 = right[4];
	const right11 = right[5];
	const right12 = right[6];
	const right13 = right[7];
	const right20 = right[8];
	const right21 = right[9];
	const right22 = right[10];
	const right23 = right[11];
	const right30 = right[12];
	const right31 = right[13];
	const right32 = right[14];
	const right33 = right[15];

	output[0] =
		left00 * right00 + left10 * right01 + left20 * right02 + left30 * right03;
	output[1] =
		left01 * right00 + left11 * right01 + left21 * right02 + left31 * right03;
	output[2] =
		left02 * right00 + left12 * right01 + left22 * right02 + left32 * right03;
	output[3] =
		left03 * right00 + left13 * right01 + left23 * right02 + left33 * right03;
	output[4] =
		left00 * right10 + left10 * right11 + left20 * right12 + left30 * right13;
	output[5] =
		left01 * right10 + left11 * right11 + left21 * right12 + left31 * right13;
	output[6] =
		left02 * right10 + left12 * right11 + left22 * right12 + left32 * right13;
	output[7] =
		left03 * right10 + left13 * right11 + left23 * right12 + left33 * right13;
	output[8] =
		left00 * right20 + left10 * right21 + left20 * right22 + left30 * right23;
	output[9] =
		left01 * right20 + left11 * right21 + left21 * right22 + left31 * right23;
	output[10] =
		left02 * right20 + left12 * right21 + left22 * right22 + left32 * right23;
	output[11] =
		left03 * right20 + left13 * right21 + left23 * right22 + left33 * right23;
	output[12] =
		left00 * right30 + left10 * right31 + left20 * right32 + left30 * right33;
	output[13] =
		left01 * right30 + left11 * right31 + left21 * right32 + left31 * right33;
	output[14] =
		left02 * right30 + left12 * right31 + left22 * right32 + left32 * right33;
	output[15] =
		left03 * right30 + left13 * right31 + left23 * right32 + left33 * right33;
	return output;
}

function buildQuaternionRotationMatrix(quaternion: {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): Float32Array {
	const { x, y, z, w } = quaternion;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;

	return new Float32Array([
		1 - (yy + zz),
		xy + wz,
		xz - wy,
		0,
		xy - wz,
		1 - (xx + zz),
		yz + wx,
		0,
		xz + wy,
		yz - wx,
		1 - (xx + yy),
		0,
		0,
		0,
		0,
		1,
	]);
}

function dotVec3(left: StaticVec3, right: StaticVec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function createTransitionEndpointPair(
	link: LandblockPortalLinkFacts,
): TransitionPortalEndpointPair | null {
	const exteriorEndpoint =
		createTransitionExteriorEndpoint(link.source) ??
		createTransitionExteriorEndpoint(link.target);
	const indoorEndpoint =
		link.source.kind === "env-cell"
			? link.source
			: link.target.kind === "env-cell"
				? link.target
				: null;
	if (!exteriorEndpoint || !indoorEndpoint) {
		return null;
	}

	return {
		exterior: exteriorEndpoint,
		indoor: {
			envCellId: indoorEndpoint.envCellId,
			envCellPortalId: indoorEndpoint.portalId,
		},
	};
}

function createTransitionExteriorEndpoint(
	endpoint: LandblockPortalLinkFacts["source"],
): TransitionApertureExteriorEndpoint | null {
	if (endpoint.kind === "landblock-building") {
		return {
			buildingInstanceId: endpoint.instanceId,
			buildingPortalId: endpoint.portalId,
			kind: "landblock-building",
		};
	}
	if (endpoint.kind === "outside") {
		return {
			kind: "outside",
			landblockId: endpoint.landblockId,
		};
	}
	return null;
}
