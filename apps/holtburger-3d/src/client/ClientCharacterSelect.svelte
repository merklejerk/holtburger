<script lang="ts">
	import { onMount, tick } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { APP_INPUT } from "../lib/input/app-input";
	import type { ClientLifecycleUiState } from "./client-lifecycle-state";

	/** The authority-owned character roster and current frontend selection. */
	type CharacterSelectionState = Extract<
		ClientLifecycleUiState,
		{ readonly kind: "character-selection" }
	>;

	/** Selection remains separate from the explicit world-entry action. */
	interface Props {
		/** Current roster and selection. */
		readonly state: CharacterSelectionState;
		/** Blocks selection and duplicate activation while entry is being requested. */
		readonly entryPending: boolean;
		/** Publish selection without entering the world. */
		readonly onChoose: (guid: number) => void;
		/** Enter the currently selected character. */
		readonly onEnter: () => void | Promise<void>;
		/** Leave character selection and disconnect. */
		readonly onDisconnect: () => void | Promise<void>;
	}

	let { state, entryPending, onChoose, onEnter, onDisconnect }: Props =
		$props();

	const { keyboard } = useAppInputPolicy();
	let listElement: HTMLDivElement;
	onMount(() => keyboard.activate(listElement));

	/** Keystrokes within this interval form a name prefix; repeated letters cycle matches. */
	const TYPEAHEAD_INTERVAL_MS = 500;
	let search = { prefix: "", time: 0 };

	function handleKeydown(event: KeyboardEvent): void {
		// Selection has no game surface to return to; its explicit exit is Disconnect.
		if (APP_INPUT.shortcut("cancel", event)) {
			event.preventDefault();
			return;
		}
		if (
			entryPending ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.isComposing
		)
			return;
		if (APP_INPUT.shortcut("enterWorld", event)) {
			event.preventDefault();
			if (!event.repeat && state.selectedGuid !== null) void onEnter();
			return;
		}
		const list = listElement;
		const options = Array.from(
			list.querySelectorAll<HTMLElement>('[role="option"]'),
		);
		if (options.length === 0) return;
		const current = state.characters.findIndex(
			(character) => character.guid === state.selectedGuid,
		);
		let next: number;
		switch (event.key) {
			case "ArrowDown":
				next = Math.min(current + 1, options.length - 1);
				break;
			case "ArrowUp":
				next = Math.max(current - 1, 0);
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = options.length - 1;
				break;
			case " ":
				event.preventDefault();
				return;
			default: {
				if (event.key.length !== 1) return;
				const time = performance.now();
				const letter = event.key.toLocaleLowerCase();
				const prefix =
					time - search.time < TYPEAHEAD_INTERVAL_MS
						? search.prefix + letter
						: letter;
				search = { prefix, time };
				const match = [...prefix].every((character) => character === letter)
					? letter
					: prefix;
				// A new single-letter search starts after the current row; a longer prefix includes it.
				const start = current + (match.length === 1 ? 1 : 0);
				next = -1;
				for (let offset = 0; offset < options.length; offset++) {
					const index = (Math.max(start, 0) + offset) % options.length;
					if (
						state.characters[index].name.toLocaleLowerCase().startsWith(match)
					) {
						next = index;
						break;
					}
				}
			}
		}
		event.preventDefault();
		const option = options[next];
		if (option) {
			onChoose(state.characters[next].guid);
			option.scrollIntoView({ block: "nearest" });
		}
		if (event.key.length !== 1) search = { prefix: "", time: 0 };
	}

	async function enterCharacter(guid: number): Promise<void> {
		if (entryPending) return;
		onChoose(guid);
		// Publish the clicked row to the parent before invoking its selected-character action.
		await tick();
		if (!entryPending) await onEnter();
	}
</script>

<h1>Choose a character</h1>
<p class="client-status">
	Select a character, then explicitly enter the world.
</p>

<div
	class="client-character-list"
	role="listbox"
	aria-label="Characters"
	aria-activedescendant={state.selectedGuid === null
		? undefined
		: `client-character-${state.selectedGuid}`}
	aria-disabled={entryPending}
	tabindex="-1"
	bind:this={listElement}
	use:keyboard.scope={{
		keydown: handleKeydown,
		cancel: () => {
			search = { prefix: "", time: 0 };
		},
	}}
>
	{#each state.characters as character (character.guid)}
		<button
			type="button"
			tabindex="-1"
			id={`client-character-${character.guid}`}
			class="client-character ui-option"
			role="option"
			aria-selected={state.selectedGuid === character.guid}
			disabled={entryPending}
			onclick={() => {
				if (!entryPending) {
					onChoose(character.guid);
					keyboard.activate(listElement);
				}
			}}
			ondblclick={() => void enterCharacter(character.guid)}
		>
			<strong>{character.name}</strong>
			<span>Slot {character.slot + 1}</span>
		</button>
	{/each}
</div>

<div class="client-actions">
	<button
		class="client-action ui-button"
		disabled={state.selectedGuid === null || entryPending}
		onclick={() => void onEnter()}
	>
		{entryPending ? "Entering…" : "Enter World"}
	</button>
	<button
		class="client-action ui-button"
		disabled={entryPending}
		onclick={() => void onDisconnect()}
	>
		Disconnect
	</button>
</div>

<style>
	@layer components {
		.client-status {
			margin: 0;
			color: var(--ui-color-muted);
			line-height: 1.45;
		}
		.client-character-list {
			display: grid;
			gap: 0;
			max-height: min(45vh, 360px);
			overflow-y: auto;
			padding: 6px;
		}
		.client-character {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 14px;
			min-height: 32px;
			padding: 4px 8px;
			text-align: left;
			font: inherit;
			border: 0;
			border-bottom: 1px solid
				var(--ui-option-border-color, var(--ui-color-border));
			cursor: pointer;
			user-select: none;
		}
		.client-character:disabled {
			cursor: not-allowed;
		}
		.client-character span {
			color: var(--ui-color-muted);
		}
		.client-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.client-action {
			min-width: 120px;
		}
	}
</style>
