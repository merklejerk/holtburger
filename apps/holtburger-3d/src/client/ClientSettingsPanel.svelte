<script lang="ts">
	import type { ClientChatSuppressionSettings } from "./client-settings-contract";
	import ClientGameplaySettingsControls from "./ClientGameplaySettingsControls.svelte";
	import type {
		ClientGameplayOption,
		ClientGameplayPreferences,
	} from "./client-gameplay-options-contract";
	import UiRange from "../app/UiRange.svelte";
	import type { UiThemeSettings } from "../app/ui-theme-selection";
	import {
		readClientBinding,
		replaceClientBinding,
	} from "../lib/input/client-keyboard-bindings";

	import ClientGraphicsSettingsControls from "./ClientGraphicsSettingsControls.svelte";
	import ClientAudioSettingsControls from "./ClientAudioSettingsControls.svelte";
	import ClientAppearanceSettingsControls from "./ClientAppearanceSettingsControls.svelte";
	import "./client-settings-controls.css";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientEnvironmentSettings from "./ClientEnvironmentSettings.svelte";
	import type {
		ClientClockFormat,
		ClientEnvironmentOverrides,
	} from "./client-environment-settings";
	import type { ClientWeatherPreset } from "./client-environment";
	import { onMount } from "svelte";
	import ClientBindingDialog from "./ClientBindingDialog.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import {
		CLIENT_BINDING_GROUPS,
		captureClientBinding,
		clientBindingsOverlap,
		conflictingClientBindings,
		replaceConflictingClientBindings,
		type ClientBindingRow,
	} from "./client-binding-catalog";
	import {
		CLIENT_INPUT_DEFAULTS,
		CLIENT_KEYBOARD_DEFAULTS,
	} from "./client-input-settings";
	import { type TextureFilteringCapabilities } from "../lib/game/renderer/texture-filtering-policy";
	import type {
		ClientAudioSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
	} from "./client-settings-contract";
	import {
		CLIENT_VITAL_WARNING_PERCENT,
		CLIENT_VITAL_WARNING_KINDS,
	} from "./client-settings-values";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type {
		ClientInputConfiguration,
		InputKeyEvent,
		KeyBinding,
	} from "../lib/input/input-contract";
	import {
		formatInputBinding,
		formatInputPill,
		modifierName,
		type InputDisplayPlatform,
	} from "../lib/input/input-presentation";

	export type SettingsTab = "graphics" | "audio" | "ui" | "input" | "gameplay";
	interface Props {
		/** Local chat admission preferences, independent of server character options. */
		readonly chatSuppression: ClientChatSuppressionSettings;
		readonly onChatSuppressionChange: (
			settings: ClientChatSuppressionSettings,
		) => void;
		/** Server-saved gameplay choices and current character admission. */
		readonly gameplayPreferences: ClientGameplayPreferences | null;
		readonly gameplayEnabled: boolean;
		readonly onGameplayOptionChange: (
			option: ClientGameplayOption,
			enabled: boolean,
		) => Promise<void>;
		/** User-scoped audio mix and mute preferences. */
		readonly audio: ClientAudioSettings;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
		readonly graphics: ClientGraphicsSettings;
		/** Shared selection owner and settings commit used by both appearance surfaces. */
		readonly theme: UiThemeSettings;
		readonly ui: ClientUiSettings;
		/** User-owned environment presentation choices and cold content catalog. */
		readonly clockFormat: ClientClockFormat;
		readonly environmentOverrides: ClientEnvironmentOverrides;
		readonly weatherPresets: readonly ClientWeatherPreset[];
		readonly environmentIssue: string | null;
		readonly onClockFormatChange: (format: ClientClockFormat) => void;
		readonly onEnvironmentOverridesChange: (
			overrides: ClientEnvironmentOverrides,
		) => void;
		readonly input: ClientInputConfiguration;
		readonly displayPlatform: InputDisplayPlatform;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly selectedTab: SettingsTab;
		readonly onSelectTab: (tab: SettingsTab) => void;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
		readonly onInputChange: (input: ClientInputConfiguration) => void;
		readonly canResetHudPlacements: boolean;
		readonly onResetHudPlacements: () => void;
	}
	let {
		chatSuppression,
		onChatSuppressionChange,
		gameplayPreferences,
		gameplayEnabled,
		onGameplayOptionChange,
		audio,
		onAudioChange,
		graphics,
		theme,
		ui,
		clockFormat,
		environmentOverrides,
		weatherPresets,
		environmentIssue,
		onClockFormatChange,
		onEnvironmentOverridesChange,
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
		readonly kind: "capture";
		readonly row: ClientBindingRow;
		readonly source: HTMLButtonElement;
		/** Modifier-only capture completes on release using its press-time event. */
		readonly modifier: {
			readonly binding: KeyBinding;
			readonly witness: InputKeyEvent;
		} | null;
	};
	type Conflict = {
		readonly kind: "conflict";
		readonly row: ClientBindingRow;
		readonly source: HTMLButtonElement;
		readonly bindings: readonly KeyBinding[];
		readonly rows: readonly ClientBindingRow[];
		/** The captured event proves mixed key/code overlap during replacement. */
		readonly witness: InputKeyEvent | null;
	};
	let bindingDialog = $state<Capture | Conflict | null>(null);
	onMount(() => {
		const cancel = () => (bindingDialog = null);
		window.addEventListener("blur", cancel);
		return () => window.removeEventListener("blur", cancel);
	});
	function closeBindingDialog(): void {
		const source = bindingDialog?.source;
		bindingDialog = null;
		requestAnimationFrame(() => {
			if (source?.isConnected) source.focus({ preventScroll: true });
		});
	}
	function captureWitness(event: KeyboardEvent): InputKeyEvent {
		return {
			key: event.key,
			code: event.code,
			shiftKey: event.shiftKey,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
		};
	}
	function proposeBindings(
		row: ClientBindingRow,
		bindings: readonly KeyBinding[],
		witness: InputKeyEvent | null,
		source: HTMLButtonElement,
	): void {
		const proposal = replaceClientBinding(input, row.reference, bindings);
		const rows = [
			...new Set(
				bindings.flatMap((binding) =>
					conflictingClientBindings(proposal, row, binding, witness),
				),
			),
		];
		if (rows.length > 0) {
			bindingDialog = {
				kind: "conflict",
				row,
				source,
				bindings,
				rows,
				witness,
			};
			return;
		}
		onInputChange({ ...input, ...proposal });
		if (bindingDialog !== null) closeBindingDialog();
	}
	function addBinding(
		row: ClientBindingRow,
		binding: KeyBinding,
		witness: InputKeyEvent,
	): void {
		if (bindingDialog?.kind !== "capture") return;
		if (
			readClientBinding(input, row.reference).some((existing) =>
				clientBindingsOverlap(existing, binding, witness),
			)
		) {
			closeBindingDialog();
			return;
		}
		proposeBindings(
			row,
			[...readClientBinding(input, row.reference), binding],
			witness,
			bindingDialog.source,
		);
	}
	function handleDialogKeydown(event: KeyboardEvent): void {
		if (bindingDialog === null) return;
		if (bindingDialog.kind === "conflict") {
			if (event.key === "Escape") {
				event.preventDefault();
				closeBindingDialog();
			}
			return;
		}
		event.preventDefault();
		if (event.repeat) return;
		if (event.key === "Escape") {
			closeBindingDialog();
			return;
		}
		const witness = captureWitness(event);
		const binding = captureClientBinding(witness);
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
			bindingDialog = {
				...bindingDialog,
				modifier: { binding, witness },
			};
			return;
		}
		addBinding(bindingDialog.row, binding, witness);
	}
	function handleDialogKeyup(event: KeyboardEvent): void {
		if (bindingDialog?.kind !== "capture") return;
		event.preventDefault();
		if (bindingDialog.modifier?.binding.key !== event.key) return;
		addBinding(
			bindingDialog.row,
			bindingDialog.modifier.binding,
			bindingDialog.modifier.witness,
		);
	}
	function startCapture(
		row: ClientBindingRow,
		button: HTMLButtonElement,
	): void {
		bindingDialog = { kind: "capture", row, source: button, modifier: null };
	}
	function clearBinding(
		row: ClientBindingRow,
		index: number,
		source: HTMLButtonElement,
	): void {
		proposeBindings(
			row,
			readClientBinding(input, row.reference).filter(
				(_, position) => position !== index,
			),
			null,
			source,
		);
	}
	function restoreBinding(
		row: ClientBindingRow,
		source: HTMLButtonElement,
	): void {
		proposeBindings(
			row,
			readClientBinding(CLIENT_KEYBOARD_DEFAULTS, row.reference),
			null,
			source,
		);
	}
	function conflictingBindingPills(candidate: Conflict): string[] {
		return candidate.bindings
			.filter((binding) =>
				candidate.rows.some((row) =>
					readClientBinding(input, row.reference).some((other) =>
						clientBindingsOverlap(binding, other, candidate.witness),
					),
				),
			)
			.map((binding) => formatInputPill(binding, displayPlatform));
	}
	function replaceDialogConflict(): void {
		if (bindingDialog?.kind !== "conflict") return;
		onInputChange({
			...input,
			...replaceConflictingClientBindings(
				input,
				bindingDialog.row,
				bindingDialog.bindings,
				bindingDialog.rows,
				bindingDialog.witness,
			),
		});
		closeBindingDialog();
	}
	const tabs = (
		[
			{ value: "graphics", label: "Graphics" },
			{ value: "audio", label: "Audio" },
			{ value: "ui", label: "UI" },
			{ value: "input", label: "Input" },
			{ value: "gameplay", label: "Gameplay" },
		] as const
	).map((tab) => ({
		...tab,
		id: `settings-tab-${tab.value}`,
		panelId: `settings-section-${tab.value}`,
	}));
</script>

<section class="settings-panel ui-body" aria-label="Client settings">
	<div
		class="settings-scroll"
		inert={bindingDialog !== null}
		use:keyboard.scope={{
			nativeControls: true,
			keydown: () => {},
		}}
	>
		<UiTabs
			label="Settings sections"
			{tabs}
			selected={selectedTab}
			onSelect={onSelectTab}
		/>
		<UiTabPanel
			id="settings-section-gameplay"
			labelledBy="settings-tab-gameplay"
			active={selectedTab === "gameplay"}
			scroll={false}
		>
			<div class="settings-section">
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Chat</summary>
					<div class="settings-section ui-disclosure-body">
						<label class="ui-checkbox">
							<input
								type="checkbox"
								checked={chatSuppression.hideSelfEvasionsAndResists}
								onchange={(event) =>
									onChatSuppressionChange({
										...chatSuppression,
										hideSelfEvasionsAndResists: event.currentTarget.checked,
									})}
							/>
							Hide self evasions/resists
						</label>
						<label class="ui-checkbox">
							<input
								type="checkbox"
								checked={chatSuppression.hideSpellIncantations}
								onchange={(event) =>
									onChatSuppressionChange({
										...chatSuppression,
										hideSpellIncantations: event.currentTarget.checked,
									})}
							/>
							Hide spell incantations
						</label>
						<p>
							Hidden messages are discarded. Changes apply to future messages
							only.
						</p>
					</div>
				</details>
				<ClientGameplaySettingsControls
					preferences={gameplayPreferences}
					enabled={gameplayEnabled}
					onChange={onGameplayOptionChange}
				/>
			</div>
		</UiTabPanel>
		{#if selectedTab === "graphics"}
			<div
				role="tabpanel"
				id="settings-section-graphics"
				aria-labelledby="settings-tab-graphics"
				class="settings-section"
			>
				<ClientGraphicsSettingsControls
					{graphics}
					{textureFilteringCapabilities}
					{onGraphicsChange}
				/>
			</div>
		{:else if selectedTab === "audio"}
			<div
				role="tabpanel"
				id="settings-section-audio"
				aria-labelledby="settings-tab-audio"
				class="settings-section"
			>
				<ClientAudioSettingsControls {audio} {onAudioChange} />
			</div>
		{:else if selectedTab === "ui"}
			<div
				role="tabpanel"
				id="settings-section-ui"
				aria-labelledby="settings-tab-ui"
				class="settings-section"
			>
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Display</summary>
					<div class="settings-section ui-disclosure-body">
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={graphics.alwaysShowEntityNameplates}
								onchange={(event) =>
									onGraphicsChange({
										...graphics,
										alwaysShowEntityNameplates: event.currentTarget.checked,
									})}
							/> Always show entity nameplates</label
						>
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={ui.showFps}
								onchange={(event) =>
									onUiChange({ ...ui, showFps: event.currentTarget.checked })}
							/> Show FPS</label
						>
					</div>
				</details>
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Time and weather</summary>
					<div class="settings-section ui-disclosure-body">
						<ClientEnvironmentSettings
							{clockFormat}
							overrides={environmentOverrides}
							presets={weatherPresets}
							issue={environmentIssue}
							{onClockFormatChange}
							onOverridesChange={onEnvironmentOverridesChange}
						/>
					</div>
				</details>
				<ClientAppearanceSettingsControls {theme} {ui} {onUiChange} />
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Vital warnings</summary>
					<div class="settings-section ui-disclosure-body">
						{#each CLIENT_VITAL_WARNING_KINDS as vital}
							<label
								>{vital.label} threshold: {ui.vitalWarningThresholds[
									vital.kind
								]}%
								<UiRange
									aria-label={`${vital.label} warning threshold`}
									min={CLIENT_VITAL_WARNING_PERCENT.minimum}
									max={CLIENT_VITAL_WARNING_PERCENT.maximum}
									step={CLIENT_VITAL_WARNING_PERCENT.step}
									value={ui.vitalWarningThresholds[vital.kind]}
									oninput={(event) =>
										onUiChange({
											...ui,
											vitalWarningThresholds: {
												...ui.vitalWarningThresholds,
												[vital.kind]: event.currentTarget.valueAsNumber,
											},
										})}
								/>
							</label>
						{/each}
					</div>
				</details>

				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>HUD layout</summary>
					<div class="settings-section ui-disclosure-body">
						<button
							type="button"
							class="ui-button"
							disabled={!canResetHudPlacements}
							onclick={onResetHudPlacements}>Reset HUD placements</button
						>
						<p class="ui-muted">
							Repositions windows and this character’s action bars without
							clearing their contents.
						</p>
					</div>
				</details>
			</div>
		{:else if selectedTab === "input"}
			<div
				role="tabpanel"
				id="settings-section-input"
				aria-labelledby="settings-tab-input"
				class="settings-section"
			>
				<p class="ui-muted">
					Use the plus icon to add a key or chord; the circular arrow restores
					an action's defaults. Escape cancels capture. An action can have
					multiple keys.
				</p>
				<button
					type="button"
					class="ui-button"
					onclick={() => onInputChange(structuredClone(CLIENT_INPUT_DEFAULTS))}
					>Restore default input settings</button
				>
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Mouse</summary>
					<div class="settings-section">
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={input.mouseMovement}
								onchange={(event) =>
									onInputChange({
										...input,
										mouseMovement: event.currentTarget.checked,
									})}
							/>Use mouse movement/steering</label
						>
						<fieldset class="ui-fieldset ui-fieldset-section">
							<legend>Camera rotation (left drag)</legend>
							<div class="ui-fieldset-body">
								<label class="ui-checkbox"
									><input
										type="checkbox"
										checked={input.invertCameraHorizontal}
										onchange={(event) =>
											onInputChange({
												...input,
												invertCameraHorizontal: event.currentTarget.checked,
											})}
									/>Invert horizontal axis</label
								>
								<label class="ui-checkbox"
									><input
										type="checkbox"
										checked={input.invertCameraVertical}
										onchange={(event) =>
											onInputChange({
												...input,
												invertCameraVertical: event.currentTarget.checked,
											})}
									/>Invert vertical axis</label
								>
							</div>
						</fieldset>
						<fieldset class="ui-fieldset ui-fieldset-section">
							<legend>Mouse steering (right drag)</legend>
							<div class="ui-fieldset-body">
								<label class="ui-checkbox"
									><input
										type="checkbox"
										checked={input.invertSteeringHorizontal}
										onchange={(event) =>
											onInputChange({
												...input,
												invertSteeringHorizontal: event.currentTarget.checked,
											})}
									/>Invert turning direction</label
								>
								<label class="ui-checkbox"
									><input
										type="checkbox"
										checked={input.invertSteeringVertical}
										onchange={(event) =>
											onInputChange({
												...input,
												invertSteeringVertical: event.currentTarget.checked,
											})}
									/>Invert camera tilt</label
								>
							</div>
						</fieldset>
					</div>
				</details>
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
													.value as ClientInputConfiguration["actionBars"]["alternate"],
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
									{#each readClientBinding(input, row.reference) as binding, index}
										<button
											type="button"
											class="binding-key ui-keycap"
											aria-label={`Remove ${formatInputBinding(binding, displayPlatform)} from ${row.label}`}
											title={`Remove binding: ${formatInputBinding(binding, displayPlatform)}`}
											onclick={(event) =>
												clearBinding(row, index, event.currentTarget)}
											><kbd aria-hidden="true"
												>{formatInputPill(binding, displayPlatform)}</kbd
											><span class="binding-key-remove" aria-hidden="true"
												>×</span
											></button
										>
									{:else}<span class="ui-muted">Unbound</span>{/each}
								</div>
								<div class="binding-actions ui-icon-actions">
									<button
										type="button"
										class="ui-button ui-icon-button"
										aria-label={`Add key for ${row.label}`}
										title={`Add key for ${row.label}`}
										onclick={(event) => startCapture(row, event.currentTarget)}
										><ClientHudIcon name="add" /></button
									>
									<button
										type="button"
										class="ui-button ui-icon-button"
										aria-label={`Restore default keys for ${row.label}`}
										title={`Restore default keys for ${row.label}`}
										onclick={(event) =>
											restoreBinding(row, event.currentTarget)}
										><ClientHudIcon name="reset" /></button
									>
								</div>
							</div>
						{/each}
					</details>
				{/each}
			</div>
		{/if}
	</div>
	{#if bindingDialog !== null}
		<ClientBindingDialog
			action={bindingDialog.row.label}
			conflict={bindingDialog.kind === "conflict"
				? {
						bindings: conflictingBindingPills(bindingDialog),
						actions: bindingDialog.rows.map((row) => row.label).join(", "),
					}
				: null}
			onKeydown={handleDialogKeydown}
			onKeyup={handleDialogKeyup}
			onReplace={replaceDialogConflict}
			onCancel={closeBindingDialog}
		/>
	{/if}
</section>

<style>
	@layer components {
		.settings-panel {
			position: relative;
			height: 100%;
			overflow: hidden;
		}
		.settings-scroll {
			box-sizing: border-box;
			height: 100%;
			overflow: auto;
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
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 3px;
		}
		.binding-actions {
			grid-area: actions;
			flex-wrap: nowrap;
			gap: 3px;
		}
		.binding-key {
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
	}
</style>
