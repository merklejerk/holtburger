<script lang="ts">
	import { onMount } from "svelte";
	import ClientPregameScreen from "../client/ClientPregameScreen.svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import { navigateVerticalButtons } from "../app/vertical-button-navigation";
	import EditIcon from "../assets/icons/hud-edit.svg?component";
	import DeleteIcon from "../assets/icons/character-delete.svg?component";
	import SelectionMarker from "../assets/icons/pregame-selection.svg?component";
	import EyeIcon from "../assets/icons/hud-eye.svg?component";
	import ServerDirectoryDialog from "./ServerDirectoryDialog.svelte";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { requestElectronClientClose } from "../lib/host/electron-host-transport";
	import { launcherTransport } from "./launcher-transport";
	import type {
		LauncherSnapshot,
		LauncherServer,
		LauncherProfileView,
		LauncherCredentials,
	} from "./launcher-contract";

	const transport = launcherTransport();
	const { keyboard } = provideAppInputPolicy();
	let snapshot = $state<LauncherSnapshot | null>(null);
	let failure = $state<string | null>(null);
	let busy = $state(false);
	let browsingServers = $state(false);
	let selectedServerId = $state("");
	let selectedProfileId = $state("");
	let account = $state("");
	let password = $state("");
	/** Baseline for the selected preset; null also allows repairing missing or unreadable credentials. */
	let savedProfileCredentials = $state<LauncherCredentials | null>(null);
	/** Revealing a password is local to the current credential draft. */
	let passwordVisible = $state(false);
	const server = $derived(
		snapshot?.servers.find((value) => value.id === selectedServerId) ?? null,
	);
	const profiles = $derived(
		snapshot?.profiles.filter((value) => value.serverId === selectedServerId) ??
			[],
	);
	const profile = $derived(
		profiles.find((value) => value.id === selectedProfileId) ?? null,
	);
	const profileChanged = $derived(
		profile !== null &&
			(savedProfileCredentials === null ||
				account !== savedProfileCredentials.account ||
				password !== savedProfileCredentials.password),
	);
	type Editor =
		| {
				kind: "server";
				/** Creating selects the new server; metadata edits preserve the current selection. */
				mode: "add" | "edit";
				id: string;
				name: string;
				host: string;
				port: number;
		  }
		| { kind: "delete-server"; value: LauncherServer }
		| { kind: "delete-profile"; value: LauncherProfileView }
		| { kind: "new-profile"; name: string }
		| { kind: "recover" };
	let editor = $state<Editor | null>(null);

	function diagnostic(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
	async function refresh(): Promise<void> {
		snapshot = await transport.snapshot();
	}
	async function chooseProfile(id: string): Promise<void> {
		savedProfileCredentials = null;
		passwordVisible = false;
		selectedProfileId = id;
		account = "";
		password = "";
		const serverId = selectedServerId;
		if (serverId !== "") {
			const saved = await transport.credentials({
				serverId,
				profileId: id === "" ? null : id,
			});
			if (
				selectedServerId === serverId &&
				selectedProfileId === id &&
				saved !== null
			) {
				account = saved.account;
				password = saved.password;
				if (id !== "") savedProfileCredentials = saved;
			}
		}
	}
	function chooseServer(id: string): void {
		// Server buttons retain focus while credentials load; block activation without disabling the DOM control.
		if (busy) return;
		selectedServerId = id;
		void run(async () => {
			await chooseProfile(snapshot?.lastProfileByServer[id] ?? "");
		});
	}
	/** The focused server owns arrow navigation; row actions keep their native button behavior. */
	function navigateServers(event: KeyboardEvent): void {
		if (busy || !(event.target instanceof HTMLButtonElement)) return;
		const buttons = event.target
			.closest(".launcher-rows")
			?.querySelectorAll<HTMLButtonElement>(".launcher-server-choice");
		if (buttons !== undefined) navigateVerticalButtons(event, buttons)?.click();
	}
	async function run(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		failure = null;
		try {
			await action();
		} catch (error) {
			failure = diagnostic(error);
		} finally {
			busy = false;
		}
	}
	async function saveEditor(): Promise<void> {
		const value = editor;
		if (!value) return;
		await run(async () => {
			const previousServerId = selectedServerId;
			const previousProfileId = selectedProfileId;
			switch (value.kind) {
				case "new-profile":
					await persistProfile(crypto.randomUUID(), value.name);
					editor = null;
					return;
				case "server":
					if (value.port === undefined) throw new Error("Enter a server port.");
					await transport.saveServer({
						id: value.id,
						name: value.name,
						endpoint: { host: value.host, port: value.port },
					});
					if (value.mode === "add") {
						selectedServerId = value.id;
						selectedProfileId = "";
					}
					break;
				case "delete-server":
					await transport.deleteServer(value.value.id);
					if (selectedServerId === value.value.id) {
						selectedServerId = "";
						selectedProfileId = "";
					}
					break;
				case "delete-profile":
					await transport.deleteProfile(value.value.id);
					selectedProfileId = "";
					break;
				case "recover":
					await transport.recover();
					break;
			}
			editor = null;
			await refresh();
			if (
				selectedServerId !== previousServerId ||
				selectedProfileId !== previousProfileId ||
				value.kind === "recover"
			)
				await chooseProfile(selectedProfileId);
		});
	}
	async function persistProfile(id: string, name: string): Promise<void> {
		if (server === null) return;
		const serverId = server.id;
		await transport.saveProfile({
			id,
			serverId,
			name,
			credentials: { account, password },
		});
		await refresh();
		await chooseProfile(id);
	}
	async function play(): Promise<void> {
		if (server === null || busy || snapshot?.canPlay !== true || !account)
			return;
		const serverId = server.id;
		await run(async () => {
			await transport.play({
				serverId,
				profileId: profile?.id ?? null,
				credentials: { account, password },
			});
			password = "";
		});
	}
	onMount(() => {
		const unmount = keyboard.mount(document);
		void run(async () => {
			await refresh();
			selectedServerId =
				snapshot?.lastSelection?.serverId ?? snapshot?.servers[0]?.id ?? "";
			await chooseProfile(
				snapshot?.lastProfileByServer[selectedServerId] ?? "",
			);
		});
		return unmount;
	});
</script>

<ClientPregameScreen branding="corner" showPortalLogo={true} backdrop={false}>
	<section
		class="launcher"
		aria-label="Server and profile launcher"
		aria-busy={busy}
	>
		{#if !snapshot || snapshot.recoveryRequired}{@render heading()}{/if}
		{#if failure || snapshot?.failure}<p class="launcher-error" role="alert">
				{failure ?? snapshot?.failure}
			</p>{/if}
		{#if snapshot?.recoveryRequired}
			<p>
				Your launcher settings need attention. Recovery preserves the original
				file before creating an empty catalog.
			</p>
			<button
				class="pregame-action ui-button"
				disabled={busy}
				onclick={() => (editor = { kind: "recover" })}
				>Recover launcher settings</button
			>
		{:else if snapshot}
			<div class="launcher-columns">
				<section class="launcher-list" aria-label="Servers">
					{@render heading()}
					<h2>Servers</h2>
					<div
						class="launcher-rows"
						use:keyboard.scope={{
							nativeControls: true,
							keydown: navigateServers,
						}}
					>
						{#each snapshot.servers as item, index (item.id)}
							{@const selected = selectedServerId === item.id}
							<div class="launcher-server-row" data-selected={selected}>
								<button
									class="ui-button pregame-quiet launcher-server-choice"
									type="button"
									aria-pressed={selected}
									aria-disabled={busy}
									tabindex={selected || (selectedServerId === "" && index === 0)
										? 0
										: -1}
									onclick={() => chooseServer(item.id)}
								>
									<span class="launcher-selection-marker" aria-hidden="true"
										><SelectionMarker /></span
									>
									<span class="launcher-server-label"
										><strong>{item.name}</strong><small
											>{item.endpoint.host}:{item.endpoint.port}</small
										></span
									>
								</button>
								<div class="ui-icon-actions launcher-server-actions">
									<button
										class="ui-button ui-icon-button pregame-quiet"
										type="button"
										disabled={busy}
										aria-label={`Edit ${item.name}`}
										title={`Edit ${item.name}`}
										onclick={() =>
											(editor = {
												kind: "server",
												mode: "edit",
												id: item.id,
												name: item.name,
												...item.endpoint,
											})}
										><span class="pregame-icon" aria-hidden="true"
											><EditIcon /></span
										></button
									>
									<button
										class="ui-button ui-icon-button pregame-quiet"
										type="button"
										disabled={busy}
										aria-label={`Delete ${item.name}`}
										title={`Delete ${item.name}`}
										onclick={() =>
											(editor = { kind: "delete-server", value: item })}
										><span class="pregame-icon" aria-hidden="true"
											><DeleteIcon /></span
										></button
									>
								</div>
							</div>
						{:else}<p>Add a server to get started.</p>{/each}
					</div>
					<div class="launcher-actions">
						<button
							class="pregame-action ui-button"
							disabled={busy}
							onclick={() =>
								(editor = {
									kind: "server",
									mode: "add",
									id: crypto.randomUUID(),
									name: "",
									host: "",
									port: 9000,
								})}>Add server</button
						>
						<button
							class="pregame-action ui-button"
							disabled={busy}
							onclick={() => (browsingServers = true)}
							>Import from TreeStats</button
						>
					</div>
				</section>
				<form
					class="launcher-profile"
					aria-label="Launch options"
					onsubmit={(event) => {
						event.preventDefault();
						void play();
					}}
				>
					<header>
						<h2>Launch options</h2>
					</header>
					<label
						>Profile (optional)<select
							class="ui-input"
							value={selectedProfileId}
							disabled={busy || !server}
							onchange={(event) =>
								void run(() => chooseProfile(event.currentTarget.value))}
						>
							<option value="">No profile</option>
							{#each profiles as item (item.id)}<option value={item.id}
									>{item.name}</option
								>{/each}
						</select></label
					>
					{#if profile?.credentialStatus === "unavailable"}<p role="alert">
							Saved credentials could not be loaded. Enter credentials and
							overwrite this profile to repair it.
						</p>{/if}
					<label
						>Account<input
							class="ui-input"
							autocomplete="username"
							required
							bind:value={account}
							disabled={busy || !server}
						/></label
					>
					<div class="launcher-password">
						<label
							>Password<input
								class="ui-input"
								type={passwordVisible ? "text" : "password"}
								autocomplete="current-password"
								bind:value={password}
								disabled={busy || !server}
							/></label
						>
						<div class="ui-icon-actions">
							<button
								class="ui-button ui-icon-button pregame-quiet"
								type="button"
								aria-label={passwordVisible ? "Hide password" : "Show password"}
								title={passwordVisible ? "Hide password" : "Show password"}
								aria-pressed={passwordVisible}
								disabled={busy || !server}
								onclick={() => (passwordVisible = !passwordVisible)}
								><span class="pregame-icon" aria-hidden="true"><EyeIcon /></span
								></button
							>
						</div>
					</div>
					<div class="launcher-actions">
						{#if profile}<button
								class="pregame-action ui-button"
								type="button"
								disabled={busy || !account || !profileChanged}
								onclick={() => {
									if (profile && profileChanged)
										void run(() => persistProfile(profile.id, profile.name));
								}}>Overwrite profile</button
							>{/if}
						{#if profile}<button
								class="pregame-action ui-button"
								type="button"
								disabled={busy}
								onclick={() => {
									if (profile)
										editor = { kind: "delete-profile", value: profile };
								}}>Delete profile</button
							>{/if}
						<button
							class="pregame-action ui-button launcher-save-profile"
							type="button"
							disabled={busy || !server || !account}
							onclick={() => (editor = { kind: "new-profile", name: "" })}
							>Save to new profile</button
						>
					</div>
					<button
						class="pregame-primary pregame-action ui-button launcher-play"
						type="submit"
						disabled={busy || !snapshot.canPlay || !server || !account}
						>Play</button
					>
				</form>
			</div>
		{:else}<p>Loading launcher settings…</p>{/if}
	</section>
	{#snippet footer()}<button
			class="pregame-action ui-button pregame-quiet"
			onclick={() =>
				void requestElectronClientClose().catch(
					(error) => (failure = diagnostic(error)),
				)}>Quit application</button
		>{/snippet}
	{#if browsingServers}
		<ServerDirectoryDialog
			onCancel={() => (browsingServers = false)}
			onAdded={async (id) => {
				await refresh();
				if (id !== null) {
					selectedServerId = id;
					await chooseProfile("");
				}
			}}
		/>
	{/if}
	{#if editor}
		<UiDialog
			className="launcher-editor"
			title={editor.kind === "server"
				? "Server"
				: editor.kind === "new-profile"
					? "Save to new profile"
					: "Confirm action"}
			onCancel={() => {
				if (!busy) editor = null;
			}}
			dismissOnBackdrop={!busy}
		>
			<form
				class="launcher-editor-form"
				onsubmit={(event) => {
					event.preventDefault();
					void saveEditor();
				}}
			>
				{#if editor.kind === "server"}
					<label
						>Name<input
							class="ui-input"
							required
							pattern={".*\\S.*"}
							bind:value={editor.name}
							disabled={busy}
						/></label
					>
					<label
						>Host<input
							class="ui-input"
							required
							pattern={".*\\S.*"}
							bind:value={editor.host}
							disabled={busy}
						/></label
					>
					<label
						>Port<input
							class="ui-input"
							type="number"
							required
							min="1"
							max="65535"
							bind:value={editor.port}
							disabled={busy}
						/></label
					>
				{:else if editor.kind === "new-profile"}
					<label
						>Profile name<input
							class="ui-input"
							required
							pattern={".*\\S.*"}
							bind:value={editor.name}
							disabled={busy}
						/></label
					>
				{:else if editor.kind === "delete-server"}
					<p>
						Delete {editor.value.name} and all of its launch profiles? Game settings
						and character captures are retained.
					</p>
				{:else if editor.kind === "delete-profile"}
					<p>Delete {editor.value.name} and its saved credentials?</p>
				{:else}<p>
						Preserve the unreadable launcher file and create a new, empty
						server/profile catalog?
					</p>{/if}
				{#if failure}<p role="alert">{failure}</p>{/if}
				<div class="ui-dialog-actions">
					<button
						class="pregame-action ui-button"
						disabled={busy}
						type="button"
						onclick={() => (editor = null)}>Cancel</button
					>
					<button class="pregame-action ui-button" disabled={busy} type="submit"
						>{editor.kind === "server" || editor.kind === "new-profile"
							? "Save"
							: "Confirm"}</button
					>
				</div>
			</form>
		</UiDialog>
	{/if}
</ClientPregameScreen>

{#snippet heading()}
	<header>
		<h1>Choose your world</h1>
		<p>Pick a server and account profile, then enter Dereth.</p>
	</header>
{/snippet}

<style>
	@layer components {
		.launcher {
			display: flex;
			flex-direction: column;
			gap: 16px;
			min-height: 0;
			overflow: auto;
		}
		h1,
		h2,
		p {
			margin: 0;
		}
		h1,
		h2 {
			font-family: var(--ui-font-heading);
		}
		header {
			display: grid;
			gap: 8px;
		}
		.launcher-columns {
			display: grid;
			grid-template-columns: minmax(200px, 1fr) minmax(240px, 1fr);
			gap: 24px;
			min-height: 0;
			flex: 1;
		}
		.launcher-list,
		.launcher-profile {
			display: flex;
			flex-direction: column;
			gap: 16px;
			min-height: 0;
			min-width: 0;
		}
		.launcher-profile {
			border-inline-start: 1px solid transparent;
			padding-inline-start: 24px;
			overflow: auto;
		}
		.launcher-rows {
			display: flex;
			flex-direction: column;
			gap: 8px;
			overflow: auto;
			min-height: 0;
			flex: 1;
			padding-inline-end: 8px;
			scrollbar-gutter: stable;
		}
		.launcher-server-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			border-inline-start: 3px solid transparent;
		}
		.launcher-server-choice {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 8px;
			text-align: left;
			min-width: 0;
		}
		.launcher-server-label {
			display: grid;
			gap: 4px;
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.launcher-selection-marker {
			display: grid;
			place-items: center;
			visibility: hidden;
		}
		.launcher-server-row[data-selected="true"] .launcher-selection-marker {
			visibility: visible;
		}
		.launcher-server-actions {
			visibility: hidden;
			padding-inline-end: 6px;
		}
		.launcher-server-row:hover .launcher-server-actions,
		.launcher-server-row:focus-within .launcher-server-actions {
			visibility: visible;
		}
		@media (hover: none) {
			.launcher-server-actions {
				visibility: visible;
			}
		}
		small,
		header p {
			color: var(--ui-color-muted);
		}
		.launcher-editor-form {
			display: grid;
			gap: var(--ui-overlay-gap);
		}
		.launcher-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.launcher-save-profile {
			margin-inline-start: auto;
		}
		.launcher-password {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			gap: 8px;
		}
		label {
			display: grid;
			gap: 6px;
		}
		.launcher-play {
			margin-top: auto;
		}
		.launcher-error {
			color: var(--ui-color-danger);
			white-space: pre-wrap;
		}
		@media (max-width: 720px) {
			.launcher-columns {
				grid-template-columns: 1fr;
				flex: none;
			}
			.launcher-profile {
				border-inline-start: 0;
				padding-inline-start: 0;
				border-block-start: 1px solid transparent;
				padding-block-start: 24px;
			}
			.launcher-rows {
				flex: none;
				max-height: 35vh;
			}
		}
	}
</style>
