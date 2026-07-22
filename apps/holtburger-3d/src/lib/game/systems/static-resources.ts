import type { ColorF } from "../pixels/types";
import type { Mat4 } from "../math/types";

/** Opaque namespace shared by every installation-scoped static resource. */
export type StaticInstallResourceNamespace = `static-install:${string}`;

/** Globally semantic geometry identity derived from reusable source and partition facts. */
export type ReusableStaticGeometryKey = `static-source-geometry:${string}`;

/** Geometry identity meaningful only inside one qualified static installation. */
export type InstallStaticGeometryKey =
	`static-install-geometry:${StaticInstallResourceNamespace}/${string}`;

/** Logical identity for either reusable or installation-specific static geometry. */
export type StaticGeometryKey =
	| ReusableStaticGeometryKey
	| InstallStaticGeometryKey;

/** Immutable cohort identity qualified by the installation that produced it. */
export type StaticInstanceStreamKey =
	`static-instance-stream:${StaticInstallResourceNamespace}/${string}`;

/** Per-instance values consumed by the initial static-object instancing program. */
export interface StaticInstanceData {
	/** Source geometry transform flattened into the owning landblock coordinate space. */
	readonly sourceToLandblock: Mat4;
	/** Per-instance color modulation after source appearance overrides are resolved. */
	readonly color: ColorF;
}

/** Complete immutable payload for one static instance cohort. */
export interface StaticInstanceStreamData {
	/** Instances drawn together by every draw unit referencing this stream. */
	readonly instances: readonly StaticInstanceData[];
}

/** Keyed stream publication crossing the static-baker worker boundary. */
export interface StaticInstanceStreamSource {
	/** Install-scoped key shared by the source and every referencing draw unit. */
	readonly key: StaticInstanceStreamKey;
	/** Immutable cohort payload. */
	readonly data: StaticInstanceStreamData;
}

/** Allocate an installation namespace before static worker dispatch. */
export function createStaticInstallResourceNamespace(
	installationId: number,
): StaticInstallResourceNamespace {
	if (!Number.isSafeInteger(installationId) || installationId < 0) {
		throw new Error(
			"Static installation id must be a non-negative safe integer.",
		);
	}
	return `static-install:${installationId}`;
}
