<script lang="ts">
	import type { Snippet } from "svelte";
	import LoadingScreen from "../../app/desktop/LoadingScreen.svelte";
	import type { HudToast as ClientToast } from "../../app/hud/toast-center";
	import { CLIENT_LOADING_TUNING } from "../settings/tuning";
	import type { ClientLoadingPageState } from "./loading-page";

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
		footer,
		actions,
		children,
	}: Props = $props();
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
	const headingIcon = $derived.by(() => {
		if (page.kind === "pending") return returning ? null : "portal";
		return page.kind === "ended" && !page.failed ? "disconnect" : "warning";
	});
</script>

<LoadingScreen
	branding={returning ? "corner" : "hero"}
	showPortalLogo={returning || page.kind !== "pending"}
	pending={page.kind === "pending"}
	{failed}
	{headingIcon}
	title={page.title}
	statusKind={status.kind}
	statusMessage={status.message}
	{details}
	detailsKey={phaseKey}
	{contentLocation}
	{footer}
	{actions}
	{children}
/>
