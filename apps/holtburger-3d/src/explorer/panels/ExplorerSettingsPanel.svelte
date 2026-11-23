<script lang="ts">
	import AppearanceSettingsControls from "../../app/settings/AppearanceSettingsControls.svelte";
	import AudioSettingsControls from "../../app/settings/AudioSettingsControls.svelte";
	import BindingDialog from "../../app/settings/BindingDialog.svelte";
	import BindingRow from "../../app/settings/BindingRow.svelte";
	import GraphicsSettingsControls from "../../app/settings/GraphicsSettingsControls.svelte";
	import "../../app/settings/settings-controls.css";
	import type { UiThemeSettings } from "../../app/theme/ui-theme-selection";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import {
		CLIENT_BINDING_GROUPS,
		captureClientBinding,
		clientBindingsOverlap,
		conflictingClientBindings,
		replaceConflictingClientBindings,
		type ClientBindingRow,
	} from "../../client/settings/binding-catalog";
	import { createClientInputDefaults } from "../../client/settings/input-settings";
	import type {
		ClientAudioSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
	} from "../../client/settings/settings-contract";
	import type { TextureFilteringCapabilities } from "../../lib/game/renderer/webgl2/texture-filtering-policy";
	import {
		readClientBinding,
		replaceClientBinding,
	} from "../../lib/input/client-keyboard-bindings";
	import {
		FLY_ACTIONS,
		type ClientInputConfiguration,
		type FlyAction,
		type KeyBinding,
	} from "../../lib/input/input-contract";
	import { createInputDefaults } from "../../lib/input/input-defaults";
	import type { InputPlatform } from "../../lib/input/input-platform";
	import { formatInputPill } from "../../lib/input/input-presentation";
	import type { ExplorerInputSettings } from "../settings/explorer-settings-contract";
	import { EXPLORER_INPUT_DEFAULTS } from "../settings/explorer-settings-defaults";

	type SettingsTab = "graphics" | "audio" | "ui" | "input";

	const TABS = [
		{
			value: "graphics",
			label: "Graphics",
			id: "explorer-settings-graphics-tab",
			panelId: "explorer-settings-graphics-panel",
		},
		{
			value: "audio",
			label: "Audio",
			id: "explorer-settings-audio-tab",
			panelId: "explorer-settings-audio-panel",
		},
		{
			value: "ui",
			label: "UI",
			id: "explorer-settings-ui-tab",
			panelId: "explorer-settings-ui-panel",
		},
		{
			value: "input",
			label: "Input",
			id: "explorer-settings-input-tab",
			panelId: "explorer-settings-input-panel",
		},
	] as const;

	const FLY_LABELS: Readonly<Record<FlyAction, string>> = {
		forward: "Fly forward",
		backward: "Fly backward",
		strafeLeft: "Fly strafe left",
		strafeRight: "Fly strafe right",
		ascend: "Fly ascend",
		descend: "Fly descend",
		turnLeft: "Fly yaw left",
		turnRight: "Fly yaw right",
		precision: "Precision slow",
	};

	type ExplorerBindingTarget =
		| { readonly scope: "client"; readonly row: ClientBindingRow }
		| {
				readonly scope: "fly";
				readonly action: FlyAction;
				readonly label: string;
		  }
		| { readonly scope: "toggleHud"; readonly label: string };

	interface PendingCapture {
		readonly target: ExplorerBindingTarget;
		readonly candidate: KeyBinding | null;
		readonly witness: KeyboardEvent | null;
		/** Held bare modifier awaiting keyup so modifier chords (e.g. Ctrl+Shift+H) can complete. */
		readonly modifier: {
			readonly binding: KeyBinding;
			readonly witness: KeyboardEvent;
		} | null;
		readonly conflictLabels: readonly string[];
		readonly conflictClientRows: readonly ClientBindingRow[];
		readonly conflictExplorerTargets: readonly (
			| { readonly scope: "fly"; readonly action: FlyAction }
			| { readonly scope: "toggleHud" }
		)[];
	}

	interface Props {
		readonly visible: boolean;
		readonly platform: InputPlatform;
		readonly theme: UiThemeSettings;
		readonly graphics: ClientGraphicsSettings;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly ui: ClientUiSettings;
		readonly audio: ClientAudioSettings;
		readonly input: ClientInputConfiguration;
		readonly explorerInput: ExplorerInputSettings;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
		readonly onInputChange: (input: ClientInputConfiguration) => void;
		readonly onExplorerInputChange: (input: ExplorerInputSettings) => void;
		readonly onResetHudLayout: () => void;
		readonly onResetExplorerDefaults: () => void;
	}

	const {
		visible,
		platform,
		theme,
		graphics,
		textureFilteringCapabilities,
		ui,
		audio,
		input,
		explorerInput,
		onGraphicsChange,
		onUiChange,
		onAudioChange,
		onInputChange,
		onExplorerInputChange,
		onResetHudLayout,
		onResetExplorerDefaults,
	}: Props = $props();

	const characterRows: readonly ClientBindingRow[] =
		CLIENT_BINDING_GROUPS.flatMap((group) =>
			group.rows.filter(
				(row) =>
					row.reference.kind === "character" ||
					(row.reference.kind === "client" &&
						row.reference.action === "toggleAutoRun"),
			),
		);

	let activeTab = $state<SettingsTab>("graphics");
	let capture = $state<PendingCapture | null>(null);

	function readExplorerTargetBindings(
		target: ExplorerBindingTarget,
	): readonly KeyBinding[] {
		if (target.scope === "client") {
			return readClientBinding(input, target.row.reference);
		}
		if (target.scope === "fly") {
			return explorerInput.fly[target.action];
		}
		return explorerInput.toggleHud;
	}

	function removeBinding(target: ExplorerBindingTarget, index: number): void {
		const nextBindings = readExplorerTargetBindings(target).filter(
			(_binding, candidateIndex) => candidateIndex !== index,
		);
		if (target.scope === "client") {
			onInputChange({
				...input,
				...replaceClientBinding(input, target.row.reference, nextBindings),
			});
			return;
		}
		if (target.scope === "fly") {
			onExplorerInputChange({
				...explorerInput,
				fly: { ...explorerInput.fly, [target.action]: nextBindings },
			});
			return;
		}
		onExplorerInputChange({
			...explorerInput,
			toggleHud: nextBindings,
		});
	}

	function resetTargetBinding(target: ExplorerBindingTarget): void {
		if (target.scope === "client") {
			const defaults = createInputDefaults(platform);
			const defaultBindings =
				target.row.reference.kind === "character"
					? defaults.character[target.row.reference.action]
					: defaults.client.toggleAutoRun;
			onInputChange({
				...input,
				...replaceClientBinding(input, target.row.reference, defaultBindings),
			});
			return;
		}
		if (target.scope === "fly") {
			onExplorerInputChange({
				...explorerInput,
				fly: {
					...explorerInput.fly,
					[target.action]: EXPLORER_INPUT_DEFAULTS.fly[target.action],
				},
			});
			return;
		}
		onExplorerInputChange({
			...explorerInput,
			toggleHud: EXPLORER_INPUT_DEFAULTS.toggleHud,
		});
	}

	$effect(() => {
		if (!visible) capture = null;
	});

	$effect(() => {
		if (capture === null) return;
		const cancelOnBlur = (): void => {
			capture = null;
		};
		window.addEventListener("blur", cancelOnBlur);
		return () => window.removeEventListener("blur", cancelOnBlur);
	});

	function beginCapture(target: ExplorerBindingTarget): void {
		capture = {
			target,
			candidate: null,
			witness: null,
			modifier: null,
			conflictLabels: [],
			conflictClientRows: [],
			conflictExplorerTargets: [],
		};
	}

	function applyCapturedBinding(
		target: ExplorerBindingTarget,
		candidate: KeyBinding,
		witness: KeyboardEvent,
	): void {
		const existing = readExplorerTargetBindings(target);
		if (
			existing.some((binding) =>
				clientBindingsOverlap(candidate, binding, witness),
			)
		) {
			capture = null;
			return;
		}

		if (target.scope === "client") {
			const conflicts = conflictingClientBindings(
				input,
				target.row,
				candidate,
				witness,
			);
			if (conflicts.length === 0) {
				onInputChange({
					...input,
					...replaceClientBinding(input, target.row.reference, [
						...existing,
						candidate,
					]),
				});
				capture = null;
				return;
			}
			capture = {
				target,
				candidate,
				witness,
				modifier: null,
				conflictLabels: conflicts.map((row) => row.label),
				conflictClientRows: conflicts,
				conflictExplorerTargets: [],
			};
			return;
		}

		// Explorer-owned bindings only conflict within Explorer's own actions.
		const explorerConflicts: (
			| {
					readonly scope: "fly";
					readonly action: FlyAction;
					readonly label: string;
			  }
			| { readonly scope: "toggleHud"; readonly label: string }
		)[] = [];
		for (const action of FLY_ACTIONS) {
			if (target.scope === "fly" && target.action === action) continue;
			if (
				explorerInput.fly[action].some((binding) =>
					clientBindingsOverlap(candidate, binding, witness),
				)
			) {
				explorerConflicts.push({
					scope: "fly",
					action,
					label: FLY_LABELS[action],
				});
			}
		}
		if (
			target.scope !== "toggleHud" &&
			explorerInput.toggleHud.some((binding) =>
				clientBindingsOverlap(candidate, binding, witness),
			)
		) {
			explorerConflicts.push({
				scope: "toggleHud",
				label: "Hide / show HUD",
			});
		}
		if (explorerConflicts.length === 0) {
			commitExplorerBinding(target, [...existing, candidate], [], witness);
			capture = null;
			return;
		}
		capture = {
			target,
			candidate,
			witness,
			modifier: null,
			conflictLabels: explorerConflicts.map((entry) => entry.label),
			conflictClientRows: [],
			conflictExplorerTargets: explorerConflicts,
		};
	}

	function handleCaptureKeydown(event: KeyboardEvent): void {
		if (capture === null) return;
		if (capture.candidate !== null) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				capture = null;
			}
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat) return;
		if (event.key === "Escape") {
			capture = null;
			return;
		}
		const candidate = captureClientBinding(event);
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
			capture = {
				...capture,
				modifier: { binding: candidate, witness: event },
			};
			return;
		}
		applyCapturedBinding(capture.target, candidate, event);
	}

	function handleCaptureKeyup(event: KeyboardEvent): void {
		if (capture === null || capture.candidate !== null) return;
		event.preventDefault();
		event.stopPropagation();
		if (capture.modifier?.binding.key !== event.key) return;
		applyCapturedBinding(
			capture.target,
			capture.modifier.binding,
			capture.modifier.witness,
		);
	}

	function commitExplorerBinding(
		target: Exclude<ExplorerBindingTarget, { readonly scope: "client" }>,
		bindings: readonly KeyBinding[],
		conflicts: readonly (
			| { readonly scope: "fly"; readonly action: FlyAction }
			| { readonly scope: "toggleHud" }
		)[],
		witness: KeyboardEvent | null,
	): void {
		let nextFly = { ...explorerInput.fly };
		let nextToggleHud = explorerInput.toggleHud;
		for (const conflict of conflicts) {
			if (conflict.scope === "fly") {
				nextFly = {
					...nextFly,
					[conflict.action]: nextFly[conflict.action].filter(
						(binding) =>
							!bindings.some((candidate) =>
								clientBindingsOverlap(candidate, binding, witness),
							),
					),
				};
			} else {
				nextToggleHud = nextToggleHud.filter(
					(binding) =>
						!bindings.some((candidate) =>
							clientBindingsOverlap(candidate, binding, witness),
						),
				);
			}
		}
		if (target.scope === "fly") {
			nextFly = { ...nextFly, [target.action]: bindings };
		} else {
			nextToggleHud = bindings;
		}
		onExplorerInputChange({
			...explorerInput,
			fly: nextFly,
			toggleHud: nextToggleHud,
		});
	}

	function confirmReplaceConflict(): void {
		if (capture === null || capture.candidate === null) return;
		const { target, candidate, witness } = capture;
		const existing = readExplorerTargetBindings(target);
		const nextBindings = [...existing, candidate];
		if (target.scope === "client") {
			onInputChange({
				...input,
				...replaceConflictingClientBindings(
					input,
					target.row,
					nextBindings,
					capture.conflictClientRows,
					witness,
				),
			});
		} else {
			commitExplorerBinding(
				target,
				nextBindings,
				capture.conflictExplorerTargets,
				witness,
			);
		}
		capture = null;
	}

	function restoreAllInputDefaults(): void {
		const defaults = createClientInputDefaults(platform);
		onInputChange({
			...input,
			character: defaults.character,
			client: {
				...input.client,
				toggleAutoRun: defaults.client.toggleAutoRun,
			},
			mouseMovement: defaults.mouseMovement,
			invertCameraHorizontal: defaults.invertCameraHorizontal,
			invertCameraVertical: defaults.invertCameraVertical,
			invertSteeringHorizontal: defaults.invertSteeringHorizontal,
			invertSteeringVertical: defaults.invertSteeringVertical,
		});
		onExplorerInputChange(EXPLORER_INPUT_DEFAULTS);
	}

	const captureActionLabel = $derived(
		capture === null
			? ""
			: capture.target.scope === "client"
				? capture.target.row.label
				: capture.target.label,
	);
	const captureConflict = $derived(
		capture !== null &&
			capture.candidate !== null &&
			capture.conflictLabels.length > 0
			? {
					bindings: [formatInputPill(capture.candidate, platform)],
					actions: capture.conflictLabels.join(", "),
				}
			: null,
	);
</script>

<section class="settings-panel ui-body" aria-label="Explorer settings">
	<div class="ui-tabbed-panel" inert={capture !== null}>
		<UiTabs
			tabs={TABS}
			selected={activeTab}
			label="Explorer settings sections"
			onSelect={(value) => (activeTab = value as SettingsTab)}
		/>

		<UiTabPanel
			id="explorer-settings-graphics-panel"
			labelledBy="explorer-settings-graphics-tab"
			active={activeTab === "graphics"}
		>
			<div class="settings-section">
				<GraphicsSettingsControls
					{graphics}
					{textureFilteringCapabilities}
					showViewDistance={false}
					{onGraphicsChange}
				/>
			</div>
		</UiTabPanel>

		<UiTabPanel
			id="explorer-settings-audio-panel"
			labelledBy="explorer-settings-audio-tab"
			active={activeTab === "audio"}
		>
			<div class="settings-section">
				<AudioSettingsControls {audio} {onAudioChange} />
			</div>
		</UiTabPanel>

		<UiTabPanel
			id="explorer-settings-ui-panel"
			labelledBy="explorer-settings-ui-tab"
			active={activeTab === "ui"}
		>
			<div class="settings-section">
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Display</summary>
					<div class="settings-section ui-disclosure-body">
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
				<AppearanceSettingsControls {theme} {ui} {onUiChange} />
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>HUD layout</summary>
					<div class="explorer-reset-actions ui-disclosure-body">
						<button type="button" class="ui-button" onclick={onResetHudLayout}
							>Reset HUD placements</button
						>
						<button
							type="button"
							class="ui-button"
							onclick={onResetExplorerDefaults}>Reset Explorer defaults</button
						>
					</div>
				</details>
			</div>
		</UiTabPanel>

		<UiTabPanel
			id="explorer-settings-input-panel"
			labelledBy="explorer-settings-input-tab"
			active={activeTab === "input"}
		>
			<div class="settings-section">
				<button
					type="button"
					class="ui-button"
					onclick={restoreAllInputDefaults}
					>Restore default input settings</button
				>
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Mouse</summary>
					<div class="settings-section ui-disclosure-body">
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={input.mouseMovement}
								onchange={(event) =>
									onInputChange({
										...input,
										mouseMovement: event.currentTarget.checked,
									})}
							/>Mouse movement (right-drag steering, middle / L+R forward)</label
						>
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={input.invertCameraHorizontal}
								onchange={(event) =>
									onInputChange({
										...input,
										invertCameraHorizontal: event.currentTarget.checked,
									})}
							/>Invert camera horizontal</label
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
							/>Invert camera vertical</label
						>
						<label class="ui-checkbox"
							><input
								type="checkbox"
								checked={input.invertSteeringHorizontal}
								onchange={(event) =>
									onInputChange({
										...input,
										invertSteeringHorizontal: event.currentTarget.checked,
									})}
							/>Invert steering horizontal</label
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
							/>Invert steering vertical</label
						>
					</div>
				</details>

				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Explorer Fly &amp; HUD</summary>
					<div class="ui-disclosure-body">
						<div class="settings-section explorer-fly-mouse-options">
							<label class="ui-checkbox"
								><input
									type="checkbox"
									checked={explorerInput.invertFlyHorizontal}
									onchange={(event) =>
										onExplorerInputChange({
											...explorerInput,
											invertFlyHorizontal: event.currentTarget.checked,
										})}
								/>Invert fly horizontal</label
							>
							<label class="ui-checkbox"
								><input
									type="checkbox"
									checked={explorerInput.invertFlyVertical}
									onchange={(event) =>
										onExplorerInputChange({
											...explorerInput,
											invertFlyVertical: event.currentTarget.checked,
										})}
								/>Invert fly vertical</label
							>
						</div>
						<BindingRow
							label="Hide / show HUD"
							bindings={explorerInput.toggleHud}
							{platform}
							onRemove={(index) =>
								removeBinding(
									{ scope: "toggleHud", label: "Hide / show HUD" },
									index,
								)}
							onAdd={() =>
								beginCapture({ scope: "toggleHud", label: "Hide / show HUD" })}
							onReset={() =>
								resetTargetBinding({
									scope: "toggleHud",
									label: "Hide / show HUD",
								})}
						/>
						{#each FLY_ACTIONS as action}
							{@const target = {
								scope: "fly",
								action,
								label: FLY_LABELS[action],
							} as const}
							<BindingRow
								label={FLY_LABELS[action]}
								bindings={explorerInput.fly[action]}
								{platform}
								onRemove={(index) => removeBinding(target, index)}
								onAdd={() => beginCapture(target)}
								onReset={() => resetTargetBinding(target)}
							/>
						{/each}
					</div>
				</details>

				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Possession Movement</summary>
					<div class="ui-disclosure-body">
						{#each characterRows as row (row.id)}
							{@const target = { scope: "client", row } as const}
							<BindingRow
								label={row.label}
								bindings={readClientBinding(input, row.reference)}
								{platform}
								onRemove={(index) => removeBinding(target, index)}
								onAdd={() => beginCapture(target)}
								onReset={() => resetTargetBinding(target)}
							/>
						{/each}
					</div>
				</details>
			</div>
		</UiTabPanel>
	</div>

	{#if capture !== null}
		<BindingDialog
			action={captureActionLabel}
			conflict={captureConflict}
			onKeydown={handleCaptureKeydown}
			onKeyup={handleCaptureKeyup}
			onReplace={confirmReplaceConflict}
			onCancel={() => (capture = null)}
		/>
	{/if}
</section>

<style>
	@layer components {
		.settings-panel {
			position: relative;
			height: 100%;
			overflow: auto;
		}
		.settings-panel > .ui-tabbed-panel {
			grid-template-rows: auto minmax(3em, 1fr);
		}
		.explorer-fly-mouse-options {
			padding-bottom: 10px;
			margin-bottom: 4px;
			border-bottom: 1px solid var(--ui-color-border);
		}
		.explorer-reset-actions {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-overlay-gap);
		}
	}
</style>
