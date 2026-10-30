<script lang="ts">
	import { presentClientBinding } from "./client-binding-catalog";
	import { onDestroy, onMount, untrack } from "svelte";
	import CombatHelpLeaders from "../assets/icons/combat-help-leaders.svg?component";
	import CombatPlay from "../assets/icons/combat-play.svg?component";
	import CombatPause from "../assets/icons/combat-pause.svg?component";
	import {
		COMBAT_BREAKPOINT_INDICES,
		COMBAT_HEIGHT_INDICES,
		type ClientKeyboardConfiguration,
	} from "../lib/input/input-contract";
	import { type InputDisplayPlatform } from "../lib/input/input-presentation";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import EquipmentSlotIcon from "./EquipmentSlotIcon.svelte";
	import { AMMUNITION_SLOT } from "./client-inventory-equipment";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import { CLIENT_TUNING } from "./client-tuning";
	import type { ClientInventoryState } from "./client-inventory-state";
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

	const gaugeId = $props.id();
	const ARC_LENGTH = 100;
	const POWER_STEP = 0.01;
	/** Independent visual inputs; every other combat-gauge dimension is derived below. */
	const GAUGE_TUNING = {
		viewBoxWidth: 300,
		viewBoxHeight: 130,
		/** Keep the arc in place while reserving panel space for controls below it. */
		gaugeTop: 15,
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
		/** Space separating the attack-height controls from the stop/ammunition footer. */
		footerGap: 8,
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
	const gaugeTop = GAUGE_TUNING.gaugeTop;
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
	/** Insets keep decorative strokes inside each existing, ellipse-clipped button. */
	const heightFaces = COMBAT_HEIGHTS.map((_, index) => {
		const inset = 0.75;
		const offset = index * (heightRowHeight + GAUGE_TUNING.heightRowGap);
		const radiusX = heightLayout.width / 2 - inset;
		const radiusY = heightLayout.height - inset;
		const leftAt = (y: number) =>
			heightLayout.width / 2 -
			radiusX * Math.sqrt(1 - ((radiusY - y) / radiusY) ** 2);
		const top = leftAt(offset + inset);
		const bottom = leftAt(offset + heightRowHeight - inset);
		const rightTop = heightLayout.width - top;
		const rightBottom = heightLayout.width - bottom;
		const lowerY = heightRowHeight - inset;
		return `M ${top} ${inset} H ${rightTop} A ${radiusX} ${radiusY} 0 0 1 ${rightBottom} ${lowerY} H ${bottom} A ${radiusX} ${radiusY} 0 0 1 ${top} ${inset} Z`;
	});
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
	/** Offset the label outside both the slider and its outward shortcut hints. */
	const helpArcRadiusX = GAUGE_TUNING.arcRadiusX + 28;
	const helpArcRadiusY = GAUGE_TUNING.arcRadiusY + 40;
	const helpArcPath = `M ${arcCenterX - helpArcRadiusX} ${GAUGE_TUNING.arcBaselineY} A ${helpArcRadiusX} ${helpArcRadiusY} 0 0 1 ${arcCenterX + helpArcRadiusX} ${GAUGE_TUNING.arcBaselineY}`;

	function pointOnArc(value: number): GaugePoint {
		return {
			x: arcCenterX - GAUGE_TUNING.arcRadiusX * Math.cos(Math.PI * value),
			y:
				GAUGE_TUNING.arcBaselineY -
				GAUGE_TUNING.arcRadiusY * Math.sin(Math.PI * value),
		};
	}

	/** Small radial marks share the slider's arc geometry and never catch input. */
	const engravings = COMBAT_BREAKPOINTS.slice(1, -1).map((value) => {
		const point = pointOnArc(value);
		const dx = point.x - arcCenterX;
		const dy = point.y - GAUGE_TUNING.arcBaselineY;
		const length = Math.hypot(dx, dy);
		const outer = GAUGE_TUNING.arcStrokeWidth / 2 - 0.5;
		const inner = outer - 3;
		return {
			x1: point.x + (dx / length) * inner,
			y1: point.y + (dy / length) * inner,
			x2: point.x + (dx / length) * outer,
			y2: point.y + (dy / length) * outer,
		};
	});
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
		/** Session-owned world facts, available independently of inventory-panel visibility. */
		readonly inventory: ClientInventoryState | null;
		/** Accepted physical-combat shortcuts. */
		readonly input: ClientKeyboardConfiguration;
		readonly displayPlatform: InputDisplayPlatform;
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly status: ClientCombatStatus;
		readonly profile: ClientAttackProfile;
		/** Accepted interactions, including selections that leave the profile unchanged. */
		readonly selectionRevision: number;
		readonly enabled: boolean;
		/** User preference for hover-only explanatory labels; shortcuts remain independent. */
		readonly showHelpLabels: boolean;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Commit an attack profile and engage the current selection when present. */
		readonly onProfileSelect: (profile: ClientAttackProfile) => void;
		/** Stop the current engagement through the same action used by Escape. */
		readonly onStopCombat: () => void;
	}

	let {
		inventory,
		input,
		displayPlatform,
		placement,
		editable,
		viewport,
		status,
		profile,
		selectionRevision,
		enabled,
		showHelpLabels,
		onPlacementChange,
		onProfileSelect,
		onStopCombat,
	}: Props = $props();

	/** Only a bounded display sample enters Svelte; unknown supply has no readout. */
	let remaining = $state<string | null>(null);
	const missileMode = $derived(profile.kind === "missile");
	$effect(() => {
		const owner = inventory;
		if (!missileMode) {
			remaining = null;
			return;
		}
		const sample = () => {
			const supply = owner?.readProjectileSupply();
			remaining =
				supply?.kind === "finite"
					? String(supply.count)
					: supply?.kind === "unlimited"
						? "∞"
						: null;
		};
		untrack(sample);
		const timer = setInterval(
			sample,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => clearInterval(timer);
	});

	const naturalPlacement = $derived({
		...placement,
		preferredWidth: CLIENT_UI_DEFAULTS.combatBar.size.width,
		preferredHeight: CLIENT_UI_DEFAULTS.combatBar.size.height,
	});
	const value = $derived(
		profile.kind === "melee" ? profile.power : profile.accuracy,
	);
	// Intent stays engaged through charging and readiness waits until cancellation is accepted.
	const engaged = $derived(status.desired !== null);
	const engagementLabel = $derived(engaged ? "Cancel attack" : "Start attack");
	let combatBar: HTMLDivElement | null = null;
	let profileEmphasized = $state(false);
	/** Initial visibility has its own lifetime and never enables hover help. */
	let appearing = $state(true);
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

	onMount(() => {
		const timer = setTimeout(() => {
			appearing = false;
		}, cssDurationMs("--ui-combat-appearance-hold-duration"));
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const signature = `${profile.kind}:${profile.height}:${value}:${selectionRevision}`;
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
	contentHitTesting="descendants"
	{onPlacementChange}
>
	<div
		bind:this={combatBar}
		class="combat-bar"
		style:--combat-metal={`url(#${gaugeId}-metal)`}
		class:profile-emphasized={profileEmphasized}
		class:appearing
		class:help-enabled={showHelpLabels}
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
			<defs>
				<path id={`${gaugeId}-help-arc`} d={helpArcPath} />
				<linearGradient
					id={`${gaugeId}-metal`}
					x1="0"
					y1="0"
					x2="0"
					y2="1"
					gradientUnits="objectBoundingBox"
				>
					<stop class="gauge-metal-light" offset="0" />
					<stop class="gauge-metal-mid" offset="0.45" />
					<stop class="gauge-metal-dark" offset="1" />
				</linearGradient>
			</defs>
			<text class="combat-help power-label" aria-hidden="true">
				<textPath
					href={`#${gaugeId}-help-arc`}
					startOffset="50%"
					text-anchor="middle"
				>
					{profile.kind === "melee" ? "Power" : "Accuracy"}
				</textPath>
			</text>
			<g class="gauge-decoration" aria-hidden="true">
				<path
					class="gauge-bezel-outline"
					d={arcPath}
					stroke-width={GAUGE_TUNING.arcStrokeWidth + 4}
				/>
				<path
					class="gauge-bezel"
					d={arcPath}
					stroke-width={GAUGE_TUNING.arcStrokeWidth + 2}
				/>
			</g>
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
			<g class="gauge-decoration" aria-hidden="true">
				{#each engravings as mark}<line
						class="gauge-engraving"
						{...mark}
					/>{/each}
				{#each [0, 1] as endpoint}
					{@const point = pointOnArc(endpoint)}
					<circle class="gauge-fastener" cx={point.x} cy={point.y} r="4.5" />
					<path
						class="gauge-fastener-slot"
						d={`M ${point.x - 1.5} ${point.y + 1.5} l 3 -3`}
					/>
				{/each}
			</g>
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
			{#each COMBAT_HEIGHT_INDICES as index}
				{@const height = COMBAT_HEIGHTS[index]}
				{@const binding = presentClientBinding(
					input,
					{ kind: "combatHeight", index },
					displayPlatform,
				)}
				<button
					type="button"
					class="height {height}"
					class:selected={profile.height === height}
					data-shortcut={binding.hint ?? ""}
					disabled={!enabled}
					aria-label={`${height[0].toUpperCase()}${height.slice(1)} attack (${binding.description})`}
					title={`${height[0].toUpperCase()}${height.slice(1)} attack — ${binding.description}`}
					aria-pressed={profile.height === height}
					onclick={() => onProfileSelect({ ...profile, height })}
					><svg
						class="height-face"
						viewBox={`0 0 ${heightLayout.width} ${heightRowHeight}`}
						aria-hidden="true"><path d={heightFaces[index]} /></svg
					></button
				>
			{/each}
		</div>

		{#each COMBAT_BREAKPOINT_INDICES as index}
			{@const marker = breakpointMarkers[index]}
			{@const binding = presentClientBinding(
				input,
				{ kind: "combatBreakpoint", index },
				displayPlatform,
			)}
			{@const percent = Math.round(COMBAT_BREAKPOINTS[index] * 100)}
			{@const setting =
				profile.kind === "melee" ? "Melee power" : "Missile accuracy"}
			<span
				class="breakpoint breakpoint-{index + 1}"
				role="img"
				aria-label={`${setting} ${percent}%. Key: ${binding.description}`}
				title={`${setting}: ${percent}%\nKey: ${binding.description}`}
				style:left={`${marker.left}px`}
				style:top={`${marker.top}px`}
				style:width={`${GAUGE_TUNING.breakpointLabelSize}px`}
				style:height={`${GAUGE_TUNING.breakpointLabelSize}px`}
				style:--breakpoint-outward-x={`${marker.outwardX}px`}
				style:--breakpoint-outward-y={`${marker.outwardY}px`}
				>{binding.hint ?? ""}</span
			>
		{/each}
		<div
			class="combat-footer"
			style:top={`${arcBaseline + GAUGE_TUNING.backdropBleedBottom + GAUGE_TUNING.footerGap}px`}
		>
			<button
				type="button"
				class="engagement-toggle"
				class:engaged
				disabled={!enabled}
				aria-label={engagementLabel}
				title={engaged ? `${engagementLabel} (Esc)` : engagementLabel}
				onclick={() => (engaged ? onStopCombat() : onProfileSelect(profile))}
				>{#if engaged}<CombatPause />{:else}<CombatPlay />{/if}</button
			>
			{#if remaining !== null && profile.kind === "missile"}
				<div
					class="projectile-supply"
					role="img"
					aria-label={remaining === "∞"
						? "Unlimited projectiles"
						: `${remaining} projectiles remaining`}
				>
					<span aria-hidden="true"
						><EquipmentSlotIcon slot={AMMUNITION_SLOT} /></span
					>
					<strong>{remaining}</strong>
				</div>
			{/if}
		</div>
		<div class="combat-help side-labels" aria-hidden="true">
			<CombatHelpLeaders />
			<span class="height-label">Height</span>
			<span class="engagement-label">{engagementLabel}</span>
		</div>
	</div>
</ClientHudPanel>

<style>
	@layer components {
		.combat-footer {
			position: absolute;
			left: 0;
			width: 100%;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 4px;
		}
		.engagement-toggle {
			display: grid;
			place-items: center;
			width: 32px;
			height: 32px;
			padding: 0;
			pointer-events: auto;
			border: 0;
			background: transparent;
			color: var(--ui-combat-start-color);
			cursor: pointer;
		}
		.engagement-toggle.engaged {
			color: var(--ui-combat-stop-color);
		}
		.engagement-toggle :global(svg) {
			width: 28px;
			height: 28px;
			pointer-events: none;
		}
		.engagement-toggle:hover:not(:disabled) :global(svg),
		.engagement-toggle:focus-visible :global(svg) {
			transform: scale(1.15);
		}
		.engagement-toggle:focus-visible {
			outline: 2px solid var(--ui-color-focus);
			outline-offset: 2px;
		}
		.engagement-toggle:disabled {
			opacity: 0.35;
			cursor: default;
		}
		.projectile-supply {
			--ui-inventory-equipment-slot-icon-size: 16px;
			--ui-inventory-equipment-slot-icon-color: currentColor;

			display: flex;
			align-items: center;
			justify-content: center;
			gap: 4px;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}
		.projectile-supply span {
			display: flex;
		}
		.projectile-supply strong {
			font-weight: 600;
		}
		.combat-bar {
			--combat-rest-opacity: var(--ui-combat-idle-opacity);

			position: relative;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			pointer-events: none;
			color: var(--ui-combat-foreground-color);
			opacity: var(--combat-rest-opacity);
			transition: opacity var(--ui-combat-opacity-transition-duration) ease-out;
			transform-origin: center;
			animation: combat-pop-in var(--ui-combat-appearance-duration)
				var(--ui-combat-appearance-easing);
		}
		.combat-bar:hover,
		.combat-bar:focus-within,
		.combat-bar.profile-emphasized,
		.combat-bar.appearing {
			--combat-rest-opacity: 1;
		}
		@keyframes combat-pop-in {
			from {
				transform: scale(var(--ui-combat-appearance-start-scale));
			}
			to {
				transform: scale(1);
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.combat-bar {
				animation: none;
			}
		}
		.combat-help {
			color: var(--ui-combat-help-color, var(--ui-combat-foreground-color));
			opacity: 0;
			pointer-events: none;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			font-weight: 600;
			text-shadow: var(
				--ui-combat-help-text-shadow,
				var(--ui-combat-breakpoint-shadow)
			);
			transition: opacity var(--ui-combat-opacity-transition-duration) ease-out;
		}
		.combat-bar.help-enabled:hover .combat-help {
			opacity: 1;
		}
		.power-label {
			fill: currentColor;
			letter-spacing: var(--ui-combat-help-arc-letter-spacing);
		}
		.side-labels {
			position: absolute;
			inset: 0;
			z-index: 3;
		}
		.side-labels :global(svg) {
			stroke: var(--ui-combat-help-leader-color, currentColor);
			stroke-width: var(--ui-combat-help-leader-width);
			stroke-dasharray: var(--ui-combat-help-leader-dasharray);
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			overflow: visible;
		}
		.side-labels span {
			position: absolute;
			white-space: nowrap;
		}
		.height-label {
			left: 0;
			top: 150px;
		}
		.engagement-label {
			right: 0;
			top: 160px;
		}
		.gauge-background {
			position: absolute;
			border-radius: 50% 50% 0 0 / 100% 100% 0 0;
			background: var(--ui-hud-glass-color);
			filter: var(--ui-hud-glass-filter);
			pointer-events: none;
		}
		.gauge {
			position: absolute;
			z-index: 2;
			display: block;
			overflow: visible;
		}
		/* Optional paint layers: themes reveal them without changing the interaction geometry. */
		.gauge-decoration,
		.height-face {
			display: none;
			pointer-events: none;
		}
		.gauge-decoration {
			fill: none;
		}
		.height-face {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
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
			cursor: pointer;
			outline: none;
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
			pointer-events: auto;
			border: 0;
			background: var(--ui-combat-height-color);
			color: var(--ui-combat-foreground-color);
			cursor: pointer;
		}
		.height::after {
			content: attr(data-shortcut);
			font-size: var(--ui-combat-height-hint-font-size);
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
			z-index: 1;
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
			pointer-events: auto;
			transform: translate(
					var(--breakpoint-outward-x),
					var(--breakpoint-outward-y)
				)
				scale(1);
		}
	}
</style>
