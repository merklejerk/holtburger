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
	<header>
		{playerName ?? "Awaiting character"}
		<span>({worldName ?? "Unknown world"})</span>
	</header>
	<div class="vitals">
		{#each bars as bar, index}
			{@const value = vital(bar.kind)}
			<div
				class={`vital vital-${bar.kind}`}
				style:height={`${16 - index * 4}px`}
				role="meter"
				aria-label={bar.label}
				aria-valuemin="0"
				aria-valuemax={value?.maximum ?? 0}
				aria-valuenow={value?.current ?? 0}
			>
				<span class="vital-fill" style:width={`${fillPercent(value)}%`}></span>
				{#if index === 0}<strong
						>{value ? `${value.current} / ${value.maximum}` : "—"}</strong
					>{/if}
			</div>
		{/each}
	</div>
	<div class="conditions" aria-label="Character conditions">
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
	.character-hud {
		display: grid;
		box-sizing: border-box;
		height: 100%;
		grid-template-rows: auto auto 1fr;
		gap: 4px;
		color: white;
		font-family: var(--ac-font-ui);
		font-size: var(--ac-panel-font-size);
		text-shadow: 0 1px 2px #000;
	}

	header {
		padding: 2px 5px;
		background: linear-gradient(90deg, rgb(16 18 17 / 0.72), transparent);
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	header span {
		color: rgb(235 235 225 / 0.76);
		font-weight: 500;
	}
	.vitals {
		display: grid;
		gap: 2px;
	}
	.vital {
		position: relative;
		overflow: hidden;
		background: rgb(4 6 7 / 0.55);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.45);
	}
	.vital-fill {
		display: block;
		height: 100%;
		transition: width 120ms linear;
	}
	.vital-health .vital-fill {
		background: #e5222a;
	}
	.vital-mana .vital-fill {
		background: #218ed5;
	}
	.vital-stamina .vital-fill {
		background: #e4bb39;
	}
	.vital strong {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: var(--ac-panel-font-size);
		line-height: 1;
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
		border: 1px solid rgb(255 255 255 / 0.28);
		border-radius: 50%;
		background: rgb(15 19 18 / 0.44);
		color: #d8eef0;
	}
</style>
