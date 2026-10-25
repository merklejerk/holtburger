<script lang="ts">
	import { requestElectronClientClose } from "../lib/host/electron-host-transport";
	import type { ClientLoadingPageState } from "./client-app-lifecycle";
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_LOADING_TUNING } from "./client-tuning";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import LoadingPortal from "../assets/icons/pregame-loading-portal.svg?component";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import RetryIcon from "../assets/icons/hud-reset.svg?component";

	interface Props {
		/** Connection and scene admission policy is resolved by the app lifecycle owner. */
		readonly state: ClientLoadingPageState;
		/** Notices share ordinary loading; character return retains its own progress text. */
		readonly toast: ClientToast | null;
		/** Null while no session exists or exit is already underway. */
		readonly onDisconnect: (() => Promise<void>) | null;
	}
	const { state: page, toast, onDisconnect }: Props = $props();
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
		{#if page.kind !== "ended"}
			<button
				class="pregame-action pregame-quiet ui-button"
				type="button"
				disabled={onDisconnect === null}
				onclick={() => void onDisconnect?.()}
			>
				<span class="pregame-icon" aria-hidden="true"><DisconnectIcon /></span>
				Disconnect</button
			>
		{/if}
	{/snippet}
	<div class="client-loading-page">
		<section
			class="loading-content"
			class:ui-panel={failed}
			class:ui-body={failed}
			aria-labelledby="client-loading-title"
		>
			{#if !returning}
				<div
					class="loading-status-icon"
					class:scene-loading={page.kind === "pending"}
					class:ui-error={failed}
					aria-hidden="true"
				>
					{#if page.kind === "pending"}<LoadingPortal
						/>{:else if page.kind === "ended" && !page.failed}<DisconnectIcon
						/>{:else}<WarningIcon />{/if}
				</div>
			{/if}
			<h1 id="client-loading-title" class:sr-only={page.kind === "pending"}>
				{page.title}
			</h1>
			<p
				class="loading-message"
				class:loading-flavor={status.kind === "playful"}
				class:ui-error={status.kind === "failed"}
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
			{#if details !== null}
				{#key phaseKey}
					<details class="loading-details ui-disclosure ui-disclosure-section">
						<summary>Details</summary>
						<div class="ui-disclosure-body"><pre>{details}</pre></div>
					</details>
				{/key}
			{/if}
			{#if page.kind === "ended"}
				<button
					class="pregame-primary pregame-action ui-button"
					type="button"
					onclick={() =>
						void requestElectronClientClose().catch((error) =>
							console.error(error),
						)}>Quit application</button
				>
			{/if}
			{#if page.kind === "failed" && page.retry !== null}
				<button
					class="pregame-action ui-button"
					type="button"
					onclick={page.retry}
				>
					<span class="pregame-icon" aria-hidden="true"><RetryIcon /></span>
					Try again</button
				>
			{/if}
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
