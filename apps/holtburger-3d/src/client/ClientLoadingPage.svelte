<script module lang="ts">
	/** App-owned page content; only recoverable failures carry a retry action. */
	export type ClientLoadingPageState =
		| {
				readonly kind: "pending";
				readonly title: string;
				readonly message: string;
		  }
		| {
				readonly kind: "failed";
				readonly title: string;
				readonly message: string;
				readonly retry: (() => void) | null;
		  };
</script>

<script lang="ts">
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	interface Props {
		/** Connection and scene admission policy is resolved by ClientApp. */
		readonly state: ClientLoadingPageState;
		/** Null while no session exists or exit is already underway. */
		readonly onDisconnect: (() => Promise<void>) | null;
	}
	const { state, onDisconnect }: Props = $props();
	const { keyboard } = useAppInputPolicy();
</script>

<main
	class="client-screen client-loading-page ui-theme"
	aria-label="Holtburger client"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	<section class="ui-panel">
		<header class="ui-frame">Holtburger 3D Client</header>
		<div class="loading-content ui-body">
			<h1>{state.title}</h1>
			<p
				class:ui-error={state.kind === "failed"}
				role={state.kind === "failed" ? "alert" : "status"}
			>
				{state.message}
			</p>
			<div class="loading-actions">
				{#if state.kind === "failed" && state.retry !== null}
					<button class="ui-button" type="button" onclick={state.retry}
						>Retry scene</button
					>
				{/if}
				<button
					class="ui-button"
					type="button"
					disabled={onDisconnect === null}
					onclick={() => void onDisconnect?.()}>Disconnect</button
				>
			</div>
		</div>
	</section>
</main>

<style>
	@layer components {
		.client-loading-page {
			position: fixed;
			inset: 0;
			display: grid;
			place-items: center;
			padding: clamp(16px, 5vw, 48px);
			background: var(--ui-color-well);
		}
		.client-loading-page > section {
			width: min(100%, 640px);
		}
		.loading-content {
			display: grid;
			gap: 12px;
		}
		.loading-content > p {
			margin: 0;
		}
		.loading-actions {
			display: flex;
			gap: 12px;
		}
	}
</style>
