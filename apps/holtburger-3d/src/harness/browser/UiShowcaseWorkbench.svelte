<script lang="ts">
	import type { Snippet } from "svelte";
	import UiRange from "../../app/UiRange.svelte";
	import UiDialog from "../../app/UiDialog.svelte";
	import UiTabs from "../../app/UiTabs.svelte";
	import UiTabPanel from "../../app/UiTabPanel.svelte";
	import ToggleField from "../../app/ToggleField.svelte";
	import ItemGridCell from "../../app/ItemGridCell.svelte";
	import ClientHudWindow from "../../client/ClientHudWindow.svelte";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import ClientPregameSettings from "../../client/ClientPregameSettings.svelte";
	import ClientDebugPanel from "../../client/ClientDebugPanel.svelte";
	import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type { ClientUserSettings } from "../../client/client-settings-contract";
	import type { ClientHudPlacement } from "../../client/client-hud-layout";
	import type { ClientAppPhase } from "../../client/client-app-lifecycle";
	import {
		CLIENT_TEXT_SCALE,
		CLIENT_ICON_SCALE,
	} from "../../client/client-settings-values";
	import type { ClientVital } from "../../client/client-host-contract";
	import {
		fixtureThemeIds,
		type ShowcaseThemeSettings,
	} from "./ui-showcase-themes";
	import {
		SHOWCASE_PANELS,
		SHOWCASE_VITAL_KINDS,
		type UiShowcaseSession,
		type ShowcasePanel,
	} from "./ui-showcase-fixture";
	import UiShowcaseDropdowns from "./UiShowcaseDropdowns.svelte";
	import swordUrl from "../../assets/icons/equipment-weapon.svg?url";
	import shieldUrl from "../../assets/icons/equipment-shield.svg?url";
	import cloakUrl from "../../assets/icons/hud-cloak.svg?url";

	interface Props {
		/** Shared fixture commands become available after the real session has started. */
		readonly session: UiShowcaseSession | null;
		/** Startup failures are visible beside the fixture controls. */
		readonly startupError: string | null;
		/** One selection owner serves sidebar, production preferences and all samples. */
		readonly themeSettings: ShowcaseThemeSettings;
		/** The client fixture owns UI, audio, graphics and layout preferences. */
		readonly preferences: ClientUserSettings;
		/** All sample preference edits update that same owner. */
		readonly onSettingsChange: (preferences: ClientUserSettings) => void;
		/** The real game canvas and production client tree, mounted exactly once. */
		readonly children: Snippet;
	}
	const {
		session,
		startupError,
		themeSettings,
		preferences,
		onSettingsChange,
		children,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const settingsUi = $derived(preferences.ui);
	const settingsGraphics = $derived(preferences.graphics);
	const settingsAudio = $derived(preferences.audio);
	let stageWidth = $state(1000);
	let stageHeight = $state(800);
	const viewport = $derived({ width: stageWidth, height: stageHeight });
	function defaultPlacement(): ClientHudPlacement {
		return {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "start", offset: 160 },
			preferredWidth: 430,
			preferredHeight: 440,
		};
	}
	let placement = $state(defaultPlacement());
	let windowOpen = $state(true);
	let tab = $state<"controls" | "characters" | "diagnostics">("controls");
	const showcaseTabs = (
		[
			{ value: "controls", label: "Controls" },
			{ value: "characters", label: "Characters" },
			{ value: "diagnostics", label: "Diagnostics" },
		] as const
	).map((page) => ({
		...page,
		id: `showcase-${page.value}-tab`,
		panelId: `showcase-${page.value}-panel`,
	}));
	let dialogOpen = $state(false);
	let toggle = $state(true);
	let selectedItem = $state(1);
	let unrestrictedUse = $state(false);
	let showHidden = $state(false);
	const initialJumpExtent = 0.65;
	const itemSpecimens = [
		{ guid: 1, name: "Weapon specimen", url: swordUrl, count: null },
		{ guid: 2, name: "Shield specimen", url: shieldUrl, count: 12 },
		{ guid: 3, name: "Cloak specimen", url: cloakUrl, count: null },
	];
	let characters = $state<
		Extract<ClientAppPhase, { kind: "character-selection" }>
	>({
		kind: "character-selection",
		rejection: null,
		maxSlots: 11,
		selectedGuid: null,
		characters: [
			{ guid: 1, name: "Wayfarer", slot: 0, deleteTime: 0 },
			{ guid: 2, name: "Lantern Keeper", slot: 1, deleteTime: 0 },
		],
	});
	let backdrop = $state("landscape");
	let backdropColor = $state("#20252b");
	let backdropFiles = $state<FileList>();
	let imageUrl = $state<string | null>(null);
	let imageFailed = $state(false);
	$effect(() => {
		const file = backdropFiles?.[0];
		imageFailed = false;
		if (!file) {
			imageUrl = null;
			return;
		}
		const url = URL.createObjectURL(file);
		imageUrl = url;
		backdrop = "image";
		return () => URL.revokeObjectURL(url);
	});
	let opaque = $state(false);
	let reload = $state<
		{ kind: "idle" | "loading" | "loaded" } | { kind: "error"; message: string }
	>({ kind: "idle" });
	function requireSession(): UiShowcaseSession {
		if (session === null) throw new Error("Showcase session is not ready");
		return session;
	}
	function notice(message: string): void {
		requireSession().notify(message);
	}
	async function selectTheme(id: string | null): Promise<void> {
		reload = { kind: "loading" };
		try {
			await themeSettings.applyPreview(id, opaque);
			reload = { kind: "loaded" };
		} catch (error) {
			reload = {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}
	let pending = $state(false);
	let panelError = $state<string | null>(null);
	async function openPanel(panel: ShowcasePanel): Promise<void> {
		pending = true;
		panelError = null;
		try {
			await requireSession().openPanel(panel);
		} catch (error) {
			panelError = error instanceof Error ? error.message : String(error);
		} finally {
			pending = false;
		}
	}
	function vitalPercent(kind: ClientVital["kind"]): number {
		const vital = session?.vitals.find((value) => value.kind === kind);
		return vital === undefined || vital.maximum === 0
			? 0
			: (vital.current / vital.maximum) * 100;
	}
	function warningPreset(kind: ClientVital["kind"] | null): void {
		const current = requireSession();
		for (const vital of ["health", "stamina", "mana"] as const)
			current.setVital(
				vital,
				vital === kind
					? Math.max(0, preferences.ui.vitalWarningThresholds[vital] - 1)
					: 100,
			);
		current.setWarningsEnabled(true);
	}
</script>

<main
	class="showcase ui-theme"
	aria-label="UI showcase"
	style:--ui-text-scale={preferences.ui.textScale}
	style:--ui-icon-scale={preferences.ui.iconScale}
	data-showcase-ready={session !== null}
	data-showcase-pending={pending}
>
	<aside
		class="showcase-controls ui-panel"
		use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
	>
		<header class="ui-frame">UI showcase</header>
		<div class="ui-body">
			<p class="ui-muted">One client stage · fixture data</p>
			{#if startupError !== null}<p role="alert" class="ui-error">
					{startupError}
				</p>{:else if session === null}<p role="status">
					Starting fixture session…
				</p>{/if}
			<label class="ui-label"
				>Theme<select
					class="ui-input"
					aria-label="Showcase theme"
					value={preferences.ui.themeId ?? "base"}
					disabled={reload.kind === "loading"}
					onchange={(event) =>
						void selectTheme(
							event.currentTarget.value === "base"
								? null
								: event.currentTarget.value,
						)}
				>
					<option value="base">Base</option>{#each fixtureThemeIds as id}<option
							value={id}>{id}</option
						>{/each}
				</select></label
			>
			<label class="ui-checkbox"
				><input
					type="checkbox"
					bind:checked={opaque}
					disabled={reload.kind === "loading"}
					onchange={() => void selectTheme(preferences.ui.themeId)}
				/> Opaque override</label
			>
			<button
				class="ui-button"
				disabled={reload.kind === "loading"}
				onclick={() => void selectTheme(preferences.ui.themeId)}
				>Reload theme</button
			>
			{#if reload.kind === "error"}<p role="alert" class="ui-error">
					{reload.message}
				</p>{/if}
			<label class="ui-label"
				>Backdrop<select class="ui-input" bind:value={backdrop}
					><option value="checker">Checkerboard</option>
					<option value="grid">Fine grid</option>
					<option value="stripes">Diagonal stripes</option>
					<option value="landscape">Sky / ground gradient</option>
					<option value="color">Custom color</option>
					<option value="image">Local image</option><option value="dark"
						>Dark</option
					><option value="bright">Bright</option></select
				></label
			>
			{#if backdrop === "color"}
				<label class="ui-label"
					>Viewport color<input
						type="color"
						bind:value={backdropColor}
					/></label
				>
			{/if}
			{#if backdrop === "image"}
				<label class="ui-label"
					>Viewport image<input
						class="ui-input"
						type="file"
						accept="image/*"
						bind:files={backdropFiles}
					/></label
				>
				{#if imageFailed}<p class="ui-danger" role="alert">
						Could not display this image. Choose another file.
					</p>{/if}
			{/if}
			<div class="showcase-actions">
				<button
					class="ui-button"
					disabled={session === null}
					aria-pressed={session?.editable ?? false}
					onclick={() =>
						requireSession().setEditable(!requireSession().editable)}
					>{session?.editable ? "Lock UI layout" : "Unlock UI layout"}</button
				>
				<button
					class="ui-button"
					disabled={session === null}
					onclick={() => {
						requireSession().resetLayout();
						placement = defaultPlacement();
						windowOpen = true;
					}}>Reset layout</button
				>
				<button class="ui-button" onclick={() => (windowOpen = !windowOpen)}
					>{windowOpen
						? "Hide control samples"
						: "Show control samples"}</button
				>
			</div>
			<label class="ui-label"
				>Text scale<UiRange
					min={CLIENT_TEXT_SCALE.minimum}
					max={CLIENT_TEXT_SCALE.maximum}
					step={CLIENT_TEXT_SCALE.step}
					value={preferences.ui.textScale}
					oninput={(event) =>
						onSettingsChange({
							...preferences,
							ui: {
								...preferences.ui,
								textScale: event.currentTarget.valueAsNumber,
							},
						})}
				/></label
			>
			<label class="ui-label"
				>Icon scale<UiRange
					min={CLIENT_ICON_SCALE.minimum}
					max={CLIENT_ICON_SCALE.maximum}
					step={CLIENT_ICON_SCALE.step}
					value={preferences.ui.iconScale}
					oninput={(event) =>
						onSettingsChange({
							...preferences,
							ui: {
								...preferences.ui,
								iconScale: event.currentTarget.valueAsNumber,
							},
						})}
				/></label
			>

			<h3>Vitals and edge effects</h3>
			<label class="ui-checkbox"
				><input
					type="checkbox"
					checked={session?.warningsEnabled ?? false}
					disabled={session === null}
					onchange={(event) =>
						requireSession().setWarningsEnabled(event.currentTarget.checked)}
				/> Low-vitals screen effect</label
			>
			{#each SHOWCASE_VITAL_KINDS as kind}
				<label class="ui-label"
					>{kind}<UiRange
						aria-label={`Preview ${kind}`}
						min={0}
						max={100}
						value={vitalPercent(kind)}
						disabled={session === null}
						oninput={(event) =>
							requireSession().setVital(
								kind,
								event.currentTarget.valueAsNumber,
							)}
					/></label
				>
			{/each}
			<div class="showcase-actions">
				<button
					class="ui-button"
					disabled={session === null}
					onclick={() => warningPreset(null)}>Healthy</button
				>{#each SHOWCASE_VITAL_KINDS as kind}<button
						class="ui-button"
						disabled={session === null}
						onclick={() => warningPreset(kind)}>Low {kind}</button
					>{/each}
			</div>
			<label class="ui-checkbox"
				><input
					type="checkbox"
					checked={session?.jumpActive ?? false}
					disabled={session === null}
					onchange={(event) =>
						requireSession().setJump(
							requireSession().jumpExtent,
							event.currentTarget.checked,
						)}
				/> Show jump charge</label
			>

			<button
				class="ui-button"
				disabled={session === null}
				onclick={() => requireSession().restartCooldown()}
				>Restart cooldown</button
			>
			<button
				class="ui-button"
				disabled={session === null}
				onclick={() => notice("Your allegiance is online.")}>Show toast</button
			>
			<h3>Minimap</h3>
			<label class="ui-checkbox"
				><input
					type="checkbox"
					aria-label="Show waypoint guide"
					checked={session?.waypointEnabled ?? false}
					disabled={session === null}
					onchange={(event) =>
						requireSession().setWaypointEnabled(event.currentTarget.checked)}
				/> Show waypoint guide</label
			>
			<h3>Open client windows</h3>
			<p class="ui-muted">
				The minimap and HUD remain on this stage. Panels open as ordinary
				floating windows.
			</p>
			<div class="showcase-actions">
				{#each SHOWCASE_PANELS as panel}<button
						class="ui-button"
						disabled={session === null || pending}
						data-showcase-panel={panel.value}
						onclick={() => void openPanel(panel.value)}>{panel.label}</button
					>{/each}
			</div>
			{#if panelError !== null}<p role="alert" class="ui-error">
					{panelError}
				</p>{/if}
		</div>
	</aside>
	<div
		class="showcase-stage"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
		data-backdrop={backdrop}
		style:background-color={backdrop === "color" ? backdropColor : null}
	>
		{#if backdrop === "image" && imageUrl}<img
				class="showcase-backdrop"
				src={imageUrl}
				alt=""
				onerror={() => (imageFailed = true)}
			/>{/if}
		{@render children()}
		{#if session !== null}
			<ClientHudWindow
				visible={windowOpen}
				icon="debug"
				title="Component showcase"
				{placement}
				{viewport}
				minWidth={CLIENT_UI_DEFAULTS.debug.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.debug.minSize.height}
				onClose={() => (windowOpen = false)}
				onPlacementChange={(next) => (placement = next)}
			>
				<div
					class="ui-body ui-tabbed-panel"
					use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
				>
					<UiTabs
						label="Showcase pages"
						tabs={showcaseTabs}
						selected={tab}
						onSelect={(value) => (tab = value)}
					/>
					<UiTabPanel
						id="showcase-controls-panel"
						labelledBy="showcase-controls-tab"
						active={tab === "controls"}
					>
						<div class="showcase-window-body">
							<div class="showcase-item-specimens">
								<span class="ui-muted">Item wells · synthetic artwork</span>
								<div class="ui-item-grid" aria-label="Item specimens">
									{#each itemSpecimens as item (item.guid)}
										<ItemGridCell
											label={item.name}
											itemGuid={item.guid}
											display={{ kind: "ready", url: item.url }}
											equipped={false}
											count={item.count}
											selected={selectedItem === item.guid}
											disabled={false}
											onselect={() => (selectedItem = item.guid)}
										/>
									{/each}
									<ItemGridCell
										label="Empty specimen"
										itemGuid={null}
										display={undefined}
										equipped={false}
										selected={false}
										disabled={false}
										onselect={() => {}}
									/>
								</div>
							</div>
							<div class="showcase-actions">
								<button
									class="ui-button"
									onclick={() =>
										requireSession().setJump(initialJumpExtent, true)}
									>Reset charge</button
								><button class="ui-button" disabled>Disabled</button>
							</div>
							<button class="ui-button" onclick={() => (dialogOpen = true)}
								>Open dialog</button
							>
							<label class="ui-label"
								>Text input<input
									class="ui-input"
									placeholder="Type here"
								/></label
							>
							<label class="ui-label"
								>Invalid input<input
									class="ui-input"
									aria-invalid="true"
									value="Invalid value"
								/></label
							>
							<ToggleField
								checked={toggle}
								label="Example setting"
								checkedLabel="On"
								uncheckedLabel="Off"
								onCheckedChange={(value) => (toggle = value)}
							/>
							<div class="showcase-actions">
								<label class="ui-checkbox"
									><input type="checkbox" /> Unchecked setting</label
								>
								<label class="ui-checkbox"
									><input type="checkbox" checked disabled /> Disabled setting</label
								>
							</div>
							<label class="ui-label"
								>Jump charge<UiRange
									min={0}
									max={1}
									step="0.05"
									value={session?.jumpExtent ?? initialJumpExtent}
									oninput={(event) =>
										requireSession().setJump(
											event.currentTarget.valueAsNumber,
											true,
										)}
								/></label
							>
							<label class="ui-label"
								>Disabled slider<UiRange
									min={0}
									max={100}
									value={50}
									disabled
								/></label
							>
							<div class="ui-well">
								<p class="ui-success">Changes saved.</p>
								<p class="ui-warning">Your pack is almost full.</p>
								<p class="ui-danger">You are too far away.</p>
							</div>
							<h3>Dropdowns</h3>
							<UiShowcaseDropdowns
								visible={tab === "controls" && windowOpen}
								onNotice={notice}
							/>
						</div>
					</UiTabPanel>
					<UiTabPanel
						id="showcase-characters-panel"
						labelledBy="showcase-characters-tab"
						active={tab === "characters"}
					>
						<ClientCharacterSelect
							visualCache={null}
							management={{ kind: "idle" }}
							creation={null}
							scene={null}
							state={characters}
							entryPending={false}
							onChoose={(guid) =>
								(characters = { ...characters, selectedGuid: guid })}
							onEnter={() => {
								notice("Character entry preview — no connection opened.");
							}}
							onDisconnect={() => {
								characters = { ...characters, selectedGuid: null };
							}}
						>
							{#snippet settings()}
								<ClientPregameSettings
									theme={themeSettings}
									graphics={settingsGraphics}
									audio={settingsAudio}
									ui={settingsUi}
									textureFilteringCapabilities={null}
									onGraphicsChange={(graphics) =>
										onSettingsChange({ ...preferences, graphics })}
									onAudioChange={(audio) =>
										onSettingsChange({ ...preferences, audio })}
									onUiChange={(ui) => onSettingsChange({ ...preferences, ui })}
								/>
							{/snippet}
						</ClientCharacterSelect>
					</UiTabPanel>
					<UiTabPanel
						id="showcase-diagnostics-panel"
						labelledBy="showcase-diagnostics-tab"
						active={tab === "diagnostics"}
					>
						<ClientDebugPanel
							readDiagnostics={() => null}
							readSelectedEntity={() => null}
							entityCollisionDisabled={false}
							onEntityCollisionDisabledChange={() => {}}
							{unrestrictedUse}
							onUnrestrictedUseChange={(enabled) => (unrestrictedUse = enabled)}
							showRetailHiddenGeometry={showHidden}
							onShowRetailHiddenGeometryChange={(value) => (showHidden = value)}
						/>
					</UiTabPanel>
				</div>
			</ClientHudWindow>
		{/if}
	</div>
</main>
{#if dialogOpen}
	<UiDialog
		title="Travel supplies"
		className="showcase-dialog"
		initialFocus="input"
		onCancel={() => (dialogOpen = false)}
	>
		<p>Preview a modal over the current theme and backdrop.</p>
		<label class="ui-label"
			>Pack label<input class="ui-input" value="Traveler’s kit" /></label
		>
		<div class="ui-dialog-actions">
			<button class="ui-button" onclick={() => (dialogOpen = false)}
				>Cancel</button
			>
			<button
				class="ui-button"
				onclick={() => {
					dialogOpen = false;
					notice("Dialog accepted — preview only.");
				}}>Accept</button
			>
		</div>
	</UiDialog>
{/if}

<style>
	@layer components {
		.showcase {
			position: fixed;
			inset: 0;
			display: grid;
			grid-template-columns: minmax(360px, 1fr) 300px;
		}
		.showcase-controls {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
			overflow: auto;
		}
		.showcase-controls .ui-body,
		.showcase-window-body {
			display: grid;
			gap: 8px;
		}
		.showcase-stage {
			grid-column: 1;
			grid-row: 1;
			position: relative;
			min-width: 0;
			min-height: 0;
			isolation: isolate;
			transform: translateZ(0);
			background: #20252b;
		}
		/* A containing block keeps production fixed HUDs, canvas and edge effects on the same stage. */
		.showcase-stage :global(.client-canvas) {
			background: transparent;
		}
		.showcase-backdrop {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
			pointer-events: none;
		}
		.showcase-stage[data-backdrop="checker"] {
			background: repeating-conic-gradient(#333 0% 25%, #aaa 0% 50%) 0 / 64px
				64px;
		}
		.showcase-stage[data-backdrop="bright"] {
			background: #eee;
		}
		.showcase-stage[data-backdrop="grid"] {
			background:
				linear-gradient(#8e99a533 1px, transparent 1px),
				linear-gradient(90deg, #8e99a533 1px, transparent 1px), #20252b;
			background-size: 16px 16px;
		}
		.showcase-stage[data-backdrop="stripes"] {
			background: repeating-linear-gradient(
				45deg,
				#303840 0 24px,
				#c3c9ce 24px 48px
			);
		}
		.showcase-stage[data-backdrop="landscape"] {
			background: linear-gradient(#4678a4, #c6dde7 46%, #738858 52%, #293521);
		}
		.showcase-actions {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
		}
		.showcase-item-specimens {
			display: grid;
			gap: 4px;
		}
		.showcase-item-specimens .ui-item-grid {
			grid-template-columns: repeat(
				4,
				calc(var(--ui-item-cell-min-size) * var(--ui-icon-scale))
			);
		}
	}
</style>
