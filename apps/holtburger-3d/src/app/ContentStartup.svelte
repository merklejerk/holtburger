<script lang="ts">
	import { launcherTransport } from "../launcher/launcher-transport";
	import PowerIcon from "../assets/icons/hud-power.svg?component";
	import { getAllContexts, onMount } from "svelte";
	import AssetSetup from "./AssetSetup.svelte";
	import ClientLoadingPage from "../client/ClientLoadingPage.svelte";
	import type { ClientLoadingPageState } from "../client/client-loading-page";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { ContentStartupSnapshot } from "./content-startup-contract";
	import { createContentStartupTransport } from "./content-startup-transport";
	import { StartupGameLifecycle } from "./startup-game-lifecycle";
	import { registerElectronStartupClose } from "../lib/host/electron-host-transport";

	interface Props {
		/** The selected game entry remains unconstructed until native content admission. */
		mode: "client" | "explorer";
		/** Own asynchronous entry bootstrap and mount; false means close cancelled construction. */
		startGame: (
			target: HTMLElement,
			signal: AbortSignal,
			context: Map<unknown, unknown>,
			contentLocation: string,
		) => Promise<boolean>;
	}
	const { mode, startGame }: Props = $props();
	const transport = createContentStartupTransport();
	const input = provideAppInputPolicy();
	const context: Map<unknown, unknown> = getAllContexts();
	let snapshot = $state<ContentStartupSnapshot | null>(null);
	let failure = $state<string | null>(null);
	let mounted = $state(false);
	let gameTarget: HTMLDivElement;
	const phase = $derived(snapshot?.phase);
	const overlay = $derived(
		!mounted ||
			phase?.kind === "restart_required" ||
			phase?.kind === "persistence_failed" ||
			phase?.kind === "fatal" ||
			failure !== null,
	);
	const page = $derived.by((): ClientLoadingPageState | null => {
		if (failure !== null)
			return {
				kind: "failed",
				title: "Unable to continue",
				message: "Application startup failed.",
				details: failure,
			};
		switch (phase?.kind) {
			case "needs_assets":
				return null;
			case "persistence_failed":
				return {
					kind: "failed",
					title: "Unable to remember assets",
					message: "Your asset preferences could not be saved.",
					details: phase.message,
				};
			case "restart_required":
				return {
					kind: "failed",
					title: "Client assets need attention",
					message:
						"Restart Holtburger to retry this location or choose another folder.",
					details: phase.message,
				};
			case "fatal":
				return {
					kind: "failed",
					title: "Unable to continue",
					message: "Application startup failed.",
					details: phase.message,
				};
			case "ready":
				return {
					kind: "pending",
					activity: "assets",
					title: "Preparing client",
					message: "Starting the application…",
				};
			case "loading":
				return {
					kind: "pending",
					activity: "assets",
					title: "Preparing client assets",
					message: phase.message,
				};
			case undefined:
				return {
					kind: "pending",
					activity: "assets",
					title: "Preparing client assets",
					message: "Locating client assets…",
				};
		}
	});
	function report(error: unknown): void {
		console.error("Application startup failed", error);
		failure = error instanceof Error ? error.message : String(error);
	}
	function run(action: () => Promise<void>): void {
		void action().catch(report);
	}

	// Startup/recovery is a cold UI transition. The existing gate cancels held world
	// input and blocks game shortcuts while the shared shell covers the game.
	$effect(() => {
		if (overlay) return input.viewport.block();
	});

	onMount(() => {
		const unmountKeyboard = input.keyboard.mount(document);
		const lifecycle = new StartupGameLifecycle(mode);
		const failedEffect = (event: ErrorEvent) => {
			const error =
				event.error instanceof Error ? event.error : new Error(event.message);
			lifecycle.failMount(error);
			report(error);
		};
		const failedPromise = (event: PromiseRejectionEvent) => {
			const error =
				event.reason instanceof Error
					? event.reason
					: new Error(String(event.reason));
			lifecycle.failMount(error);
			report(error);
		};
		window.addEventListener("error", failedEffect);
		window.addEventListener("unhandledrejection", failedPromise);
		const unregisterClose =
			mode === "client" ? registerElectronStartupClose(lifecycle) : null;
		const unsubscribe = transport.subscribe((next) => {
			snapshot = next;
			if (next.phase.kind === "ready") {
				const contentLocation = next.phase.location;
				void lifecycle
					.start(async (signal) => {
						const started = await startGame(
							gameTarget,
							signal,
							context,
							contentLocation,
						);
						if (started) mounted = true;
						return started;
					})
					.catch(report);
			}
		}, report);
		return () => {
			unmountKeyboard();
			unsubscribe();
			unregisterClose?.();
			window.removeEventListener("error", failedEffect);
			window.removeEventListener("unhandledrejection", failedPromise);
		};
	});
</script>

<div class="game-root" bind:this={gameTarget} inert={overlay}></div>
{#if overlay}
	<div class="startup-overlay" aria-busy={page?.kind === "pending"}>
		{#if failure === null && phase?.kind === "needs_assets"}
			<AssetSetup
				state={phase}
				temporary={snapshot?.temporary === true}
				onChoose={() => run(transport.choose)}
				onRetry={() => run(transport.retry)}
				onQuit={() => run(transport.quit)}
				onBack={mode === "client" &&
				window.holtburgerLauncher?.enabled !== false
					? () => run(() => launcherTransport().back(failure))
					: null}
			/>
		{:else if page !== null}
			<ClientLoadingPage
				state={page}
				toast={null}
				contentLocation={phase !== undefined && "location" in phase
					? phase.location
					: null}
			>
				{#snippet footer()}
					{#if mode === "client" && window.holtburgerLauncher?.enabled !== false}
						<button
							class="pregame-action pregame-quiet ui-button"
							type="button"
							onclick={() => run(() => launcherTransport().back(failure))}
							>{page?.kind === "pending"
								? "Cancel"
								: "Back to launcher"}</button
						>
					{/if}
					<button
						class="pregame-action pregame-quiet ui-button"
						type="button"
						onclick={() => run(transport.quit)}
						><span class="pregame-icon" aria-hidden="true"><PowerIcon /></span
						><span>Quit application</span></button
					>
				{/snippet}
				{#snippet actions()}
					{#if failure === null && phase?.kind === "persistence_failed"}
						<button
							class="pregame-primary pregame-action ui-button"
							type="button"
							onclick={() => run(transport.retry)}>Retry saving</button
						>
					{/if}
				{/snippet}
				{#snippet children()}
					{#if snapshot?.temporary}
						<p>
							This launch uses a temporary asset selection. This selection will
							not be saved.
						</p>
					{/if}
				{/snippet}
			</ClientLoadingPage>
		{/if}
	</div>
{/if}

<style>
	.game-root {
		position: absolute;
		inset: 0;
	}
	.startup-overlay {
		position: fixed;
		inset: 0;
		z-index: 10000;
	}
</style>
