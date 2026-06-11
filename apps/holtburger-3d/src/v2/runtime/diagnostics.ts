import type {
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";

export interface RuntimeDiagnostics {
	warn(event: RuntimeWarningEvent): void;
}

type RuntimeWarningEvent =
	| StaticMaterializationFailedWarning
	| TerrainRenderableFallbackWarning;

interface StaticMaterializationFailedWarning {
	readonly kind: "static-materialization-failed";
	readonly revision: number;
	readonly message: string;
	readonly error: unknown;
}

interface TerrainRenderableFallbackWarning {
	readonly kind: "terrain-renderable-fallback";
	readonly revision: number;
	readonly drawUnitId: string;
	readonly materialFamily: TerrainGeometryStaticDrawUnit["materialFamily"];
	readonly materialBucketKey: string;
	readonly reasons: readonly TerrainMaterialFallbackReason[];
}

export function createConsoleRuntimeDiagnostics(): RuntimeDiagnostics {
	return new ConsoleRuntimeDiagnostics();
}

class ConsoleRuntimeDiagnostics implements RuntimeDiagnostics {
	readonly #reportedFallbacks = new Set<string>();

	warn(event: RuntimeWarningEvent): void {
		switch (event.kind) {
			case "static-materialization-failed":
				console.warn(
					`V2 static materialization revision ${event.revision} failed; draw units from this commit were not added to renderer residency.`,
					event.error,
				);
				return;
			case "terrain-renderable-fallback":
				this.#warnTerrainRenderableFallback(event);
				return;
		}
	}

	#warnTerrainRenderableFallback(
		event: TerrainRenderableFallbackWarning,
	): void {
		const warningKey = [
			event.revision,
			event.drawUnitId,
			event.materialBucketKey,
			createReasonSignature(event.reasons),
		].join("|");
		if (this.#reportedFallbacks.has(warningKey)) {
			return;
		}

		this.#reportedFallbacks.add(warningKey);
		console.warn(
			`V2 terrain draw unit ${event.drawUnitId} rendered with ${event.materialFamily} because its material could not be fully satisfied.`,
			{
				materialBucketKey: event.materialBucketKey,
				reasons: event.reasons,
				revision: event.revision,
			},
		);
	}
}

function createReasonSignature(
	reasons: readonly TerrainMaterialFallbackReason[],
): string {
	return reasons
		.map((reason) =>
			[
				reason.code,
				reason.pcode?.toString(16) ?? "none",
				reason.texture?.surfaceTextureId.toString(16) ?? "none",
			].join(":"),
		)
		.join("|");
}
