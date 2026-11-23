<script lang="ts">
	import type { Snippet } from "svelte";
	import LoadingPortal from "../../../../../assets/branding/portal.svg?component";
	import DisconnectIcon from "../../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../../assets/icons/pregame-warning.svg?component";
	import PregameScreen from "./PregameScreen.svelte";

	export type LoadingScreenStatusKind =
		"real" | "playful" | "warning" | "failed";

	interface Props {
		readonly branding: "hero" | "corner";
		readonly showPortalLogo: boolean;
		readonly pending: boolean;
		readonly failed: boolean;
		readonly headingIcon: "portal" | "warning" | "disconnect" | null;
		readonly title: string;
		readonly statusKind: LoadingScreenStatusKind;
		readonly statusMessage: string;
		readonly details: string | null;
		readonly detailsKey: string;
		readonly contentLocation: string | null;
		readonly footer: Snippet;
		readonly actions: Snippet;
		readonly children?: Snippet;
	}

	const {
		branding,
		showPortalLogo,
		pending,
		failed,
		headingIcon,
		title,
		statusKind,
		statusMessage,
		details,
		detailsKey,
		contentLocation,
		footer: footerActions,
		actions,
		children,
	}: Props = $props();

	// Recovery can cover a still-mounted session loading page; each label owns its identity.
	const id = $props.id();
	const titleId = `${id}-loading-title`;
</script>

<PregameScreen {branding} {showPortalLogo} backdrop={false}>
	{#snippet footer()}
		{@render footerActions()}
		{#if contentLocation !== null}
			<span class="loading-assets" title={contentLocation}
				>Assets: {contentLocation}</span
			>
		{/if}
	{/snippet}
	<div class="client-loading-page">
		<section
			class="loading-content"
			class:ui-panel={failed}
			class:ui-body={failed}
			aria-labelledby={titleId}
		>
			{#if pending}
				{#if headingIcon === "portal"}
					<div class="loading-status-icon scene-loading" aria-hidden="true">
						<LoadingPortal />
					</div>
				{/if}
				<h1 id={titleId} class="sr-only">{title}</h1>
			{:else}
				<div class="loading-heading">
					{#if headingIcon !== null}
						<span
							class="loading-heading-icon"
							class:loading-error={failed}
							aria-hidden="true"
						>
							{#if headingIcon === "disconnect"}<DisconnectIcon
								/>{:else}<WarningIcon />{/if}
						</span>
					{/if}
					<h1 id={titleId}>{title}</h1>
				</div>
			{/if}
			<p
				class="loading-message"
				class:loading-flavor={statusKind === "playful"}
				class:loading-error={statusKind === "failed"}
				class:ui-warning={statusKind === "warning"}
				role={statusKind === "failed" || statusKind === "warning"
					? "alert"
					: statusKind === "real"
						? "status"
						: undefined}
				aria-live={statusKind === "playful" ? "off" : undefined}
			>
				{statusMessage}
			</p>
			{@render children?.()}
			{#if details !== null}
				{#key detailsKey}
					<details class="loading-details ui-disclosure ui-disclosure-section">
						<summary>Details</summary>
						<div class="ui-disclosure-body"><pre>{details}</pre></div>
					</details>
				{/key}
			{/if}
			{@render actions()}
		</section>
	</div>
</PregameScreen>

<style>
	@layer components {
		.client-loading-page {
			display: grid;
			align-content: center;
			justify-items: center;
			min-width: 0;
		}
		.loading-content {
			display: grid;
			justify-items: center;
			gap: 16px;
			width: min(100%, 640px);
			text-align: center;
			overflow-wrap: anywhere;
		}
		.loading-content > p {
			margin: 0;
		}
		.loading-heading {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 10px;
			font-size: calc(var(--ui-font-size-heading-1) * var(--ui-text-scale));
		}
		.loading-heading h1 {
			margin: 0;
			font-size: inherit;
		}
		.loading-heading-icon {
			flex: none;
			width: 1em;
			height: 1em;
		}
		.loading-heading-icon > :global(svg) {
			display: block;
			width: 100%;
			height: 100%;
		}
		.loading-error {
			color: var(--ui-color-danger);
		}
		.loading-assets {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			user-select: text;
			text-align: center;
		}
		.loading-status-icon {
			position: relative;
			width: 40px;
			height: 40px;
			margin: 8px;
		}
		.loading-status-icon > :global(svg) {
			display: block;
			width: 100%;
			height: 100%;
		}
		.scene-loading {
			width: 112px;
			height: 112px;
		}
		.loading-message {
			min-height: 3em;
		}
		.loading-details {
			width: 100%;
			text-align: left;
		}
		.loading-details pre {
			max-height: calc(var(--ui-viewport-height) * 0.24);
			overflow: auto;
			margin: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			font: inherit;
			user-select: text;
		}
	}
</style>
