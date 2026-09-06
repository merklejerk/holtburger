<script lang="ts">
	import type { ClientVital } from "./client-host-contract";
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

	function vital(kind: ClientVital["kind"]): ClientVital | undefined {
		return vitals.find((candidate) => candidate.kind === kind);
	}

	function fillPercent(value: ClientVital | undefined): number {
		if (!value || value.maximum === 0) return 0;
		return Math.max(0, Math.min(100, (value.current / value.maximum) * 100));
	}
</script>

<section class="character-hud">
	<header class="ui-readout">
		{playerName ?? "Awaiting character"}
		<span>({worldName ?? "Unknown world"})</span>
	</header>
	<div class="vitals">
		{#each bars as bar, index}
			{@const value = vital(bar.kind)}
			<div
				class={`vital ui-meter ui-meter--${bar.kind}`}
				style:height={`${16 - index * 4}px`}
				role="meter"
				aria-label={bar.label}
				aria-valuemin="0"
				aria-valuemax={value?.maximum ?? 0}
				aria-valuenow={value?.current ?? 0}
			>
				<span class="vital-fill" style:width={`${fillPercent(value)}%`}></span>
				{#if index === 0}<strong class="ui-readout"
						>{value ? `${value.current} / ${value.maximum}` : "—"}</strong
					>{/if}
			</div>
		{/each}
	</div>
	<div class="conditions" aria-label="Character conditions">
		{#each conditions as condition}
			<div
				class="condition ui-readout"
				title={`${condition.label} status (stub)`}
				aria-label={`${condition.label} status`}
			>
				<ClientHudIcon name={condition.name} />
			</div>
		{/each}
	</div>
</section>

<style>
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
		display: grid;
		gap: 2px;
	}
	.vital {
		position: relative;
	}
	.vital-fill {
		transition: width 120ms linear;
	}
	.vital strong {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		font-size: 11px;
		line-height: 16px;
		padding: 0 3px;
		white-space: nowrap;
	}
	.conditions {
		display: flex;
		align-items: end;
		gap: 10px;
		padding: 4px 6px 0;
	}
	.condition {
		box-sizing: border-box;
		width: 32px;
		height: 32px;
		padding: 6px;
	}
	@media (prefers-reduced-motion: reduce) {
		.vital-fill {
			transition: none;
		}
	}
</style>
