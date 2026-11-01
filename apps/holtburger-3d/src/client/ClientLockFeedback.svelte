<script lang="ts">
	import { onMount } from "svelte";
	import artwork from "../assets/icons/lock-feedback.svg?raw";
	import type { ClientLockFeedbackFrame } from "./client-lock-feedback";

	interface Props {
		/** Frame-current positions stay imperative, outside Svelte's reactive graph. */
		readonly readFrames: () => readonly ClientLockFeedbackFrame[];
	}
	let { readFrames }: Props = $props();
	let root: HTMLDivElement;

	onMount(() => {
		const template = document.createElement("template");
		template.innerHTML = artwork;
		const markers = new Map<
			number,
			{ node: HTMLDivElement; revision: number }
		>();
		let handle = 0;
		const update = (): void => {
			const frames = readFrames();
			const visible = new Set<number>();
			for (const frame of frames) {
				visible.add(frame.target);
				let marker = markers.get(frame.target);
				if (marker?.revision !== frame.revision) {
					// Replace the animated child to restart even consecutive identical failures.
					marker?.node.remove();
					const node = document.createElement("div");
					node.className = "lock-feedback-marker";
					node.dataset.outcome = frame.outcome;
					const icon = document.createElement("div");
					icon.className = "lock-feedback-icon";
					icon.style.setProperty("--lock-lifetime", `${frame.lifetimeMs}ms`);
					icon.style.setProperty("--lock-age", `${-frame.elapsedMs}ms`);
					icon.append(template.content.cloneNode(true));
					node.append(icon);
					root.append(node);
					marker = { node, revision: frame.revision };
					markers.set(frame.target, marker);
				}
				marker.node.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0)`;
			}
			for (const [target, marker] of markers) {
				if (visible.has(target)) continue;
				marker.node.remove();
				markers.delete(target);
			}
			handle = requestAnimationFrame(update);
		};
		handle = requestAnimationFrame(update);
		return () => {
			cancelAnimationFrame(handle);
			markers.clear();
			root.replaceChildren();
		};
	});
</script>

<div bind:this={root} class="lock-feedback" aria-hidden="true"></div>

<style>
	@layer components {
		.lock-feedback {
			position: absolute;
			inset: 0;
			pointer-events: none;
			overflow: hidden;
			z-index: 3;
		}
		.lock-feedback :global(.lock-feedback-marker) {
			position: absolute;
			top: 0;
			left: 0;
			width: 0;
			height: 0;
		}
		.lock-feedback :global(.lock-feedback-icon) {
			width: var(--ui-lock-feedback-size);
			height: var(--ui-lock-feedback-size);
			margin-left: calc(var(--ui-lock-feedback-size) / -2);
			margin-top: calc(var(--ui-lock-feedback-size) / -2);
			color: var(--ui-lock-feedback-failure-color);
			animation: lock-failure var(--lock-lifetime) var(--lock-age) both;
		}
		.lock-feedback :global(svg) {
			stroke-width: var(--ui-lock-feedback-stroke-width);
			width: 100%;
			height: 100%;
		}
		.lock-feedback :global([data-outcome="unlocked"] .lock-feedback-icon) {
			color: var(--ui-lock-feedback-success-color);
			filter: drop-shadow(
				0 0 var(--ui-lock-feedback-glow-blur) var(--ui-lock-feedback-glow)
			);
			animation-name: lock-success;
		}
		.lock-feedback :global([data-outcome="unlocked"] .lock-feedback-shackle) {
			transform-origin: 34px 23px;
			animation: lock-open var(--lock-lifetime) var(--lock-age) both;
		}
		@keyframes lock-failure {
			0% {
				opacity: 1;
				transform: translateX(0);
			}
			12%,
			36% {
				transform: translateX(calc(-1 * var(--ui-lock-feedback-shake-travel)))
					rotate(calc(-1 * var(--ui-lock-feedback-shake-angle)));
			}
			24%,
			48% {
				transform: translateX(var(--ui-lock-feedback-shake-travel))
					rotate(var(--ui-lock-feedback-shake-angle));
			}
			60% {
				opacity: 1;
				transform: translateX(0);
			}
			100% {
				opacity: 0;
				transform: translateX(0);
			}
		}
		@keyframes lock-success {
			0% {
				opacity: 1;
				transform: scale(calc(2 - var(--ui-lock-feedback-pop-scale)));
			}
			22% {
				transform: translateY(calc(-1 * var(--ui-lock-feedback-pop-rise)))
					scale(var(--ui-lock-feedback-pop-scale));
			}
			40% {
				opacity: 1;
				transform: translateY(calc(var(--ui-lock-feedback-pop-rise) / -2))
					scale(1);
			}
			100% {
				opacity: 0;
				transform: translateY(calc(-1 * var(--ui-lock-feedback-rise))) scale(1);
			}
		}
		@keyframes lock-open {
			0% {
				transform: rotate(0);
			}
			25%,
			100% {
				transform: rotate(var(--ui-lock-feedback-open-angle));
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.lock-feedback :global([data-outcome] .lock-feedback-icon) {
				animation-name: lock-fade;
			}
			.lock-feedback :global([data-outcome="unlocked"] .lock-feedback-shackle) {
				animation: none;
				transform: rotate(var(--ui-lock-feedback-open-angle));
			}
		}
		@keyframes lock-fade {
			0%,
			65% {
				opacity: 1;
			}
			100% {
				opacity: 0;
			}
		}
	}
</style>
