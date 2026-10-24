<script lang="ts">
	import { probePregameWorldLifetime } from "./pregame-world-lifetime-probe";
	import { onMount, tick, type ComponentProps } from "svelte";
	import PregameCreatorHarness, {
		type CreatorWorkflowProof,
	} from "./PregameCreatorHarness.svelte";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import ClientModelPreview from "../../client/ClientModelPreview.svelte";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import type { ObjectPreviewSource as CapturedSource } from "../../client/client-object-preview-contract";
	import ClientCharacterCreator from "../../client/ClientCharacterCreator.svelte";
	import type { ObjectPreviewHandle } from "../../lib/game/preview/object-preview-controller";
	import { Vec3 } from "../../lib/game/math/types";
	import type {
		ObjectPreviewSource,
		ObjectPreviewVisual,
	} from "../../lib/game/runtime/object-preview-source";
	import {
		observePreviewDevice,
		type PreviewDeviceProbeSnapshot,
	} from "./preview-device-probe";
	import { acquireObjectPreviewVisual } from "../../lib/game/preview/object-preview-assets";
	import {
		pregameEquipmentComposition,
		probePregameEquipmentFrames,
	} from "./pregame-equipment-probe";
	import type { CharacterCreationCatalog } from "../../client/client-character-creation-contract";
	import {
		loadCharacterCreationCatalog,
		resolveCharacterCreationAppearance,
	} from "../../client/client-character-creation-contract";
	import type {
		HostCommandName,
		HostTransport,
	} from "../../lib/host/host-transport";
	import { HostPresentationAssets } from "../../lib/game/runtime/host-presentation-assets";
	import {
		StandardClientObjectPreviewService,
		type ClientObjectPreviewService,
	} from "../../client/client-object-preview-service";
	import type { ObjectPreviewRendererDiagnostics } from "../../lib/game/renderer/webgl2-preview-renderer";

	/** Read once after a production direct-canvas draw and complete resource retirement. */
	type Proof =
		| { kind: "loading" }
		| { kind: "failed"; message: string }
		| {
				kind: "ready";
				diagnostics: ObjectPreviewRendererDiagnostics;
				device: PreviewDeviceProbeSnapshot;
				replacementCount: number;
				failedReplacementPreservedVisual: boolean;
				hiddenReplacementDidNotDraw: boolean;
				faceFramingRendered: boolean;
				sharedSurfaceRetainedDevice: boolean;
				creatorWorkflow: CreatorWorkflowProof;
				worldLifetime: Awaited<ReturnType<typeof probePregameWorldLifetime>>;
				preparedBodies: number;
				preparedBackgrounds: number;
				subjectRotationPreservedBackdrop: boolean;
				attachmentPlacements: readonly {
					readonly wcid: number;
					readonly requested: number;
					readonly resolved: number;
					readonly partFramesChecked: number;
				}[];
				commands: readonly HostCommandName[];
				sharedAssetsSurvivedPreviewRetirement: boolean;
				remainingSetupLeases: number;
		  };
	let canvas: HTMLCanvasElement;
	let status = $state("loading");
	// Manual user acceptance uses the production creator and assets without a game-server session.
	const showcaseMode = new URLSearchParams(location.search).has(
		"creator-showcase",
	);
	const pickerShowcaseMode = new URLSearchParams(location.search).has(
		"picker-showcase",
	);
	let pickerShowcase = $state.raw<ComponentProps<
		typeof ClientCharacterSelect
	> | null>(null);
	let showcase = $state.raw<ComponentProps<
		typeof ClientCharacterCreator
	> | null>(null);
	const { keyboard } = provideAppInputPolicy();
	let creatorProbe = $state.raw<ComponentProps<
		typeof PregameCreatorHarness
	> | null>(null);
	// Cold mount/source controls for the production component's separate lifecycle probe.
	let surfaceProbe = $state.raw<{
		readonly source: ObjectPreviewSource | null;
		readonly service: ClientObjectPreviewService;
	} | null>(null);
	let proof: Proof = { kind: "loading" };
	const bridge = globalThis as typeof globalThis & {
		__HOLTBURGER_PREGAME_PREVIEW__?: { read(): Proof };
	};
	bridge.__HOLTBURGER_PREGAME_PREVIEW__ = { read: () => proof };

	onMount(() => {
		const retireKeyboard = keyboard.mount(document);
		const url = new URLSearchParams(location.search).get("contentHost");
		if (!url)
			throw new Error("Pre-game preview probe requires a content host.");
		const device = observePreviewDevice(canvas);
		const commands: HostCommandName[] = [];
		const endpoints: Partial<Record<HostCommandName, string>> = {
			load_setup_visual: "/setup-visual",
			load_character_creation_catalog: "/character-creation-catalog",
			resolve_character_creation_appearance: "/character-creation-appearance",
			load_animation: "/animation",
			load_physics_script: "/physics-script",
			load_particle_emitter: "/particle-emitter",
			load_particle_meshes: "/particle-meshes",
			load_texture_pixels: "/texture-pixels",
		};
		// Exercise production host adapters over the existing diagnostic HTTP endpoints.
		const transport: HostTransport = {
			invoke: async (command, args) => {
				commands.push(command);
				const endpoint = endpoints[command];
				if (endpoint === undefined)
					throw new Error(`Unexpected pre-game capability: ${command}`);
				const catalogQuery = command === "load_character_creation_catalog";
				if (catalogQuery) {
					const response = await fetch(new URL(endpoint, url));
					if (!response.ok) throw new Error(await response.text());
					return response.json();
				}
				if (args === undefined || !("request" in args))
					throw new Error(`Missing ${command} request`);
				const response = await fetch(new URL(endpoint, url), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(args.request),
				});
				if (!response.ok) throw new Error(await response.text());
				if (command === "resolve_character_creation_appearance")
					return response.json();
				return new Uint8Array(await response.arrayBuffer());
			},
			listen: async () => {
				throw new Error(
					"Static preview preparation does not subscribe to world events.",
				);
			},
		};
		const assets = new HostPresentationAssets(transport);
		const service = new StandardClientObjectPreviewService({
			resolveResources: () => assets.resources(),
		});
		let disposed = false;
		const start = async (): Promise<void> => {
			if (showcaseMode) {
				showcase = {
					services: {
						loadCatalog: async () => loadCharacterCreationCatalog(transport),
						resolveAppearance: async (request) =>
							resolveCharacterCreationAppearance(transport, request),
						submit: async () => {
							throw new Error("Preview only: no game server is connected.");
						},
					},
					previewService: service,
					management: { kind: "idle" },
					onCancel: () => {
						showcase = null;
						status = "cancelled";
					},
				};
				status = "showcase";
				return;
			}
			const resources = await assets.resources();
			const catalog = await loadCharacterCreationCatalog(transport);
			const heritage = catalog.heritages.find((entry) => entry.id === 1);
			if (heritage === undefined)
				throw new Error("Creation probe requires the Aluvian heritage.");
			const gender = heritage.genders.find((entry) => entry.id === 1);
			if (gender === undefined)
				throw new Error("Creation probe requires the Aluvian male body.");
			const firstColor = (
				styles: CharacterCreationCatalog["heritages"][number]["genders"][number]["shirts"],
			): number => {
				const [first] = styles;
				return first === undefined ? 0 : first.paletteTemplateIds[0];
			};
			const resolve = async (
				heritage: CharacterCreationCatalog["heritages"][number],
				gender: CharacterCreationCatalog["heritages"][number]["genders"][number],
				skinHue: number,
			) =>
				resolveCharacterCreationAppearance(transport, {
					heritage: heritage.id,
					gender: gender.id,
					appearance: {
						eyes: 0,
						nose: 0,
						mouth: 0,
						hairColor: 0,
						eyeColor: 0,
						hairStyle: 0,
						headgearStyle: 0xffff_ffff,
						headgearColor: 0,
						shirtStyle: 0,
						shirtColor: firstColor(gender.shirts),
						pantsStyle: 0,
						pantsColor: firstColor(gender.pants),
						footwearStyle: 0,
						footwearColor: firstColor(gender.footwear),
						skinHue,
						hairHue: 0.5,
						headgearHue: 0,
						shirtHue: 0.5,
						pantsHue: 0.5,
						footwearHue: 0.5,
					},
				});
			const captureSource = (
				visual: Awaited<ReturnType<typeof resolve>>,
			): CapturedSource => ({
				body: visual.body,
				attachments: pregameEquipmentComposition(
					visual,
					visual.body,
				).attachments.map((entry) => {
					if (entry.placement !== 1 && entry.placement !== 6)
						throw new Error("Unexpected picker probe equipment placement");
					return {
						...entry,
						placement: entry.placement === 1 ? "right-hand-combat" : "shield",
					};
				}),
			});
			if (pickerShowcaseMode) {
				const source = captureSource(await resolve(heritage, gender, 0.5));
				const guid = 0x50000043;
				pickerShowcase = {
					state: {
						kind: "character-selection",
						maxSlots: 10,
						selectedGuid: guid,
						characters: [
							{ guid, name: "Cached appearance", slot: 0, deleteTime: 0 },
							{
								guid: guid + 1,
								name: "No saved appearance",
								slot: 1,
								deleteTime: 0,
							},
						],
					},
					entryPending: false,
					management: { kind: "idle" },
					creation: {
						loadCatalog: async () => catalog,
						resolveAppearance: (request) =>
							resolveCharacterCreationAppearance(transport, request),
						submit: async () => {
							throw new Error("Preview only: no game server is connected.");
						},
					},
					previewService: service,
					visualCache: {
						read: async (selected) =>
							selected === guid
								? { kind: "ready", capture: { guid, source } }
								: { kind: "missing" },
						stage: async () => {
							throw new Error("Read-only picker showcase");
						},
						listenFailures: () => () => undefined,
					},
					onChoose: (selectedGuid) => {
						if (pickerShowcase !== null)
							pickerShowcase = {
								...pickerShowcase,
								state: { ...pickerShowcase.state, selectedGuid },
							};
					},
					onEnter: () => {
						status = "Preview only: no game server is connected.";
					},
					onDisconnect: () => {
						pickerShowcase = null;
						status = "disconnected";
					},
				};
				status = "picker showcase";
				return;
			}
			let preparedBodies = 0;
			const backgrounds = new Set<number>();
			for (const candidate of catalog.heritages) {
				for (const body of candidate.genders) {
					const visual = await resolve(candidate, body, 0.5);
					const lease = await acquireObjectPreviewVisual(
						resources.assets,
						visual.body,
						0,
					);
					lease.release();

					preparedBodies++;
					if (visual.backgroundSetupDid !== null)
						backgrounds.add(visual.backgroundSetupDid);
				}
			}
			for (const setupDid of backgrounds) {
				const lease = await acquireObjectPreviewVisual(
					resources.assets,
					{
						setupDid,
						appearance: {
							paletteDid: null,
							subPalettes: [],
							textureChanges: [],
							partChanges: [],
						},
						scale: 1,
						translucency: 0,
						pose: { kind: "setup-pose" },
					},
					0,
				);
				lease.release();
			}
			const visual = await resolve(heritage, gender, 0.5);
			const composition = (body: ObjectPreviewVisual): ObjectPreviewSource =>
				pregameEquipmentComposition(visual, body);
			const { attachmentPlacements, subjectRotationPreservedBackdrop } =
				await probePregameEquipmentFrames(
					resources.assets,
					composition(visual.body),
				);
			const preview = service.open({
				canvas,
				source: composition(visual.body),
			});
			preview.setViewport({
				extent: { width: 512, height: 512 },
				rotation: { kind: "subject", headingRadians: 0, cameraYawRadians: 0 },
				framing: { kind: "body" },
				minimumFrameIntervalSeconds: 1 / 30,
			});
			await preview.ready;
			const diagnostics = preview.diagnostics();
			if (
				diagnostics === null ||
				diagnostics.frameCount === 0 ||
				diagnostics.drawnObjectRangeCount === 0
			)
				throw new Error("Pre-game preview did not draw its prepared model.");
			const installedDevice = device.read();
			const nextFrame = () =>
				new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const nextDrawAfter = async (frameCount: number): Promise<void> => {
				const deadline = performance.now() + 1_000;
				while (performance.now() < deadline) {
					await nextFrame();
					const current = preview.diagnostics();
					if (current !== null && current.frameCount > frameCount) return;
				}
				throw new Error(
					"Installed preview did not draw within its diagnostic deadline.",
				);
			};
			let replacementCount = 0;
			const replacementSamples = 12;
			for (let sample = 0; sample < replacementSamples; sample++) {
				const edited = await resolve(
					heritage,
					gender,
					sample / (replacementSamples - 1),
				);
				const result = await preview.replaceSource(composition(edited.body));
				if (result.kind !== "installed")
					throw new Error("Sequential preview edit was superseded.");
				await nextFrame();
				replacementCount++;
				const current = device.read();
				if (
					current.contextRequests !== 1 ||
					current.programs.created !== installedDevice.programs.created
				)
					throw new Error(
						"Appearance edit rebuilt the mounted preview device or shader.",
					);
				if (current.textures.live > installedDevice.textures.live)
					throw new Error(
						"Appearance edits accumulated obsolete GPU textures.",
					);
			}
			device.failTextureAllocationAfter(2);
			const beforeFailure = preview.diagnostics();
			if (beforeFailure === null)
				throw new Error("Failure probe needs an installed visual.");
			let failedReplacementPreservedVisual = false;
			try {
				await preview.replaceSource(composition(visual.body));
			} catch (cause) {
				if (
					!(cause instanceof Error) ||
					!cause.message.toLowerCase().includes("texture")
				)
					throw cause;
				failedReplacementPreservedVisual = true;
			}
			if (!failedReplacementPreservedVisual)
				throw new Error(
					"Injected texture allocation failure did not reject staging.",
				);
			await nextDrawAfter(beforeFailure.frameCount);
			const afterFailure = preview.diagnostics();
			if (
				beforeFailure === null ||
				afterFailure === null ||
				afterFailure.frameCount <= beforeFailure.frameCount ||
				afterFailure.drawnObjectRangeCount === 0
			)
				throw new Error(
					"Failed staging did not preserve a drawable installed visual.",
				);
			if (device.read().textures.live > installedDevice.textures.live)
				throw new Error("Failed replacement leaked staged textures.");
			preview.setViewport(null);
			const hiddenFrames = preview.diagnostics()?.frameCount;
			await preview.replaceSource(composition(visual.body));
			await nextFrame();
			const hiddenReplacementDidNotDraw =
				preview.diagnostics()?.frameCount === hiddenFrames;
			if (!hiddenReplacementDidNotDraw)
				throw new Error("Hidden replacement resumed drawing.");
			const beforeFace = preview.diagnostics();
			if (beforeFace === null)
				throw new Error("Face probe needs an installed visual.");
			await preview.replaceSource(
				composition({ ...visual.body, translucency: 0.1 }),
			);
			preview.setViewport({
				extent: { width: 512, height: 512 },
				minimumFrameIntervalSeconds: 1 / 30,
				rotation: {
					kind: "subject",
					headingRadians: Math.PI / 3,
					cameraYawRadians: 0,
				},
				framing: {
					kind: "face",
					center: new Vec3(0, 1.65 * visual.body.scale, 0),
					height: 0.5 * visual.body.scale,
				},
			});
			await nextDrawAfter(beforeFace.frameCount);
			const faceFramingRendered =
				(preview.diagnostics()?.drawnObjectRangeCount ?? 0) > 0;
			if (!faceFramingRendered)
				throw new Error("Face framing did not draw the composition.");
			preview.setViewport({
				extent: { width: 512, height: 512 },
				rotation: { kind: "subject", headingRadians: 0, cameraYawRadians: 0 },
				framing: { kind: "body" },
				minimumFrameIntervalSeconds: 1 / 30,
			});
			await nextFrame();
			await preview.withdrawSource();
			if (preview.diagnostics() !== null || device.read().textures.live !== 0)
				throw new Error("Subject withdrawal retained the previous visual.");
			await preview.replaceSource(composition(visual.body));
			await nextFrame();
			if (device.read().textures.peak > installedDevice.textures.live * 2)
				throw new Error(
					"Preview staging exceeded the active-plus-staged texture bound.",
				);
			const finalDiagnostics = preview.diagnostics();
			if (
				finalDiagnostics === null ||
				finalDiagnostics.frameCount <= diagnostics.frameCount
			)
				throw new Error("Retained preview did not draw its replacements.");
			await service.destroy();
			const surfaceService = new StandardClientObjectPreviewService({
				resolveResources: () => assets.resources(),
			});
			let surfaceHandle: ObjectPreviewHandle | null = null;
			let surfaceDevice: ReturnType<typeof observePreviewDevice> | null = null;
			let mountCount = 0;
			let replacementCountOnSurface = 0;
			const surfaceReplacements = (): number => replacementCountOnSurface;
			let completeReplacement: () => void = () => {
				throw new Error(
					"Surface replacement completed before its probe started.",
				);
			};
			const surfaceReplacement = new Promise<void>((resolve) => {
				completeReplacement = resolve;
			});
			const observedService: ClientObjectPreviewService = {
				open: (request) => {
					mountCount++;
					surfaceDevice = observePreviewDevice(request.canvas);
					const handle = surfaceService.open(request);
					surfaceHandle = handle;
					return {
						ready: handle.ready,
						diagnostics: () => handle.diagnostics(),
						setViewport: (viewport) => handle.setViewport(viewport),
						withdrawSource: () => handle.withdrawSource(),
						dispose: () => handle.dispose(),
						replaceSource: async (source) => {
							replacementCountOnSurface++;
							const result = await handle.replaceSource(source);
							completeReplacement();
							return result;
						},
					};
				},
			};
			const mountedHandle = (): ObjectPreviewHandle => {
				if (surfaceHandle === null)
					throw new Error("Shared preview component did not mount its owner.");
				return surfaceHandle;
			};
			const mountedDevice = (): PreviewDeviceProbeSnapshot => {
				if (surfaceDevice === null)
					throw new Error("Shared preview component did not request a device.");
				return surfaceDevice.read();
			};
			try {
				surfaceProbe = {
					source: composition(visual.body),
					service: observedService,
				};
				await tick();
				await mountedHandle().ready;
				surfaceProbe = {
					source: composition({ ...visual.body, translucency: 0.1 }),
					service: observedService,
				};
				await surfaceReplacement;
				await nextFrame();
				const installed = mountedDevice();
				if (
					mountCount !== 1 ||
					surfaceReplacements() !== 1 ||
					installed.contextRequests !== 1 ||
					installed.programs.created !== 1
				)
					throw new Error(
						"Cold source changes rebuilt the shared preview component's device.",
					);
				surfaceProbe = { source: null, service: observedService };
				await tick();
				if (mountedHandle().diagnostics() !== null)
					throw new Error(
						"Subject withdrawal left the previous character visible.",
					);
				surfaceProbe = {
					source: composition(visual.body),
					service: observedService,
				};
				const deadline = performance.now() + 2_000;
				while (
					mountedHandle().diagnostics() === null &&
					performance.now() < deadline
				)
					await nextFrame();
				if (
					mountedHandle().diagnostics() === null ||
					mountCount !== 1 ||
					surfaceReplacements() !== 2 ||
					mountedDevice().contextRequests !== 1 ||
					mountedDevice().programs.created !== 1
				)
					throw new Error(
						"Restoring an empty shared surface rebuilt its device or failed to install.",
					);
			} finally {
				surfaceProbe = null;
				await tick();
				await surfaceService.destroy();
			}
			const closedSurface = mountedDevice();
			if (
				closedSurface.programs.live !== 0 ||
				closedSurface.textures.live !== 0 ||
				closedSurface.buffers.live !== 0 ||
				closedSurface.vertexArrays.live !== 0
			)
				throw new Error(
					"Shared preview component unmount retained GPU resources.",
				);
			const creatorWorkflow = await new Promise<CreatorWorkflowProof>(
				(resolve, reject) => {
					creatorProbe = {
						transport,
						contentUrl: url,
						resources,
						savedVisual: captureSource(visual),
						onComplete: resolve,
						onFailure: reject,
					};
				},
			);
			creatorProbe = null;
			await tick();
			const worldLifetime = await probePregameWorldLifetime(
				assets,
				transport,
				url,
				composition(visual.body),
			);
			const retained = await assets.resources();
			await assets.destroy();
			const retired = device.read();
			if (
				retired.programs.live !== 0 ||
				retired.textures.live !== 0 ||
				retired.buffers.live !== 0 ||
				retired.vertexArrays.live !== 0
			)
				throw new Error("Preview shutdown retained native GPU resources.");
			if (disposed) return;
			proof = {
				kind: "ready",
				device: retired,
				replacementCount,
				failedReplacementPreservedVisual,
				hiddenReplacementDidNotDraw,
				faceFramingRendered,
				sharedSurfaceRetainedDevice: true,
				creatorWorkflow,
				worldLifetime,
				diagnostics: finalDiagnostics,
				preparedBodies,
				preparedBackgrounds: backgrounds.size,
				attachmentPlacements,
				subjectRotationPreservedBackdrop,
				commands,
				sharedAssetsSurvivedPreviewRetirement:
					retained.assets === resources.assets,
				remainingSetupLeases:
					resources.assets.setupVisuals.getDiagnostics().referenceCount,
			};
			status = proof.kind;
		};
		const completion = start().catch((error: unknown) => {
			if (disposed) return;
			proof = {
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			};
			status = proof.kind;
		});
		return () => {
			retireKeyboard();
			disposed = true;
			delete bridge.__HOLTBURGER_PREGAME_PREVIEW__;
			void service
				.destroy()
				.then(() => completion)
				.then(() => assets.destroy())
				.catch(console.error);
		};
	});
</script>

<p>Pre-game preview probe: {status}</p>
{#if showcase !== null}
	<div
		class="ui-theme ui-panel"
		style="max-width: 1080px; margin: 20px auto; padding: 20px;"
	>
		<ClientCharacterCreator {...showcase} />
	</div>
{/if}
{#if pickerShowcase !== null}
	<div
		class="ui-theme ui-panel"
		style="max-width: 1080px; margin: 20px auto; padding: 20px;"
	>
		<ClientCharacterSelect {...pickerShowcase} />
	</div>
{/if}
{#if creatorProbe !== null}<PregameCreatorHarness {...creatorProbe} />{/if}
<canvas
	bind:this={canvas}
	style="width: 512px; height: 512px;"
	style:display={showcaseMode || pickerShowcaseMode ? "none" : "block"}
></canvas>
{#if surfaceProbe !== null}
	<div style="width: 512px; height: 512px;">
		<ClientModelPreview
			source={surfaceProbe.source}
			emptyMessage="No probe subject"
			service={surfaceProbe.service}
			rotation="subject"
			framing={{ kind: "body" }}
		/>
	</div>
{/if}
