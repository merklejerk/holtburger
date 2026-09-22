<script lang="ts">
	import { onMount } from "svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import {
		CLIENT_BINDING_GROUPS,
		conflictingClientBindings,
		replaceConflictingClientBindings,
		type ClientBindingRow,
	} from "./client-binding-catalog";
	import { CLIENT_KEYBOARD_DEFAULTS } from "./client-input-settings";
	import { keyBindingsOverlap } from "../lib/input/input-context";
	import { ENTITY_SHADOW_MODES } from "../lib/game/renderer/entity-shadow-modes";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
	} from "../lib/game/renderer/texture-filtering-policy";
	import type {
		ClientGraphicsSettings,
		ClientUiSettings,
	} from "./client-settings-contract";
	import {
		CLIENT_FONT_FAMILY_OPTIONS,
		CLIENT_GRAPHICS_RANGES,
		type ClientFontFamily,
	} from "./client-settings-values";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type {
		ClientKeyboardConfiguration,
		KeyBinding,
	} from "../lib/input/input-contract";
	import {
		formatInputBinding,
		formatInputPill,
		modifierName,
		type InputDisplayPlatform,
	} from "../lib/input/input-presentation";

	export type SettingsTab = "graphics" | "ui" | "input";
	interface Props {
		readonly graphics: ClientGraphicsSettings;
		readonly ui: ClientUiSettings;
		readonly input: ClientKeyboardConfiguration;
		readonly displayPlatform: InputDisplayPlatform;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly selectedTab: SettingsTab;
		readonly onSelectTab: (tab: SettingsTab) => void;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
		readonly onInputChange: (input: ClientKeyboardConfiguration) => void;
		readonly canResetHudPlacements: boolean;
		readonly onResetHudPlacements: () => void;
	}
	let {
		graphics,
		ui,
		input,
		displayPlatform,
		textureFilteringCapabilities,
		selectedTab,
		onSelectTab,
		onGraphicsChange,
		onUiChange,
		onInputChange,
		canResetHudPlacements,
		onResetHudPlacements,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	type Capture = {
		readonly row: ClientBindingRow;
		readonly modifier: KeyBinding | null;
	};
	type Conflict = {
		readonly row: ClientBindingRow;
		readonly bindings: readonly KeyBinding[];
		readonly rows: readonly ClientBindingRow[];
	};
	let capture = $state<Capture | null>(null);
	let conflict = $state<Conflict | null>(null);
	onMount(() => {
		const cancel = () => {
			capture = null;
			conflict = null;
		};
		window.addEventListener("blur", cancel);
		return () => window.removeEventListener("blur", cancel);
	});
	function exactBinding(event: KeyboardEvent): KeyBinding {
		return {
			key: event.key,
			shift: event.shiftKey,
			ctrl: event.ctrlKey,
			alt: event.altKey,
			meta: event.metaKey,
		};
	}
	function proposeBindings(
		row: ClientBindingRow,
		bindings: readonly KeyBinding[],
	): void {
		const proposal = row.write(input, bindings);
		const rows = [
			...new Set(
				bindings.flatMap((binding) =>
					conflictingClientBindings(proposal, row, binding),
				),
			),
		];
		if (rows.length > 0) {
			conflict = { row, bindings, rows };
			return;
		}
		onInputChange(proposal);
	}
	function addBinding(row: ClientBindingRow, binding: KeyBinding): void {
		capture = null;
		if (
			row.read(input).some((existing) => keyBindingsOverlap(existing, binding))
		)
			return;
		proposeBindings(row, [...row.read(input), binding]);
	}
	function handleCaptureKeydown(event: KeyboardEvent): void {
		if (capture === null) return;
		event.preventDefault();
		if (event.repeat) return;
		if (event.key === "Escape") {
			capture = null;
			return;
		}
		const binding = exactBinding(event);
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
			capture = { ...capture, modifier: binding };
			return;
		}
		addBinding(capture.row, binding);
	}
	function handleCaptureKeyup(event: KeyboardEvent): void {
		if (capture === null) return;
		event.preventDefault();
		if (capture.modifier?.key !== event.key) return;
		addBinding(capture.row, capture.modifier);
	}
	function startCapture(
		row: ClientBindingRow,
		button: HTMLButtonElement,
	): void {
		conflict = null;
		capture = { row, modifier: null };
		button.focus();
	}
	function clearBinding(row: ClientBindingRow, index: number): void {
		proposeBindings(
			row,
			row.read(input).filter((_, position) => position !== index),
		);
	}
	function restoreBinding(row: ClientBindingRow): void {
		proposeBindings(row, row.read(CLIENT_KEYBOARD_DEFAULTS));
	}
	function conflictingBindingLabels(candidate: Conflict): string {
		return candidate.bindings
			.filter((binding) =>
				candidate.rows.some((row) =>
					row.read(input).some((other) => keyBindingsOverlap(binding, other)),
				),
			)
			.map((binding) => formatInputBinding(binding, displayPlatform))
			.join(" / ");
	}
	function handleSettingsKeydown(event: KeyboardEvent): void {
		if (capture !== null) {
			handleCaptureKeydown(event);
			return;
		}
		if (
			!(event.target instanceof HTMLElement) ||
			event.target.getAttribute("role") !== "tab"
		)
			return;
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		const index = tabs.findIndex((tab) => tab.id === selectedTab);
		const next =
			tabs[
				(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
					tabs.length
			];
		event.preventDefault();
		onSelectTab(next.id);
		document.getElementById(`settings-tab-${next.id}`)?.focus();
	}
	let supportedFiltering = $derived(
		textureFilteringCapabilities === null
			? []
			: supportedTextureFilteringPolicies(textureFilteringCapabilities),
	);
	let effectiveFiltering = $derived(
		textureFilteringCapabilities === null
			? null
			: resolveTextureFilteringPolicy(
					graphics.textureFiltering,
					textureFilteringCapabilities,
				),
	);
	const renderScales = [0.5, 0.75, 1, 1.5, 2] as const;
	const fontRoles = [
		{ id: "body", label: "Body text" },
		{ id: "heading", label: "Headings" },
		{ id: "mono", label: "Monospace" },
	] as const;
	const fontFamilyLabels: Readonly<Record<ClientFontFamily, string>> = {
		theme: "Theme default",
		sans: "Arial / Helvetica",
		serif: "Georgia / Times New Roman",
		mono: "Courier New",
	};
	const tabs: readonly { readonly id: SettingsTab; readonly label: string }[] =
		[
			{ id: "graphics", label: "Graphics" },
			{ id: "ui", label: "UI" },
			{ id: "input", label: "Input" },
		];
</script>

<section
	class="settings-panel ui-body"
	aria-label="Client settings"
	use:keyboard.scope={{
		nativeControls: true,
		keydown: handleSettingsKeydown,
		keyup: handleCaptureKeyup,
	}}
>
	<div
		class="settings-tabs ui-tabs"
		role="tablist"
		aria-label="Settings sections"
	>
		{#each tabs as tab}
			<button
				type="button"
				class="ui-tab"
				role="tab"
				id={`settings-tab-${tab.id}`}
				aria-controls={`settings-section-${tab.id}`}
				aria-selected={selectedTab === tab.id}
				tabindex={selectedTab === tab.id ? 0 : -1}
				onclick={() => onSelectTab(tab.id)}>{tab.label}</button
			>
		{/each}
	</div>
	{#if selectedTab === "graphics"}
		<div
			role="tabpanel"
			id="settings-section-graphics"
			aria-labelledby="settings-tab-graphics"
			class="settings-section"
		>
			<label
				>View distance: {graphics.viewDistance} landblocks
				<input
					type="range"
					min={CLIENT_GRAPHICS_RANGES.viewDistance.minimum}
					max={CLIENT_GRAPHICS_RANGES.viewDistance.maximum}
					step={CLIENT_GRAPHICS_RANGES.viewDistance.step}
					value={graphics.viewDistance}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							viewDistance: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<p class="ui-muted">
				Terrain and buildings extend to this distance; smaller objects stay
				nearby.
			</p>
			<label
				>Field of view: {graphics.verticalFovDegrees}°
				<input
					type="range"
					min={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.minimum}
					max={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.maximum}
					step={CLIENT_GRAPHICS_RANGES.verticalFovDegrees.step}
					value={graphics.verticalFovDegrees}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							verticalFovDegrees: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<label class="checkbox"
				><input
					type="checkbox"
					checked={graphics.ambientOcclusionEnabled}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							ambientOcclusionEnabled: event.currentTarget.checked,
						})}
				/> Ambient occlusion</label
			>
			<label
				>Entity shadows
				<select
					value={graphics.entityShadowMode}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							entityShadowMode: event.currentTarget
								.value as ClientGraphicsSettings["entityShadowMode"],
						})}
				>
					{#each ENTITY_SHADOW_MODES as mode}<option value={mode}
							>{mode === "none"
								? "Off"
								: mode === "simple"
									? "Simple"
									: "Shadow maps"}</option
						>{/each}
				</select>
			</label>
			<label
				>Texture filtering
				<select
					value={graphics.textureFiltering}
					disabled={textureFilteringCapabilities === null}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							textureFiltering: event.currentTarget
								.value as ClientGraphicsSettings["textureFiltering"],
						})}
				>
					{#if textureFilteringCapabilities === null}<option
							value={graphics.textureFiltering}>Detecting GPU…</option
						>{/if}
					{#if textureFilteringCapabilities !== null && effectiveFiltering !== graphics.textureFiltering}
						<option value={graphics.textureFiltering}
							>{graphics.textureFiltering} (saved; using {effectiveFiltering})</option
						>
					{/if}
					{#each supportedFiltering as mode}<option value={mode}>{mode}</option
						>{/each}
				</select>
			</label>
			<label
				>Render scale
				<select
					value={graphics.renderScale}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							renderScale: Number(event.currentTarget.value),
						})}
				>
					{#each renderScales as scale}<option value={scale}>{scale}×</option
						>{/each}
				</select>
			</label>
			<label class="checkbox"
				><input
					type="checkbox"
					checked={graphics.weatherEnabled}
					onchange={(event) =>
						onGraphicsChange({
							...graphics,
							weatherEnabled: event.currentTarget.checked,
						})}
				/> Weather</label
			>
		</div>
	{:else if selectedTab === "ui"}
		<div
			role="tabpanel"
			id="settings-section-ui"
			aria-labelledby="settings-tab-ui"
			class="settings-section"
		>
			{#each fontRoles as role}
				<label
					>{role.label} font
					<select
						value={ui.fonts[role.id]}
						onchange={(event) =>
							onUiChange({
								...ui,
								fonts: {
									...ui.fonts,
									[role.id]: event.currentTarget.value as ClientFontFamily,
								},
							})}
					>
						{#each CLIENT_FONT_FAMILY_OPTIONS as family}
							<option value={family}>{fontFamilyLabels[family]}</option>
						{/each}
					</select>
				</label>
			{/each}
			<label
				>Text scaling (planned)
				<input type="range" min="50" max="200" value="100" disabled />
			</label>
			<label
				>Icon scaling (planned)
				<input type="range" min="50" max="200" value="100" disabled />
			</label>
			<button
				type="button"
				class="ui-button"
				disabled={!canResetHudPlacements}
				onclick={onResetHudPlacements}>Reset HUD placements</button
			>
			<p class="ui-muted">
				Repositions windows and this character’s action bars without clearing
				their contents.
			</p>
		</div>
	{:else}
		<div
			role="tabpanel"
			id="settings-section-input"
			aria-labelledby="settings-tab-input"
			class="settings-section"
		>
			<p class="ui-muted">
				Use the plus icon to add a key or chord; the circular arrow restores an
				action's defaults. Escape cancels capture. An action can have multiple
				keys.
			</p>
			<button
				type="button"
				class="ui-button"
				onclick={() => {
					capture = null;
					conflict = null;
					onInputChange(structuredClone(CLIENT_KEYBOARD_DEFAULTS));
				}}>Restore all default bindings</button
			>
			{#if conflict !== null}
				<div class="binding-conflict" role="alert">
					<p>
						{conflictingBindingLabels(conflict)} conflicts with
						{conflict.rows.map((row) => row.label).join(", ")}.
					</p>
					<button
						type="button"
						class="ui-button"
						onclick={() => {
							if (conflict !== null) {
								onInputChange(
									replaceConflictingClientBindings(
										input,
										conflict.row,
										conflict.bindings,
										conflict.rows,
									),
								);
								conflict = null;
							}
						}}>Replace conflicting bindings</button
					>
					<button
						type="button"
						class="ui-button"
						onclick={() => {
							conflict = null;
						}}>Cancel</button
					>
				</div>
			{/if}
			{#each CLIENT_BINDING_GROUPS as group}
				<details class="binding-group" open={group.title === "Movement"}>
					<summary>{group.title}</summary>
					{#if group.title === "Action bars"}
						<label
							>Alternate action modifier
							<select
								value={input.actionBars.alternate}
								onchange={(event) =>
									onInputChange({
										...input,
										actionBars: {
											...input.actionBars,
											alternate: event.currentTarget
												.value as ClientKeyboardConfiguration["actionBars"]["alternate"],
										},
									})}
							>
								<option value="shift"
									>{modifierName("shift", displayPlatform)}</option
								><option value="ctrl"
									>{modifierName("ctrl", displayPlatform)}</option
								><option value="alt"
									>{modifierName("alt", displayPlatform)}</option
								><option value="meta"
									>{modifierName("meta", displayPlatform)}</option
								>
							</select>
						</label>
						<p class="ui-muted">
							Hold this while activating an action cell to use its alternate
							effect, such as equipping the other side or using an item on the
							selected target.
						</p>
					{/if}
					{#each group.rows as row (row.id)}
						<div class="binding-row">
							<span class="binding-label">{row.label}</span>
							<div class="binding-keys">
								{#each row.read(input) as binding, index}
									<button
										type="button"
										class="binding-key"
										aria-label={`Remove ${formatInputBinding(binding, displayPlatform)} from ${row.label}`}
										title={`Remove binding: ${formatInputBinding(binding, displayPlatform)}`}
										onclick={() => clearBinding(row, index)}
										><kbd aria-hidden="true"
											>{formatInputPill(binding, displayPlatform)}</kbd
										><span class="binding-key-remove" aria-hidden="true">×</span
										></button
									>
								{:else}<span class="ui-muted">Unbound</span>{/each}
							</div>
							<div class="binding-actions">
								<button
									type="button"
									class="ui-button ui-icon-button"
									aria-label={capture?.row.id === row.id
										? `Press a key for ${row.label}`
										: `Add key for ${row.label}`}
									title={capture?.row.id === row.id
										? `Press a key for ${row.label}`
										: `Add key for ${row.label}`}
									aria-pressed={capture?.row.id === row.id}
									onclick={(event) => startCapture(row, event.currentTarget)}
									onblur={() => {
										if (capture?.row.id === row.id) capture = null;
									}}><ClientHudIcon name="add" /></button
								>
								<button
									type="button"
									class="ui-button ui-icon-button"
									aria-label={`Restore default keys for ${row.label}`}
									title={`Restore default keys for ${row.label}`}
									onclick={() => restoreBinding(row)}
									><ClientHudIcon name="reset" /></button
								>
							</div>
						</div>
					{/each}
				</details>
			{/each}
		</div>
	{/if}
</section>

<style>
	@layer components {
		.settings-panel {
			height: 100%;
			overflow: auto;
			padding: 12px;
		}
		.settings-tabs {
			margin-bottom: 12px;
		}
		.settings-tabs button {
			flex: 1;
		}
		.settings-section {
			display: grid;
			gap: 12px;
		}
		.settings-section label:not(.checkbox) {
			display: grid;
			gap: 4px;
		}
		.settings-section input[type="range"],
		.settings-section select {
			width: 100%;
		}
		.settings-section p {
			margin: 0;
		}
		.binding-group {
			display: block;
		}
		.binding-group summary {
			cursor: pointer;
			font-weight: 700;
			padding: 6px 2px;
		}
		.binding-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: "label actions" "keys actions";
			column-gap: 8px;
			row-gap: 2px;
			align-items: center;
			padding: 5px 2px;
			border-bottom: 1px solid var(--ui-color-border);
		}
		.binding-label {
			grid-area: label;
			font-weight: 600;
		}
		.binding-keys {
			grid-area: keys;
			min-width: 0;
		}
		.binding-actions {
			grid-area: actions;
			flex-wrap: nowrap;
			gap: 3px;
		}
		.binding-keys,
		.binding-actions {
			display: flex;
			align-items: center;
		}
		.binding-keys {
			flex-wrap: wrap;
			gap: 3px;
		}
		.binding-actions .ui-icon-button {
			width: 26px;
			height: 26px;
			padding: 4px;
		}
		.binding-key {
			display: inline-grid;
			place-items: center;
			min-width: 30px;
			min-height: 24px;
			padding: 1px 8px;
			border: 1px solid var(--ui-color-border);
			border-radius: 999px;
			background: var(--ui-color-control);
			color: inherit;
			font: inherit;
			white-space: nowrap;
			cursor: pointer;
		}
		.binding-key kbd,
		.binding-key-remove {
			grid-area: 1 / 1;
		}
		.binding-key kbd {
			font: inherit;
		}
		.binding-key-remove {
			font-size: 1.25em;
			line-height: 1;
			opacity: 0;
			pointer-events: none;
		}
		.binding-key:hover,
		.binding-key:focus-visible {
			border-color: var(--ui-color-accent);
			color: var(--ui-color-accent);
		}
		.binding-key:focus-visible {
			outline: 2px solid var(--ui-color-accent);
			outline-offset: 2px;
		}
		.binding-key:hover kbd,
		.binding-key:focus-visible kbd {
			opacity: 0;
		}
		.binding-key:hover .binding-key-remove,
		.binding-key:focus-visible .binding-key-remove {
			opacity: 1;
		}
		.binding-conflict {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
			padding: 8px;
			border: 1px solid var(--ui-color-warning);
		}
	}
</style>
