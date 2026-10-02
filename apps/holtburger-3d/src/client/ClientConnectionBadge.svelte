<script lang="ts">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { ClientConnectionObservation } from "./client-lifecycle-session";
	import { CLIENT_CONNECTION_BADGE_TUNING } from "./client-tuning";

	interface Props {
		/** Imperative transport owner; polled only while this HUD is mounted. */
		readonly readConnection: () => ClientConnectionObservation | null;
	}
	const { readConnection }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	function keydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			keyboard.returnToGame();
		}
	}
	/** Display-only snapshot, published at the badge's bounded polling cadence. */
	let observation = $state<ClientConnectionObservation | null>(null);
	let receiving = $state(false);
	let sending = $state(false);
	const health = $derived(observation?.sample.health ?? "pending");
	const quality = $derived(observation?.sample.quality ?? "unavailable");
	const bars = $derived(
		({ good: 3, fair: 2, poor: 1, unavailable: 0 } as const)[quality],
	);
	function repairLabel(share: number | null): string {
		return share === null
			? "no recent samples"
			: `${(share * 100).toFixed(1)}%`;
	}
	const label = $derived(
		observation === null
			? "Connection: awaiting traffic sample"
			: `${health === "waiting" ? "Waiting for server traffic" : health === "disconnected" ? "Disconnected" : "Connected"}\nReliability: ${quality}\nRecent repair traffic: RX ${repairLabel(observation.sample.reliability.receiveRepairShare)}, TX ${repairLabel(observation.sample.reliability.sendRepairShare)}\nReceive gap: ${observation.sample.reliability.receiveGap ? "awaiting missing packet" : "none"}\nLast receive: ${observation.sample.receiveAgeSeconds.toFixed(1)} s ago\nReceive (right): ${Math.round(observation.sample.receiveBytesPerSecond).toLocaleString()} B/s\nSend (left): ${Math.round(observation.sample.sendBytesPerSecond).toLocaleString()} B/s`,
	);

	/** Hold one native tooltip snapshot across overlapping pointer and keyboard engagement. */
	let tooltipSnapshot = $state<string | null>(null);
	const tooltipEngagement = { hovered: false, focused: false };
	const tooltipLabel = $derived(tooltipSnapshot ?? label);
	function engageTooltip(kind: "hovered" | "focused", engaged: boolean): void {
		tooltipEngagement[kind] = engaged;
		if (engaged && tooltipSnapshot === null) tooltipSnapshot = label;
		else if (!tooltipEngagement.hovered && !tooltipEngagement.focused)
			tooltipSnapshot = null;
	}

	onMount(() => {
		function update(): void {
			observation = readConnection();
			const active =
				observation !== null &&
				observation.sample.health !== "disconnected" &&
				performance.now() -
					observation.receivedAtMs +
					observation.sample.sampleAgeSeconds * 1_000 <=
					CLIENT_CONNECTION_BADGE_TUNING.activityHoldMs;
			receiving =
				active &&
				observation !== null &&
				observation.sample.receiveBytesPerSecond > 0;
			sending =
				active &&
				observation !== null &&
				observation.sample.sendBytesPerSecond > 0;
		}
		update();
		const timer = setInterval(
			update,
			CLIENT_CONNECTION_BADGE_TUNING.displayIntervalMs,
		);
		return () => clearInterval(timer);
	});
</script>

<button
	type="button"
	class="connection-badge"
	data-health={health}
	data-quality={quality}
	aria-label={tooltipLabel}
	title={tooltipLabel}
	onpointerenter={() => engageTooltip("hovered", true)}
	onpointerleave={() => engageTooltip("hovered", false)}
	onfocus={() => engageTooltip("focused", true)}
	onblur={() => engageTooltip("focused", false)}
	use:keyboard.scope={{ nativeControls: true, keydown }}
	style:--badge-width={`${CLIENT_CONNECTION_BADGE_TUNING.widthEm}em`}
	style:--badge-height={`${CLIENT_CONNECTION_BADGE_TUNING.heightEm}em`}
	style:--activity-idle-opacity={CLIENT_CONNECTION_BADGE_TUNING.activityIdleOpacity}
	style:--activity-active-opacity={CLIENT_CONNECTION_BADGE_TUNING.activityActiveOpacity}
	style:--activity-fade={`${CLIENT_CONNECTION_BADGE_TUNING.activityFadeMs}ms`}
>
	<span class="quality-bars" aria-hidden="true">
		{#each [1, 2, 3] as bar}
			<span
				class="quality-bar"
				class:lit={bar <= bars}
				style:height={`${(bar * 3 + 1) / 13}em`}
			></span>
		{/each}
	</span>
	<span class="activity-dots" aria-hidden="true">
		<span class="activity send" class:active={sending}></span>
		<span class="activity receive" class:active={receiving}></span>
	</span>
</button>

<style>
	@layer components {
		.connection-badge {
			display: inline-flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: calc(3em / 13);
			flex: 0 0 auto;
			box-sizing: border-box;
			width: var(--badge-width);
			height: var(--badge-height);
			padding: 0;
			font: inherit;
			border: 0;
			background: transparent;
			color: var(--ui-color-muted);
			pointer-events: auto;
		}
		.quality-bars {
			display: flex;
			align-items: flex-end;
			gap: calc(2em / 13);
			height: calc(10em / 13);
		}
		.quality-bar {
			width: calc(4em / 13);
			border-radius: calc(1em / 13);
			background: currentColor;
			opacity: 0.25;
		}
		.quality-bar.lit {
			opacity: 1;
		}
		[data-quality="good"] {
			color: var(--ui-connection-good-color);
		}
		[data-quality="fair"] {
			color: var(--ui-connection-fair-color);
		}
		[data-quality="poor"],
		[data-health="disconnected"] {
			color: var(--ui-connection-poor-color);
		}
		.activity-dots {
			display: flex;
			gap: calc(5em / 13);
		}
		.activity {
			width: calc(4em / 13);
			height: calc(4em / 13);
			border-radius: 50%;
			background: var(--ui-connection-activity-color);
			opacity: var(--activity-idle-opacity);
			transition: opacity var(--activity-fade) linear;
		}
		.activity.active {
			opacity: var(--activity-active-opacity);
		}
		@media (prefers-reduced-motion: reduce) {
			.activity {
				transition: none;
			}
		}
	}
</style>
