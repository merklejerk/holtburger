<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ClientLoadingPageState } from "./client-loading-page";
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_LOADING_TUNING } from "./client-tuning";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import LoadingPortal from "../../../../assets/branding/portal.svg?component";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";

	interface Props {
		/** Asset/session admission is resolved by the caller; this page only presents progress. */
		readonly state: ClientLoadingPageState;
		/** Selected asset source when known; discovery does not invent a location. */
		readonly contentLocation: string | null;
		/** Notices share ordinary loading; character return retains its own progress text. */
		readonly toast: ClientToast | null;
		/** Peripheral actions belong to the active lifecycle owner. */
		readonly footer: Snippet;
		/** Recovery/session actions use the same pregame control composition. */
		readonly actions: Snippet;
		/** Optional asset-location guidance or temporary-selection information. */
		readonly children?: Snippet;
	}
	const {
		state: page,
		contentLocation,
		toast,
		footer: footerActions,
		actions,
		children,
	}: Props = $props();
	// Recovery can cover a still-mounted session loading page; each label owns its identity.
	const id = $props.id();
	const titleId = `${id}-loading-title`;
	const returning = $derived(
		page.kind === "pending" && page.activity === "return",
	);
	const { quips, quipIdleDelayMs, quipIntervalMs } = CLIENT_LOADING_TUNING;
	/** Real phase identity invalidates stale playful text synchronously with new page content. */
	const phaseKey = $derived(
		JSON.stringify([
			page.kind,
			page.kind === "pending" ? page.activity : null,
			page.title,
			page.message,
		]),
	);
	/** Retain the most recent notice through its toast expiry, until the real phase changes. */
	let receivedNotice = $state<{
		/** The real loading phase in which this notice arrived. */
		readonly phaseKey: string;
		/** Identity, tone, and message come from the existing toast owner. */
		readonly toast: ClientToast;
	} | null>(null);
	let observedToastId: number | null = null;
	$effect(() => {
		const incoming = toast;
		const phase = phaseKey;
		if (incoming === null || incoming.id === observedToastId) return;
		observedToastId = incoming.id;
		receivedNotice = { phaseKey: phase, toast: incoming };
	});
	const notice = $derived(
		toast !== null &&
			(toast.tone === "warning" || toast.id !== receivedNotice?.toast.id)
			? toast
			: receivedNotice?.phaseKey === phaseKey
				? receivedNotice.toast
				: null,
	);
	const realUpdateKey = $derived(
		notice === null ? phaseKey : `toast:${notice.id}`,
	);
	const playfulAllowed = $derived(
		page.kind === "pending" &&
			(page.activity === "connection" || page.activity === "scene"),
	);
	/** A playful line is valid only for the exact real update whose idle timer elapsed. */
	let idleQuip = $state<{
		/** The real update whose quiet period admitted this line. */
		readonly updateKey: string;
		/** Index into the nonempty, frontend-owned loading copy. */
		readonly index: number;
	} | null>(null);
	$effect(() => {
		const updateKey = realUpdateKey;
		if (!playfulAllowed) return;
		let interval: number | null = null;
		let index = Math.floor(Math.random() * quips.length);
		const idleTimer = window.setTimeout(() => {
			idleQuip = { updateKey, index };
			interval = window.setInterval(() => {
				index = (index + 1) % quips.length;
				idleQuip = { updateKey, index };
			}, quipIntervalMs);
		}, quipIdleDelayMs);
		return () => {
			window.clearTimeout(idleTimer);
			if (interval !== null) window.clearInterval(interval);
		};
	});
	const details = $derived(page.kind === "pending" ? null : page.details);
	const failed = $derived(
		page.kind === "failed" || (page.kind === "ended" && page.failed),
	);
	const status = $derived.by(() => {
		if (failed) return { kind: "failed", message: page.message } as const;
		if (returning || page.kind === "ended")
			return { kind: "real", message: page.message } as const;
		if (
			playfulAllowed &&
			toast?.tone !== "warning" &&
			idleQuip?.updateKey === realUpdateKey
		) {
			return { kind: "playful", message: quips[idleQuip.index] } as const;
		}
		return {
			kind: notice?.tone === "warning" ? "warning" : "real",
			message: notice?.message ?? `${page.title} · ${page.message}`,
		} as const;
	});
</script>

<ClientPregameScreen
	branding={returning ? "corner" : "hero"}
	showPortalLogo={returning || page.kind !== "pending"}
	backdrop={false}
>
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
			{#if page.kind === "pending"}
				{#if !returning}
					<div class="loading-status-icon scene-loading" aria-hidden="true">
						<LoadingPortal />
					</div>
				{/if}
				<h1 id={titleId} class="sr-only">{page.title}</h1>
			{:else}
				<div class="loading-heading">
					<span
						class="loading-heading-icon"
						class:loading-error={failed}
						aria-hidden="true"
					>
						{#if page.kind === "ended" && !page.failed}<DisconnectIcon
							/>{:else}<WarningIcon />{/if}
					</span>
					<h1 id={titleId}>{page.title}</h1>
				</div>
			{/if}
			<p
				class="loading-message"
				class:loading-flavor={status.kind === "playful"}
				class:loading-error={status.kind === "failed"}
				class:ui-warning={status.kind === "warning"}
				role={status.kind === "failed" || status.kind === "warning"
					? "alert"
					: status.kind === "real"
						? "status"
						: undefined}
				aria-live={status.kind === "playful" ? "off" : undefined}
			>
				{status.message}
			</p>
			{@render children?.()}
			{#if details !== null}
				{#key phaseKey}
					<details class="loading-details ui-disclosure ui-disclosure-section">
						<summary>Details</summary>
						<div class="ui-disclosure-body"><pre>{details}</pre></div>
					</details>
				{/key}
			{/if}
			{@render actions()}
		</section>
	</div>
</ClientPregameScreen>

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
			max-height: 24dvh;
			overflow: auto;
			margin: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			font: inherit;
			user-select: text;
		}
	}
</style>
