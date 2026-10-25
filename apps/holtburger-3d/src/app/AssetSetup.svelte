<script lang="ts">
	import PowerIcon from "../assets/icons/hud-power.svg?component";
	import ClientPregameScreen from "../client/ClientPregameScreen.svelte";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import type { ContentStartupPhase } from "./content-startup-contract";

	interface Props {
		/** Native setup state remains active while the folder browser is open. */
		readonly state: Extract<ContentStartupPhase, { kind: "needs_assets" }>;
		/** A replacement picked during a CLI override is also temporary. */
		readonly temporary: boolean;
		/** The shell owns operation failures and native actions. */
		readonly onChoose: () => void;
		/** Retry admission is supplied by native startup. */
		readonly onRetry: () => void;
		/** Quit remains available before any game runtime exists. */
		readonly onQuit: () => void;
	}
	const { state, temporary, onChoose, onRetry, onQuit }: Props = $props();
	const id = $props.id();
	const titleId = `${id}-asset-title`;
</script>

<ClientPregameScreen branding="hero" showPortalLogo={true} backdrop={false}>
	{#snippet footer()}
		<button
			class="pregame-action pregame-quiet ui-button"
			type="button"
			onclick={onQuit}
			><span class="pregame-icon" aria-hidden="true"><PowerIcon /></span><span
				>Quit application</span
			></button
		>
	{/snippet}
	<div class="asset-setup-page">
		<section
			class="asset-setup ui-body"
			aria-labelledby={titleId}
			aria-busy={state.choosing}
		>
			<header class="asset-heading">
				{#if state.message !== null}<span
						class="asset-warning"
						aria-hidden="true"><WarningIcon /></span
					>{/if}
				<h1 id={titleId}>
					{state.message === null
						? "Choose your game assets"
						: "Unable to load game assets"}
				</h1>
			</header>
			<p class="asset-instructions">
				Choose a folder containing all end-of-retail Asheron's Call DAT files or
				a Holtburger full-profile HBA file.
			</p>
			{#if state.location !== null}
				<p class="asset-location">Assets: <span>{state.location}</span></p>
			{/if}
			{#if state.message !== null}<p class="asset-diagnostic" role="alert">
					{state.message}
				</p>{/if}
			{#if temporary}<p class="asset-hint">
					This launch uses a temporary asset selection. This selection will not
					be saved.
				</p>{/if}
			<div class="asset-actions">
				<button
					class="pregame-primary pregame-action ui-button"
					type="button"
					disabled={state.choosing}
					onclick={onChoose}>Choose folder</button
				>
				{#if state.canRetry}<button
						class="pregame-action ui-button"
						type="button"
						disabled={state.choosing}
						onclick={onRetry}>Try again</button
					>{/if}
			</div>
		</section>
	</div>
</ClientPregameScreen>

<style>
	@layer components {
		.asset-setup-page {
			display: grid;
			align-content: center;
			justify-items: center;
			min-width: 0;
		}
		.asset-setup {
			display: grid;
			gap: 24px;
			width: min(100%, 40rem);
			text-align: left;
			overflow-wrap: anywhere;
		}
		.asset-setup h1,
		.asset-setup p {
			margin: 0;
		}
		.asset-heading {
			display: flex;
			align-items: center;
			gap: 10px;
			font-size: calc(var(--ui-font-size-heading-1) * var(--ui-text-scale));
		}
		.asset-heading h1 {
			font-size: inherit;
		}
		.asset-warning {
			flex: none;
			width: 1em;
			height: 1em;
			color: var(--ui-color-danger);
		}
		.asset-warning > :global(svg) {
			display: block;
			width: 100%;
			height: 100%;
		}
		.asset-instructions {
			line-height: 1.6;
		}
		.asset-location,
		.asset-hint {
			color: var(--ui-color-muted);
		}
		.asset-location > span {
			font-family: var(--ui-font-mono);
		}
		.asset-location,
		.asset-diagnostic {
			user-select: text;
		}
		.asset-diagnostic {
			white-space: pre-wrap;
			max-height: 24dvh;
			overflow: auto;
			line-height: 1.5;
			color: var(--ui-color-danger);
		}
		.asset-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 12px;
			padding-top: 8px;
		}
	}
</style>
