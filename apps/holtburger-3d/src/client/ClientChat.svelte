<script lang="ts">
	import { tick } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { APP_INPUT } from "../lib/input/app-input";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import {
		CLIENT_CHAT_FILTER_TAGS,
		clientChatChannelLabel,
		clientChatFilterLabel,
		clientChatFiltersAllow,
		clientChatTone,
		type ClientChatFilterTag,
		type ClientChatLine,
	} from "./client-chat-policy";

	interface Props {
		readonly messages: readonly ClientChatLine[];
		readonly onSend: (message: string) => Promise<void>;
	}

	const { messages, onSend }: Props = $props();
	const { keyboard } = useAppInputPolicy();

	let inputElement = $state<HTMLInputElement | null>(null);
	let message = $state("");
	let sending = $state(false);
	let failure = $state<string | null>(null);
	let bufferElement = $state<HTMLDivElement | null>(null);
	/** Explicit history interaction enables selection and preserves the reader's scroll position. */
	let historyInteractive = $state(false);
	let enabledTags = $state<readonly ClientChatFilterTag[]>([
		...CLIENT_CHAT_FILTER_TAGS,
	]);
	const visibleMessages = $derived(
		messages.filter((line) => clientChatFiltersAllow(enabledTags, line)),
	);

	$effect(() => {
		visibleMessages;
		if (historyInteractive) return;
		void tick().then(() => {
			if (bufferElement && !historyInteractive)
				bufferElement.scrollTop = bufferElement.scrollHeight;
		});
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (APP_INPUT.shortcut("cancel", event)) {
			event.preventDefault();
			message = "";
			failure = null;
			keyboard.returnToGame();
		} else scrollHistory(event);
	}

	function scrollHistory(event: KeyboardEvent): void {
		if (
			APP_INPUT.shortcut("chatPreviousPage", event) ||
			APP_INPUT.shortcut("chatNextPage", event)
		) {
			event.preventDefault();
			bufferElement?.scrollBy({
				top:
					(APP_INPUT.shortcut("chatPreviousPage", event) ? -1 : 1) *
					bufferElement.clientHeight *
					0.85,
			});
		}
	}

	function toggleHistory(): void {
		historyInteractive = !historyInteractive;
		if (historyInteractive && bufferElement !== null)
			keyboard.activate(bufferElement);
		else if (document.activeElement === bufferElement) keyboard.returnToGame();
	}

	async function submit(): Promise<void> {
		const text = message.trim();
		if (sending || text.length === 0) return;
		sending = true;
		failure = null;
		try {
			await onSend(text);
			message = "";
			if (document.activeElement === inputElement) keyboard.returnToGame();
		} catch (error) {
			failure = error instanceof Error ? error.message : "Chat send failed.";
		} finally {
			sending = false;
		}
	}

	function toggleTag(tag: ClientChatFilterTag): void {
		const disabling = enabledTags.includes(tag);
		enabledTags = CLIENT_CHAT_FILTER_TAGS.filter((candidate) =>
			candidate === tag ? !disabling : enabledTags.includes(candidate),
		);
	}

	function linePrefix(line: ClientChatLine): string {
		const time = line.receivedAt.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
		const channel =
			line.kind === "channel"
				? ` [${clientChatChannelLabel(line.channel)}]`
				: "";
		const sender = "sender" in line ? ` ${line.sender}` : "";
		return `[${time}]${channel}${sender}`;
	}
</script>

<section class="chat-panel">
	<div class="chat-history" class:interactive={historyInteractive}>
		<div
			bind:this={bufferElement}
			class="chat-buffer ui-hud-surface"
			tabindex="-1"
			role="log"
			aria-live="polite"
			aria-label="Chat messages"
			use:keyboard.scope={{ keydown: scrollHistory }}
			onpointerdown={(event) => {
				if (historyInteractive) keyboard.activate(event.currentTarget);
			}}
		>
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
					class:chat-emote={line.kind === "emote"}
				>
					<strong>{linePrefix(line)}:</strong>
					<span class="chat-message">{line.message}</span>
				</p>
			{/each}
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
				class="ui-button"
				aria-pressed={enabledTags.includes(tag)}
				onclick={() => toggleTag(tag)}
			>
				{clientChatFilterLabel(tag)}
			</button>
		{/each}
	</div>
	{#if failure}<div class="chat-failure" role="alert">{failure}</div>{/if}
	<form
		class="ui-hud-surface"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<input
			class="ui-input ui-hud-input"
			bind:this={inputElement}
			bind:value={message}
			readonly={sending}
			aria-label="Chat message"
			autocomplete="off"
			use:keyboard.scope={{
				activation: (event) =>
					APP_INPUT.shortcut("chat", event) &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey,
				keydown: handleKeydown,
			}}
		/>
		<button
			type="button"
			class="chat-channel ui-hud-button"
			tabindex="-1"
			title="Speech channel"
			aria-label="Speech channel"
		>
			<ClientHudIcon name="speech" />
		</button>
	</form>
</section>

<style>
	@layer components {
		.chat-panel {
			display: grid;
			box-sizing: border-box;
			height: 100%;
			grid-template-rows: minmax(0, 1fr) auto auto auto;
			color: var(--ui-color-text);
			font: inherit;
			line-height: 1.25;
			pointer-events: none;
			text-shadow: 0 1px 2px var(--ui-color-shadow);
			user-select: none;
		}
		.chat-filters {
			display: flex;
			gap: 2px;
			padding: 0 3px 3px;
			background: var(--_ui-hud-background-color);
			pointer-events: auto;
			user-select: auto;
		}
		.chat-filters button {
			min-height: 22px;
			padding: 2px 8px;
		}
		.chat-history {
			position: relative;
			display: grid;
			min-height: 0;
		}
		.chat-history.interactive .chat-buffer {
			pointer-events: auto;
			user-select: text;
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
			background: linear-gradient(
				to top,
				var(--_ui-hud-background-color),
				color-mix(in srgb, var(--_ui-hud-background-color) 48%, transparent) 55%,
				transparent
			);
			mask-image: linear-gradient(to bottom, transparent, #000 34%, #000);
			scrollbar-width: thin;
			scrollbar-color: transparent transparent;
		}
		.chat-buffer:focus {
			/* Keyboard ownership enables copying without adding a border to the HUD. */
			outline: none;
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
			background: transparent;
		}
		.chat-panel:focus-within .chat-buffer,
		.chat-history.interactive .chat-buffer {
			background: var(--_ui-hud-background-color);
			mask-image: none;
			scrollbar-color: var(--ui-color-border) transparent;
		}
		.chat-panel:focus-within .chat-buffer::-webkit-scrollbar-thumb,
		.chat-history.interactive .chat-buffer::-webkit-scrollbar-thumb {
			background: var(--ui-color-border);
		}
		.chat-panel:focus-within .chat-buffer::-webkit-scrollbar-thumb:hover,
		.chat-history.interactive .chat-buffer::-webkit-scrollbar-thumb:hover {
			background: var(--ui-color-accent);
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
		.chat-failure {
			padding: 3px 7px;
			background: var(--ui-color-well);
			color: var(--ui-color-danger);
		}
		form {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 28px;
			gap: 3px;
			padding: 3px;
			background: var(--_ui-hud-background-color);
			pointer-events: auto;
			user-select: auto;
		}
		input {
			box-sizing: border-box;
			width: 100%;
			height: 25px;
			padding: 2px 6px;
		}
		.chat-channel {
			width: 28px;
			height: 25px;
			min-height: 0;
			padding: 5px;
		}
	}
</style>
