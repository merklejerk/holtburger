import assert from "node:assert/strict";

/** Exercise real gameplay drawing and shutdown without unrelated roster/UI acceptance checks. */
export async function probeClientPresentationLifetime(
	client,
	evaluate,
	consoleMessages,
) {
	const read = (expression) => evaluate(client, expression);
	const api = "globalThis.__HOLTBURGER_CLIENT_PRESENTATION__";
	const proof = "globalThis.__HOLTBURGER_LIFETIME_PROOF__";
	const wait = async (expression) => {
		const deadline = Date.now() + 90_000;
		while (!(await read(expression))) {
			const errors = consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			);
			if (errors.length) throw new Error(JSON.stringify(errors));
			if (Date.now() >= deadline)
				throw new Error(`Lifetime probe timeout: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};
	await wait(
		`${api}?.read().gates.connection.waiting > 0 && ${api}.read().gates.scene.waiting > 0`,
	);
	await read(`${api}.releaseConnection(); ${api}.releaseScene()`);
	await wait(
		"[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Enter World' && !b.disabled)",
	);
	await read(
		"[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Enter World').click()",
	);
	await wait(
		`${api}.read().portalReveals === 1 && document.querySelector('.client-world') !== null`,
	);
	// Fault injection stays in the diagnostic browser: no extra production hooks or contracts.
	await read(`(async () => {
		const { ClientGameplayPresentation } = await import('/src/client/client-gameplay-presentation.ts');
		const { PossessionCameraController } = await import('/src/lib/game/camera/possession-camera-controller.ts');
		const { GamePresentationRuntime } = await import('/src/lib/game/runtime/game-presentation-runtime.ts');
		const { DynamicEntitySystem } = await import('/src/lib/game/systems/dynamic-entity-system.ts');
		const { ClientRestPostureController } = await import('/src/client/client-rest-posture-controller.ts');
		const { ClientEntitySelection } = await import('/src/client/client-entity-selection.ts');
		const native = {
			frame: ClientGameplayPresentation.prototype.frame,
			camera: PossessionCameraController.prototype.presentation,
			view: GamePresentationRuntime.prototype.setPrimaryView,
			dynamics: DynamicEntitySystem.prototype.destroy,
			posture: ClientRestPostureController.prototype.destroy,
			selection: ClientEntitySelection.prototype.destroy,
		};
		const state = { held: true, lastFrame: null, joined: false, dynamics: 0, selectionRetirements: 0 };
		let runtime = null;
		ClientGameplayPresentation.prototype.frame = function(timeMs) {
			return state.lastFrame = native.frame.call(this, timeMs);
		};
		PossessionCameraController.prototype.presentation = function(timeMs) {
			const camera = native.camera.call(this, timeMs);
			if (!state.held || camera === null) return camera;
			return { ...camera, placement: { ...camera.placement,
				residency: { ...camera.placement.residency, envCellId: '0x00000100' } } };
		};
		GamePresentationRuntime.prototype.setPrimaryView = function(view) {
			runtime = this;
			return native.view.call(this, view);
		};
		DynamicEntitySystem.prototype.destroy = function() {
			state.dynamics++;
			return native.dynamics.call(this);
		};
		ClientRestPostureController.prototype.destroy = function() {
			native.posture.call(this);
			throw new Error('Lifetime fixture: posture cleanup failed.');
		};
		ClientEntitySelection.prototype.destroy = function() {
			state.selectionRetirements++;
			return native.selection.call(this);
		};
		globalThis.__HOLTBURGER_LIFETIME_PROOF__ = {
			read: () => ({ ...state }),
			release: () => { state.held = false; },
			joinShutdown: async () => {
				if (runtime === null) throw new Error('Lifetime fixture did not capture the runtime.');
				const first = runtime.destroy();
				state.joined = first === runtime.destroy();
				await first;
			},
			restore: () => {
				ClientGameplayPresentation.prototype.frame = native.frame;
				PossessionCameraController.prototype.presentation = native.camera;
				GamePresentationRuntime.prototype.setPrimaryView = native.view;
				DynamicEntitySystem.prototype.destroy = native.dynamics;
				ClientRestPostureController.prototype.destroy = native.posture;
				ClientEntitySelection.prototype.destroy = native.selection;
			},
		};
	})()`);
	let evidence;
	try {
		await wait(
			`${proof}.read().lastFrame?.status.kind === 'loading-activation'`,
		);
		assert.equal((await read(`${proof}.read()`)).lastFrame.rendered, false);
		const heldDraws = (await read(`${api}.read()`)).worldDraws;
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		assert.equal((await read(`${api}.read()`)).worldDraws, heldDraws);
		await read(`${proof}.release()`);
		await wait(
			`${proof}.read().lastFrame?.status.kind === 'ready' && ${api}.read().worldDraws > ${heldDraws}`,
		);
		await read(`${api}.beginClose()`);
		await wait(`${api}.read().closeResult !== null`);
		const closeResult = (await read(`${api}.read()`)).closeResult;
		assert.equal(closeResult.kind, "failed");
		assert.match(
			closeResult.diagnostic,
			/Lifetime fixture: posture cleanup failed/,
		);
		assert.equal((await read(`${proof}.read()`)).selectionRetirements, 1);
		await read(`${proof}.joinShutdown()`);
		const closed = await read(`${proof}.read()`);
		assert.equal(closed.joined, true);
		assert.equal(closed.dynamics, 1);
		evidence = {
			cameraWaited: true,
			drawingResumed: true,
			joinedShutdown: true,
			dynamicsRetired: true,
			controllerFailureReported: true,
			selectionRetiredAfterControllerFailure: true,
		};
	} finally {
		await read(`${proof}.restore(); delete ${proof}`);
	}
	// Content admission can fail before ClientApp exists; exercise the actual startup shell.
	const origin = await read("location.origin");
	const startupFailure = "Lifetime fixture: content admission failed.";
	await client.send("Page.enable");
	await client.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `
		window.holtburgerClient = { quit: async () => {}, onPrepareClose: () => () => {} };
		window.holtburgerLauncher = { enabled: false };
		window.holtburgerContent = {
			snapshot: async () => ({ revision: 0, temporary: false, phase: { kind: 'fatal', message: ${JSON.stringify(startupFailure)} } }),
			choose: async () => {}, retry: async () => {}, quit: async () => {}, listen: () => () => {},
		};
	`,
	});
	const loaded = new Promise((resolve) =>
		client.on("Page.loadEventFired", resolve),
	);
	await client.send("Page.navigate", { url: `${origin}/client/index.html` });
	await loaded;
	await wait(
		`document.querySelector('.startup-overlay [role="alert"]')?.textContent === 'Application startup failed.' && document.querySelector('.startup-overlay .loading-details pre')?.textContent.includes(${JSON.stringify(startupFailure)})`,
	);
	return { ...evidence, startupFailurePresented: true };
}
