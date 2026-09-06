<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";
	import LayoutHandleIcon from "../../app/LayoutHandleIcon.svelte";
	import { ESPRESSO_AERO } from "../../app/themes/espresso-aero";
	import { applyUiTheme } from "../../app/ui-theme";
	import { hexRgb } from "../../lib/frontend-color";
	import { trackPointerGesture } from "../../app/pointer-gesture";
	import type { UiTheme } from "../../app/ui-theme-contract";
	import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
	import {
		createClientHudLayout,
		resolveClientHudPlacement,
	} from "../../client/client-hud-layout";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "../../client/ClientHudIcon.svelte";
	import "../../app/ui-theme-recipes.css";

	/** Harness-only alternate palette proves the complete-configuration and grain-free paths. */
	const steel: UiTheme = {
		...ESPRESSO_AERO,
		id: "specimen-steel",
		name: "Texture-free fixture",
		color: {
			...ESPRESSO_AERO.color,
			surface: hexRgb("#172530"),
			well: hexRgb("#101a23"),
			control: hexRgb("#304553"),
			frame: hexRgb("#263e4a"),
			accent: hexRgb("#a2d7e9"),
			border: hexRgb("#a2bac7"),
		},
		material: { ...ESPRESSO_AERO.material, grain: 0 },
	};
	/** Cold specimen controls; none participate in the world renderer's lifecycle. */
	let background = $state("world");
	let reducedTransparency = $state(false);
	let alternate = $state(false);

	let selected = $state(true);
	let channel = $state("Local");
	/** Representative client shortcuts share their count with layout sizing. */
	const shortcuts = [
		"inventory",
		"training",
		"spells",
		"party",
		"map",
		"journal",
		"settings",
	] as const satisfies readonly ClientHudIconName[];
	let sent = $state(false);
	let root: HTMLElement;
	/** Resize-only geometry uses the production defaults, not a second specimen layout configuration. */
	let viewport = $state({ width: 0, height: 0 });
	const layout = $derived(
		createClientHudLayout(CLIENT_UI_DEFAULTS, viewport, shortcuts.length),
	);
	function placement(
		name:
			| "character"
			| "chat"
			| "diagnostics"
			| "frameRate"
			| "selectedEntity"
			| "shortcuts"
			| "toast",
	): string {
		const rect = resolveClientHudPlacement(
			layout[name],
			viewport,
			CLIENT_UI_DEFAULTS[name].minSize,
		);
		return `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
	}
	let cancelGesture: (() => void) | null = null;

	function updateTheme(): void {
		applyUiTheme(root, alternate ? steel : ESPRESSO_AERO, {
			reducedTransparency,
		});
	}
	/** Exercise the same pointer-gesture ownership as the production HUD without reactive pointer state. */
	function beginWindowGesture(
		event: PointerEvent,
		kind: "move" | "resize",
	): void {
		if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement))
			return;
		const surface = event.currentTarget.closest<HTMLElement>("[data-overlap]");
		if (surface === null)
			throw new Error("Specimen gesture requires its window.");
		event.preventDefault();
		const x = event.clientX,
			y = event.clientY;
		const startX = surface.offsetLeft,
			startY = surface.offsetTop;
		const startWidth = surface.offsetWidth,
			startHeight = surface.offsetHeight;
		const style = getComputedStyle(surface);
		const minWidth = Number.parseFloat(style.minWidth),
			minHeight = Number.parseFloat(style.minHeight);
		cancelGesture?.();
		cancelGesture = trackPointerGesture(window, event.pointerId, (moved) => {
			if (kind === "move") {
				surface.style.left = `${startX + moved.clientX - x}px`;
				surface.style.top = `${startY + moved.clientY - y}px`;
			} else {
				surface.style.width = `${Math.max(minWidth, startWidth + moved.clientX - x)}px`;
				surface.style.height = `${Math.max(minHeight, startHeight + moved.clientY - y)}px`;
			}
		});
	}
	onDestroy(() => cancelGesture?.());
	onMount(() => {
		updateTheme();
		/** Harness commands change only cold appearance state and wait for DOM publication. */
		const api = {
			verifyApplication() {
				const target = document.createElement("section");
				target.style.width = "123px";
				const child = document.createElement("input");
				target.append(child);
				document.body.append(target);
				try {
					applyUiTheme(target, ESPRESSO_AERO, { reducedTransparency: false });
					const before = target.style.cssText;
					let rejected = false;
					try {
						applyUiTheme(
							target,
							{
								...ESPRESSO_AERO,
								radius: { ...ESPRESSO_AERO.radius, surface: -1 },
							},
							{ reducedTransparency: false },
						);
					} catch (error) {
						if (
							!(error instanceof Error) ||
							!error.message.includes("radius.surface")
						)
							throw error;
						rejected = true;
					}
					if (!rejected || target.style.cssText !== before)
						throw new Error("Invalid theme application was not atomic.");
					applyUiTheme(target, ESPRESSO_AERO, { reducedTransparency: true });
					if (target.firstChild !== child || target.style.width !== "123px")
						throw new Error("Theme application replaced unrelated DOM state.");
					return {
						invalidRejectedBeforeMutation: true,
						identityPreserved: true,
					};
				} finally {
					target.remove();
				}
			},
			async configure(next: {
				background: string;
				reducedTransparency: boolean;
				alternate: boolean;
			}) {
				background = next.background;
				reducedTransparency = next.reducedTransparency;
				alternate = next.alternate;
				updateTheme();
				await tick();
			},
		};
		Object.assign(window, { __UI_THEME_SPECIMEN__: api });
		return () => {
			Reflect.deleteProperty(window, "__UI_THEME_SPECIMEN__");
		};
	});
</script>

<svelte:window
	bind:innerWidth={viewport.width}
	bind:innerHeight={viewport.height}
/>
<main bind:this={root} class="ui-theme specimen" data-background={background}>
	<section class="hud character" style={placement("character")}>
		<div class="ui-readout identity">
			<strong>Wayfarer</strong>
			<span class="ui-muted" data-contrast="secondary glass">(Dereth)</span>
		</div>
		<div class="vitals">
			{#each [{ role: "health", label: "Health", value: 82, height: 16 }, { role: "mana", label: "Mana", value: 91, height: 12 }, { role: "stamina", label: "Stamina", value: 65, height: 8 }] as vital}
				<div
					class="ui-meter ui-meter--{vital.role}"
					style:height={`${vital.height}px`}
					role="meter"
					aria-label={vital.label}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={vital.value}
					title={`${vital.label}: ${vital.value}%`}
				>
					<span style:width={`${vital.value}%`}></span>
					{#if vital.role === "health"}<strong
							class="health-value ui-readout"
							data-contrast="health value">328 / 400</strong
						>{/if}
				</div>
			{/each}
		</div>
		<div class="conditions">
			{#each ["buffed", "debuffed", "encumbered", "sick"] as const as name}
				<span class="ui-readout" title={name}><ClientHudIcon {name} /></span>
			{/each}
		</div>
	</section>
	<section class="hud target" style={placement("selectedEntity")}>
		<div class="target-row">
			<button class="ui-hud-button" title="Interact" aria-label="Interact"
				><ClientHudIcon name="interact" /></button
			>
			<strong class="ui-readout" data-contrast="target">Drudge Prowler</strong>
			<button class="ui-hud-button" title="Examine" aria-label="Examine"
				><ClientHudIcon name="examine" /></button
			>
		</div>
		<div
			class="ui-meter ui-meter--health"
			role="meter"
			aria-label="Target health"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow="68"
		>
			<span style:width="68%"></span>
		</div>
	</section>
	<div class="hud fps ui-mono" style={placement("frameRate")}>
		<span class="ui-readout" data-contrast="frame rate">120 fps</span>
	</div>
	<aside class="specimen-settings ui-well">
		<strong>{alternate ? steel.name : ESPRESSO_AERO.name}</strong><span
			class="ui-muted">HUD material study</span
		>
		<label class="settings-row"
			>Backdrop<select class="ui-input" bind:value={background}
				><option value="world">Dereth</option><option value="bright"
					>Bright</option
				><option value="dark">Dark</option></select
			></label
		>
		<div class="button-row">
			<button
				class="ui-button"
				aria-pressed={reducedTransparency}
				onclick={() => {
					reducedTransparency = !reducedTransparency;
					updateTheme();
				}}>Opaque</button
			>
			<button
				class="ui-button"
				aria-pressed={alternate}
				onclick={() => {
					alternate = !alternate;
					updateTheme();
				}}>Texture-free</button
			>
		</div>
		<span class="ui-muted">Specimen controls · not saved</span>
	</aside>
	<section class="ui-glass hud controls" style={placement("diagnostics")}>
		<header class="ui-frame title-row">
			<h3>Control states</h3>
			<span class="ui-muted">Specimen</span>
		</header>
		<div class="ui-body stack">
			<div class="state-grid">
				<button class="ui-button" data-normal>Normal</button><button
					class="ui-button"
					data-hover>Hover</button
				><button class="ui-button" data-pressed>Pressed</button>
				<button
					class="ui-button"
					aria-pressed={selected}
					onclick={() => (selected = !selected)}>✓ Selected</button
				><button class="ui-button" disabled data-contrast="disabled"
					>Disabled</button
				><button class="ui-button" data-focus>Focus</button>
			</div>
			<label class="field-row"
				>Name<input class="ui-input" value="Wayfarer" data-input /></label
			>
			<label class="field-row"
				>Search<input class="ui-input" placeholder="Name or item type" /></label
			>
			<label class="field-row"
				>Locked<input
					class="ui-input"
					value="Requires fellowship"
					disabled
				/></label
			>
			<label class="field-row"
				>Invalid<input
					class="ui-input"
					value="Not enough pyreals"
					aria-invalid="true"
				/></label
			>
			<div class="ui-well statuses">
				<p class="ui-muted" data-contrast="reading well">Pack · 42% burden</p>
				<p class="ui-success" data-contrast="success">✓ Changes saved.</p>
				<p class="ui-warning" data-contrast="warning">
					! Your pack is almost full.
				</p>
				<p class="ui-danger" data-contrast="error">× You are too far away.</p>
			</div>
		</div>
	</section>
	<section class="hud chat-overlay" style={placement("chat")}>
		<div class="chat-lines">
			<p class="ui-muted">[20:41] You have entered Yaraq.</p>
			<p data-contrast="chat">[20:42] A traveler says, “Room by the fire?”</p>
			<p class="ui-success">[20:42] Your fellowship has been formed.</p>
			<p class="ui-warning">[20:43] You give the barkeeper 10 pyreals.</p>
			<p class="ui-muted">
				{sent
					? "[20:44] You say, “Another round?”"
					: "[20:44] The lanterns sway in the breeze."}
			</p>
		</div>
		<div class="chat-filters">
			<div class="ui-tabs" role="tablist" aria-label="Chat channel">
				{#each ["Local", "Allegiance", "Tells"] as name}
					<button
						class="ui-hud-button"
						role="tab"
						aria-selected={channel === name}
						onclick={() => (channel = name)}>{name}</button
					>
				{/each}
			</div>
		</div>
		<form
			class="chat-entry"
			onsubmit={(event) => {
				event.preventDefault();
				sent = true;
			}}
		>
			<input
				class="ui-input ui-hud-input"
				aria-label="Say"
				value="Another round?"
			/>
			<button
				class="ui-hud-button"
				type="submit"
				aria-label="Send message"
				title="Send message"
				data-send><ClientHudIcon name="speech" /></button
			>
		</form>
	</section>
	<div class="hud notification" role="status" style={placement("toast")}>
		<span class="ui-readout" data-contrast="notification"
			>Your allegiance is online.</span
		>
	</div>
	<nav
		class="hud shortcuts"
		aria-label="Client shortcuts"
		style={placement("shortcuts")}
	>
		{#each shortcuts as name}
			<button class="ui-hud-button" aria-label={name} title={name}
				><ClientHudIcon {name} /></button
			>
		{/each}
	</nav>
	<section class="ui-glass overlap-window" data-overlap>
		<header
			class="ui-frame"
			role="toolbar"
			tabindex="-1"
			aria-label="Field notes window controls"
			onpointerdown={(event) => beginWindowGesture(event, "move")}
		>
			<h3>Field notes</h3>
		</header>
		<div class="ui-body stack">
			<p data-contrast="overlap">
				Walnut edges. Smoked glass.<br />The world takes the space.
			</p>
			<button class="ui-button" data-overlap-button>Keep exploring</button>
		</div>
		<button
			class="ui-button ui-icon-button specimen-resize"
			data-resize
			aria-label="Resize field notes"
			onpointerdown={(event) => beginWindowGesture(event, "resize")}
			><LayoutHandleIcon action="resize" /></button
		>
	</section>
	<div
		class="ui-tooltip specimen-tooltip"
		role="tooltip"
		data-contrast="tooltip"
	>
		Examine selected object
	</div>
</main>

<style>
	.specimen {
		position: fixed;
		inset: 0;
		z-index: 40;
		pointer-events: none;
	}
	.specimen[data-background="bright"] {
		background: #fff8e8;
	}
	.specimen[data-background="dark"] {
		background: #080b10;
	}
	.hud {
		position: absolute;
		pointer-events: auto;
		box-sizing: border-box;
	}

	.identity {
		width: fit-content;
		margin-bottom: 4px;
	}
	.title-row,
	.button-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.vitals {
		display: grid;
		gap: 2px;
	}
	.vitals .ui-meter {
		position: relative;
	}
	.health-value {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		padding: 0 3px;
		font-size: 11px;
		line-height: 16px;
	}
	.conditions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.conditions .ui-readout {
		padding: 3px;
		opacity: 0.7;
	}
	.conditions :global(svg) {
		width: 16px;
		height: 16px;
	}
	.target-row {
		display: grid;
		grid-template-columns: 24px 1fr 24px;
		align-items: center;
		gap: 4px;
	}
	.target-row strong {
		text-align: center;
	}
	.target .ui-meter {
		height: 5px;
		margin-top: 3px;
	}
	.fps {
		text-align: center;
		font-size: 12px;
	}
	.specimen-settings {
		position: absolute;
		right: 48px;
		top: 16px;
		width: 220px;
		display: grid;
		gap: 6px;
		pointer-events: auto;
		font-size: 12px;
	}
	.settings-row,
	.field-row {
		display: grid;
		grid-template-columns: 52px 1fr;
		gap: 6px;
		align-items: center;
	}
	.stack {
		display: grid;
		gap: 6px;
	}
	.state-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.statuses {
		line-height: 1.5;
	}

	.chat-overlay {
		display: flex;
		flex-direction: column;
		pointer-events: none;
	}
	.chat-lines p {
		pointer-events: auto;
	}
	.chat-lines {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		flex-direction: column;
		justify-content: end;
		padding: 8px;
		line-height: 1.5;
		background: linear-gradient(
			to bottom,
			transparent,
			var(--ui-hud-backing) 60%
		);
		text-shadow: 0 1px 2px var(--ui-color-shadow);
	}
	.chat-overlay:focus-within .chat-lines {
		background: var(--ui-hud-backing);
	}
	.chat-filters {
		padding: 0 3px;
		background: var(--ui-hud-backing);
		pointer-events: auto;
	}
	.chat-filters .ui-tabs {
		padding: 0;
		gap: 2px;
	}
	.chat-entry {
		display: grid;
		grid-template-columns: 1fr 26px;
		gap: 3px;
		padding: 3px;
		background: var(--ui-hud-backing);
		pointer-events: auto;
	}
	.chat-entry :global(svg) {
		width: 16px;
		height: 16px;
	}
	.notification {
		display: grid;
		place-content: center;
		pointer-events: none;
	}
	.notification .ui-readout {
		pointer-events: auto;
	}
	.shortcuts {
		display: flex;
		gap: 5px;
		align-items: end;
	}
	.shortcuts .ui-hud-button {
		flex: 1;
		min-width: 0;
		padding: 6px;
	}
	.shortcuts :global(svg) {
		width: 22px;
		height: 22px;
	}
	.overlap-window {
		position: absolute;
		left: calc(100% - 530px);
		top: 140px;
		width: 240px;
		height: 142px;
		min-width: 220px;
		min-height: 140px;
		pointer-events: auto;
	}
	.overlap-window header {
		cursor: move;
		touch-action: none;
	}
	.overlap-window .ui-body {
		padding-right: 40px;
	}
	.specimen-resize {
		width: 22px;
		height: 22px;
		position: absolute;
		bottom: 8px;
		right: 8px;
		cursor: nwse-resize;
		touch-action: none;
	}
	.specimen-tooltip {
		pointer-events: auto;
		position: absolute;
		left: calc(50% - 94px);
		top: 122px;
	}
</style>
