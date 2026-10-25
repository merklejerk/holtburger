<script lang="ts">
	import { onMount, type ComponentProps } from "svelte";
	import { encode } from "@msgpack/msgpack";
	import { z } from "zod";
	import { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
	import type { ClientClosePreparation } from "../../client/client-close-contract";
	import ClientApp from "../../client/ClientApp.svelte";
	import { createClientShortcuts } from "../../client/ClientShortcutDock.svelte";
	import { createDefaultClientUserSettings } from "../../client/client-settings-defaults";
	import { soulEmoteFixture } from "../../client/client-soul-emotes.test-support";
	import {
		initialCreationDraft,
		creationAppearanceRequest,
	} from "../../client/client-character-creation";
	import {
		loadCharacterCreationCatalog,
		resolveCharacterCreationAppearance,
	} from "../../client/client-character-creation-contract";
	import { pregameContentTransport } from "./pregame-content-transport";
	import { pregameGameplayFixture } from "./pregame-gameplay-fixture";
	import { pregameEquipmentComposition } from "./pregame-equipment-probe";
	import type { ObjectPreviewSource } from "../../client/client-object-preview-contract";

	/** Controllable host response barrier; diagnostic code never changes production readiness. */
	function loadingGate(heldInitially: boolean) {
		let completion = Promise.resolve();
		let release = () => {};
		let held = false;
		let waiting = 0;
		const hold = () => {
			if (held) throw new Error("Fixture gate already held");
			held = true;
			completion = new Promise<void>((resolve) => {
				release = resolve;
			});
		};
		if (heldInitially) hold();
		return {
			hold,
			release: () => {
				held = false;
				release();
			},
			wait: async () => {
				waiting++;
				try {
					await completion;
				} finally {
					waiting--;
				}
			},
			read: () => ({ held, waiting }),
		};
	}
	const controlledLoading = new URLSearchParams(location.search).has(
		"presentation-gates",
	);
	let loadingControls = $state.raw<{
		connection: () => void;
		scene: () => void;
	} | null>(null);
	let props = $state.raw<ComponentProps<typeof ClientApp> | null>(null);
	let status = $state("Preparing production-client fixture…");

	onMount(() => {
		const url = new URLSearchParams(location.search).get("contentHost");
		if (url === null)
			throw new Error("Client presentation fixture requires contentHost");
		let closed = false;
		const previousBridge = window.holtburgerHost;
		const previousStartup = window.holtburgerClient;
		const nativeGetContext = HTMLCanvasElement.prototype.getContext;
		const worlds = new Set<HTMLCanvasElement>();
		let worldContextRequests = 0;
		let worldDraws = 0;
		let rosterDelivered = false;
		let sceneResponses = 0;
		let failScene = false;
		let failConnection = false;
		const connection = loadingGate(controlledLoading);
		const scene = loadingGate(controlledLoading);
		const retirement = loadingGate(false);
		const captureStaging = loadingGate(false);
		let prepareClose: (() => Promise<ClientClosePreparation>) | null = null;
		let closeResult: ClientClosePreparation | null = null;
		// Hold actual borrower withdrawal as well as camera IPC: logout can implicitly retire the native camera.
		const replaceSnapshot =
			GamePresentationRuntime.prototype.replaceDynamicEntitySnapshot;
		GamePresentationRuntime.prototype.replaceDynamicEntitySnapshot =
			async function (entities) {
				const completion = replaceSnapshot.call(this, entities);
				if (entities.length === 0) await retirement.wait();
				return completion;
			};
		const expectedErrors: string[] = [];
		const reportError = console.error;
		console.error = (...args) => {
			if (
				controlledLoading &&
				args.length === 1 &&
				args[0] instanceof Error &&
				args[0].message.startsWith("Presentation fixture: ")
			) {
				expectedErrors.push(args[0].message);
				return;
			}
			reportError(...args);
		};
		loadingControls = { connection: connection.release, scene: scene.release };
		// Machine proof of persistent surface identity, independent of production instrumentation.
		Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
			configurable: true,
			writable: true,
			value: function (
				this: HTMLCanvasElement,
				kind: string,
				options?: unknown,
			) {
				const context = nativeGetContext.call(this, kind, options);
				if (kind === "webgl2" && this.classList.contains("client-canvas")) {
					worldContextRequests++;
					if (!worlds.has(this) && context instanceof WebGL2RenderingContext) {
						const drawElements = context.drawElements.bind(context);
						context.drawElements = (...args) => {
							worldDraws++;
							drawElements(...args);
						};
						const drawArrays = context.drawArrays.bind(context);
						context.drawArrays = (...args) => {
							worldDraws++;
							drawArrays(...args);
						};
					}
					worlds.add(this);
				}
				return context;
			},
		});
		const bridge = globalThis as typeof globalThis & {
			__HOLTBURGER_CLIENT_PRESENTATION__?: {
				read(): {
					worldCanvases: number;
					worldContextRequests: number;
					portalReveals: number;
					/** User logout requests received by the fixture authority. */
					logoutRequests: number;
					/** Actual GPU draws prove the scene progresses behind the opaque loading page. */
					worldDraws: number;
					/** Authority delivery and host barriers establish independent readiness ordering. */
					rosterDelivered: boolean;
					sceneResponses: number;
					gates: {
						connection: ReturnType<typeof connection.read>;
						scene: ReturnType<typeof scene.read>;
						retirement: ReturnType<typeof retirement.read>;
						captures: ReturnType<typeof captureStaging.read>;
					};
					expectedErrors: readonly string[];
					closeResult: ClientClosePreparation | null;
				};
				/** Terminal authority edge carrying the connection-loss diagnostic. */
				failSession(): void;
				releaseConnection(): void;
				releaseScene(): void;
				holdRetirement(): void;
				holdCaptureStaging(): void;
				releaseCaptureStaging(): void;
				publishCapture(): void;
				beginClose(): void;
				releaseRetirement(): void;
				failScene(): void;
				failConnection(): void;
				authenticate(): void;
				/** Deliver a notice through the real session event path during loading. */
				notify(message: string, tone: "status" | "warning"): void;
			};
		};
		const content = pregameContentTransport(url);
		const start = async () => {
			const catalog = await loadCharacterCreationCatalog(content);
			const draft = initialCreationDraft(catalog, 1, 1, "Fixture", () => 0.5);
			const visual = await resolveCharacterCreationAppearance(
				content,
				creationAppearanceRequest(draft, false),
			);
			if (closed) return;
			const source: ObjectPreviewSource = {
				body: visual.body,
				attachments: pregameEquipmentComposition(
					visual,
					visual.body,
				).attachments.map((entry) => {
					if (entry.placement !== 1 && entry.placement !== 6)
						throw new Error("Unexpected fixture placement");
					return {
						...entry,
						placement: entry.placement === 1 ? "right-hand-combat" : "shield",
					};
				}),
			};
			const authority = pregameGameplayFixture(visual.body);
			const emptyRoster = new URLSearchParams(location.search).has(
				"empty-roster",
			);
			authority.selection(emptyRoster);
			const tokens = new Map<number, () => void>();
			let token = 0;
			const iconCanvas = document.createElement("canvas");
			iconCanvas.width = 32;
			iconCanvas.height = 32;
			const iconContext = iconCanvas.getContext("2d");
			if (iconContext === null)
				throw new Error("Fixture icon context unavailable");
			iconContext.fillStyle = "#a58a55";
			iconContext.fillRect(0, 0, 32, 32);
			const image = Uint8Array.from(
				atob(iconCanvas.toDataURL().split(",")[1]),
				(value) => value.charCodeAt(0),
			);
			window.holtburgerClient = {
				quit: async () => {
					if (prepareClose === null)
						throw new Error("Client close handler not registered.");
					closeResult = await prepareClose();
				},
				onPrepareClose: (handler) => {
					prepareClose = handler;
					return () => {
						if (prepareClose === handler) prepareClose = null;
					};
				},
				start: async () => {
					await connection.wait();
					if (failConnection) {
						failConnection = false;
						throw new Error("Presentation fixture: connection failed");
					}
					// Authentication progress and the later roster are distinct authority stages.
					authority.selection(emptyRoster);
				},
			};
			let disconnected = false;
			let disconnectRequests = 0;
			window.holtburgerHost = {
				invoke: async (command, args) => {
					if (closeResult !== null)
						throw new Error(`Host request after close preparation: ${command}`);
					if (
						disconnected &&
						(command === "stop_client_camera" ||
							command === "set_client_camera_intent" ||
							command === "set_client_camera_clearance")
					)
						throw new Error(
							"Presentation fixture: client host is shutting down",
						);
					if (command === "request_client_current_state") {
						const result = await authority.invoke(command, args);
						rosterDelivered = true;
						return result;
					}
					if (command === "load_landblock_profile") {
						await scene.wait();
						if (failScene) {
							failScene = false;
							throw new Error("Presentation fixture: scene failed");
						}
						const result = await content.invoke(command, args);
						sceneResponses++;
						return result;
					}
					if (command === "stop_client_camera") await retirement.wait();
					if (command === "disconnect_client") {
						disconnectRequests++;
						disconnected = true;
						authority.exit("explicit-disconnect", "Fixture disconnected");
						return;
					}
					if (command === "host_status")
						return {
							entityMetadata: {
								status: "unavailable",
								path: null,
								kind: "missing",
								reason: "Presentation fixture has no server catalog",
							},
						};
					if (command === "load_soul_emotes")
						return soulEmoteFixture().references;
					if (command === "prepare_ui_icons") {
						const request = z
							.object({ icons: z.array(z.object({ key: z.string() })) })
							.parse(args?.request);
						return encode(
							request.icons.map(({ key }) => ({ kind: "ready", key, image })),
						);
					}
					if (command === "create_client_character")
						throw new Error("Preview only: no server character creation");
					if (
						command.startsWith("load_") ||
						command === "resolve_character_creation_appearance"
					)
						return content.invoke(command, args);
					return authority.invoke(command, args);
				},
				listen: async (event, handler) => {
					const id = ++token;
					tokens.set(id, await authority.listen(event, handler));
					return id;
				},
				unlisten: async (id) => {
					tokens.get(id)?.();
					tokens.delete(id);
				},
			};
			bridge.__HOLTBURGER_CLIENT_PRESENTATION__ = {
				read: () => ({
					worldCanvases: worlds.size,
					worldContextRequests,
					portalReveals: authority.acknowledgements(),
					logoutRequests: authority.logoutRequests(),
					disconnectRequests,
					worldDraws,
					rosterDelivered,
					sceneResponses,
					gates: {
						connection: connection.read(),
						scene: scene.read(),
						retirement: retirement.read(),
						captures: captureStaging.read(),
					},
					expectedErrors,
					closeResult,
				}),
				failSession: () =>
					authority.exit(
						"server-disconnect",
						"The server closed the connection for maintenance.",
					),
				releaseConnection: connection.release,
				releaseScene: scene.release,
				holdRetirement: retirement.hold,
				holdCaptureStaging: captureStaging.hold,
				releaseCaptureStaging: captureStaging.release,
				publishCapture: () => {
					const guid = authority.snapshot().localPlayerGuid;
					if (guid === null)
						throw new Error("Fixture capture requires a local player.");
					authority.capture({ guid, source });
				},
				beginClose: () => {
					if (prepareClose === null)
						throw new Error("Client close handler not registered.");
					void prepareClose().then(
						(result) => {
							closeResult = result;
						},
						(error) => console.error(error),
					);
				},
				releaseRetirement: retirement.release,
				failScene: () => {
					failScene = true;
					scene.release();
				},
				failConnection: () => {
					failConnection = true;
					connection.release();
				},
				authenticate: authority.authenticate,
				notify: authority.notify,
			};
			props = {
				initialUserSettings: createDefaultClientUserSettings(
					{ width: innerWidth, height: innerHeight },
					createClientShortcuts(false).length,
				),
				initialSettingsIssue: null,
				settingsTransport: {
					loadUser: async () => ({
						sections: {},
						hudPlacements: {},
						unavailable: [],
						repaired: [],
					}),
					saveUserPatch: async () => {},
					resetUser: async () => [],
					loadCharacter: async () => ({
						sections: {},
						unavailable: [],
						repaired: [],
					}),
					saveCharacterPatch: async () => {},
				},
				visualCacheTransport: {
					read: async (guid) =>
						guid === 0x50000043
							? { kind: "ready", capture: { guid, source } }
							: { kind: "missing" },
					stage: async () => {
						await captureStaging.wait();
					},
					listenFailures: () => () => {},
				},
			};
		};
		void start().catch((error: unknown) => {
			if (!closed) {
				status = String(error);
				console.error(error);
			}
		});
		return () => {
			closed = true;
			connection.release();
			scene.release();
			retirement.release();
			captureStaging.release();
			GamePresentationRuntime.prototype.replaceDynamicEntitySnapshot =
				replaceSnapshot;
			console.error = reportError;
			HTMLCanvasElement.prototype.getContext = nativeGetContext;
			window.holtburgerHost = previousBridge;
			window.holtburgerClient = previousStartup;
			delete bridge.__HOLTBURGER_CLIENT_PRESENTATION__;
		};
	});
</script>

{#if props !== null}<ClientApp {...props} />{:else}<p role="status">
		{status}
	</p>{/if}

{#if controlledLoading && loadingControls !== null}
	<aside
		class="loading-controls ui-panel ui-body"
		aria-label="Harness loading controls"
	>
		<button class="ui-button" onclick={loadingControls.connection}
			>Provide characters</button
		>
		<button class="ui-button" onclick={loadingControls.scene}
			>Release scene</button
		>
	</aside>
{/if}

<style>
	.loading-controls {
		position: fixed;
		bottom: 12px;
		right: 12px;
		z-index: 100;
		display: flex;
		gap: 12px;
	}
</style>
