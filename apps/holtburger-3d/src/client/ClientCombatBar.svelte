<script lang="ts">
	import { untrack } from "svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type {
		ClientAttackProfile,
		ClientCombatMode,
		ClientCombatStatus,
	} from "./client-host-contract";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	const ATTACK_HEIGHTS = ["low", "medium", "high"] as const;

	interface Props {
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly combatMode: ClientCombatMode;
		readonly status: ClientCombatStatus;
		readonly activeTargetName: string | null;
		readonly profile: ClientAttackProfile;
		readonly selectedTarget: number | null;
		readonly enabled: boolean;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onProfileChange: (profile: ClientAttackProfile) => void;
		readonly onAttack: () => void;
		readonly onStop: () => void;
	}

	let {
		placement,
		editable,
		viewport,
		combatMode,
		status,
		activeTargetName,
		profile,
		selectedTarget,
		enabled,
		onPlacementChange,
		onProfileChange,
		onAttack,
		onStop,
	}: Props = $props();

	const naturalPlacement = $derived({
		...placement,
		preferredWidth: 420,
		preferredHeight: 78,
	});
	let sampledAt = $state(performance.now());
	let refillReceivedAt = $state(performance.now());
	$effect(() => {
		status.refill;
		refillReceivedAt = performance.now();
		const sample = () => (sampledAt = performance.now());
		untrack(sample);
		const timer = setInterval(sample, 33);
		return () => clearInterval(timer);
	});
	const fill = $derived.by(() => {
		const refill = status.refill;
		if (refill === null) return status.state === "active" ? 1 : 0;
		if (refill.durationMs === 0) return 1;
		// Host elapsed time is sampled at event delivery; this local clock advances display only.
		const elapsed = refill.elapsedMs + (sampledAt - refillReceivedAt);
		return Math.min(1, elapsed / refill.durationMs);
	});
	const value = $derived(
		profile.kind === "melee" ? profile.power : profile.accuracy,
	);
	const active = $derived(status.desired !== null);
	const activeTargetLabel = $derived(
		status.desired === null
			? null
			: (activeTargetName ??
					`0x${status.desired.target.toString(16).toUpperCase().padStart(8, "0")}`),
	);
	const label = $derived(profile.kind === "melee" ? "Power" : "Accuracy");

	function replaceValue(next: number): void {
		onProfileChange(
			profile.kind === "melee"
				? { ...profile, power: next }
				: { ...profile, accuracy: next },
		);
	}
</script>

<ClientHudPanel
	label="Combat bar"
	{editable}
	placement={naturalPlacement}
	{viewport}
	minWidth={300}
	minHeight={64}
	resizable={false}
	contentHitTesting="surface"
	{onPlacementChange}
>
	<div class="combat-bar" data-combat-mode={combatMode}>
		<div class="combat-fill" style:--combat-fill={`${fill * 100}%`}></div>
		<div class="combat-controls">
			<div class="height-controls" aria-label="Attack height">
				{#each ATTACK_HEIGHTS as height}
					<button
						type="button"
						class:active={profile.height === height}
						disabled={!enabled}
						onclick={() => onProfileChange({ ...profile, height })}
						>{height[0]?.toUpperCase()}</button
					>
				{/each}
			</div>
			<label>
				<span>{label}</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					{value}
					disabled={!enabled}
					oninput={(event) => replaceValue(Number(event.currentTarget.value))}
				/>
			</label>
			<span class="combat-value">{Math.round(value * 100)}%</span>
			{#if active}
				<button type="button" class="combat-action stop" onclick={onStop}
					>Stop</button
				>
			{:else}
				<button
					type="button"
					class="combat-action"
					disabled={!enabled || selectedTarget === null}
					onclick={onAttack}>Attack</button
				>
			{/if}
		</div>
		<div class="combat-state">{status.state.replaceAll("-", " ")}</div>
		{#if activeTargetLabel !== null}
			<div class="combat-target" title={activeTargetLabel}>
				Target: {activeTargetLabel}
			</div>
		{/if}
	</div>
</ClientHudPanel>

<style>
	.combat-bar {
		position: relative;
		display: grid;
		align-content: center;
		width: 100%;
		height: 100%;
		min-height: 64px;
		overflow: hidden;
		border: 1px solid var(--ui-border-strong);
		background: var(--ui-surface-strong);
		color: var(--ui-text);
	}
	.combat-fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--combat-fill);
		background: color-mix(in srgb, var(--ui-accent) 24%, transparent);
		pointer-events: none;
	}
	.combat-controls {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(110px, 1fr) 3rem auto;
		gap: 8px;
		align-items: center;
		padding: 9px 10px 18px;
	}
	.height-controls {
		display: flex;
		gap: 2px;
	}
	button {
		min-height: 28px;
		border: 1px solid var(--ui-border);
		background: var(--ui-control-surface);
		color: inherit;
	}
	.height-controls button {
		width: 28px;
	}
	button.active {
		border-color: var(--ui-accent);
		color: var(--ui-accent);
	}
	label {
		display: grid;
		gap: 2px;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	input {
		width: 100%;
	}
	.combat-value {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.combat-action {
		min-width: 58px;
	}
	.combat-action.stop {
		color: var(--ui-danger, #ff8d82);
	}
	.combat-state {
		position: absolute;
		left: 10px;
		bottom: 3px;
		font-size: 0.65rem;
		text-transform: capitalize;
		color: var(--ui-text-muted);
	}
	.combat-target {
		position: absolute;
		right: 10px;
		bottom: 3px;
		max-width: 55%;
		overflow: hidden;
		font-size: 0.65rem;
		color: var(--ui-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
