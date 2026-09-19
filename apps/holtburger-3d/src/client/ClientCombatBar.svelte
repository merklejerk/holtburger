<script lang="ts">
	import { untrack } from "svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientAttackProfile,
		ClientCombatStatus,
	} from "./client-host-contract";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import {
		COMBAT_BREAKPOINTS,
		type ClientCombatTarget,
	} from "./client-combat-bar-state";

	const ARC_LENGTH = 100;

	interface Props {
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly status: ClientCombatStatus;
		/** Known presentation for the engaged entity, resolved by the app. */
		readonly activeTarget: ClientCombatTarget | null;
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
		status,
		activeTarget,
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
		preferredWidth: CLIENT_UI_DEFAULTS.combatBar.size.width,
		preferredHeight: CLIENT_UI_DEFAULTS.combatBar.size.height,
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
	const gaugeLevel = $derived(fill * value);
	const needleAngle = $derived(-180 + gaugeLevel * 180);
	const activeTargetLabel = $derived(
		status.desired === null
			? null
			: (activeTarget?.name ??
					`0x${status.desired.target.toString(16).toUpperCase().padStart(8, "0")}`),
	);
	const attackLabel = $derived(
		selectedTarget === null
			? "Select a target to attack"
			: `Attack selected target with ${profile.kind === "melee" ? "melee" : "missile"}`,
	);

	function replaceValue(next: number): void {
		onProfileChange(
			profile.kind === "melee"
				? { ...profile, power: next }
				: { ...profile, accuracy: next },
		);
	}
</script>

<ClientHudPanel
	label="Combat gauge"
	{editable}
	placement={naturalPlacement}
	{viewport}
	minWidth={CLIENT_UI_DEFAULTS.combatBar.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.combatBar.minSize.height}
	resizable={false}
	contentHitTesting="surface"
	{onPlacementChange}
>
	<div class="combat-bar" data-combat-mode={profile.kind}>
		<div class="gauge-column">
			<div class="gauge">
				<button
					type="button"
					class="attack-trigger"
					disabled={!enabled || selectedTarget === null}
					title={attackLabel}
					aria-label={attackLabel}
					onclick={onAttack}
				>
					<svg viewBox="0 0 220 125" aria-hidden="true">
						<path
							class="gauge-face"
							d="M 25 110 A 85 85 0 0 1 195 110 L 25 110 Z"
						/>
						<path
							class="gauge-track"
							d="M 25 110 A 85 85 0 0 1 195 110"
							pathLength={ARC_LENGTH}
						/>
						<path
							class="gauge-fill"
							d="M 25 110 A 85 85 0 0 1 195 110"
							pathLength={ARC_LENGTH}
							style:stroke-dasharray={`${gaugeLevel * ARC_LENGTH} ${ARC_LENGTH}`}
						/>
						<g class="needle" style:transform={`rotate(${needleAngle}deg)`}>
							{#if profile.kind === "melee"}
								<path
									class="weapon"
									d="M 104 106 L 153 106 L 169 110 L 153 114 L 104 114 Z"
								/>
								<path class="weapon" d="M 119 99 H 125 V 121 H 119 Z" />
								<path class="weapon" d="M 101 106 H 112 V 114 H 101 Z" />
							{:else}
								<path class="weapon-stroke" d="M 104 110 H 165" />
								<path
									class="weapon"
									d="M 171 110 L 155 101 L 159 110 L 155 119 Z"
								/>
								<path
									class="weapon"
									d="M 111 110 L 101 103 L 105 110 L 101 117 Z"
								/>
							{/if}
						</g>
						<circle class="needle-pin" cx="110" cy="110" r="6" />
					</svg>
				</button>
				{#each COMBAT_BREAKPOINTS as breakpoint, index}
					<button
						type="button"
						class="breakpoint breakpoint-{index + 1}"
						class:selected={value === breakpoint}
						disabled={!enabled}
						aria-label={`Set ${profile.kind === "melee" ? "attack power" : "missile accuracy"} to ${breakpoint * 100}%`}
						aria-pressed={value === breakpoint}
						onclick={() => replaceValue(breakpoint)}>{index + 1}</button
					>
				{/each}
			</div>
			{#if activeTargetLabel !== null}
				<button
					type="button"
					class="combat-target"
					style:color={activeTarget?.color}
					title={`Stop attacking ${activeTargetLabel}`}
					disabled={!enabled}
					onclick={onStop}>{activeTargetLabel}</button
				>
			{:else}
				<div class="combat-target-placeholder">No target engaged</div>
			{/if}
		</div>

		<div class="attack-height" aria-label="Attack height">
			<button
				type="button"
				class="height head"
				class:selected={profile.height === "high"}
				disabled={!enabled}
				aria-label="High attack"
				aria-pressed={profile.height === "high"}
				onclick={() => onProfileChange({ ...profile, height: "high" })}
			></button>
			<button
				type="button"
				class="height torso"
				class:selected={profile.height === "medium"}
				disabled={!enabled}
				aria-label="Medium attack"
				aria-pressed={profile.height === "medium"}
				onclick={() => onProfileChange({ ...profile, height: "medium" })}
			></button>
			<button
				type="button"
				class="height legs"
				class:selected={profile.height === "low"}
				disabled={!enabled}
				aria-label="Low attack"
				aria-pressed={profile.height === "low"}
				onclick={() => onProfileChange({ ...profile, height: "low" })}
			></button>
		</div>
		<span class="combat-state">{status.state.replaceAll("-", " ")}</span>
	</div>
</ClientHudPanel>

<style>
	.combat-bar {
		position: relative;
		display: grid;
		grid-template-columns: minmax(230px, 1fr) 58px;
		align-items: center;
		gap: 4px;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 170px;
		padding: 7px 12px 8px;
		overflow: hidden;
		border: 1px solid var(--ui-color-border);
		background: var(--ui-hud-background-color);
		color: var(--ui-color-text);
	}
	.gauge-column {
		display: grid;
		align-self: stretch;
		grid-template-rows: minmax(0, 1fr) 25px;
		min-width: 0;
	}
	.gauge {
		position: relative;
		width: min(100%, 250px);
		height: 142px;
		margin: 0 auto;
	}
	.attack-trigger {
		position: absolute;
		inset: 18px 15px 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: crosshair;
	}
	.attack-trigger:disabled {
		cursor: default;
	}
	.attack-trigger svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.gauge-face {
		fill: color-mix(in srgb, var(--ui-color-control) 56%, transparent);
	}
	.gauge-track,
	.gauge-fill {
		fill: none;
		stroke-linecap: butt;
		stroke-width: 13;
	}
	.gauge-track {
		stroke: color-mix(in srgb, var(--ui-color-border) 62%, transparent);
	}
	.gauge-fill {
		stroke: var(--ui-color-accent);
	}
	.needle {
		transform-box: view-box;
		transform-origin: 110px 110px;
	}
	.weapon,
	.needle-pin {
		fill: var(--ui-color-text);
	}
	.weapon-stroke {
		fill: none;
		stroke: var(--ui-color-text);
		stroke-width: 7;
	}
	.breakpoint,
	.height {
		border: 1px solid var(--ui-color-border);
		background: var(--ui-color-well);
		color: var(--ui-color-text);
		cursor: pointer;
	}
	.breakpoint {
		position: absolute;
		width: 34px;
		height: 34px;
		padding: 0;
		border-radius: 50%;
		font-size: 1.05rem;
		font-weight: 800;
	}
	.breakpoint-1 {
		left: 0;
		bottom: 12px;
	}
	.breakpoint-2 {
		left: 26px;
		top: 28px;
	}
	.breakpoint-3 {
		left: calc(50% - 17px);
		top: 0;
	}
	.breakpoint-4 {
		right: 26px;
		top: 28px;
	}
	.breakpoint-5 {
		right: 0;
		bottom: 12px;
	}
	.breakpoint.selected,
	.height.selected {
		border-color: var(--ui-color-accent);
		background: color-mix(
			in srgb,
			var(--ui-color-accent) 38%,
			var(--ui-color-control)
		);
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--ui-color-accent) 35%, transparent),
			0 0 10px color-mix(in srgb, var(--ui-color-accent) 55%, transparent);
		color: var(--ui-color-text);
	}
	.breakpoint:disabled,
	.height:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.combat-target,
	.combat-target-placeholder {
		align-self: center;
		justify-self: center;
		max-width: 100%;
		overflow: hidden;
		font-size: 0.8rem;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.combat-target {
		padding: 2px 8px;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.combat-target:hover {
		text-decoration: line-through;
	}
	.combat-target-placeholder {
		color: var(--ui-color-muted);
		font-weight: 400;
	}
	.attack-height {
		display: grid;
		grid-template-rows: 42px 58px 50px;
		align-content: center;
		justify-items: center;
		gap: 3px;
	}
	.height {
		padding: 0;
	}
	.height.head {
		width: 36px;
		height: 36px;
		border-radius: 50%;
	}
	.height.torso {
		width: 56px;
		height: 54px;
		clip-path: polygon(
			25% 0,
			75% 0,
			100% 32%,
			76% 32%,
			76% 100%,
			24% 100%,
			24% 32%,
			0 32%
		);
	}
	.height.legs {
		width: 45px;
		height: 48px;
		clip-path: polygon(
			10% 0,
			90% 0,
			82% 100%,
			56% 100%,
			50% 48%,
			44% 100%,
			18% 100%
		);
	}
	.combat-state {
		position: absolute;
		right: 5px;
		bottom: 2px;
		font-size: 0.55rem;
		text-transform: capitalize;
		color: var(--ui-color-muted);
	}
</style>
