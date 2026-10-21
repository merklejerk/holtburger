<script lang="ts">
	import { chatCompletion } from "./client-chat-completion";
	import { ChatSubmissionError } from "./client-chat-composer.svelte";
	import ClientWaypointText from "./ClientWaypointText.svelte";
	import ClientChatFormattedText from "./ClientChatFormattedText.svelte";
	import ClientChatRecipientDialog from "./ClientChatRecipientDialog.svelte";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { useClientInput } from "./client-input-context";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import { tick } from "svelte";
	import PopupMenu from "../app/PopupMenu.svelte";
	import type { ClientChatComposer } from "./client-chat-composer.svelte";
	import type { ClientClockFormat } from "./client-environment-settings";
	import {
		CHAT_CHANNEL_DESTINATIONS,
		resolveChatCompose,
		type ChatComposeResolution,
	} from "./client-chat-compose";
	import type { ClientChatDestination } from "./client-host-contract";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		navigateSentChat,
		type ChatInputRecall,
	} from "./client-chat-input-history";
	import {
		CLIENT_CHAT_FILTER_TAGS,
		clientChatMessageLabel,
		clientChatFilterLabel,
		clientChatFiltersAllow,
		clientChatTone,
		type ClientChatFilterTag,
		type ClientChatLine,
	} from "./client-chat-policy";

	interface Props {
		/** Set the current local destination without submitting chat. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
		readonly messages: readonly ClientChatLine[];
		/** User-selected clock format for all buffered message timestamps. */
		readonly clockFormat: ClientClockFormat;
		/** App-owned locally queued input, oldest first. */
		readonly sentHistory: readonly string[];
		readonly onSend: (
			message: string,
			resolution: ChatComposeResolution,
		) => Promise<void>;
		/** Session-owned destination and structured reply/retell addresses. */
		readonly composer: ClientChatComposer;
		/** Append submission failures to the app-owned durable chat buffer. */
		readonly onSendError: (message: string) => void;
		readonly enabledTags: readonly ClientChatFilterTag[];
		readonly onEnabledTagsChange: (
			value: readonly ClientChatFilterTag[],
		) => void;
	}

	const {
		onSetWaypoint,
		messages,
		clockFormat,
		sentHistory,
		onSend,
		composer,
		onSendError,
		enabledTags,
		onEnabledTagsChange,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();

	let inputElement = $state<HTMLInputElement | null>(null);
	let message = $state("");
	/** Navigation is local to the mounted editor; the sent entries outlive it. */
	let recall = $state<ChatInputRecall | null>(null);
	let sending = $state(false);
	let editorFocused = $state(false);
	/** Editor events update completion inputs; no cursor movement is observed globally. */
	let caret = $state(0);
	let completionIndex = $state(0);
	let completionDismissed = $state(false);
	let composing = $state(false);
	const completionId = $props.id();
	const completion = $derived(
		completionDismissed || !editorFocused || sending || composing
			? null
			: chatCompletion(
					message,
					caret,
					composer.destination.kind === "speech",
					composer.emotes,
				),
	);
	const completionChoice = $derived(
		completion?.choices[completionIndex] ?? completion?.choices[0],
	);
	function updateCompletion(element: HTMLInputElement): void {
		caret = element.selectionStart ?? element.value.length;
		completionIndex = 0;
		completionDismissed = false;
	}
	async function acceptCompletion(): Promise<void> {
		if (completion === null || completionChoice === undefined) return;
		const inserted = completionChoice.replacement;
		const nextCaret = completion.start + inserted.length;
		message =
			message.slice(0, completion.start) +
			inserted +
			message.slice(completion.end);
		completionDismissed = true;
		recall = null;
		await tick();
		inputElement?.setSelectionRange(nextCaret, nextCaret);
		caret = nextCaret;
	}
	let bufferElement = $state<HTMLDivElement | null>(null);
	/** Deliberate history interaction survives editor blur and viewport clicks. */
	let explicitHistory = $state(false);

	/** The component-local prompt never replaces the completed destination until accepted. */
	let recipientOpen = $state(false);
	let menuAnchor = $state<HTMLButtonElement | null>(null);
	let menuOpen = $state(false);
	type DestinationAction =
		"speech" | "tell" | "selected" | ClientChatDestination;
	const destinationItems = $derived([
		{ action: "speech" as const, label: "Local", disabled: false },
		{ action: "tell" as const, label: "Tell…", disabled: false },
		{
			action: "selected" as const,
			label:
				composer.selection.kind === "target"
					? `Tell selected → ${composer.selection.target.name}`
					: "Tell selected",
			disabled: composer.selection.kind !== "target",
		},
		...CHAT_CHANNEL_DESTINATIONS.map((entry) => ({
			action: entry.channel,
			label:
				entry.channel === "fellowship" && !composer.inParty
					? "Party (not in a party)"
					: entry.label,
			disabled: entry.channel === "fellowship" && !composer.inParty,
		})),
	]);
	const resolution = $derived(
		resolveChatCompose(message, {
			destination: composer.destination,
			reply: composer.reply,
			retell: composer.retell,
			selection: composer.selection,
			emotes: composer.emotes,
		}),
	);
	$effect(() => {
		const choice = completionChoice;
		const index = completionIndex;
		if (choice !== undefined)
			void tick().then(() =>
				document
					.getElementById(`${completionId}-${index}`)
					?.scrollIntoView({ block: "nearest" }),
			);
	});
	const historyInteractive = $derived(
		explicitHistory || editorFocused || recipientOpen,
	);
	const visibleMessages = $derived(
		messages.filter((line) => clientChatFiltersAllow(enabledTags, line)),
	);
	/** Imperative scroll intent; layout observations do not belong in the UI graph. */
	let following = true;
	let bufferReady = false;
	let lastScrollTop = 0;

	function atBottom(element: HTMLDivElement): boolean {
		return (
			element.scrollHeight - element.clientHeight - element.scrollTop <=
			CLIENT_TUNING.chat.bottomToleranceCssPixels
		);
	}

	function scrollToBottom(element: HTMLDivElement): void {
		following = true;
		element.scrollTop = element.scrollHeight;
		lastScrollTop = element.scrollTop;
	}

	$effect(() => {
		// Ending history interaction immediately returns the HUD to live messages.
		if (!historyInteractive && bufferElement !== null)
			scrollToBottom(bufferElement);
	});

	$effect.pre(() => {
		// A user can reach the bottom before the browser dispatches its queued scroll event.
		// Capture the old DOM geometry before messages/filtering change its height.
		void visibleMessages;
		if (bufferReady && bufferElement !== null) {
			following = !historyInteractive || atBottom(bufferElement);
			// Its queued scroll notification must not recompute intent against the grown DOM.
			lastScrollTop = bufferElement.scrollTop;
		}
	});

	/** Native anchoring retains active reading positions; inactive history always follows. */
	function followBuffer(element: HTMLDivElement): { destroy: () => void } {
		const content = element.firstElementChild;
		if (!(content instanceof HTMLElement))
			throw new Error("Chat scroll content is missing.");
		lastScrollTop = element.scrollTop;
		const scroll = () => {
			if (!historyInteractive) {
				scrollToBottom(element);
				return;
			}
			// Ignore our own scroll notification, which can arrive after another layout update.
			if (element.scrollTop === lastScrollTop) return;
			lastScrollTop = element.scrollTop;
			following = atBottom(element);
		};
		const observer = new ResizeObserver(() => {
			bufferReady = true;
			// Filtering/retention can fit every line without changing scrollTop or emitting scroll.
			following ||= !historyInteractive || atBottom(element);
			if (!following) return;
			scrollToBottom(element);
		});
		element.addEventListener("scroll", scroll);
		observer.observe(element);
		observer.observe(content);
		return {
			destroy: () => {
				bufferReady = false;
				observer.disconnect();
				element.removeEventListener("scroll", scroll);
			},
		};
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing || composing) return;
		if (
			completion !== null &&
			completionChoice !== undefined &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey
		) {
			if (event.key === "Escape") {
				event.preventDefault();
				completionDismissed = true;
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				completionIndex =
					(completionIndex +
						(event.key === "ArrowDown" ? 1 : -1) +
						completion.choices.length) %
					completion.choices.length;
				return;
			}
			if (event.key === "Tab" || event.key === "Enter") {
				event.preventDefault();
				if (!event.repeat) void acceptCompletion();
				return;
			}
		}
		if (clientInput.shortcut("cancel", event)) {
			event.preventDefault();
			message = "";
			recall = null;
			explicitHistory = false;
			keyboard.returnToGame();
		} else if (
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.shiftKey &&
			(event.key === "ArrowUp" || event.key === "ArrowDown")
		) {
			// Recall replaces text programmatically, so it must honor the editor's read-only state.
			if (sending) return;
			const next = navigateSentChat(
				sentHistory,
				recall,
				message,
				event.key === "ArrowUp" ? "older" : "newer",
			);
			if (next !== null) {
				event.preventDefault();
				recall = next.recall;
				message = next.message;
			}
		} else scrollHistory(event);
	}

	function scrollHistory(event: KeyboardEvent): void {
		if (
			clientInput.shortcut("chatPreviousPage", event) ||
			clientInput.shortcut("chatNextPage", event)
		) {
			event.preventDefault();
			bufferElement?.scrollBy({
				top:
					(clientInput.shortcut("chatPreviousPage", event) ? -1 : 1) *
					bufferElement.clientHeight *
					0.85,
			});
		}
	}

	function toggleHistory(): void {
		explicitHistory = !explicitHistory;
		if (explicitHistory && bufferElement !== null)
			keyboard.activate(bufferElement);
		else if (document.activeElement === bufferElement) keyboard.returnToGame();
	}

	function activateHistory(event: KeyboardEvent): boolean {
		if (!clientInput.shortcut("toggleChatHistory", event)) return false;
		if (explicitHistory) {
			event.preventDefault();
			explicitHistory = false;
			return false;
		}
		explicitHistory = true;
		return true;
	}

	function historyKeydown(event: KeyboardEvent): void {
		if (
			clientInput.shortcut("toggleChatHistory", event) ||
			clientInput.shortcut("cancel", event)
		) {
			event.preventDefault();
			if (event.repeat) return;
			explicitHistory = false;
			keyboard.returnToGame();
		} else if (
			clientInput.shortcut("chat", event) &&
			document.activeElement === bufferElement &&
			inputElement !== null
		) {
			// A focused coordinate link keeps its native Enter activation.
			event.preventDefault();
			keyboard.activate(inputElement);
		} else scrollHistory(event);
	}

	async function submit(): Promise<void> {
		const text = message.trim();
		if (sending || composing || text.length === 0) return;
		const generation = composer.generation;
		const resolved = resolution;
		sending = true;
		try {
			await onSend(text, resolved);
			if (composer.generation !== generation) return;
			message = "";
			recall = null;
			if (document.activeElement === inputElement) keyboard.returnToGame();
		} catch (error) {
			if (
				composer.generation === generation &&
				error instanceof ChatSubmissionError &&
				error.queued > 0
			) {
				message = "";
				recall = null;
			}
			if (composer.generation === generation) {
				const detail = error instanceof Error ? error.message : String(error);
				onSendError(
					error instanceof ChatSubmissionError && error.queued > 0
						? `${detail} The draft was cleared to avoid repeating queued actions.`
						: detail,
				);
			}
		} finally {
			if (composer.generation === generation) sending = false;
		}
	}

	async function chooseDestination(action: DestinationAction): Promise<void> {
		menuOpen = false;
		const generation = composer.generation;
		if (action === "tell") {
			// Retire the popup's keyboard owner before the dialog focuses its recipient field.
			await tick();
			if (composer.generation === generation) recipientOpen = true;
			return;
		}
		if (action === "speech") composer.destination = { kind: "speech" };
		else if (action === "selected") {
			if (composer.selection.kind !== "target") {
				onSendError("Selected tell target is no longer available.");
				return;
			}
			composer.destination = {
				kind: "tell",
				target: composer.selection.target,
			};
		} else composer.destination = { kind: "channel", channel: action };
		await tick();
		if (composer.generation === generation && inputElement !== null)
			keyboard.activate(inputElement);
	}

	async function closeRecipient(name: string | null): Promise<void> {
		if (name !== null)
			composer.destination = { kind: "tell", target: { kind: "player", name } };
		recipientOpen = false;
		const generation = composer.generation;
		await tick();
		if (composer.generation === generation && inputElement !== null)
			keyboard.activate(inputElement);
	}

	function toggleTag(tag: ClientChatFilterTag): void {
		const disabling = enabledTags.includes(tag);
		onEnabledTagsChange(
			CLIENT_CHAT_FILTER_TAGS.filter((candidate) =>
				candidate === tag ? !disabling : enabledTags.includes(candidate),
			),
		);
	}

	function updateBufferHover(event: PointerEvent): void {
		if (bufferElement === null) return;
		if (event.pointerType === "touch") {
			setBufferHovered(false);
			return;
		}
		const bounds = bufferElement.getBoundingClientRect();
		setBufferHovered(
			event.clientX >= bounds.left &&
				event.clientX <= bounds.right &&
				event.clientY >= bounds.top &&
				event.clientY <= bounds.bottom,
		);
	}

	function setBufferHovered(hovered: boolean): void {
		if (bufferElement === null) return;
		const next = String(hovered);
		if (bufferElement.dataset.pointerHovered !== next)
			bufferElement.dataset.pointerHovered = next;
	}

	function clearBufferHover(): void {
		setBufferHovered(false);
	}

	function linePrefix(line: ClientChatLine): string {
		const time = line.receivedAt.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: clockFormat === "24-hour" ? "h23" : "h12",
		});
		const label = clientChatMessageLabel(line);
		const channel = label === null ? "" : ` [${label}]`;
		const sender = "sender" in line ? ` ${line.sender}` : "";
		const separator =
			line.kind === "emote" || line.kind === "soul-emote" ? "" : ":";
		return `[${time}]${channel}${sender}${separator}`;
	}
</script>

<svelte:window
	onpointermove={updateBufferHover}
	onpointerleave={clearBufferHover}
	onblur={clearBufferHover}
/>

<section class="chat-panel" class:interactive={historyInteractive}>
	<div class="chat-content" inert={recipientOpen}>
		<div class="chat-history" class:interactive={historyInteractive}>
			<div
				bind:this={bufferElement}
				class="chat-buffer ui-hud-surface"
				data-pointer-hovered="false"
				tabindex="-1"
				role="log"
				aria-live="polite"
				aria-label="Chat messages"
				onpointerdown={() => {
					explicitHistory = true;
				}}
				use:followBuffer
				use:keyboard.scope={{
					nativeControls: true,
					pointerActivation: true,
					activation: activateHistory,
					keydown: historyKeydown,
				}}
			>
				<div class="chat-lines">
					{#each visibleMessages as line (line.id)}
						{@const tone = clientChatTone(line)}
						<p
							class:chat-tone-tell={tone === "tell"}
							class:chat-tone-emote={tone === "emote"}
							class:chat-tone-npc={tone === "npc"}
							class:chat-tone-combat={tone === "combat"}
							class:chat-tone-system={tone === "system"}
							class:chat-tone-error={tone === "error"}
							class:chat-tone-party={tone === "party"}
							class:chat-tone-guild={tone === "guild"}
							class:chat-tone-trade={tone === "trade"}
							class:chat-tone-society={tone === "society"}
							class:chat-emphasized={line.kind === "combat" && line.emphasized}
							class:chat-emote={line.kind === "emote" ||
								line.kind === "soul-emote"}
						>
							<strong>{linePrefix(line)}</strong>
							<span class="chat-message"
								>{#if line.kind === "formatted-system"}<ClientChatFormattedText
										rows={line.rows}
										interactive={historyInteractive}
										{onSetWaypoint}
									/>{:else if historyInteractive}<ClientWaypointText
										text={line.message}
										{onSetWaypoint}
									/>{:else}{line.message}{/if}</span
							>
						</p>
					{/each}
				</div>
			</div>
			<button
				type="button"
				class="chat-history-toggle ui-hud-button"
				aria-label="Interact with chat history"
				aria-pressed={historyInteractive}
				title={historyInteractive
					? "Disable chat history interaction"
					: "Enable chat history interaction (select and copy)"}
				onclick={toggleHistory}
			>
				<ClientHudIcon name="select-text" />
			</button>
		</div>
		<div
			class="chat-filters ui-hud-surface"
			role="group"
			aria-label="Message filters"
		>
			{#each CLIENT_CHAT_FILTER_TAGS as tag}
				<button
					type="button"
					class="ui-filter-pill"
					aria-pressed={enabledTags.includes(tag)}
					onclick={() => toggleTag(tag)}
				>
					{clientChatFilterLabel(tag)}
				</button>
			{/each}
		</div>
		<form
			style="position: relative"
			class="ui-hud-surface"
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<button
				bind:this={menuAnchor}
				type="button"
				class="chat-channel ui-button"
				tabindex="-1"
				title="Choose chat destination"
				aria-label="Chat destination"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={() => {
					menuOpen = !menuOpen;
				}}
			>
				<span class="chat-channel-icon"
					><ClientHudIcon name={resolution.buttonIcon} /></span
				>
				<span
					class="chat-destination"
					aria-live="polite"
					title={resolution.kind === "error"
						? resolution.message
						: resolution.label}
				>
					{resolution.buttonLabel}
				</span>
			</button>

			<input
				class="ui-input ui-hud-input"
				bind:this={inputElement}
				value={message}
				oninput={(event) => {
					message = event.currentTarget.value;
					recall = null;
					updateCompletion(event.currentTarget);
				}}
				onselect={(event) => updateCompletion(event.currentTarget)}
				onclick={(event) => updateCompletion(event.currentTarget)}
				onkeyup={(event) => {
					if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
						updateCompletion(event.currentTarget);
				}}
				oncompositionstart={() => {
					composing = true;
				}}
				oncompositionend={(event) => {
					composing = false;
					updateCompletion(event.currentTarget);
				}}
				aria-autocomplete="list"
				aria-controls={completion === null ? undefined : completionId}
				aria-expanded={completion !== null}
				aria-activedescendant={completion === null
					? undefined
					: `${completionId}-${completionIndex}`}
				readonly={sending}
				aria-label="Chat message"
				placeholder="Message"
				onfocus={() => {
					editorFocused = true;
				}}
				onblur={() => {
					editorFocused = false;
				}}
				autocomplete="off"
				use:keyboard.scope={{
					activation: (event) => clientInput.shortcut("chat", event),
					keydown: handleKeydown,
				}}
			/>
			{#if completion !== null}
				<div
					id={completionId}
					class="chat-completions ui-overlay-surface"
					role="listbox"
					aria-label="Chat completions"
					data-editor-accessory
				>
					{#each completion.choices as choice, index (choice.id)}
						<button
							type="button"
							role="option"
							aria-selected={completionChoice === choice}
							id={`${completionId}-${index}`}
							class="ui-menu-item"
							onpointerenter={() => (completionIndex = index)}
							onclick={() => {
								completionIndex = index;
								void acceptCompletion();
							}}
						>
							<span>{choice.label}</span>
							<span class="chat-completion-detail ui-muted"
								>{choice.detail}</span
							>
						</button>
					{/each}
				</div>
			{/if}
		</form>
	</div>
	{#if menuOpen && menuAnchor !== null}
		<PopupMenu
			anchor={menuAnchor}
			label="Chat destination"
			items={destinationItems}
			onselect={(action) => {
				void chooseDestination(action);
			}}
			onclose={() => {
				menuOpen = false;
			}}
		/>
	{/if}
	{#if recipientOpen}
		<ClientChatRecipientDialog
			onSubmit={(name) => {
				void closeRecipient(name);
			}}
			onCancel={() => {
				void closeRecipient(null);
			}}
		/>
	{/if}
</section>

<style>
	.chat-completions {
		box-sizing: border-box;
		padding: var(--ui-menu-padding);
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		max-height: min(18rem, 50vh);
		overflow: auto;
		display: flex;
		flex-direction: column;
		pointer-events: auto;
	}
	.chat-completions .ui-menu-item {
		display: grid;
		gap: 0;
	}
	.chat-completion-detail {
		font-size: 0.9em;
	}

	@property --chat-buffer-focus {
		syntax: "<percentage>";
		inherits: false;
		initial-value: 0%;
	}
	@property --chat-buffer-middle-opacity {
		syntax: "<percentage>";
		inherits: false;
		initial-value: 48%;
	}

	@layer components {
		.chat-panel {
			position: relative;
			display: grid;
			box-sizing: border-box;
			height: 100%;
			grid-template-rows: minmax(0, 1fr) auto auto;
			color: var(--ui-color-text);
			font: inherit;
			line-height: 1.25;
			pointer-events: none;
			text-shadow: 0 1px 2px var(--ui-color-shadow);
			user-select: none;
		}
		.chat-content {
			display: contents;
		}
		.chat-panel.interactive {
			/* Enclose the complete HUD without reserving space between its rows. */
			outline: 1px solid var(--ui-color-accent);
			outline-offset: -1px;
		}
		.chat-filters {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-filter-gap);
			padding: 0 3px 3px;
			background: var(--_ui-hud-background-color);
			pointer-events: auto;
			user-select: auto;
		}
		.chat-history {
			position: relative;
			display: grid;
			min-height: 0;
		}
		.chat-history.interactive .chat-buffer {
			user-select: text;
			/* Native control clicks return keyboard ownership to the game without ending this mode. */
			pointer-events: auto;
		}
		.chat-history-toggle {
			position: absolute;
			top: 4px;
			left: 8px;
			width: 24px;
			height: 24px;
			padding: 4px;
			pointer-events: auto;
		}
		.chat-buffer {
			min-height: 0;
			overflow: hidden auto;
			padding: 8px;
			background-image: linear-gradient(
				to top,
				var(--_ui-hud-background-color),
				color-mix(
						in srgb,
						var(--_ui-hud-background-color) var(--chat-buffer-middle-opacity),
						transparent
					)
					55%,
				color-mix(
					in srgb,
					var(--_ui-hud-background-color) var(--chat-buffer-focus),
					transparent
				)
			);
			mask-image: linear-gradient(
				to bottom,
				color-mix(in srgb, #000 var(--chat-buffer-focus), transparent),
				#000 34%,
				#000 100%
			);
			scrollbar-width: thin;
			scrollbar-color: transparent transparent;
			transition:
				--chat-buffer-focus 160ms ease-out,
				--chat-buffer-middle-opacity 160ms ease-out,
				scrollbar-color 160ms ease-out;
		}
		.chat-buffer:focus {
			/* The complete, unmasked chat HUD owns the active border. */
			outline: none;
			pointer-events: auto;
		}
		.chat-buffer::before {
			/* Keep faded leading space inside the scroll area. Percentage padding would
			   use the panel's width and overflow the grid row in wide, short layouts. */
			content: "";
			display: block;
			height: 42%;
		}
		.chat-buffer::-webkit-scrollbar {
			width: 5px;
		}
		.chat-buffer::-webkit-scrollbar-track,
		.chat-buffer::-webkit-scrollbar-thumb {
			background-color: transparent;
			transition: background-color 160ms ease-out;
		}
		/* Pointer hover is measured without making the click-through buffer a hit target. */
		:global(.chat-buffer[data-pointer-hovered="true"]),
		.chat-panel:focus-within .chat-buffer,
		.chat-history.interactive .chat-buffer {
			--chat-buffer-focus: 100%;
			--chat-buffer-middle-opacity: 100%;
			scrollbar-color: var(--ui-color-border) transparent;
		}
		:global(.chat-buffer[data-pointer-hovered="true"]::-webkit-scrollbar-thumb),
		.chat-panel:focus-within .chat-buffer::-webkit-scrollbar-thumb,
		.chat-history.interactive .chat-buffer::-webkit-scrollbar-thumb {
			background-color: var(--ui-color-border);
		}
		:global(
			.chat-buffer[data-pointer-hovered="true"]::-webkit-scrollbar-thumb:hover
		),
		.chat-panel:focus-within .chat-buffer::-webkit-scrollbar-thumb:hover,
		.chat-history.interactive .chat-buffer::-webkit-scrollbar-thumb:hover {
			background-color: var(--ui-color-accent);
		}
		p {
			margin: 0 0 5px;
		}
		.chat-message {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.chat-emphasized .chat-message {
			font-weight: 700;
		}
		p strong {
			color: var(--ui-color-muted);
			font-weight: 700;
		}
		.chat-tone-system {
			color: var(--ui-chat-system-text);
		}
		.chat-tone-tell {
			color: var(--ui-chat-tell-text);
		}
		.chat-tone-emote {
			color: var(--ui-chat-emote-text);
		}
		.chat-tone-party {
			color: var(--ui-chat-party-text);
		}
		.chat-emote {
			font-style: italic;
		}
		.chat-tone-npc {
			color: var(--ui-chat-npc-text);
		}
		.chat-tone-error {
			color: var(--ui-chat-error-text);
		}
		.chat-tone-combat {
			color: var(--ui-chat-combat-text);
		}
		.chat-tone-guild {
			color: var(--ui-chat-guild-text);
		}
		.chat-tone-trade {
			color: var(--ui-chat-trade-text);
		}
		.chat-tone-society {
			color: var(--ui-chat-society-text);
		}
		form {
			display: flex;
			align-items: center;
			gap: 3px;
			padding: 3px;
			background: var(--_ui-hud-background-color);
			pointer-events: auto;
			user-select: auto;
		}
		.chat-destination {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 0.85em;
			color: var(--ui-color-muted);
		}
		input {
			flex: 1;
			box-sizing: border-box;
			min-width: 0;
			width: 100%;
			height: 25px;
			padding: 2px 6px;
		}
		.chat-channel {
			display: flex;
			align-items: center;
			gap: 4px;
			min-width: 28px;
			max-width: 40%;
			height: 25px;
			min-height: 0;
			padding: 2px 5px;
		}
		.chat-channel-icon {
			/* HUD SVGs fill their parent through inline styles; constrain that parent. */
			flex: none;
			width: 16px;
			height: 16px;
		}
		@media (prefers-reduced-motion: reduce) {
			.chat-buffer,
			.chat-buffer::-webkit-scrollbar-thumb {
				transition: none;
			}
		}
	}
</style>
