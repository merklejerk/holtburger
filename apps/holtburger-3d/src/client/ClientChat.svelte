<script lang="ts">
	import { tick } from "svelte";
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
		readonly onFocusChange: (focused: boolean) => void;
		readonly onSend: (message: string) => Promise<void>;
	}

	const { gameCanvas, messages, onFocusChange, onSend }: Props = $props();
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
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				message = "";
				failure = null;
				gameCanvas?.focus();
				return;
			}
			if (event.key === "PageUp" || event.key === "PageDown") {
				event.preventDefault();
				event.stopPropagation();
				bufferElement?.scrollBy({
					top:
						(event.key === "PageUp" ? -1 : 1) *
						(bufferElement.clientHeight * 0.85),
				});
			}
			return;
		}
		if (event.key === "Enter" && document.activeElement === gameCanvas) {
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
		if (wasFocused !== isFocused) onFocusChange(isFocused);
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
				aria-pressed={enabledTags.includes(tag)}
				class:active={enabledTags.includes(tag)}
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
			class="chat-channel"
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
		color: white;
		font: var(--ac-panel-font-size) / 1.25 var(--ac-font-ui);
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
		user-select: none;
	}
	.chat-filters {
		display: flex;
		gap: 2px;
		padding: 0 3px 3px;
		background: rgb(13 15 15 / 0.56);
		pointer-events: auto;
		user-select: auto;
	}
	.chat-filters button {
		min-height: 22px;
		padding: 2px 8px;
		border: 1px solid rgb(230 230 220 / 0.22);
		background: rgb(20 22 21 / 0.44);
		color: rgb(235 238 231 / 0.7);
		font: inherit;
	}
	.chat-filters button:hover,
	.chat-filters button:focus-visible {
		border-color: rgb(239 208 111 / 0.56);
		outline: none;
	}
	.chat-filters button.active {
		border-color: rgb(239 208 111 / 0.7);
		background: rgb(87 67 25 / 0.56);
		color: #f3dc8c;
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
			rgb(12 14 15 / 0.5),
			rgb(12 14 15 / 0.24) 55%,
			transparent
		);
		mask-image: linear-gradient(to bottom, transparent, #000 34%, #000);
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
	}
	.chat-buffer::-webkit-scrollbar {
		width: 5px;
	}
	.chat-buffer::-webkit-scrollbar-track {
		background: transparent;
	}
	.chat-buffer::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background: transparent;
	}
	.chat-focused .chat-buffer {
		background: rgb(12 14 15 / 0.5);
		mask-image: none;
		scrollbar-color: rgb(230 230 220 / 0.24) transparent;
	}
	.chat-focused .chat-buffer::-webkit-scrollbar-thumb {
		background: rgb(230 230 220 / 0.24);
	}
	.chat-focused .chat-buffer::-webkit-scrollbar-thumb:hover {
		background: rgb(239 208 111 / 0.38);
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
		color: rgb(235 238 231 / 0.82);
		font-weight: 700;
	}
	.chat-tone-system {
		color: #9fc9e9;
	}
	.chat-tone-tell {
		color: #f09bea;
	}
	.chat-tone-emote,
	.chat-tone-party {
		color: #cfdcc1;
	}
	.chat-emote {
		font-style: italic;
	}
	.chat-tone-npc {
		color: #f2bd7f;
	}
	.chat-tone-error {
		color: #ff8177;
	}
	.chat-tone-combat {
		color: #ff938b;
	}
	.chat-tone-guild {
		color: #8edbe6;
	}
	.chat-tone-trade {
		color: #f4d878;
	}
	.chat-tone-society {
		color: #8dafff;
	}
	.chat-failure {
		padding: 3px 7px;
		background: rgb(90 20 18 / 0.75);
		color: #ffd9d3;
	}
	form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 28px;
		gap: 3px;
		padding: 3px;
		background: rgb(13 15 15 / 0.56);
		pointer-events: auto;
		user-select: auto;
	}
	input {
		box-sizing: border-box;
		width: 100%;
		height: 25px;
		padding: 2px 6px;
		border: 1px solid rgb(230 230 220 / 0.38);
		background: rgb(8 9 9 / 0.52);
		color: white;
		outline: none;
	}
	input:focus {
		border-color: rgb(239 208 111 / 0.82);
		box-shadow: 0 0 0 1px rgb(239 208 111 / 0.18);
	}
	.chat-channel {
		width: 28px;
		height: 25px;
		min-height: 0;
		padding: 5px;
		border: 1px solid rgb(230 230 220 / 0.3);
		background: rgb(20 22 21 / 0.52);
		color: #eee;
	}
</style>
