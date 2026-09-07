<script lang="ts">
	import type { Snippet } from "svelte";
	import { provideViewportInputGate } from "../../lib/input/viewport-input-context";
	import { uiThemes } from "../../app/mount";
	import { defaultUiThemeUrl } from "../../app/ui-theme";
	import { steelUrl, opaqueUrl } from "./ui-showcase-themes";
	import ClientCharacterHud from "../../client/ClientCharacterHud.svelte";
	import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
	import ClientChat from "../../client/ClientChat.svelte";
	import ClientFpsCounter from "../../client/ClientFpsCounter.svelte";
	import ClientJumpPowerBar from "../../client/ClientJumpPowerBar.svelte";
	import ClientToastOverlay from "../../client/ClientToastOverlay.svelte";
	import ClientHudPanel from "../../client/ClientHudPanel.svelte";
	import ClientHudWindow from "../../client/ClientHudWindow.svelte";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import ClientDebugPanel from "../../client/ClientDebugPanel.svelte";
	import ClientShortcutDock, {
		createClientShortcuts,
	} from "../../client/ClientShortcutDock.svelte";
	import ToggleField from "../../app/ToggleField.svelte";
	import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
	import {
		type ClientHudPlacement,
		type ClientHudLayout,
	} from "../../client/client-hud-layout";
	import type { ClientChatLine } from "../../client/client-chat-policy";
	import type { ClientLifecycleUiState } from "../../client/client-lifecycle-state";

	provideViewportInputGate();
	/** Showcase geometry follows the available stage, independently of client placement defaults. */
	let stageWidth = $state(960);
	let windowHeight = $state(720);
	const columns = $derived(stageWidth >= 728 ? 2 : 1);
	const viewport = $derived({
		width: stageWidth,
		height: Math.max(windowHeight, columns === 2 ? 632 : 1116),
	});
	let adjustments = $state<Partial<ClientHudLayout>>({});
	const shortcuts = createClientShortcuts(true);
	/** Production HUD surfaces whose component inputs do not require a GPU owner. */
	type HudSurface = Exclude<keyof ClientHudLayout, "minimap" | "diagnostics">;
	const layout = $derived.by(() => {
		const width = (stageWidth - 16 * (columns + 1)) / columns;
		const right = columns === 2 ? width + 32 : 16;
		const place = (
			x: number,
			y: number,
			w: number,
			h: number,
		): ClientHudPlacement => ({
			horizontal: { alignment: "start", offset: x },
			vertical: { alignment: "start", offset: y },
			preferredWidth: w,
			preferredHeight: h,
		});
		return {
			character: place(16, 16, width, 132),
			selectedEntity: place(16, 164, width, 72),
			shortcuts: place(16, 252, width, 42),
			frameRate: place(16, 320, 120, 26),
			jumpPower: place(width - 22, 310, 38, 132),
			toast: place(16, 370, width - 70, 64),
			chat: place(right, columns === 2 ? 16 : 470, width, 264),
			diagnostics: place(
				right,
				columns === 2 ? 304 : 758,
				width,
				columns === 2 ? 304 : 340,
			),
			...adjustments,
		};
	});
	let editable = $state(false);
	let windowOpen = $state(true);
	let tab = $state<"controls" | "characters" | "diagnostics">("controls");
	let backdrop = $state("landscape");
	/** User-selected solid backdrop, retained while previewing other backgrounds. */
	let backdropColor = $state("#20252b");
	/** A local screenshot stays in the browser; release its object URL when replaced. */
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
	let theme = $state("standard");
	let opaque = $state(false);
	let showHidden = $state(false);
	let toggle = $state(true);
	let jumpExtent = $state(0.65);
	let toastMessage = $state("Your allegiance is online.");
	/** Reload status is independent of the mounted component tree and its local state. */
	let reload = $state<
		| { kind: "idle" }
		| { kind: "loading" }
		| { kind: "loaded" }
		| { kind: "error"; message: string }
	>({ kind: "idle" });
	let revision = 0;
	let characters = $state<
		Extract<ClientLifecycleUiState, { kind: "character-selection" }>
	>({
		kind: "character-selection",
		selectedGuid: null,
		characters: [
			{ guid: 1, name: "Wayfarer", slot: 0, deleteTime: 0 },
			{ guid: 2, name: "Lantern Keeper", slot: 1, deleteTime: 0 },
		],
	});
	let messages = $state<ClientChatLine[]>([
		{
			id: 1,
			receivedAt: new Date(2026, 0, 1, 20, 41),
			kind: "system",
			message: "Welcome to the UI showcase.",
		},
		{
			id: 2,
			receivedAt: new Date(2026, 0, 1, 20, 42),
			kind: "speech",
			sender: "Traveler",
			speakerKind: "player",
			message: "Room by the fire?",
		},
		{
			id: 3,
			receivedAt: new Date(2026, 0, 1, 20, 42),
			kind: "tell",
			sender: "Lantern Keeper",
			speakerKind: "player",
			message: "Meet at the lifestone.",
		},
		{
			id: 4,
			receivedAt: new Date(2026, 0, 1, 20, 43),
			kind: "channel",
			channel: "allegiance",
			sender: "Wayfarer",
			speakerKind: "player",
			message: "Your fellowship has been formed.",
		},
		{
			id: 5,
			receivedAt: new Date(2026, 0, 1, 20, 44),
			kind: "combat",
			message: "You hit the training dummy.",
			emphasized: false,
		},
		{
			id: 6,
			receivedAt: new Date(2026, 0, 1, 20, 44),
			kind: "error",
			message: "You are too far away.",
		},
	]);
	async function send(message: string): Promise<void> {
		messages = [
			...messages,
			{
				id: messages.length + 1,
				receivedAt: new Date(),
				kind: "speech",
				sender: "Wayfarer",
				speakerKind: "player",
				message,
			},
		];
	}
	async function reloadTheme(): Promise<void> {
		reload = { kind: "loading" };
		const currentRevision = ++revision;
		// A new stylesheet URL bypasses the browser cache without remounting the specimen.
		const fresh = (path: string) => {
			const url = new URL(path, document.baseURI);
			url.searchParams.set("showcase-reload", String(currentRevision));
			return url.href;
		};
		try {
			await uiThemes.replace(
				fresh(theme === "standard" ? defaultUiThemeUrl : steelUrl),
				opaque ? fresh(opaqueUrl) : null,
			);
			reload = { kind: "loaded" };
		} catch (error) {
			reload = {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}
</script>

<svelte:window bind:innerHeight={windowHeight} />
<main class="showcase ui-theme" aria-label="UI showcase">
	<aside class="showcase-controls ui-panel">
		<header class="ui-frame">UI showcase</header>
		<div class="ui-body">
			<p class="ui-muted">Production components · fixture data</p>
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
			<label class="ui-label"
				>Theme<select
					class="ui-input"
					bind:value={theme}
					disabled={reload.kind === "loading"}
					onchange={reloadTheme}
					><option value="standard">Holtburger Standard</option><option
						value="steel">Steel fixture</option
					></select
				></label
			>
			<label
				><input
					type="checkbox"
					bind:checked={opaque}
					disabled={reload.kind === "loading"}
					onchange={reloadTheme}
				/> Opaque override</label
			>
			<div class="showcase-actions">
				<button
					class="ui-button"
					disabled={reload.kind === "loading"}
					onclick={reloadTheme}>Reload theme</button
				>
				<button
					class="ui-button"
					aria-pressed={editable}
					onclick={() => (editable = !editable)}
					>{editable ? "Lock UI layout" : "Unlock UI layout"}</button
				>
				<button
					class="ui-button"
					onclick={() => {
						adjustments = {};
						windowOpen = true;
					}}>Reset layout</button
				>
			</div>
			{#if reload.kind === "error"}<p class="ui-error" role="alert">
					{reload.message}
				</p>{:else}<p class="ui-muted" role="status">
					{reload.kind === "loading"
						? "Loading theme…"
						: reload.kind === "loaded"
							? "Theme reloaded."
							: "Edit the theme CSS, then reload."}
				</p>{/if}
		</div>
	</aside>

	<div class="showcase-stage-scroll">
		<div
			class="showcase-stage"
			data-backdrop={backdrop}
			bind:clientWidth={stageWidth}
			style:height={`${viewport.height}px`}
			style:background-color={backdrop === "color" ? backdropColor : null}
		>
			{#if backdrop === "image" && imageUrl}
				<img
					class="showcase-backdrop"
					src={imageUrl}
					alt=""
					onerror={() => (imageFailed = true)}
				/>
			{/if}

			{#snippet hud(name: HudSurface, children: Snippet)}
				<!-- Match ClientWorldView: these surfaces rely on their wrapper to receive input. -->
				<ClientHudPanel
					{children}
					{editable}
					label={name}
					placement={layout[name]}
					{viewport}
					minWidth={CLIENT_UI_DEFAULTS[name].minSize.width}
					minHeight={CLIENT_UI_DEFAULTS[name].minSize.height}
					resizable={CLIENT_UI_DEFAULTS[name].resizable}
					contentHitTesting={name === "character" ||
					name === "jumpPower" ||
					name === "shortcuts"
						? "surface"
						: "descendants"}
					onPlacementChange={(placement) =>
						(adjustments = { ...adjustments, [name]: placement })}
				/>
			{/snippet}
			{#snippet character()}<ClientCharacterHud
					playerName="Wayfarer"
					worldName="Dereth"
					vitals={[
						{ kind: "health", current: 328, maximum: 400 },
						{ kind: "mana", current: 273, maximum: 300 },
						{ kind: "stamina", current: 195, maximum: 300 },
					]}
				/>{/snippet}
			{#snippet target()}<ClientSelectedEntityHud
					selectedGuid={1}
					readSelectedName={() => "Drudge Prowler"}
				/>{/snippet}
			{#snippet chat()}<ClientChat
					gameCanvas={null}
					{messages}
					onSend={send}
				/>{/snippet}
			{#snippet fps()}<ClientFpsCounter
					readFrameRates={() => ({ capped: 60, uncapped: 120 })}
				/>{/snippet}
			{#snippet jump()}<ClientJumpPowerBar
					active={false}
					previewExtent={jumpExtent}
					actionEnabled={true}
					readExtent={() => jumpExtent}
					onEnterPrecise={() =>
						(toastMessage = "Precise jump fixture activated.")}
				/>{/snippet}
			{#snippet toast()}<ClientToastOverlay
					toast={null}
					previewMessage={toastMessage}
				/>{/snippet}
			{#snippet dock()}<ClientShortcutDock
					{shortcuts}
					debugOpen={windowOpen}
					onDebug={() => (windowOpen = !windowOpen)}
				/>{/snippet}
			{@render hud("character", character)}
			{@render hud("selectedEntity", target)}
			{@render hud("chat", chat)}
			{@render hud("frameRate", fps)}
			{@render hud("jumpPower", jump)}
			{@render hud("toast", toast)}
			{@render hud("shortcuts", dock)}

			{#if windowOpen}
				<ClientHudWindow
					title="Component showcase"
					placement={layout.diagnostics}
					{viewport}
					minWidth={CLIENT_UI_DEFAULTS.diagnostics.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.diagnostics.minSize.height}
					onClose={() => (windowOpen = false)}
					onPlacementChange={(placement) =>
						(adjustments = { ...adjustments, diagnostics: placement })}
				>
					<div class="showcase-window-body ui-body">
						<nav class="ui-tabs" aria-label="Showcase pages">
							{#each ["controls", "characters", "diagnostics"] as const as page}<button
									class="ui-tab"
									aria-pressed={tab === page}
									onclick={() => (tab = page)}>{page}</button
								>{/each}
						</nav>
						{#if tab === "characters"}
							<ClientCharacterSelect
								state={characters}
								entryPending={false}
								onChoose={(guid) =>
									(characters = { ...characters, selectedGuid: guid })}
								onEnter={() => {
									toastMessage =
										"Character entry preview — no connection opened.";
								}}
								onDisconnect={() => {
									characters = { ...characters, selectedGuid: null };
								}}
							/>
						{:else if tab === "diagnostics"}
							<ClientDebugPanel
								readDiagnostics={() => null}
								showRetailHiddenGeometry={showHidden}
								onShowRetailHiddenGeometryChange={(value) =>
									(showHidden = value)}
							/>
						{:else}
							<div class="showcase-actions">
								<button class="ui-button">Normal</button><button
									class="ui-button"
									disabled>Disabled</button
								>
							</div>
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
							<label class="ui-label"
								>Jump charge<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									bind:value={jumpExtent}
								/></label
							>
							<div class="ui-well">
								<p class="ui-success">Changes saved.</p>
								<p class="ui-warning">Your pack is almost full.</p>
								<p class="ui-danger">You are too far away.</p>
							</div>
						{/if}
					</div>
				</ClientHudWindow>
			{/if}
		</div>
	</div>
</main>

<style>
	@layer components {
		.showcase {
			position: fixed;
			inset: 0;
			display: grid;
			grid-template-columns: minmax(0, 1fr) 300px;
			background: #20252b;
		}
		.showcase-stage-scroll {
			grid-column: 1;
			grid-row: 1;
			overflow: auto;
		}
		.showcase-stage {
			position: relative;
			min-width: 360px;
			background: #20252b;
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
		.showcase-backdrop {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
			pointer-events: none;
		}
		.showcase-controls {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
			overflow: auto;
		}
		@media (max-width: 700px) {
			.showcase {
				grid-template-columns: minmax(0, 1fr);
				grid-template-rows: auto minmax(0, 1fr);
			}
			.showcase-controls {
				grid-column: 1;
				max-height: 240px;
			}
			.showcase-stage-scroll {
				grid-row: 2;
			}
		}

		.showcase-controls .ui-body,
		.showcase-window-body {
			display: grid;
			gap: 8px;
		}
		.showcase-window-body {
			height: 100%;
			overflow: auto;
			align-content: start;
		}
		.showcase-actions {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
		}
	}
</style>
