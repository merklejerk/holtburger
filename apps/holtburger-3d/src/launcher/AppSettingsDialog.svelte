<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import UiDialog from "../app/ui/UiDialog.svelte";
	import UiTabs from "../app/ui/UiTabs.svelte";
	import UiTabPanel from "../app/ui/UiTabPanel.svelte";
	import type {
		AppSettings,
		AppSettingsSnapshot,
		DefaultContentSnapshot,
	} from "../app/desktop/app-settings-contract";
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
			value: "content",
			label: "Content",
			id: `${id}-content-tab`,
			panelId: `${id}-content-panel`,
		},
		{
			value: "live-api",
			label: "Live API",
			id: `${id}-live-api-tab`,
			panelId: `${id}-live-api-panel`,
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
	/** Loaded preferences and their editable drafts share one lifecycle. */
	let loaded = $state<{
		snapshot: AppSettingsSnapshot;
		draft: AppSettings;
		apiPortDraft: string;
		content: DefaultContentSnapshot;
		contentDraft: string;
	} | null>(null);
	/** Loading is cancellable; accepted save/copy/browse actions finish before the modal closes. */
	let operation = $state<"loading" | "idle" | "saving" | "browsing">("loading");
	/** Failure reports remain available while the native graphics query is pending. */
	let copying = $state(false);
	const busy = $derived(
		operation === "saving" || operation === "browsing" || copying,
	);
	let failure = $state<string | null>(null);
	/** Brief acknowledgement in the copy button after a successful clipboard write. */
	let copied = $state<"hardware" | "failure" | null>(null);
	let copyStatus = $state<string | null>(null);
	const CONFIRMATION_MS = 2_000;
	/** Replaced on each confirmation and cleared when the dialog closes. */
	let copyConfirmationTimer: ReturnType<typeof setTimeout> | null = null;

	const normalizedContentDraft = $derived(
		loaded === null
			? null
			: loaded.contentDraft.trim() === ""
				? null
				: loaded.contentDraft.trim(),
	);
	const graphicsDirty = $derived(
		loaded !== null &&
			(loaded.draft.graphicsBackend !==
				loaded.snapshot.settings.graphicsBackend ||
				loaded.draft.vsync !== loaded.snapshot.settings.vsync ||
				loaded.draft.gpuCompositing !==
					loaded.snapshot.settings.gpuCompositing),
	);
	const restartNeeded = $derived(
		loaded !== null && (loaded.snapshot.restartRequired || graphicsDirty),
	);
	const liveApiPortBaseline = $derived(
		loaded === null || loaded.snapshot.settings.liveApi.port === null
			? ""
			: String(loaded.snapshot.settings.liveApi.port),
	);
	const liveApiDirty = $derived(
		loaded !== null &&
			(loaded.draft.liveApi.enabled !==
				loaded.snapshot.settings.liveApi.enabled ||
				(loaded.draft.liveApi.enabled &&
					loaded.apiPortDraft.trim() !== liveApiPortBaseline)),
	);
	const contentDirty = $derived(
		loaded !== null &&
			(normalizedContentDraft !== loaded.content.location ||
				loaded.content.diagnostic !== null ||
				loaded.content.attentionMessage !== null),
	);
	const hasChanges = $derived(restartNeeded || contentDirty || liveApiDirty);

	function parseApiPortDraft(raw: string): number | null {
		const trimmed = raw.trim();
		if (trimmed === "") return null;
		if (!/^[0-9]+$/.test(trimmed))
			throw new Error(
				"Live API port must be a whole number between 1 and 65535.",
			);
		const parsed = Number(trimmed);
		if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535)
			throw new Error("Live API port must be between 1 and 65535.");
		return parsed;
	}

	async function load(): Promise<void> {
		operation = "loading";
		failure = null;
		try {
			const [snapshot, content] = await Promise.all([
				transport.appSettings(),
				transport.defaultContent(),
			]);
			loaded = {
				snapshot,
				draft: {
					...snapshot.settings,
					liveApi: { ...snapshot.settings.liveApi },
				},
				apiPortDraft:
					snapshot.settings.liveApi.port === null
						? ""
						: String(snapshot.settings.liveApi.port),
				content,
				contentDraft: content.location ?? "",
			};
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			operation = "idle";
		}
	}
	function resetDefaults(): void {
		if (loaded === null) return;
		failure = null;
		loaded.draft = {
			...loaded.snapshot.defaults,
			liveApi: { ...loaded.snapshot.defaults.liveApi },
		};
		loaded.apiPortDraft =
			loaded.snapshot.defaults.liveApi.port === null
				? ""
				: String(loaded.snapshot.defaults.liveApi.port);
	}
	async function save(): Promise<void> {
		if (loaded === null || operation !== "idle" || !hasChanges) return;
		operation = "saving";
		failure = null;
		try {
			const graphicsChanged = graphicsDirty;
			const shouldRestart = restartNeeded;
			const shouldSaveAppSettings = graphicsChanged || liveApiDirty;
			const shouldSaveContent = contentDirty;
			const port = loaded.draft.liveApi.enabled
				? parseApiPortDraft(loaded.apiPortDraft)
				: loaded.snapshot.settings.liveApi.port;

			if (shouldSaveAppSettings) {
				const nextSettings: AppSettings = {
					...loaded.draft,
					liveApi: { ...loaded.draft.liveApi, port },
				};
				await transport.saveAppSettings(nextSettings);
				loaded.snapshot = {
					...loaded.snapshot,
					settings: nextSettings,
					restartRequired: loaded.snapshot.restartRequired || graphicsChanged,
				};
				loaded.draft = {
					...nextSettings,
					liveApi: { ...nextSettings.liveApi },
				};
				loaded.apiPortDraft = port === null ? "" : String(port);
			}
			if (shouldSaveContent) {
				const saved = await transport.saveDefaultContent(
					normalizedContentDraft,
				);
				loaded.content = saved;
				loaded.contentDraft = saved.location ?? "";
			}
			if (shouldRestart) {
				await transport.restart();
			} else {
				onCancel();
			}
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			operation = "idle";
		}
	}
	async function browseDefaultContent(): Promise<void> {
		if (loaded === null || operation !== "idle") return;
		operation = "browsing";
		failure = null;
		try {
			const picked = await transport.chooseContentPath(normalizedContentDraft);
			if (picked !== null) {
				loaded.contentDraft = picked;
			}
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
			}, CONFIRMATION_MS);
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
			active={selected === "content"}
		>
			<div class="settings-section">
				{#if loaded}
					<p role="status">
						Applies to future Client and Explorer launches. No restart required.
					</p>
					<div class="content-field">
						<label for={`${id}-default-content`}
							>Default content directory</label
						>
						<div class="content-path-input">
							<input
								id={`${id}-default-content`}
								class="ui-input"
								bind:value={loaded.contentDraft}
								placeholder="Automatic discovery"
								disabled={busy}
							/>
							<div class="content-path-actions">
								{#if loaded.contentDraft}
									<button
										class="ui-button ui-icon-button pregame-quiet"
										type="button"
										aria-label="Clear default content directory"
										title="Use automatic discovery"
										disabled={busy}
										onclick={() => {
											if (loaded) loaded.contentDraft = "";
										}}>×</button
									>
								{/if}
								<button
									class="ui-button ui-icon-button pregame-quiet"
									type="button"
									aria-label="Browse content folder"
									title="Browse content folder"
									disabled={busy}
									onclick={() => void browseDefaultContent()}>…</button
								>
							</div>
						</div>
						<small>
							DAT or HBA folder used unless a server or Explorer override is
							set. Leave blank for automatic discovery.
						</small>
					</div>
					{#if loaded.content.attentionMessage}
						<p role="alert">{loaded.content.attentionMessage}</p>
					{/if}
					{#if loaded.content.diagnostic}
						<p role="alert">{loaded.content.diagnostic}</p>
					{/if}
				{:else if operation === "loading"}
					<p role="status">Loading app settings…</p>
				{/if}
			</div>
		</UiTabPanel>
		<UiTabPanel
			id={tabs[2].panelId}
			labelledBy={tabs[2].id}
			active={selected === "live-api"}
		>
			<div class="settings-section">
				{#if loaded}
					<p role="status">
						Applies to future Client launches. Binds strictly to 127.0.0.1 and
						rejects browser origins and non-loopback hosts.
					</p>
					<label class="ui-checkbox"
						><input
							type="checkbox"
							name="liveApiEnabled"
							bind:checked={loaded.draft.liveApi.enabled}
							disabled={busy}
						/> Enable localhost Live API</label
					>
					<div class="content-field">
						<label for={`${id}-live-api-port`}>Fixed port (optional)</label>
						<input
							id={`${id}-live-api-port`}
							class="ui-input"
							inputmode="numeric"
							bind:value={loaded.apiPortDraft}
							placeholder="Automatic (ephemeral)"
							disabled={busy || !loaded.draft.liveApi.enabled}
						/>
						<small>
							Leave blank for an automatic ephemeral port discovered via the
							instance PID file.
						</small>
					</div>
				{:else if operation === "loading"}
					<p role="status">Loading app settings…</p>
				{/if}
			</div>
		</UiTabPanel>
		<UiTabPanel
			id={tabs[3].panelId}
			labelledBy={tabs[3].id}
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
		{#if loaded}
			<button class="ui-button" disabled={busy} onclick={resetDefaults}
				>Use defaults</button
			>
		{:else if operation !== "loading"}
			<button class="ui-button" disabled={busy} onclick={() => void load()}
				>Retry</button
			>
		{/if}
		<button class="ui-button" disabled={busy} onclick={onCancel}>Cancel</button>
		<button
			class="ui-button"
			disabled={busy || loaded === null || !hasChanges}
			onclick={() => void save()}
			>{restartNeeded ? "Save and restart" : "Save"}</button
		>
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
		.content-field {
			display: grid;
			gap: 6px;
		}
		.content-field small {
			color: var(--ui-color-muted);
		}
		.content-path-input {
			position: relative;
		}
		.content-path-input .ui-input {
			width: 100%;
			padding-inline-end: 54px;
		}
		.content-path-actions {
			display: flex;
			position: absolute;
			inset-block: 2px;
			inset-inline-end: 2px;
		}
		.content-path-actions .ui-icon-button {
			width: 24px;
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
