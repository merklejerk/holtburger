<script lang="ts">
	import { tick } from "svelte";
	import { useClientInput } from "./client-input-context";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import {
		queueSnakeTurn,
		createSnakeGame,
		LOGOPOLIS,
		stepSnake,
		type SnakeDirection,
	} from "./client-logopolis";
	import {
		LOGOPOLIS_SCREEN,
		loadLogopolisSprites,
		renderLogopolis,
		type LogopolisScreenStatus,
	} from "./client-logopolis-renderer";

	/** Canvas lifetime includes asynchronous artwork preparation before input can start. */
	type BoardRenderer =
		| { readonly kind: "loading" }
		| { readonly kind: "ready"; readonly draw: () => void }
		| { readonly kind: "failed"; readonly message: string };

	interface Props {
		/** Hidden retained boards stop simulation and release their keyboard interaction. */
		readonly visible: boolean;
		/** Explicit command launches acquire input and resume, including on first mount. */
		readonly launchRevision: number;
	}
	const { visible, launchRevision }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	let surface = $state<HTMLCanvasElement>();
	let status = $state<LogopolisScreenStatus>("paused");
	let score = $state(0);
	/** Best completed or ongoing run retained for this mounted client session. */
	let bestScore = $state(0);
	// Simulation and queued input stay outside Svelte's UI graph.
	let game = createSnakeGame(Math.random);
	let queuedTurns: readonly SnakeDirection[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let renderer = $state<BoardRenderer>({ kind: "loading" });

	function paint(): void {
		if (renderer.kind === "ready") renderer.draw();
	}

	function pause(): void {
		if (timer !== null) clearInterval(timer);
		timer = null;
		queuedTurns = [];
		if (status === "playing") {
			status = "paused";
			paint();
		}
	}

	function play(): void {
		if (
			!visible ||
			surface === undefined ||
			renderer.kind !== "ready" ||
			!document.hasFocus()
		)
			return;
		keyboard.activate(surface);
		// An existing modal may refuse activation; never run an uncontrollable board.
		if (document.activeElement !== surface) return;
		pause();
		if (game.outcome.kind !== "playing") {
			game = createSnakeGame(Math.random);
			score = game.score;
		}
		status = "playing";
		paint();
		timer = setInterval(() => {
			const [turn, ...remaining] = queuedTurns;
			// stepSnake rechecks against the actual heading, which a portal may have changed.
			game = stepSnake(game, turn ?? game.direction, Math.random);
			queuedTurns = remaining;
			if (score !== game.score) {
				score = game.score;
				bestScore = Math.max(bestScore, score);
			}
			if (game.outcome.kind !== "playing") {
				pause();
				status = game.outcome.kind;
			}
			paint();
		}, LOGOPOLIS.tickMs);
	}

	function keydown(event: KeyboardEvent): void {
		// Let the central policy release this interaction on Escape or activate the configured chat shortcut.
		if (event.key === "Escape" || clientInput.shortcut("chat", event)) return;
		event.preventDefault();
		if (
			event.repeat ||
			status !== "playing" ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey
		)
			return;
		const directions: Readonly<Record<string, SnakeDirection>> = {
			ArrowUp: "up",
			KeyW: "up",
			ArrowRight: "right",
			KeyD: "right",
			ArrowDown: "down",
			KeyS: "down",
			ArrowLeft: "left",
			KeyA: "left",
		};
		const direction = directions[event.code];
		if (direction !== undefined)
			queuedTurns = queueSnakeTurn(queuedTurns, game.direction, direction);
	}

	function board(canvas: HTMLCanvasElement): { destroy: () => void } {
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("Logopolis requires a 2D canvas.");
		let disposed = false;
		const registration = keyboard.scope(canvas, { keydown, cancel: pause });
		void loadLogopolisSprites().then(
			(sprites) => {
				if (disposed) return;
				const draw = () =>
					renderLogopolis(context, sprites, game, bestScore, status);
				renderer = { kind: "ready", draw };
				draw();
			},
			(error: unknown) => {
				if (!disposed)
					renderer = {
						kind: "failed",
						message: error instanceof Error ? error.message : String(error),
					};
			},
		);
		return {
			destroy: () => {
				disposed = true;
				pause();
				registration.destroy();
				renderer = { kind: "loading" };
			},
		};
	}

	$effect(() => {
		const canvas = surface;
		const revision = launchRevision;
		const currentRenderer = renderer;
		if (!visible) {
			pause();
			if (canvas !== undefined && document.activeElement === canvas)
				keyboard.returnToGame();
			return;
		}
		if (
			canvas === undefined ||
			revision === 0 ||
			currentRenderer.kind !== "ready"
		)
			return;
		let cancelled = false;
		// Wait for lazy window content and scope registration; chat cleanup cannot take input back
		// once activation moves DOM focus away from its composer.
		void tick().then(() => {
			if (!cancelled) play();
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="logopolis" data-logopolis-status={status}>
	<div class="logopolis-screen">
		<canvas
			bind:this={surface}
			use:board
			width={LOGOPOLIS_SCREEN.width}
			height={LOGOPOLIS_SCREEN.height}
			tabindex="-1"
			aria-label="Logopolis portal Snake board"
		></canvas>
		<dl class="sr-only" aria-label="Scores">
			<div>
				<dt>Score</dt>
				<dd>{score}</dd>
			</div>
			<div>
				<dt>Best</dt>
				<dd>{bestScore}</dd>
			</div>
		</dl>
		{#if renderer.kind === "failed"}
			<p class="arcade-message" role="alert">{renderer.message}</p>
		{:else if renderer.kind === "loading"}
			<span class="arcade-message" role="status">Loading</span>
		{:else if status !== "playing"}
			<span class="sr-only" role="status"
				>{status === "paused"
					? "Paused"
					: status === "won"
						? "Board clear"
						: "Game over"}</span
			>
			<button class="arcade-action" type="button" onclick={play}
				>{status === "paused" ? "Resume" : "Play again"}</button
			>
		{/if}
	</div>
</div>

<style>
	@layer components {
		.logopolis {
			container-type: size;
			display: grid;
			place-items: center;
			width: 100%;
			height: 100%;
			padding: 8px;
			background: #080909;
			user-select: none;
		}
		.logopolis-screen {
			position: relative;
			isolation: isolate;
			width: min(100cqw, calc(100cqh * 4 / 3));
			aspect-ratio: 4 / 3;
			overflow: hidden;
			border: 2px solid #55594a;
			border-radius: 5% / 6%;
			background: #020302;
			box-shadow:
				0 0 0 3px #111412,
				0 0 8px #000;
		}
		canvas {
			display: block;
			width: 100%;
			height: 100%;
			image-rendering: pixelated;
			outline: none;
		}
		/* Static glass passes cover the entire arcade screen, including its native controls.
		   They never intercept pointers or require an animation loop while paused/hidden. */
		.logopolis-screen::before,
		.logopolis-screen::after {
			content: "";
			position: absolute;
			inset: 0;
			z-index: 2;
			pointer-events: none;
			border-radius: inherit;
		}
		.logopolis-screen::before {
			background:
				repeating-linear-gradient(0deg, #0003 0 1px, transparent 1px 4px),
				repeating-linear-gradient(
					90deg,
					#ff301006 0 1px,
					#30ff4006 1px 2px,
					#3050ff06 2px 3px
				);
		}
		.logopolis-screen::after {
			background:
				radial-gradient(ellipse at center, transparent 52%, #0008 100%),
				linear-gradient(115deg, #fff1, transparent 18%, transparent 92%, #fff1);
			box-shadow:
				inset 0 0 10px #000c,
				inset 0 1px 2px #e4f2bd66;
		}
		.arcade-message {
			position: absolute;
			inset: 35% 8% auto;
			margin: 0;
			color: #fff1b9;
			font-family: Cousine, monospace;
			text-align: center;
		}
		/* This is part of the game's pixel display rather than standard HUD control chrome. */
		.arcade-action {
			position: absolute;
			left: 50%;
			top: 61%;
			transform: translate(-50%, -50%);
			padding: 0.5em 0.8em;
			border: 1px solid #fff1b9;
			border-radius: 0;
			background: #080b06;
			color: #fff1b9;
			font:
				bold clamp(10px, 3cqw, 20px) Cousine,
				monospace;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			text-shadow: 0 0 3px #f2ff9c99;
			cursor: pointer;
		}
		.arcade-action:hover,
		.arcade-action:focus-visible {
			background: #fff1b9;
			color: #080b06;
			outline: 1px solid #fff1b9;
			outline-offset: 3px;
		}
	}
</style>
