import { EXPLORER_TUNING } from "../../explorer/explorer-tuning";
import { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import type { HostPresentationAssets } from "../../lib/game/runtime/host-presentation-assets";
import type {
	HostTransport,
	HostCommandName,
} from "../../lib/host/host-transport";
import type { ObjectPreviewSource } from "../../lib/game/runtime/object-preview-source";
import { StandardClientObjectPreviewService } from "../../client/client-object-preview-service";
import { observePreviewDevice } from "./preview-device-probe";

/** Successful/canceled world borrowers must leave the same app assets usable by a later preview. */
export async function probePregameWorldLifetime(
	assets: HostPresentationAssets,
	staticTransport: HostTransport,
	contentUrl: string,
	source: ObjectPreviewSource,
) {
	const resources = await assets.resources();
	const commands: HostCommandName[] = [];
	const endpoints: Partial<Record<HostCommandName, string>> = {
		load_active_region_data: "/active-region-data",
		load_sky_source: "/sky-source",
		load_audio: "/audio",
		load_sound_table: "/sound-table",
		load_physics_script_table: "/physics-script-table",
	};
	const transport: HostTransport = {
		listen: staticTransport.listen,
		invoke: async (command, args) => {
			commands.push(command);
			const endpoint = endpoints[command];
			if (endpoint === undefined) return staticTransport.invoke(command, args);
			const response = await fetch(new URL(endpoint, contentUrl), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(args?.request ?? {}),
			});
			if (!response.ok) throw new Error(await response.text());
			return new Uint8Array(await response.arrayBuffer());
		},
	};
	const canvas = document.createElement("canvas");
	const device = observePreviewDevice(canvas);
	let audio: AudioContext | null = null;
	const dependencies = {
		canvas,
		hostTransport: transport,
		presentationResources: resources,
		frameSettings: EXPLORER_TUNING.frameSettings,
		portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
		audioTuning: EXPLORER_TUNING.audio,
		audioContextFactory: () => {
			const context = new AudioContext();
			audio = context;
			return context;
		},
	};
	const world = await GamePresentationOwner.build(dependencies);
	await world.destroy();
	const retired = device.read();
	// Factory assignment is intentionally imperative; inspect the context through an accessor.
	const audioClosed = (): boolean => audio !== null && audio.state === "closed";
	if (
		!audioClosed() ||
		retired.programs.live !== 0 ||
		retired.textures.live !== 0 ||
		retired.buffers.live !== 0 ||
		retired.vertexArrays.live !== 0
	)
		throw new Error(
			`World retirement retained browser device resources: ${JSON.stringify({ audioClosed: audioClosed(), retired })}`,
		);
	const cancelled = new AbortController();
	try {
		await GamePresentationOwner.build({
			...dependencies,
			signal: cancelled.signal,
			hostTransport: {
				...transport,
				invoke: async (command, args) => {
					const response = await transport.invoke(command, args);
					if (command === "load_active_region_data") cancelled.abort();
					return response;
				},
			},
		});
		throw new Error("Canceled world construction succeeded");
	} catch (error) {
		if (!(error instanceof Error) || error.name !== "AbortError") throw error;
	}
	if ((await assets.resources()).assets !== resources.assets)
		throw new Error("World retirement replaced shared content assets");
	const previewCanvas = document.createElement("canvas");
	const previewDevice = observePreviewDevice(previewCanvas);
	const service = new StandardClientObjectPreviewService({
		resolveResources: () => assets.resources(),
	});
	try {
		const preview = service.open({ canvas: previewCanvas, source });
		preview.setViewport({
			extent: { width: 256, height: 256 },
			minimumFrameIntervalSeconds: 1 / 30,
			rotation: { kind: "orbit", yawRadians: 0 },
			framing: { kind: "body" },
		});
		await preview.ready;
		const deadline = performance.now() + 10_000;
		while ((preview.diagnostics()?.frameCount ?? 0) === 0) {
			if (performance.now() > deadline)
				throw new Error("Preview could not draw after world retirement");
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	} finally {
		await service.destroy();
	}
	const closed = previewDevice.read();
	if (
		closed.programs.live !== 0 ||
		closed.textures.live !== 0 ||
		closed.buffers.live !== 0 ||
		closed.vertexArrays.live !== 0
	)
		throw new Error("Post-world preview retained device resources");
	return {
		commands,
		worldRetired: true,
		canceledWorldRetired: true,
		previewDrewAfterWorldRetirement: true,
		remainingWorldGpuResources: 0,
		remainingPreviewGpuResources: 0,
	};
}
