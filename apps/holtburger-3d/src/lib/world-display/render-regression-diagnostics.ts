import { readLaunchQueryParam } from "../diagnostics/launch-query-params";
import type { LandblockRenderProduct } from "./landblock-render-product";

export type RenderUploadDiagnosticFamily =
	| "terrain"
	| "static-objects"
	| "cell-structures"
	| "portal-masks";

type RenderFamilyDiagnosticFamily = RenderUploadDiagnosticFamily;

export type RenderArtifactDiagnosticFamily =
	| "terrain"
	| "static-objects"
	| "cell-structures";

export interface TemporaryRenderRegressionDiagnostics {
	enabled: boolean;
	productFilter: ReadonlySet<LandblockRenderProduct> | null;
	familyFilter: ReadonlySet<RenderFamilyDiagnosticFamily> | null;
	uploadFilter: ReadonlySet<RenderUploadDiagnosticFamily> | null;
	artifactFilter: ReadonlySet<RenderArtifactDiagnosticFamily> | null;
}

const PRODUCT_VALUES = [
	"outdoor-terrain",
	"outdoor-buildings",
	"outdoor-detail",
	"outdoor-env-cells",
	"dungeon-env-cells",
] as const satisfies readonly LandblockRenderProduct[];

const UPLOAD_FAMILY_VALUES = [
	"terrain",
	"static-objects",
	"cell-structures",
	"portal-masks",
] as const satisfies readonly RenderUploadDiagnosticFamily[];

const ARTIFACT_FAMILY_VALUES = [
	"terrain",
	"static-objects",
	"cell-structures",
] as const satisfies readonly RenderArtifactDiagnosticFamily[];

export const ALL_RENDER_UPLOAD_DIAGNOSTIC_FAMILIES: readonly RenderUploadDiagnosticFamily[] =
	UPLOAD_FAMILY_VALUES;

let cachedDiagnostics: TemporaryRenderRegressionDiagnostics | null = null;

export function readTemporaryRenderRegressionDiagnostics(): TemporaryRenderRegressionDiagnostics {
	if (cachedDiagnostics) {
		return cachedDiagnostics;
	}
	const familyFilter = readEnumSet<RenderFamilyDiagnosticFamily>(
		"renderFamilies",
		"VITE_HOLTBURGER_RENDER_FAMILY_FILTER",
		UPLOAD_FAMILY_VALUES,
	);
	const uploadFilter =
		readEnumSet<RenderUploadDiagnosticFamily>(
			"renderUploads",
			"VITE_HOLTBURGER_RENDER_UPLOAD_FILTER",
			UPLOAD_FAMILY_VALUES,
		) ?? familyFilter;
	const artifactFilter =
		readEnumSet<RenderArtifactDiagnosticFamily>(
			"renderArtifacts",
			"VITE_HOLTBURGER_RENDER_ARTIFACT_FILTER",
			ARTIFACT_FAMILY_VALUES,
		) ?? deriveArtifactFilterFromFamilyFilter(familyFilter);
	cachedDiagnostics = {
		enabled: readBooleanFlag(
			"renderDiag",
			"VITE_HOLTBURGER_RENDER_DIAGNOSTICS",
		),
		productFilter: readEnumSet<LandblockRenderProduct>(
			"renderProducts",
			"VITE_HOLTBURGER_RENDER_PRODUCT_FILTER",
			PRODUCT_VALUES,
		),
		familyFilter,
		uploadFilter,
		artifactFilter,
	};
	if (
		cachedDiagnostics.enabled ||
		cachedDiagnostics.productFilter ||
		cachedDiagnostics.familyFilter ||
		cachedDiagnostics.uploadFilter ||
		cachedDiagnostics.artifactFilter
	) {
		console.info("[holtburger-3d][render-regression][config]", {
			enabled: cachedDiagnostics.enabled,
			productFilter: describeDiagnosticSet(cachedDiagnostics.productFilter),
			familyFilter: describeDiagnosticSet(cachedDiagnostics.familyFilter),
			uploadFilter: describeDiagnosticSet(cachedDiagnostics.uploadFilter),
			artifactFilter: describeDiagnosticSet(cachedDiagnostics.artifactFilter),
		});
	}
	return cachedDiagnostics;
}

export function shouldRequestRenderProduct(
	diagnostics: TemporaryRenderRegressionDiagnostics,
	product: LandblockRenderProduct,
): boolean {
	return !diagnostics.productFilter || diagnostics.productFilter.has(product);
}

export function shouldUploadRenderFamily(
	diagnostics: TemporaryRenderRegressionDiagnostics,
	family: RenderUploadDiagnosticFamily,
): boolean {
	return !diagnostics.uploadFilter || diagnostics.uploadFilter.has(family);
}

export function logTemporaryRenderRegressionDiagnostic(
	label: string,
	detail: Record<string, unknown>,
	diagnostics = readTemporaryRenderRegressionDiagnostics(),
): void {
	if (!diagnostics.enabled) {
		return;
	}
	console.info(`[holtburger-3d][render-regression][${label}]`, detail);
}

export function describeDiagnosticSet<T extends string>(
	values: ReadonlySet<T> | null,
): string {
	return values ? [...values].sort().join(",") : "all";
}

function readBooleanFlag(queryParam: string, envName: string): boolean {
	const queryValue = readQueryParam(queryParam);
	if (queryValue !== null) {
		return queryValue === "1" || queryValue === "true";
	}
	const envValue = readViteEnv(envName);
	return envValue === "1" || envValue === "true";
}

function readEnumSet<T extends string>(
	queryParam: string,
	envName: string,
	allowedValues: readonly T[],
): ReadonlySet<T> | null {
	const rawValue = readQueryParam(queryParam) ?? readViteEnv(envName);
	if (!rawValue) {
		return null;
	}
	const allowed = new Set<string>(allowedValues);
	const values = rawValue
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (values.length === 0 || values.includes("all")) {
		return null;
	}
	const invalid = values.filter((value) => !allowed.has(value));
	if (invalid.length > 0) {
		throw new Error(
			`Unsupported temporary render diagnostic filter value(s) for ${queryParam}: ${invalid.join(
				", ",
			)}.`,
		);
	}
	return new Set(values as T[]);
}

function deriveArtifactFilterFromFamilyFilter(
	familyFilter: ReadonlySet<RenderFamilyDiagnosticFamily> | null,
): ReadonlySet<RenderArtifactDiagnosticFamily> | null {
	if (!familyFilter) {
		return null;
	}
	const artifactFamilies = new Set<RenderArtifactDiagnosticFamily>();
	for (const family of familyFilter) {
		if (family === "portal-masks") {
			artifactFamilies.add("cell-structures");
			continue;
		}
		artifactFamilies.add(family);
	}
	return artifactFamilies;
}

function readQueryParam(name: string): string | null {
	return readLaunchQueryParam(name);
}

function readViteEnv(name: string): string | undefined {
	return import.meta.env[name] as string | undefined;
}
