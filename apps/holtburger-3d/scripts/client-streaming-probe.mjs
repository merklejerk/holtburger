import { writeFile } from "node:fs/promises";

/**
 * Repeated live movement across one outdoor boundary. Teleports only establish the start pose;
 * their portal-loading frames are excluded. All instrumentation lives in the disposable page.
 * Window endpoints expose uncaptured leading/trailing time; consumers must check coverage and
 * workload parity before comparing trials. Success proves the route, not a performance budget.
 */
export async function runClientStreamingProbe(client, helpers, options) {
	const { evaluate, submitChat, waitForReady, pageState } = helpers;
	await evaluate(
		client,
		`async () => {
		const { GamePresentationRuntime } = await import('/src/lib/game/runtime/game-presentation-runtime.ts');
		const state = { runtime: null, active: false, frames: [], interest: [], tickMs: 0, lastRenderAt: null, startedAt: null };
		window.__holtburgerStreamingProbe = state;
		const prototype = GamePresentationRuntime.prototype;
		const tick = prototype.tick;
		prototype.tick = function(...args) {
			state.runtime = this;
			if (!state.active) return tick.apply(this, args);
			const start = performance.now();
			const result = tick.apply(this, args);
			state.tickMs = performance.now() - start;
			return result;
		};
		const render = prototype.render;
		prototype.render = function(...args) {
			if (!state.active) return render.apply(this, args);
			const start = performance.now();
			const result = render.apply(this, args);
			const renderMs = performance.now() - start;
			state.frames.push({ at: start, tickMs: state.tickMs, renderMs,
				workMs: state.tickMs + renderMs,
				gapMs: state.lastRenderAt === null ? null : start - state.lastRenderAt });
			state.lastRenderAt = start;
			return result;
		};
		const interest = prototype.updateSceneInterest;
		prototype.updateSceneInterest = function(request) {
			if (state.active) state.interest.push({ at: performance.now(), target: request.target });
			return interest.call(this, request);
		};
	}`,
	);
	const trials = [];
	try {
		for (let trial = 0; trial < options.trials; trial += 1) {
			const previous = await pageState(client);
			await submitChat(client, options.startCommand);
			const ready = await waitForReady(
				client,
				options.timeoutMs,
				"streaming start",
				false,
				previous.camera?.cameraGeneration ?? null,
			);
			if (!ready.ready)
				throw new Error("Streaming start teleport did not settle.");
			await delay(options.settleMs);
			await evaluate(
				client,
				`() => {
			const canvas = document.querySelector('canvas');
			if (!canvas) throw new Error('Client canvas is unavailable.');
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			canvas.focus();
		}`,
			);
			const before = await snapshot(client, evaluate);
			const start = before.client.diagnostics.playerResidency;
			if (
				start?.landblockId !== options.startLandblock ||
				start.envCellId !== null
			)
				throw new Error(
					"Streaming start did not reach the expected outdoor landblock.",
				);
			if (options.profile) {
				await evaluate(
					client,
					`() => window.__holtburgerClientPerformance.setRendererProfilingEnabled(true)`,
				);
				await client.send("Profiler.enable");
				await client.send("Profiler.setSamplingInterval", { interval: 100 });
				await client.send("Profiler.start");
			}
			await evaluate(
				client,
				`() => {
			window.__holtburgerClientPerformance.reset();
			const state = window.__holtburgerStreamingProbe;
			state.frames = []; state.interest = []; state.lastRenderAt = null; state.tickMs = 0;
			state.startedAt = performance.now();
			state.active = true;
		}`,
			);
			try {
				await client.send("Input.dispatchKeyEvent", {
					type: "keyDown",
					key: "w",
					code: "KeyW",
					windowsVirtualKeyCode: 87,
				});
				await delay(options.moveMs);
			} finally {
				await client.send("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: "w",
					code: "KeyW",
					windowsVirtualKeyCode: 87,
				});
			}
			await delay(options.drainMs);
			const measured = await evaluate(
				client,
				`() => {
			const state = window.__holtburgerStreamingProbe;
			const endedAt = performance.now();
			state.active = false;
			return { window: { startedAt: state.startedAt, endedAt }, frames: state.frames, interest: state.interest,
				performance: window.__holtburgerClientPerformance.snapshot() };
		}`,
			);
			if (options.profile) {
				const { profile } = await client.send("Profiler.stop");
				await writeFile(
					`${options.outputPrefix}-${trial}.cpuprofile`,
					JSON.stringify(profile),
				);
				await evaluate(
					client,
					`() => window.__holtburgerClientPerformance.setRendererProfilingEnabled(false)`,
				);
			}
			const after = await snapshot(client, evaluate);
			trials.push({ before, after, ...measured });
			const screenshot = await client.send("Page.captureScreenshot", {
				format: "png",
			});
			await writeFile(
				`${options.outputPrefix}-${trial}.png`,
				Buffer.from(screenshot.data, "base64"),
			);
			if (measured.frames.length === 0)
				throw new Error(
					"Streaming window did not capture any rendered frames.",
				);
			if (after.camera?.cameraGeneration !== before.camera?.cameraGeneration)
				throw new Error("Streaming window crossed a camera discontinuity.");
			const destination = after.client.diagnostics.playerResidency;
			if (
				destination?.landblockId !== options.destination ||
				destination.envCellId !== null
			)
				throw new Error(
					"Movement did not reach the expected outdoor landblock; inspect pose/collision evidence.",
				);
			if (
				!measured.interest.some(
					({ target }) =>
						target.kind === "outdoor" &&
						target.requested.kind === "automatic-landblock" &&
						target.requested.landblockId === options.destination,
				)
			)
				throw new Error(
					"Movement reached the destination without its automatic scene-interest update.",
				);
		}
	} catch (error) {
		// Keep completed measurements reviewable when a later trial or artifact write fails.
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
			options,
			trials,
		};
	}

	return { ok: true, options, trials };
}

async function snapshot(client, evaluate) {
	return evaluate(
		client,
		`() => {
		const runtime = window.__holtburgerStreamingProbe.runtime;
		if (!runtime) throw new Error('Streaming probe has not observed the runtime.');
		return {
			at: performance.now(),
			client: window.__holtburgerClientPerformance.snapshot(),
			camera: window.__holtburgerProbeEvidence.camera,
			staticObjects: runtime.getStaticObjectRuntimeDiagnostics(),
			terrain: runtime.getTerrainWorkerDiagnostics(),
			portal: runtime.getPortalTransitionDiagnostics(),
		};
	}`,
	);
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
