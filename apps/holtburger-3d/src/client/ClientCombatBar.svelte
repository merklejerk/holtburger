<script lang="ts">
	import { onDestroy, untrack } from "svelte";
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
		COMBAT_GAUGE_SIZE,
		COMBAT_HEIGHTS,
	} from "./client-combat-bar-state";

	const ARC_LENGTH = 100;
	const POWER_STEP = 0.01;
	/** Independent visual inputs; every other combat-gauge dimension is derived below. */
	const GAUGE_TUNING = {
		viewBoxWidth: 300,
		viewBoxHeight: 130,
		arcBaselineY: 112,
		arcRadiusX: 96,
		arcRadiusY: 76,
		arcStrokeWidth: 13,
		powerHitStrokeWidth: 24,
		heightArcGap: 8,
		heightRowGap: 4,
		backdropBleedX: 15,
		backdropBleedTop: 9,
		backdropBleedBottom: 11,
		breakpointLabelSize: 24,
		breakpointOutwardDistance: 16,
		breakpointEndpointClearance: 10,
		breakpointOpticalLift: 4,
	} as const;

	interface GaugePoint {
		readonly x: number;
		readonly y: number;
	}

	const arcCenterX = GAUGE_TUNING.viewBoxWidth / 2;
	const gaugeLeft = (COMBAT_GAUGE_SIZE.width - GAUGE_TUNING.viewBoxWidth) / 2;
	const gaugeTop = (COMBAT_GAUGE_SIZE.height - GAUGE_TUNING.viewBoxHeight) / 2;
	const arcBaseline = gaugeTop + GAUGE_TUNING.arcBaselineY;
	const arcLeft = gaugeLeft + arcCenterX - GAUGE_TUNING.arcRadiusX;
	const innerArcInset =
		GAUGE_TUNING.arcStrokeWidth / 2 + GAUGE_TUNING.heightArcGap;
	const unsnappedHeight = GAUGE_TUNING.arcRadiusY - innerArcInset;
	// Whole-pixel rows keep both nominally equal gaps on the same raster boundary.
	const heightRowHeight = Math.floor(
		(unsnappedHeight -
			GAUGE_TUNING.heightRowGap * (COMBAT_HEIGHTS.length - 1)) /
			COMBAT_HEIGHTS.length,
	);
	const heightLayout = {
		left: arcLeft + innerArcInset,
		bottom: COMBAT_GAUGE_SIZE.height - arcBaseline,
		width: 2 * (GAUGE_TUNING.arcRadiusX - innerArcInset),
		height:
			heightRowHeight * COMBAT_HEIGHTS.length +
			GAUGE_TUNING.heightRowGap * (COMBAT_HEIGHTS.length - 1),
	} as const;
	const backdropLayout = {
		left: arcLeft - GAUGE_TUNING.backdropBleedX,
		bottom:
			COMBAT_GAUGE_SIZE.height - arcBaseline - GAUGE_TUNING.backdropBleedBottom,
		width: 2 * (GAUGE_TUNING.arcRadiusX + GAUGE_TUNING.backdropBleedX),
		height:
			GAUGE_TUNING.arcRadiusY +
			GAUGE_TUNING.backdropBleedTop +
			GAUGE_TUNING.backdropBleedBottom,
	} as const;
	const arcPath = `M ${arcCenterX - GAUGE_TUNING.arcRadiusX} ${GAUGE_TUNING.arcBaselineY} A ${GAUGE_TUNING.arcRadiusX} ${GAUGE_TUNING.arcRadiusY} 0 0 1 ${arcCenterX + GAUGE_TUNING.arcRadiusX} ${GAUGE_TUNING.arcBaselineY}`;

	function pointOnArc(value: number): GaugePoint {
		return {
			x: arcCenterX - GAUGE_TUNING.arcRadiusX * Math.cos(Math.PI * value),
			y:
				GAUGE_TUNING.arcBaselineY -
				GAUGE_TUNING.arcRadiusY * Math.sin(Math.PI * value),
		};
	}

	const breakpointMarkers = COMBAT_BREAKPOINTS.map((value, index) => {
		const point = pointOnArc(value);
		const radialX = point.x - arcCenterX;
		const radialY = point.y - GAUGE_TUNING.arcBaselineY;
		const radialLength = Math.hypot(radialX, radialY);
		const endpointDirection =
			index === 0 ? -1 : index === COMBAT_BREAKPOINTS.length - 1 ? 1 : 0;
		// Endpoint clearance and a tiny vertical lift keep glyphs optically off the stroke.
		const labelCenterX =
			gaugeLeft +
			point.x +
			endpointDirection * GAUGE_TUNING.breakpointEndpointClearance;
		const labelCenterY =
			gaugeTop +
			point.y -
			GAUGE_TUNING.breakpointOpticalLift * Math.sin(Math.PI * value);
		return {
			left: Math.round(labelCenterX) - GAUGE_TUNING.breakpointLabelSize / 2,
			top: Math.round(labelCenterY) - GAUGE_TUNING.breakpointLabelSize / 2,
			outwardX: Math.round(
				(radialX / radialLength) * GAUGE_TUNING.breakpointOutwardDistance,
			),
			outwardY: Math.round(
				(radialY / radialLength) * GAUGE_TUNING.breakpointOutwardDistance,
			),
		};
	});

	interface Props {
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly status: ClientCombatStatus;
		readonly profile: ClientAttackProfile;
		readonly enabled: boolean;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Commit an attack profile and engage the current selection when present. */
		readonly onProfileSelect: (profile: ClientAttackProfile) => void;
	}

	let {
		placement,
		editable,
		viewport,
		status,
		profile,
		enabled,
		onPlacementChange,
		onProfileSelect,
	}: Props = $props();

	const naturalPlacement = $derived({
		...placement,
		preferredWidth: CLIENT_UI_DEFAULTS.combatBar.size.width,
		preferredHeight: CLIENT_UI_DEFAULTS.combatBar.size.height,
	});
	const value = $derived(
		profile.kind === "melee" ? profile.power : profile.accuracy,
	);
	let combatBar: HTMLDivElement | null = null;
	let profileEmphasized = $state(false);
	let observedProfile = $state<string | null>(null);
	let emphasisTimer: ReturnType<typeof setTimeout> | null = null;

	function cssDurationMs(property: string): number {
		if (combatBar === null) throw new Error("Combat gauge is not mounted");
		const value = getComputedStyle(combatBar).getPropertyValue(property).trim();
		const multiplier = value.endsWith("ms")
			? 1
			: value.endsWith("s")
				? 1_000
				: null;
		if (multiplier === null)
			throw new Error(`${property} must use an ms or s duration`);
		const amount = Number.parseFloat(value);
		if (!Number.isFinite(amount) || amount < 0)
			throw new Error(`${property} must be a non-negative duration`);
		return amount * multiplier;
	}

	$effect(() => {
		const signature = `${profile.kind}:${profile.height}:${value}`;
		if (observedProfile === null) {
			observedProfile = signature;
			return;
		}
		if (observedProfile === signature) return;
		observedProfile = signature;
		untrack(() => {
			profileEmphasized = true;
			if (emphasisTimer !== null) clearTimeout(emphasisTimer);
			emphasisTimer = setTimeout(() => {
				profileEmphasized = false;
				emphasisTimer = null;
			}, cssDurationMs("--ui-combat-emphasis-duration"));
		});
	});
	onDestroy(() => {
		if (emphasisTimer !== null) clearTimeout(emphasisTimer);
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
	const charge = $derived.by(() => {
		const refill = status.refill;
		if (refill === null) return status.state === "active" ? 1 : 0;
		if (refill.durationMs === 0) return 1;
		// Host elapsed time is sampled at event delivery; this local clock advances display only.
		const elapsed = refill.elapsedMs + (sampledAt - refillReceivedAt);
		return Math.min(1, elapsed / refill.durationMs);
	});
	let dragValue = $state<number | null>(null);
	let activePointer = $state<number | null>(null);
	let powerControl: SVGGElement | null = null;
	const displayedValue = $derived(dragValue ?? value);
	const chargeLevel = $derived(charge * displayedValue);
	const displayedPercent = $derived(Math.round(displayedValue * 100));
	const handlePoint = $derived(pointOnArc(displayedValue));
	// The triangle points along local +Y; use the actual ellipse-to-center vector.
	const handleAngle = $derived(
		(Math.atan2(
			handlePoint.x - arcCenterX,
			GAUGE_TUNING.arcBaselineY - handlePoint.y,
		) *
			180) /
			Math.PI,
	);

	function clampPower(value: number): number {
		return Math.min(1, Math.max(0, value));
	}

	function profileWithValue(next: number): ClientAttackProfile {
		return profile.kind === "melee"
			? { ...profile, power: next }
			: { ...profile, accuracy: next };
	}

	function powerAtPointer(event: PointerEvent): number {
		const bounds = powerControl?.ownerSVGElement?.getBoundingClientRect();
		if (bounds === undefined || bounds.width === 0) return displayedValue;
		const svgX =
			((event.clientX - bounds.left) / bounds.width) *
			GAUGE_TUNING.viewBoxWidth;
		const cosine =
			clampPower(
				(arcCenterX - svgX + GAUGE_TUNING.arcRadiusX) /
					(GAUGE_TUNING.arcRadiusX * 2),
			) *
				2 -
			1;
		return Math.acos(cosine) / Math.PI;
	}

	function beginPowerDrag(event: PointerEvent): void {
		if (!enabled || event.button !== 0 || powerControl === null) return;
		event.preventDefault();
		activePointer = event.pointerId;
		dragValue = powerAtPointer(event);
		powerControl.setPointerCapture(event.pointerId);
	}

	function movePowerDrag(event: PointerEvent): void {
		if (event.pointerId !== activePointer) return;
		dragValue = powerAtPointer(event);
	}

	function finishPowerDrag(event: PointerEvent): void {
		if (event.pointerId !== activePointer || powerControl === null) return;
		const next = powerAtPointer(event);
		powerControl.releasePointerCapture(event.pointerId);
		activePointer = null;
		dragValue = null;
		onProfileSelect(profileWithValue(next));
	}

	function cancelPowerDrag(event: PointerEvent): void {
		if (event.pointerId !== activePointer) return;
		activePointer = null;
		dragValue = null;
	}

	function changePowerFromKeyboard(event: KeyboardEvent): void {
		if (!enabled) return;
		let next: number;
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowDown":
				next = value - POWER_STEP;
				break;
			case "ArrowRight":
			case "ArrowUp":
				next = value + POWER_STEP;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		onProfileSelect(profileWithValue(clampPower(next)));
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
	<div
		bind:this={combatBar}
		class="combat-bar"
		class:profile-emphasized={profileEmphasized}
		data-combat-mode={profile.kind}
	>
		<div
			class="gauge-background"
			style:left={`${backdropLayout.left}px`}
			style:bottom={`${backdropLayout.bottom}px`}
			style:width={`${backdropLayout.width}px`}
			style:height={`${backdropLayout.height}px`}
			aria-hidden="true"
		></div>
		<svg
			class="gauge"
			viewBox={`0 0 ${GAUGE_TUNING.viewBoxWidth} ${GAUGE_TUNING.viewBoxHeight}`}
			style:left={`${gaugeLeft}px`}
			style:top={`${gaugeTop}px`}
			style:width={`${GAUGE_TUNING.viewBoxWidth}px`}
			style:height={`${GAUGE_TUNING.viewBoxHeight}px`}
		>
			<path
				class="gauge-track"
				d={arcPath}
				pathLength={ARC_LENGTH}
				stroke-width={GAUGE_TUNING.arcStrokeWidth}
			/>
			<path
				class="gauge-fill"
				d={arcPath}
				pathLength={ARC_LENGTH}
				stroke-width={GAUGE_TUNING.arcStrokeWidth}
				style:stroke-dasharray={`${chargeLevel * ARC_LENGTH} ${ARC_LENGTH}`}
			/>
			<g
				bind:this={powerControl}
				class="power-control"
				class:disabled={!enabled}
				class:dragging={activePointer !== null}
				role="slider"
				tabindex={enabled ? 0 : -1}
				aria-label={profile.kind === "melee"
					? "Attack power"
					: "Missile accuracy"}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={displayedPercent}
				aria-valuetext={`${displayedPercent}%`}
				onpointerdown={beginPowerDrag}
				onpointermove={movePowerDrag}
				onpointerup={finishPowerDrag}
				onpointercancel={cancelPowerDrag}
				onkeydown={changePowerFromKeyboard}
			>
				<path
					class="power-hit-area"
					d={arcPath}
					stroke-width={GAUGE_TUNING.powerHitStrokeWidth}
				/>
				<g
					transform={`translate(${handlePoint.x} ${handlePoint.y}) rotate(${handleAngle})`}
				>
					<path class="power-handle" d="M -10 -10 H 10 L 0 11 Z" />
				</g>
			</g>
		</svg>

		<div
			class="attack-height"
			style:left={`${heightLayout.left}px`}
			style:bottom={`${heightLayout.bottom}px`}
			style:width={`${heightLayout.width}px`}
			style:height={`${heightLayout.height}px`}
			style:gap={`${GAUGE_TUNING.heightRowGap}px`}
			aria-label="Attack height"
		>
			{#each COMBAT_HEIGHTS as height, index}
				<button
					type="button"
					class="height {height}"
					class:selected={profile.height === height}
					data-shortcut={index + 1}
					disabled={!enabled}
					aria-label={`${height[0].toUpperCase()}${height.slice(1)} attack (Shift+${index + 1})`}
					aria-pressed={profile.height === height}
					onclick={() => onProfileSelect({ ...profile, height })}
				></button>
			{/each}
		</div>

		{#each breakpointMarkers as marker, index}
			<span
				class="breakpoint breakpoint-{index + 1}"
				style:left={`${marker.left}px`}
				style:top={`${marker.top}px`}
				style:width={`${GAUGE_TUNING.breakpointLabelSize}px`}
				style:height={`${GAUGE_TUNING.breakpointLabelSize}px`}
				style:--breakpoint-outward-x={`${marker.outwardX}px`}
				style:--breakpoint-outward-y={`${marker.outwardY}px`}
				aria-hidden="true">{index + 1}</span
			>
		{/each}
	</div>
</ClientHudPanel>

<style>
	.combat-bar {
		--combat-rest-opacity: var(--ui-combat-idle-opacity);

		position: relative;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		color: var(--ui-combat-foreground-color);
		opacity: var(--combat-rest-opacity);
		transition: opacity var(--ui-combat-opacity-transition-duration) ease-out;
	}
	.combat-bar:hover,
	.combat-bar:focus-within,
	.combat-bar.profile-emphasized {
		--combat-rest-opacity: 1;
	}
	.gauge-background {
		position: absolute;
		border-radius: 50% 50% 0 0 / 100% 100% 0 0;
		background: var(--ui-combat-backdrop-color);
		filter: var(--ui-combat-backdrop-filter);
		pointer-events: none;
	}
	.gauge {
		position: absolute;
		display: block;
		overflow: visible;
	}
	.gauge-track,
	.gauge-fill,
	.power-hit-area {
		fill: none;
	}
	.gauge-track {
		stroke: var(--ui-combat-track-color);
	}
	.gauge-fill {
		stroke: var(--ui-combat-charge-color);
	}
	.power-control {
		cursor: grab;
		outline: none;
	}
	.power-control.dragging {
		cursor: grabbing;
	}
	.power-control.disabled {
		cursor: default;
		opacity: 0.55;
	}
	.power-control:focus-visible .power-handle {
		filter: var(--ui-combat-handle-focus-filter);
	}
	.power-hit-area {
		stroke: transparent;
		pointer-events: stroke;
	}
	.power-handle {
		fill: var(--ui-combat-foreground-color);
		stroke: var(--ui-combat-outline-color);
		stroke-width: 3;
		filter: var(--ui-combat-handle-filter);
		pointer-events: all;
		transform-box: fill-box;
		transform-origin: center;
		transition: transform 120ms var(--ui-easing);
	}
	.power-handle:hover,
	.power-control:focus-visible .power-handle,
	.power-control.dragging .power-handle {
		transform: scale(1.12);
	}
	.attack-height {
		position: absolute;
		display: grid;
		grid-template-rows: repeat(3, minmax(0, 1fr));
		overflow: hidden;
		clip-path: ellipse(50% 100% at 50% 100%);
	}
	.height {
		position: relative;
		display: grid;
		box-sizing: border-box;
		width: 100%;
		place-items: center;
		padding: 0;
		border: 0;
		background: var(--ui-combat-height-color);
		color: var(--ui-combat-foreground-color);
		cursor: pointer;
	}
	.height::after {
		content: attr(data-shortcut);
		font-size: var(--ui-font-size-micro);
		font-weight: 800;
		opacity: 0;
		pointer-events: none;
		text-shadow: var(--ui-combat-breakpoint-shadow);
		transition: opacity 100ms ease-out;
	}
	.combat-bar:hover .height::after,
	.combat-bar:focus-within .height::after {
		opacity: 1;
	}
	.height.selected {
		background: var(--ui-combat-height-selected-color);
	}
	.height:hover:not(:disabled),
	.height:focus-visible {
		background: var(--ui-combat-height-hover-color);
		outline: none;
	}
	.height:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.breakpoint {
		position: absolute;
		z-index: 3;
		display: grid;
		place-items: center;
		font-size: 0.9rem;
		font-weight: 800;
		opacity: 0;
		pointer-events: none;
		text-shadow: var(--ui-combat-breakpoint-shadow);
		transform: scale(0.85);
		transition:
			opacity 100ms ease-out,
			transform 100ms ease-out;
	}
	.combat-bar:hover .breakpoint,
	.combat-bar:focus-within .breakpoint {
		opacity: 1;
		transform: translate(
				var(--breakpoint-outward-x),
				var(--breakpoint-outward-y)
			)
			scale(1);
	}
</style>
