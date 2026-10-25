<script module lang="ts">
	/** App-owned page content; only recoverable failures carry a retry action. */
	export type ClientLoadingPageState =
		| {
				readonly kind: "pending";
				/** Frontend-owned activity distinguishes scene/connection work from session shutdown. */
				readonly activity: "connection" | "scene" | "disconnect";
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
	import type { ClientToast } from "./client-toast-center";
	import { CLIENT_LOADING_TUNING } from "./client-tuning";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import LoadingPortal from "../assets/icons/pregame-loading-portal.svg?component";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import RetryIcon from "../assets/icons/hud-reset.svg?component";

	interface Props {
		/** Connection and scene admission policy is resolved by ClientApp. */
		readonly state: ClientLoadingPageState;
		/** Active notices share the loading status area instead of a separate overlay. */
		readonly toast: ClientToast | null;
		/** Null while no session exists or exit is already underway. */
		readonly onDisconnect: (() => Promise<void>) | null;
	}
	const { state: page, toast, onDisconnect }: Props = $props();
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
		page.kind === "pending" && page.activity !== "disconnect",
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
	const status = $derived(
		page.kind === "failed"
			? ({ kind: "failed", message: page.message } as const)
			: playfulAllowed &&
				  toast?.tone !== "warning" &&
				  idleQuip?.updateKey === realUpdateKey
				? ({ kind: "playful", message: quips[idleQuip.index] } as const)
				: ({
						kind: notice?.tone === "warning" ? "warning" : "real",
						message: notice?.message ?? `${page.title} · ${page.message}`,
					} as const),
	);
</script>

<ClientPregameScreen branding="hero" backdrop={false}>
	{#snippet footer()}
		<button
			class="pregame-action pregame-quiet ui-button"
			type="button"
			disabled={onDisconnect === null}
			onclick={() => void onDisconnect?.()}
		>
			<span class="pregame-icon" aria-hidden="true"><DisconnectIcon /></span>
			Disconnect</button
		>
	{/snippet}
	<div class="client-loading-page">
		<section
			class="loading-content"
			class:ui-panel={page.kind === "failed"}
			class:ui-body={page.kind === "failed"}
			aria-labelledby="client-loading-title"
		>
			<div
				class="loading-status-icon"
				class:scene-loading={page.kind === "pending"}
				class:ui-error={page.kind === "failed"}
				aria-hidden="true"
			>
				{#if page.kind === "pending"}<LoadingPortal />{:else}<WarningIcon
					/>{/if}
			</div>
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
			{#if page.kind === "failed" && page.retry !== null}
				<button
					class="pregame-action ui-button"
					type="button"
					onclick={page.retry}
				>
					<span class="pregame-icon" aria-hidden="true"><RetryIcon /></span>
					Retry scene</button
				>
			{/if}
		</section>
	</div>
</ClientPregameScreen>

<style>
	@layer components {
		.client-loading-page {
			display: grid;
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
	}
</style>
