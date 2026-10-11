<script lang="ts">
	import type { ClientVitalWarningThresholds } from "./client-settings-contract";
	import VitalVeins from "../assets/icons/vital-warning-veins.svg?component";
	import {
		ClientVitalWarningPolicy,
		type ClientVitalWarning,
	} from "./client-vital-warning";
	import type { ClientVital } from "./client-host-contract";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Current authoritative vital values, already exposed to the character HUD. */
		readonly vitals: readonly ClientVital[];
		/** Only active gameplay may retain or display warnings. */
		readonly enabled: boolean;
		/** Saved percentage for each vital's glow and veins. */
		readonly thresholds: ClientVitalWarningThresholds;
	}
	const { vitals, enabled, thresholds }: Props = $props();
	const policy = new ClientVitalWarningPolicy(CLIENT_TUNING.vitalWarning);
	let warning = $state<ClientVitalWarning | null>(null);
	const kinds = ["health", "stamina", "mana"] as const;
	const corners = [
		"top-left",
		"top-right",
		"bottom-left",
		"bottom-right",
	] as const;

	$effect(() => {
		warning = policy.update(vitals, enabled, thresholds);
	});
</script>

<div
	class="vital-warning-overlay"
	class:suppressed={!enabled}
	data-vital-warning={warning?.kind ?? "none"}
	aria-hidden="true"
>
	<!-- Retained layers switch immediately; only the shared pulse varies their brightness. -->
	{#each kinds as kind}
		<div
			class="warning-layer {kind}"
			class:active={enabled && warning?.kind === kind}
		>
			<!-- One pulsing parent keeps the vignette and veins exactly in phase. -->
			<div class="warning-glow">
				<div class="warning-vignette"></div>
				<div class="warning-veins">
					{#each corners as corner}
						<div class="vein-corner {corner}"><VitalVeins /></div>
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	@layer components {
		.vital-warning-overlay,
		.warning-layer,
		.warning-glow,
		.warning-vignette,
		.warning-veins {
			position: absolute;
			inset: 0;
			pointer-events: none;
		}
		.vital-warning-overlay {
			/* Canvas paints first; positioned HUD surfaces paint above this layer. */
			z-index: 0;
		}
		.suppressed {
			visibility: hidden;
		}
		.warning-layer,
		.warning-veins {
			opacity: 0;
		}
		.warning-layer.active {
			opacity: var(--warning-opacity);
		}
		.active .warning-veins {
			opacity: var(--ui-vital-warning-vein-opacity);
		}
		.health {
			--warning-color: var(--ui-color-health);
			--warning-opacity: var(--ui-vital-warning-health-opacity);
		}
		.stamina {
			--warning-color: var(--ui-color-stamina);
			--warning-opacity: var(--ui-vital-warning-stamina-opacity);
		}
		.mana {
			--warning-color: var(--ui-color-mana);
			--warning-opacity: var(--ui-vital-warning-mana-opacity);
		}
		.warning-vignette {
			background: radial-gradient(
				ellipse at center,
				transparent var(--ui-vital-warning-glow-clear-extent),
				var(--warning-color) 100%
			);
		}
		.warning-glow {
			animation: vital-warning-pulse var(--ui-vital-warning-pulse-duration)
				ease-in-out infinite;
			animation-play-state: paused;
		}
		.active .warning-glow {
			animation-play-state: running;
		}
		.warning-veins {
			color: var(--warning-color);
		}
		.vein-corner {
			position: absolute;
			width: var(--ui-vital-warning-vein-corner-size);
			height: var(--ui-vital-warning-vein-corner-size);
		}
		.top-left {
			top: 0;
			left: 0;
		}
		.top-right {
			top: 0;
			right: 0;
			transform: scaleX(-1);
		}
		.bottom-left {
			bottom: 0;
			left: 0;
			transform: scaleY(-1);
		}
		.bottom-right {
			bottom: 0;
			right: 0;
			transform: scale(-1);
		}
		@keyframes vital-warning-pulse {
			0%,
			100% {
				opacity: var(--ui-vital-warning-pulse-minimum-opacity);
			}
			50% {
				opacity: 1;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.warning-glow {
				animation: none;
			}
		}
	}
</style>
