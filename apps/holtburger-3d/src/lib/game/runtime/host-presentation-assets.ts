import { AnimationHostSource } from "../../assets/animation-host-source";
import { SetupVisualHostSource } from "../../assets/setup-visual-host-source";
import { ParticleEmitterHostSource } from "../../assets/particle-emitter-host-source";
import { ParticleMeshHostSource } from "../../assets/particle-mesh-host-source";
import { PhysicsScriptHostSource } from "../../assets/physics-script-host-source";
import { TexturePixelHostSource } from "../../assets/texture-pixel-host-source";
import type { HostTransport } from "../../host/host-transport";
import type { ObjectPreviewResources } from "../preview/object-preview-controller";
import { PresentationAssetService } from "./presentation-asset-service";
import { PresentationTeardownStack } from "./presentation-teardown";

/** App-owned CPU/content capabilities borrowed by world and isolated presentations. */
export interface HostPresentationResources extends ObjectPreviewResources {
	/** Existing transition loader consumes the same setup source as the visual repository. */
	readonly setupVisualSource: SetupVisualHostSource;
	/** Existing transition loader consumes the same animation source as the repository. */
	readonly animationSource: AnimationHostSource;
	/** World static-detail preparation borrows this immutable pixel capability. */
	readonly texturePixelSource: TexturePixelHostSource;
}

/** Lazy client/Explorer composition lifetime; borrowers must retire before this owner closes. */
export class HostPresentationAssets {
	readonly #transport: HostTransport;
	#completion: Promise<HostPresentationResources> | null = null;
	#retirement: Promise<void> | null = null;
	#closed = false;

	constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	/** Prepare content capabilities without creating a scene, audio device or WebGL context. */
	async resources(): Promise<HostPresentationResources> {
		if (this.#closed)
			throw new DOMException("Presentation assets are closing.", "AbortError");
		const resources = await (this.#completion ??= this.#build());
		if (this.#closed)
			throw new DOMException(
				"Presentation assets closed during construction.",
				"AbortError",
			);
		return resources;
	}

	/** Wait for pending construction and release sources after every borrower has retired. */
	destroy(): Promise<void> {
		this.#closed = true;
		return (this.#retirement ??=
			this.#completion === null
				? Promise.resolve()
				: this.#completion.then((resources) => resources.assets.destroy()));
	}

	async #build(): Promise<HostPresentationResources> {
		const setupVisualSource = new SetupVisualHostSource(this.#transport);
		const animationSource = AnimationHostSource.build(this.#transport);
		const physicsScriptSource = PhysicsScriptHostSource.build(this.#transport);
		const particleEmitterSource = ParticleEmitterHostSource.build(
			this.#transport,
		);
		const texturePixelSource = TexturePixelHostSource.build(this.#transport);
		const rollback = new PresentationTeardownStack();
		rollback.add("setup-visual-source", () => setupVisualSource.destroy());
		rollback.add("animation-source", () => animationSource.destroy());
		rollback.add("physics-script-source", () => physicsScriptSource.destroy());
		rollback.add("particle-emitter-source", () =>
			particleEmitterSource.destroy(),
		);
		try {
			const assets = await PresentationAssetService.build({
				setupVisualSource,
				animationSource,
				physicsScriptSource,
				particleEmitterSource,
				texturePixelSource,
			});
			return {
				assets,
				setupVisualSource,
				animationSource,
				texturePixelSource,
				particleMeshSource: () => ParticleMeshHostSource.build(this.#transport),
			};
		} catch (cause) {
			try {
				await rollback.close();
			} catch (rollbackCause) {
				throw new AggregateError(
					[cause, rollbackCause],
					"Presentation asset construction and rollback failed.",
					{ cause: rollbackCause },
				);
			}
			throw cause;
		}
	}
}
