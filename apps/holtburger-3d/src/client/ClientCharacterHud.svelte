<script lang="ts">
	import type { ClientVital } from "./client-host-contract";
	import { formatQuantity } from "../app/quantity-format";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";

	interface Props {
		readonly playerName: string | null;
		readonly worldName: string | null;
		readonly vitals: readonly ClientVital[];
	}

	const { playerName, worldName, vitals }: Props = $props();
	const conditions: readonly { name: ClientHudIconName; label: string }[] = [
		{ name: "buffed", label: "Buffed" },
		{ name: "debuffed", label: "Debuffed" },
		{ name: "encumbered", label: "Encumbered" },
		{ name: "sick", label: "Sick" },
	];
	const bars = [
		{ kind: "health", label: "Health" },
		{ kind: "mana", label: "Mana" },
		{ kind: "stamina", label: "Stamina" },
	] as const;
	let focusedKind = $state<ClientVital["kind"]>("health");

	function vital(kind: ClientVital["kind"]): ClientVital | undefined {
		return vitals.find((candidate) => candidate.kind === kind);
	}

	function fillPercent(value: ClientVital | undefined): number {
		if (!value || value.maximum === 0) return 0;
		return Math.max(0, Math.min(100, (value.current / value.maximum) * 100));
	}

	function quantity(value: ClientVital | undefined): string {
		return value
			? `${formatQuantity(value.current)} / ${formatQuantity(value.maximum)}`
			: "—";
	}
</script>

<section class="character-hud">
	<header class="ui-readout">
		{playerName ?? "Awaiting character"}
		<span>({worldName ?? "Unknown world"})</span>
	</header>
	<div
		class="vitals"
		role="group"
		aria-label="Character vitals"
		onpointerleave={() => (focusedKind = "health")}
	>
		{#each bars as bar}
			{@const value = vital(bar.kind)}
			<div
				class={`vital ui-meter ui-meter--${bar.kind}`}
				data-focused={focusedKind === bar.kind}
				role="meter"
				aria-label={bar.label}
				aria-valuemin="0"
				aria-valuemax={value?.maximum ?? 0}
				aria-valuenow={value?.current ?? 0}
				aria-valuetext={quantity(value)}
				onpointerenter={() => (focusedKind = bar.kind)}
			>
				<span class="vital-fill" style:width={`${fillPercent(value)}%`}></span>
				<strong class="ui-readout" aria-hidden={focusedKind !== bar.kind}
					>{quantity(value)}</strong
				>
			</div>
		{/each}
	</div>
	<div class="conditions ui-hud-group" aria-label="Character conditions">
		{#each conditions as condition}
			<div
				class="condition"
				title={`${condition.label} status (stub)`}
				aria-label={`${condition.label} status`}
			>
				<ClientHudIcon name={condition.name} />
			</div>
		{/each}
	</div>
</section>

<style>
	@layer components {
		.character-hud {
			display: grid;
			box-sizing: border-box;
			height: 100%;
			grid-template-rows: auto auto 1fr;
			gap: 4px;
		}
		header {
			width: fit-content;
			font-weight: 700;
		}
		header span {
			color: var(--ui-color-muted);
			font-weight: 500;
		}
		.vitals {
			display: flex;
			flex-direction: column;
			gap: 2px;
			/* One 16px focused bar, two 8px unfocused bars, and two 2px gaps. */
			block-size: 36px;
		}
		.vital {
			position: relative;
			flex: 1 1 0;
			min-block-size: 0;
			height: auto;
			transition: flex-grow 140ms var(--ui-easing);
		}
		.vital[data-focused="true"] {
			flex-grow: 2;
		}
		.vital-fill {
			transition: width 120ms linear;
		}
		.vital strong {
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			font-size: var(--ui-font-size-micro);
			line-height: 16px;
			padding-block: 0;
			padding-inline: calc(14px + 3px);
			white-space: nowrap;
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 100ms linear,
				visibility 0s 100ms;
		}
		.vital[data-focused="true"] strong {
			opacity: 1;
			visibility: visible;
			transition-delay: 40ms, 0s;
		}
		.conditions {
			display: flex;
			align-items: end;
			align-self: start;
			gap: 10px;
			justify-self: start;
			height: fit-content;
			width: fit-content;
			padding-block: 4px 0;
		}
		.condition {
			box-sizing: border-box;
			width: 32px;
			height: 32px;
			padding: 6px;
		}
		@media (prefers-reduced-motion: reduce) {
			.vital,
			.vital-fill,
			.vital strong {
				transition: none;
			}
		}
	}
</style>
