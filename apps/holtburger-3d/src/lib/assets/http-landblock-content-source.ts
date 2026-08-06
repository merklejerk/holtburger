import type { LandblockId } from "../game/game-types";
import type { DatAssetId } from "../game/game-types";
import type { AnimationAssetSource } from "./animation-asset-source";
import { decodeAnimationRecord } from "./decode-animation-record";
import { decodePhysicsScriptRecord } from "./decode-physics-script-record";
import type { PhysicsScriptSource } from "./physics-script-source";
import { decodeParticleEmitterRecord } from "./decode-particle-emitter-record";
import type { ParticleEmitterSource } from "./particle-emitter-source";
import { decodeSoundTableRecord } from "./decode-sound-table-record";
import type { SoundTableSource } from "./sound-table-source";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";
import {
	decodeActiveRegionSource,
	type ActiveRegionSource,
} from "./active-region-source";
import { decodeTexturePixels } from "./decode-texture-pixels";
import type { TexturePixelSource } from "./texture-pixel-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import {
	decodeSkySourceRecord,
	type SkySourcePresentations,
} from "./decode-sky-record";
import type { SkySourceLoader } from "./sky-source";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
} from "./landblock-source-batch";

/** One observed host batch retained only by the browser harness source adapter. */
export interface HttpLandblockSourceBatchDiagnostic {
	/** Canonical landblock requested by the frontend dispatch. */
	readonly landblockId: LandblockId;
	/** Exact layer subset projected from the host's cumulative asset. */
	readonly layers: readonly LandblockSourceLayer[];
	/** Exact response payload length before browser decoding. */
	readonly responseBytes: number;
	/** Host-only source assembly duration, excluding browser transfer and decoding. */
	readonly hostAssemblyDurationMs: number;
}

/** Browser-compatible adapter for the same closed landblock batch contract used by Tauri. */
export class HttpLandblockContentSource
	implements
		LandblockSourceBatchSource,
		TexturePixelSource,
		AnimationAssetSource,
		PhysicsScriptSource,
		ParticleEmitterSource,
		SoundTableSource,
		SkySourceLoader
{
	readonly #baseUrl: URL;
	readonly #activeRegion: ActiveRegionSource;
	readonly #landblockSourceBatchDiagnostics: HttpLandblockSourceBatchDiagnostic[] =
		[];

	private constructor(baseUrl: URL, activeRegion: ActiveRegionSource) {
		this.#baseUrl = baseUrl;
		this.#activeRegion = activeRegion;
	}

	static async build(baseUrl: string): Promise<HttpLandblockContentSource> {
		let parsed: URL;
		try {
			parsed = new URL(baseUrl);
		} catch {
			throw new Error(`Landblock content host URL is invalid: ${baseUrl}.`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Landblock content host URL must use HTTP or HTTPS.");
		}
		const activeRegion = decodeActiveRegionSource(
			await postBinary(parsed, "active-region-data", {}),
		);
		return new HttpLandblockContentSource(parsed, activeRegion);
	}

	/** Immutable active-region facts shared by terrain and outdoor-static presentation setup. */
	get activeRegion(): ActiveRegionSource {
		return this.#activeRegion;
	}

	/** Snapshot browser-harness source-batch observations without exposing response payloads. */
	getLandblockSourceBatchDiagnostics(): readonly HttpLandblockSourceBatchDiagnostic[] {
		return [...this.#landblockSourceBatchDiagnostics];
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		const response = await this.#postBinaryResponse("landblock-source-batch", {
			landblockId,
			layers: [...layers],
		});
		this.#landblockSourceBatchDiagnostics.push({
			hostAssemblyDurationMs: requiredNonNegativeHeader(
				response.headers,
				"x-holtburger-landblock-source-batch-duration-ms",
			),
			landblockId,
			layers: [...layers],
			responseBytes: response.bytes.byteLength,
		});
		return decodeLandblockSourceBatch(
			response.bytes,
			landblockId,
			layers,
			this.#activeRegion,
		);
	}

	async loadSkySource(): Promise<SkySourcePresentations> {
		return decodeSkySourceRecord(await this.#postBinary("sky-source", {}));
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		const bytes = await this.#postBinary("texture-pixels", request);
		return decodeTexturePixels(bytes, request);
	}

	async loadAnimation(animationId: DatAssetId) {
		return decodeAnimationRecord(
			await this.#postBinary("animation", { animationId }),
			animationId,
		);
	}

	async loadParticleEmitter(emitterInfoId: DatAssetId) {
		return decodeParticleEmitterRecord(
			await this.#postBinary("particle-emitter", { emitterInfoId }),
			emitterInfoId,
		);
	}

	async loadSoundTable(soundTableId: DatAssetId) {
		return decodeSoundTableRecord(
			await this.#postBinary("sound-table", { soundTableId }),
			soundTableId,
		);
	}

	async loadPhysicsScript(scriptId: DatAssetId) {
		return decodePhysicsScriptRecord(
			await this.#postBinary("physics-script", { scriptId }),
			scriptId,
		);
	}

	destroy(): void {}

	async #postBinary(path: string, body: unknown): Promise<Uint8Array> {
		return postBinary(this.#baseUrl, path, body);
	}

	async #postBinaryResponse(
		path: string,
		body: unknown,
	): Promise<{ readonly bytes: Uint8Array; readonly headers: Headers }> {
		return postBinaryResponse(this.#baseUrl, path, body);
	}
}

async function postBinary(
	baseUrl: URL,
	path: string,
	body: unknown,
): Promise<Uint8Array> {
	return (await postBinaryResponse(baseUrl, path, body)).bytes;
}

async function postBinaryResponse(
	baseUrl: URL,
	path: string,
	body: unknown,
): Promise<{ readonly bytes: Uint8Array; readonly headers: Headers }> {
	const response = await fetch(new URL(path, baseUrl), {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(
			`Landblock content host ${path} failed (${response.status}): ${await response.text()}`,
		);
	}
	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		headers: response.headers,
	};
}

function requiredNonNegativeHeader(headers: Headers, name: string): number {
	const value = headers.get(name);
	if (value === null) {
		throw new Error(`Landblock content host omitted required ${name} header.`);
	}
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) {
		throw new Error(`Landblock content host returned invalid ${name} header.`);
	}
	return number;
}
