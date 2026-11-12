<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import type {
		AppSettings,
		AppSettingsSnapshot,
	} from "../app/app-settings-contract";
	import { launcherTransport } from "./launcher-transport";
	import { probeLauncherHardware } from "./launcher-hardware-info";

	interface Props {
		/** Closing discards the local draft; saving is always explicit. */
		readonly onCancel: () => void;
	}
	const { onCancel }: Props = $props();
	const transport = launcherTransport();
	const id = $props.id();
	const tabs = [
		{
			value: "graphics",
			label: "Graphics",
			id: `${id}-graphics-tab`,
			panelId: `${id}-graphics-panel`,
		},
		{
			value: "diagnostics",
			label: "Diagnostics",
			id: `${id}-diagnostics-tab`,
			panelId: `${id}-diagnostics-panel`,
		},
	] as const;
	/** Selection changes visibility while the dialog keeps its draft. */
	let selected = $state<(typeof tabs)[number]["value"]>("graphics");
	/** Loaded preferences and their editable draft share one lifecycle. */
	let loaded = $state<{
		snapshot: AppSettingsSnapshot;
		draft: AppSettings;
	} | null>(null);
	/** Loading is cancellable; accepted save/copy actions finish before the modal closes. */
	let operation = $state<"loading" | "idle" | "saving">("loading");
	/** Failure reports remain available while the native graphics query is pending. */
	let copying = $state(false);
	const busy = $derived(operation === "saving" || copying);
	let failure = $state<string | null>(null);
	/** Brief acknowledgement in the copy button after a successful clipboard write. */
	let copied = $state<"hardware" | "failure" | null>(null);
	let copyStatus = $state<string | null>(null);
	const COPY_CONFIRMATION_MS = 2_000;
	/** Replaced on each copy and cleared when the dialog closes. */
	let copyConfirmationTimer: ReturnType<typeof setTimeout> | null = null;

	async function load(): Promise<void> {
		operation = "loading";
		failure = null;
		try {
			const snapshot = await transport.appSettings();
			loaded = { snapshot, draft: { ...snapshot.settings } };
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			operation = "idle";
		}
	}
	async function saveAndRestart(): Promise<void> {
		if (loaded === null || operation !== "idle") return;
		operation = "saving";
		failure = null;
		try {
			await transport.saveAppSettings(loaded.draft);
			await transport.restart();
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			operation = "idle";
		}
	}
	async function copy(kind: "hardware" | "failure"): Promise<void> {
		if (busy) return;
		if (copyConfirmationTimer !== null) clearTimeout(copyConfirmationTimer);
		copyConfirmationTimer = null;
		copying = true;
		failure = null;
		copied = null;
		copyStatus = null;
		try {
			if (kind === "hardware") {
				await transport.copyHardwareInfo(probeLauncherHardware());
			} else if (!(await transport.copyLastFailure())) {
				copyStatus = "No failure report has been saved.";
				return;
			}
			copied = kind;
			copyConfirmationTimer = setTimeout(() => {
				copied = null;
				copyConfirmationTimer = null;
			}, COPY_CONFIRMATION_MS);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			copying = false;
		}
	}
	onMount(() => {
		void load();
	});
	onDestroy(() => {
		if (copyConfirmationTimer !== null) clearTimeout(copyConfirmationTimer);
	});
</script>

<UiDialog
	title="App settings"
	className="app-settings-dialog"
	onCancel={() => {
		if (!busy) onCancel();
	}}
	dismissOnBackdrop={!busy}
>
	<div class="ui-tabbed-panel">
		<UiTabs
			label="App settings sections"
			{tabs}
			{selected}
			onSelect={(value) => (selected = value)}
		/>
		<UiTabPanel
			id={tabs[0].panelId}
			labelledBy={tabs[0].id}
			active={selected === "graphics"}
		>
			<div class="settings-section">
				{#if loaded}
					<p role="status">
						{loaded.snapshot.restartRequired
							? "An app restart is required to apply saved changes."
							: "Changes require an app restart."}
					</p>
					<label
						>Graphics backend
						<select
							class="ui-input"
							bind:value={loaded.draft.graphicsBackend}
							disabled={busy}
						>
							{#each loaded.snapshot.backends as backend}<option
									value={backend.value}>{backend.label}</option
								>{/each}
						</select>
					</label>
					<label class="ui-checkbox"
						><input
							type="checkbox"
							name="vsync"
							bind:checked={loaded.draft.vsync}
							disabled={busy}
						/> Synchronize frames with the display (VSync)</label
					>
					<label class="ui-checkbox"
						><input
							type="checkbox"
							name="gpuCompositing"
							aria-describedby={`${id}-gpu-compositing-help`}
							bind:checked={loaded.draft.gpuCompositing}
							disabled={busy}
						/> Use GPU compositing</label
					>
					<p id={`${id}-gpu-compositing-help`}>
						Turning this off may resolve transparent holes in panels or text,
						but can significantly reduce frame rates.
					</p>
				{:else if operation === "loading"}
					<p role="status">Loading app settings…</p>
				{/if}
			</div>
		</UiTabPanel>
		<UiTabPanel
			id={tabs[1].panelId}
			labelledBy={tabs[1].id}
			active={selected === "diagnostics"}
		>
			<div class="settings-section">
				{#if loaded}
					<dl class="ui-facts">
						<dt>Renderer</dt>
						<dd>
							{loaded.snapshot.renderer ?? "Not reported by Chromium"}
						</dd>
						<dt>Hardware acceleration</dt>
						<dd>
							{loaded.snapshot.hardwareAcceleration ? "Enabled" : "Disabled"}
						</dd>
						{#if loaded.snapshot.overrides.length > 0}
							<dt>Launch overrides</dt>
							<dd>{loaded.snapshot.overrides.join(", ")}</dd>
						{/if}
					</dl>

					{#if loaded.snapshot.diagnostic}
						<p role="alert">{loaded.snapshot.diagnostic}</p>
					{/if}
				{/if}
				<div class="diagnostic-actions">
					<button
						class="ui-button"
						aria-live="polite"
						disabled={busy || loaded === null}
						onclick={() => void copy("hardware")}
						>{copied === "hardware" ? "Copied!" : "Copy hardware info"}</button
					>
					<button
						class="ui-button"
						aria-live="polite"
						disabled={busy}
						onclick={() => void copy("failure")}
						>{copied === "failure"
							? "Copied!"
							: "Copy last failure report"}</button
					>
				</div>
				{#if copyStatus}<p role="status">{copyStatus}</p>{/if}
			</div>
		</UiTabPanel>
	</div>
	{#if failure}<p role="alert">{failure}</p>{/if}
	<div class="ui-dialog-actions">
		{#if selected === "graphics"}
			{#if loaded}
				<button
					class="ui-button"
					disabled={busy}
					onclick={() => {
						if (loaded) loaded.draft = { ...loaded.snapshot.defaults };
					}}>Use defaults</button
				>
			{:else if operation !== "loading"}
				<button class="ui-button" disabled={busy} onclick={() => void load()}
					>Retry</button
				>
			{/if}
		{/if}
		<button class="ui-button" disabled={busy} onclick={onCancel}>Cancel</button>
		{#if selected === "graphics"}
			<button
				class="ui-button"
				disabled={busy || loaded === null}
				onclick={() => void saveAndRestart()}>Save and restart</button
			>
		{/if}
	</div>
</UiDialog>

<style>
	@layer components {
		:global(.app-settings-dialog) {
			--ui-dialog-width: 28rem;
		}
		.settings-section {
			display: grid;
			gap: var(--ui-overlay-gap);
		}
		.diagnostic-actions {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-overlay-gap);
		}
		label {
			display: grid;
			gap: var(--ui-overlay-gap);
		}
		label.ui-checkbox {
			display: flex;
		}
		dd {
			overflow-wrap: anywhere;
		}
	}
</style>
