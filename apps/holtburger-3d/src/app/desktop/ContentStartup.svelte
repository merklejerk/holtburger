<script lang="ts">
	import PowerIcon from "../../assets/icons/hud-power.svg?component";
	import { getAllContexts, onMount } from "svelte";
	import AssetSetup from "./AssetSetup.svelte";
	import LoadingScreen from "./LoadingScreen.svelte";
	import {
		isLauncherReturnAvailable,
		returnToLauncher,
	} from "./launcher-navigation";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type { ContentStartupSnapshot } from "./content-startup-contract";
	import { createContentStartupTransport } from "./content-startup-transport";
	import { StartupGameLifecycle } from "./startup-game-lifecycle";
	import { registerElectronStartupClose } from "../../lib/host/electron-host-transport";

	type StartupPageState =
		| {
				readonly kind: "pending";
				readonly title: string;
				readonly message: string;
		  }
		| {
				readonly kind: "failed";
				readonly title: string;
				readonly message: string;
				readonly details: string;
		  };

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
	const modeLabel = $derived(mode === "explorer" ? "Explorer" : "client");
	const page = $derived.by((): StartupPageState | null => {
		if (failure !== null)
			return {
				kind: "failed",
				title: "Unable to continue",
				message: mounted
					? "Application failed."
					: "Application startup failed.",
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
					title: "Game assets need attention",
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
					title: `Preparing ${modeLabel}`,
					message: "Starting the application…",
				};
			case "loading":
				return {
					kind: "pending",
					title: `Preparing ${modeLabel} assets`,
					message: phase.message,
				};
			case undefined:
				return {
					kind: "pending",
					title: `Preparing ${modeLabel} assets`,
					message: "Locating game assets…",
				};
		}
	});
	function report(error: unknown): void {
		console.error(
			mounted ? "Application failed" : "Application startup failed",
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		// A cleanup failure must not replace the diagnostic that first stopped the application.
		failure ??= error instanceof Error ? error.message : String(error);
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
		const lifecycle = new StartupGameLifecycle();
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
		const unregisterClose = registerElectronStartupClose(lifecycle);
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
				onBack={isLauncherReturnAvailable()
					? () => run(() => returnToLauncher(failure))
					: null}
			/>
		{:else if page !== null}
			{@const pending = page.kind === "pending"}
			<LoadingScreen
				branding="hero"
				showPortalLogo={!pending}
				{pending}
				failed={!pending}
				headingIcon={pending ? "portal" : "warning"}
				title={page.title}
				statusKind={pending ? "real" : "failed"}
				statusMessage={pending
					? `${page.title} · ${page.message}`
					: page.message}
				details={page.kind === "failed" ? page.details : null}
				detailsKey={JSON.stringify([page.kind, page.title, page.message])}
				contentLocation={phase !== undefined && "location" in phase
					? phase.location
					: null}
			>
				{#snippet footer()}
					{#if isLauncherReturnAvailable()}
						<button
							class="pregame-action pregame-quiet ui-button"
							type="button"
							onclick={() => run(() => returnToLauncher(failure))}
							>{pending
								? "Cancel"
								: mode === "explorer"
									? "Back to Explorer launcher"
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
							This launch uses an explicit asset selection. Recovery choices do
							not change the application default.
						</p>
					{/if}
				{/snippet}
			</LoadingScreen>
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
