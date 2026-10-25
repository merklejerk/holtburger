import { startPresentationFrameLoop } from "../../app/presentation-frame-loop";
import { probePregameOutdoorEnvironment } from "./pregame-outdoor-probe";
import { ClientPresentationRoot } from "../../client/client-presentation-root";
import { ClientGameplayPresentation } from "../../client/client-gameplay-presentation";
import { pregameGameplayFixture } from "./pregame-gameplay-fixture";
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
	source: ObjectPreviewSource,
) {
	const resources = await assets.resources();
	const commands: HostCommandName[] = [];
	const transport: HostTransport = {
		listen: staticTransport.listen,
		invoke: (command, args) => {
			commands.push(command);
			return staticTransport.invoke(command, args);
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
	const constructionStartedAtMs = performance.now();
	const world = await GamePresentationOwner.build(dependencies);
	const worldConstructionMs = performance.now() - constructionStartedAtMs;
	const authority = pregameGameplayFixture(source.body);
	await authority.session.start();
	let worldBuilds = 0;
	let gameplayAdapters = 0;
	const errors: unknown[] = [];
	const root = new ClientPresentationRoot({
		canvas,
		build: async () => {
			worldBuilds++;
			return world;
		},
		createGameplay: (resources) => {
			gameplayAdapters++;
			return new ClientGameplayPresentation({
				canvas,
				session: authority.session,
				resources,
				onError: (error) => errors.push(error),
			});
		},
		onGameplayRetired: () => {},
		onReady: () => {},
		onError: (error) => errors.push(error),
	});
	// The offscreen diagnostic canvas still supplies a real drawing extent to both drivers.
	Object.defineProperties(canvas, {
		clientWidth: { value: 512 },
		clientHeight: { value: 512 },
	});
	const settle = async (kind: "pregame" | "gameplay") => {
		const deadline = performance.now() + 60_000;
		for (;;) {
			const frame = root.frame(performance.now());
			if (frame.kind === "failed") throw new Error(frame.message);
			if (frame.kind === "pregame" && frame.status.kind === "failed")
				throw new Error(frame.status.message);
			if (errors.length > 0)
				throw new AggregateError(errors, "World driver failed");
			if (
				(kind === "pregame" && frame.kind === "pregame" && frame.rendered) ||
				(kind === "gameplay" &&
					frame.kind === "gameplay" &&
					frame.frame.status.kind === "ready" &&
					frame.frame.rendered &&
					authority.session.state().lifecycle?.kind === "in-world")
			)
				return;
			if (performance.now() > deadline)
				throw new Error(
					`Persistent world did not reach ${kind}: ${JSON.stringify(frame)}`,
				);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	};
	let backdropFrames = 0;
	let firstCyclePrograms = 0;
	let candidatePreparationMs: number;
	let outdoor: Awaited<ReturnType<typeof probePregameOutdoorEnvironment>>;
	try {
		const preparationStartedAtMs = performance.now();
		await root.setMode("pregame");
		await settle("pregame");
		candidatePreparationMs = performance.now() - preparationStartedAtMs;
		backdropFrames++;
		// Creator and selector are foreground-only changes; the installed scene keeps drawing.
		await root.setMode("pregame");
		await settle("pregame");
		backdropFrames++;
		await root.setMode("idle");
		outdoor = await probePregameOutdoorEnvironment(world);
		for (let cycle = 0; cycle < 2; cycle++) {
			await authority.enter();
			await root.setMode("gameplay");
			await settle("gameplay");
			if (authority.acknowledgements() !== cycle + 1)
				throw new Error("Gameplay did not acknowledge its portal reveal");
			authority.selection();
			await root.setMode("pregame");
			await settle("pregame");
			if ([...world.runtime.listPresentedSpawnedEntities()].length !== 0)
				throw new Error("Gameplay actors leaked into pre-game");
			if (cycle === 0) firstCyclePrograms = device.read().programs.created;
		}
		if (
			device.read().contextRequests !== 1 ||
			worldBuilds !== 1 ||
			gameplayAdapters !== 2
		)
			throw new Error("Mode handoff rebuilt world resources");
		if (device.read().programs.created !== firstCyclePrograms)
			throw new Error("Repeated handoff recompiled world programs");
	} finally {
		await root.destroy();
		authority.session.stop();
	}
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
		startFrameLoop: startPresentationFrameLoop,
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
		// Diagnostic cold-start spans exclude shared CPU bootstrap and later preview/weather work.
		startup: {
			worldConstructionMs,
			candidatePreparationMs,
			width: 512,
			height: 512,
			renderScale: EXPLORER_TUNING.frameSettings.quality.renderScale,
		},
		candidateBackdropFrames: backdropFrames,
		backdropPausedAndResumed: true,
		persistentWorldBuilds: worldBuilds,
		outdoor,
		gameplayAdapters,
		portalReveals: authority.acknowledgements(),
		repeatedHandoffRetainedPrograms: true,
		canceledWorldRetired: true,
		previewDrewAfterWorldRetirement: true,
		remainingWorldGpuResources: 0,
		remainingPreviewGpuResources: 0,
	};
}
