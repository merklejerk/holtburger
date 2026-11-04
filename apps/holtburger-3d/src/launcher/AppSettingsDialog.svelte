<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
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
	/** Loaded preferences and their editable draft share one lifecycle. */
	let loaded = $state<{
		snapshot: AppSettingsSnapshot;
		draft: AppSettings;
	} | null>(null);
	/** Loading is cancellable; accepted save/copy actions finish before the modal closes. */
	let operation = $state<"loading" | "idle" | "saving" | "copying">("loading");
	const busy = $derived(operation === "saving" || operation === "copying");
	let failure = $state<string | null>(null);
	/** Brief acknowledgement in the copy button after a successful clipboard write. */
	let hardwareInfoCopied = $state(false);
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
	async function copyHardware(): Promise<void> {
		if (operation !== "idle") return;
		if (copyConfirmationTimer !== null) clearTimeout(copyConfirmationTimer);
		copyConfirmationTimer = null;
		operation = "copying";
		failure = null;
		hardwareInfoCopied = false;
		try {
			await transport.copyHardwareInfo(probeLauncherHardware());
			hardwareInfoCopied = true;
			copyConfirmationTimer = setTimeout(() => {
				hardwareInfoCopied = false;
				copyConfirmationTimer = null;
			}, COPY_CONFIRMATION_MS);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			operation = "idle";
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
	<p role="status">
		{loaded?.snapshot.restartRequired
			? "An app restart is required to apply saved changes."
			: "Changes require an app restart."}
	</p>
	{#if loaded}
		<label
			>Graphics backend
			<select
				class="ui-input"
				bind:value={loaded.draft.graphicsBackend}
				disabled={busy}
			>
				{#each loaded.snapshot.backends as backend}<option value={backend.value}
						>{backend.label}</option
					>{/each}
			</select>
		</label>
		<label class="ui-checkbox"
			><input
				type="checkbox"
				bind:checked={loaded.draft.vsync}
				disabled={busy}
			/> Synchronize frames with the display (VSync)</label
		>
		<details class="app-settings-graphics ui-disclosure ui-disclosure-section">
			<summary>Current graphics</summary>
			<div class="ui-disclosure-body">
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
				<button
					class="ui-button"
					aria-live="polite"
					disabled={busy}
					onclick={() => void copyHardware()}
					>{hardwareInfoCopied ? "Copied!" : "Copy hardware info"}</button
				>
			</div>
		</details>
		{#if loaded.snapshot.diagnostic}<p role="alert">
				{loaded.snapshot.diagnostic}
			</p>{/if}
	{:else if operation === "loading"}<p role="status">
			Loading app settings…
		</p>{/if}
	{#if failure}<p role="alert">{failure}</p>{/if}
	<div class="ui-dialog-actions">
		{#if loaded}
			<button
				class="ui-button"
				disabled={busy}
				onclick={() => {
					if (loaded) loaded.draft = { ...loaded.snapshot.defaults };
				}}>Use defaults</button
			>
		{:else}<button
				class="ui-button"
				disabled={operation !== "idle"}
				onclick={() => void load()}>Retry</button
			>{/if}
		<button class="ui-button" disabled={busy} onclick={onCancel}>Cancel</button>
		<button
			class="ui-button"
			disabled={busy || loaded === null}
			onclick={() => void saveAndRestart()}>Save and restart</button
		>
	</div>
</UiDialog>

<style>
	@layer components {
		.app-settings-graphics {
			margin-inline-start: var(--ui-overlay-padding);
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
