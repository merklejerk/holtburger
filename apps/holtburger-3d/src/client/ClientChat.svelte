<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import { useViewportInputGate } from "../lib/input/viewport-input-context";
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
		readonly gameCanvas: HTMLCanvasElement | null;
		readonly messages: readonly ClientChatLine[];
		readonly onSend: (message: string) => Promise<void>;
	}

	const { gameCanvas, messages, onSend }: Props = $props();
	const inputGate = useViewportInputGate();
	/** Focus owns this blocker until chat is left or unmounted. */
	let releaseInputBlock: (() => void) | null = null;
	onDestroy(() => releaseInputBlock?.());
	type ChatFocusMode = "inactive" | "input" | "buffer" | "filters";

	let inputElement = $state<HTMLInputElement | null>(null);
	let message = $state("");
	let sending = $state(false);
	let failure = $state<string | null>(null);
	let bufferElement = $state<HTMLDivElement | null>(null);
	let filtersElement = $state<HTMLDivElement | null>(null);
	let focusMode = $state<ChatFocusMode>("inactive");
	let enabledTags = $state<readonly ClientChatFilterTag[]>([
		...CLIENT_CHAT_FILTER_TAGS,
	]);
	const visibleMessages = $derived(
		messages.filter((line) => clientChatFiltersAllow(enabledTags, line)),
	);

	$effect(() => {
		visibleMessages;
		void tick().then(() => {
			if (bufferElement) bufferElement.scrollTop = bufferElement.scrollHeight;
		});
	});

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (focusMode !== "inactive") {
			if (APP_INPUT.shortcut("cancel", event)) {
				event.preventDefault();
				event.stopPropagation();
				message = "";
				failure = null;
				gameCanvas?.focus();
				return;
			}
			if (
				APP_INPUT.shortcut("chatPreviousPage", event) ||
				APP_INPUT.shortcut("chatNextPage", event)
			) {
				event.preventDefault();
				event.stopPropagation();
				bufferElement?.scrollBy({
					top:
						(APP_INPUT.shortcut("chatPreviousPage", event) ? -1 : 1) *
						(bufferElement.clientHeight * 0.85),
				});
			}
			return;
		}
		if (
			APP_INPUT.shortcut("chat", event) &&
			document.activeElement === gameCanvas
		) {
			event.preventDefault();
			inputElement?.focus();
		}
	}

	async function submit(): Promise<void> {
		const text = message.trim();
		if (sending || text.length === 0) return;
		sending = true;
		failure = null;
		try {
			await onSend(text);
			message = "";
			gameCanvas?.focus();
		} catch (error) {
			failure = error instanceof Error ? error.message : "Chat send failed.";
		} finally {
			sending = false;
		}
	}

	function transitionFocus(next: ChatFocusMode): void {
		const wasFocused = focusMode !== "inactive";
		const isFocused = next !== "inactive";
		focusMode = next;
		if (wasFocused === isFocused) return;
		if (isFocused) releaseInputBlock = inputGate.block();
		else {
			releaseInputBlock?.();
			releaseInputBlock = null;
		}
	}

	function handleFocusOut(event: FocusEvent): void {
		if (event.relatedTarget === inputElement) {
			transitionFocus("input");
		} else if (event.relatedTarget === bufferElement) {
			transitionFocus("buffer");
		} else if (
			event.relatedTarget instanceof Node &&
			filtersElement?.contains(event.relatedTarget)
		) {
			transitionFocus("filters");
		} else {
			transitionFocus("inactive");
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

<svelte:window onkeydowncapture={handleWindowKeydown} />

<section class="chat-panel" class:chat-focused={focusMode !== "inactive"}>
	<div
		bind:this={bufferElement}
		class="chat-buffer"
		tabindex="-1"
		role="log"
		aria-live="polite"
		aria-label="Chat messages"
		onfocus={() => transitionFocus("buffer")}
		onblur={handleFocusOut}
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
	<div
		bind:this={filtersElement}
		class="chat-filters"
		role="group"
		aria-label="Message filters"
	>
		{#each CLIENT_CHAT_FILTER_TAGS as tag}
			<button
				type="button"
				class="ui-hud-button"
				aria-pressed={enabledTags.includes(tag)}
				onfocus={() => transitionFocus("filters")}
				onblur={handleFocusOut}
				onclick={() => toggleTag(tag)}
			>
				{clientChatFilterLabel(tag)}
			</button>
		{/each}
	</div>
	{#if failure}<div class="chat-failure" role="alert">{failure}</div>{/if}
	<form
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
			onfocus={() => transitionFocus("input")}
			onblur={handleFocusOut}
		/>
		<button
			type="button"
			class="chat-channel ui-hud-button"
			tabindex="-1"
			title="Speech channel"
			aria-label="Speech channel"
			onpointerdown={(event) => event.preventDefault()}
		>
			<ClientHudIcon name="speech" />
		</button>
	</form>
</section>

<style>
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
		background: var(--ui-hud-backing);
		pointer-events: auto;
		user-select: auto;
	}
	.chat-filters button {
		min-height: 22px;
		padding: 2px 8px;
	}
	.chat-focused {
		pointer-events: auto;
		user-select: text;
	}
	.chat-buffer {
		min-height: 0;
		overflow: hidden auto;
		padding: 42% 8px 8px;
		background: linear-gradient(
			to top,
			var(--ui-hud-backing),
			color-mix(in srgb, var(--ui-hud-backing) 48%, transparent) 55%,
			transparent
		);
		mask-image: linear-gradient(to bottom, transparent, #000 34%, #000);
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
	}
	.chat-buffer::-webkit-scrollbar {
		width: 5px;
	}
	.chat-buffer::-webkit-scrollbar-track,
	.chat-buffer::-webkit-scrollbar-thumb {
		background: transparent;
	}
	.chat-focused .chat-buffer {
		background: var(--ui-hud-backing);
		mask-image: none;
		scrollbar-color: var(--ui-color-border) transparent;
	}
	.chat-focused .chat-buffer::-webkit-scrollbar-thumb {
		background: var(--ui-color-border);
	}
	.chat-focused .chat-buffer::-webkit-scrollbar-thumb:hover {
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
		color: var(--ui-color-mana);
	}
	.chat-tone-tell {
		color: var(--ui-color-chatTell);
	}
	.chat-tone-emote,
	.chat-tone-party {
		color: var(--ui-color-success);
	}
	.chat-emote {
		font-style: italic;
	}
	.chat-tone-npc {
		color: var(--ui-color-accent);
	}
	.chat-tone-error {
		color: var(--ui-color-danger);
	}
	.chat-tone-combat {
		color: var(--ui-color-health);
	}
	.chat-tone-guild {
		color: var(--ui-color-chatGuild);
	}
	.chat-tone-trade {
		color: var(--ui-color-warning);
	}
	.chat-tone-society {
		color: var(--ui-color-chatSociety);
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
		background: var(--ui-hud-backing);
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
</style>
