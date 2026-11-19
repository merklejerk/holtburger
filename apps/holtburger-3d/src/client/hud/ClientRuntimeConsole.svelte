<script lang="ts">
	import { onMount, tick } from "svelte";
	import { cubicOut } from "svelte/easing";
	import type { TransitionConfig } from "svelte/transition";
	import type { RuntimeLogEntry } from "../../app/runtime-log-contract";
	import { formatError } from "../../lib/format-error";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import { useClientInput } from "../session/input-context";
	import { copyTextSelection } from "./text-selection";

	const {
		onClose,
		onToggle,
	}: {
		onClose: () => void;
		onToggle: () => void;
	} = $props();
	const { keyboard, viewport } = useAppInputPolicy();
	const input = useClientInput();
	let output: HTMLElement;
	let entries = $state.raw<readonly RuntimeLogEntry[]>([]);
	let issue = $state<string | null>(null);
	let copyIssue = $state<string | null>(null);

	/** Slide the whole surface, including its trim, beyond the viewport edge. */
	function drop(element: HTMLElement): TransitionConfig {
		const travel = element.offsetHeight + 16;
		return {
			duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? 0
				: 200,
			easing: cubicOut,
			css: (t) => `transform: translateY(${(t - 1) * travel}px);`,
		};
	}

	onMount(() => {
		const unblock = viewport.block();
		// Escape still dismisses the overlay after a click transfers keyboard focus.
		const escape = keyboard.bindEscapeContext(onClose, { untilRelease: true });
		const selection = copyTextSelection(
			output,
			(message) => (copyIssue = message),
			{ selectAllWithin: true },
		);
		const bridge = window.holtburgerAppDiagnostics;
		let revision = -1;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function refresh(): Promise<void> {
			try {
				if (selection.isSelecting()) return;
				const snapshot = await bridge?.readRuntimeLog(revision);
				if (stopped || selection.isSelecting()) return;
				if (snapshot) {
					const following =
						output.scrollHeight - output.scrollTop - output.clientHeight <= 2;
					revision = snapshot.revision;
					entries = snapshot.entries;
					await tick();
					if (!stopped && following) output.scrollTop = output.scrollHeight;
				}
				issue = null;
			} catch (error) {
				if (!stopped) issue = formatError(error);
			} finally {
				if (!stopped) timer = setTimeout(() => void refresh(), 500);
			}
		}
		keyboard.activate(output);
		if (bridge) void refresh();
		else issue = "Runtime logs are available in the desktop client.";
		return () => {
			stopped = true;
			clearTimeout(timer);
			selection.destroy();
			escape.release();
			unblock();
		};
	});
</script>

<section
	class="runtime-console ui-runtime-console"
	aria-label="Runtime console"
	transition:drop|global
>
	<pre
		bind:this={output}
		tabindex="-1"
		role="log"
		aria-live="off"
		aria-label="Runtime log"
		use:keyboard.scope={{
			pointerActivation: true,
			keydown: (event) => {
				if (event.isComposing) return;
				const close = event.key === "Escape";
				if (!close && !input.shortcut("toggleConsole", event)) return;
				event.preventDefault();
				if (!event.repeat) (close ? onClose : onToggle)();
			},
		}}>{#each entries as { time, level, message, count }, index}{index === 0
				? ""
				: "\n"}<span class="timestamp">[{time}]</span> <span class={level}
				>{level.toUpperCase()}</span
			> {message}{count > 1
				? ` (×${count})`
				: ""}{:else}No warnings or errors.{/each}</pre>
	{#if issue || copyIssue}
		<p role="status">{issue ?? copyIssue}</p>
	{/if}
</section>

<style>
	@layer components {
		.runtime-console {
			position: absolute;
			inset: 0 0 auto;
			z-index: 550;
			height: min(48vh, 32rem);
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			pointer-events: auto;
		}
		pre:focus {
			outline: none;
		}
		pre {
			margin: 0;
			padding: 0.75rem 1rem;
			overflow: auto;
			font: calc(0.875rem * var(--ui-text-scale)) / 1.5 var(--ui-font-mono);
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			overscroll-behavior: contain;
			user-select: text;
		}
		.timestamp {
			color: var(--ui-color-muted);
		}
		.warning {
			color: var(--ui-color-warning);
		}
		.error,
		p {
			color: var(--ui-color-danger);
		}
		pre::selection,
		pre span::selection {
			color: var(--ui-console-selection-text, var(--ui-color-shadow));
			background: var(
				--ui-console-selection-background,
				var(--ui-color-highlight)
			);
		}
		p {
			margin: 0;
			padding: 0.4rem 1rem;
		}
	}
</style>
