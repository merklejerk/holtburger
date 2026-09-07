/** Real-browser style evidence; no theme defaults are duplicated by this diagnostic. */
export async function probeUiTheme(client, evaluateExpression, saveScreenshot) {
	const read = (fn, ...args) =>
		evaluateExpression(
			client,
			`(${fn.toString()})(...${JSON.stringify(args)})`,
		);
	const capture = async () =>
		(
			await client.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: false,
			})
		).data;
	const configure = async (
		background,
		opaqueOverride = false,
		alternate = false,
	) => {
		await read(
			async (configuration) => {
				await window.__UI_THEME_SPECIMEN__.configure(configuration);
				await new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				);
				// Capture settled appearance, not a partially completed palette transition.
				for (const animation of document.getAnimations())
					if (animation instanceof CSSTransition) animation.finish();
			},
			{ background, opaqueOverride, alternate },
		);
	};
	const application = await read(() =>
		window.__UI_THEME_SPECIMEN__.verifyApplication(),
	);

	await client.send("DOM.enable");
	await client.send("CSS.enable");
	const { root } = await client.send("DOM.getDocument");
	const force = async (selector, forcedPseudoClasses) => {
		const { nodeId } = await client.send("DOM.querySelector", {
			nodeId: root.nodeId,
			selector,
		});
		if (!nodeId) throw new Error(`Missing theme specimen control: ${selector}`);
		await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses });
	};
	const controlColors = await (async () => {
		await read(() => {
			const fixture = document.createElement("div");
			fixture.id = "theme-token-probe";
			fixture.className = "ui-theme";
			fixture.style.cssText =
				"position:fixed;left:-2000px;top:0;--ui-color-text:rgb(11,22,33);--ui-color-control:rgb(22,33,44);--ui-color-accent:rgb(33,44,55);--ui-color-border:rgb(44,55,66);--ui-color-well:rgb(55,66,77);--ui-button-background-color:initial;--ui-button-border-color:initial;--ui-input-background:initial";
			fixture.innerHTML = `<button id="token-button" class="ui-button">Button</button>
				<button id="token-toggle" class="ui-button" aria-pressed="true">Toggle</button>
				<button id="token-tab" class="ui-tab" aria-selected="true">Tab</button>
				<div id="token-option" class="ui-option" aria-selected="true">Option</div>
				<button id="token-hud" class="ui-hud-button">HUD icon</button>
				<div class="shortcut-dock"><button id="token-dock" class="ui-hud-button" aria-pressed="true">Open panel</button></div>
				<input id="token-input" class="ui-input" placeholder="Placeholder">
				<div id="token-panel" class="ui-panel">Panel</div>`;
			for (const control of fixture.querySelectorAll("*"))
				control.style.transition = "none";
			document.body.append(fixture);
		});
		const expect = async (checks) =>
			read((checks) => {
				for (const [selector, property, expected, pseudo] of checks) {
					const actual = getComputedStyle(
						document.querySelector(selector),
						pseudo,
					).getPropertyValue(
						property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
					);
					if (actual !== expected)
						throw new Error(
							`${selector}${pseudo || ""} ${property}: expected ${expected}, got ${actual}`,
						);
				}
			}, checks);
		try {
			await expect([
				["#token-button", "color", "rgb(11, 22, 33)"],
				["#token-button", "backgroundColor", "rgb(22, 33, 44)"],
				["#token-hud", "color", "rgb(11, 22, 33)"],
				["#token-panel", "borderTopColor", "rgb(44, 55, 66)"],
				["#token-input", "backgroundColor", "rgb(55, 66, 77)"],
			]);
			await read(() => {
				const style = document.createElement("style");
				// These are actual author-facing selectors, not a parallel state-token API.
				style.textContent = `@layer overrides {
					#theme-token-probe :is(.ui-button, .ui-tab) { color: rgb(12,23,34); --ui-button-background-color: rgb(23,34,45); }
					#theme-token-probe :is(.ui-button, .ui-tab):where([aria-pressed="true"], [aria-selected="true"]) { --ui-button-background-color: rgb(45,56,67); }
					#theme-token-probe :is(.ui-button, .ui-tab):where(:hover:not(:disabled)) { --ui-button-background-color: rgb(56,67,78); }
					#theme-token-probe :is(.ui-button, .ui-tab):where(:active:not(:disabled)) { --ui-button-background-color: rgb(67,78,89); }
					#theme-token-probe :is(.ui-button, .ui-tab):where(:disabled) { --ui-button-background-color: rgb(78,89,90); }
					#theme-token-probe .ui-option { --ui-option-background: rgb(89,90,101); }
					#theme-token-probe .ui-hud-button { color: rgb(90,101,112); --ui-hud-button-background: rgb(101,112,123); }
					#theme-token-probe .shortcut-dock .ui-hud-button[aria-pressed="true"] { color: rgb(112,123,134); --ui-hud-button-background: rgb(123,134,145); --ui-hud-button-indicator-color: transparent; }
					#theme-token-probe .shortcut-dock .ui-hud-button:hover:not(:disabled) { color: rgb(134,145,156); --ui-hud-button-background: rgb(145,156,167); }
					#theme-token-probe .shortcut-dock .ui-hud-button:active:not(:disabled) { --ui-hud-button-background: rgb(156,167,178); }
					#theme-token-probe .shortcut-dock .ui-hud-button:disabled { color: rgb(167,178,189); }
					#theme-token-probe .ui-input { color: rgb(178,189,190); --ui-input-background: rgb(189,190,201); }
					#theme-token-probe .ui-input::placeholder { color: rgb(190,201,212); }
					#theme-token-probe .ui-input[aria-invalid="true"] { --ui-input-border-color: rgb(201,212,223); }
					#theme-token-probe .ui-panel { --ui-panel-background: rgb(212,223,234); --ui-surface-shadow: none; }
				}`;
				document.querySelector("#theme-token-probe").append(style);
			});
			await expect([
				["#token-button", "color", "rgb(12, 23, 34)"],
				["#token-button", "backgroundColor", "rgb(23, 34, 45)"],
				["#token-toggle", "backgroundColor", "rgb(45, 56, 67)"],
				["#token-tab", "backgroundColor", "rgb(45, 56, 67)"],
				["#token-option", "backgroundColor", "rgb(89, 90, 101)"],
				["#token-hud", "backgroundColor", "rgb(101, 112, 123)", "::before"],
				["#token-dock", "color", "rgb(112, 123, 134)"],
				["#token-dock", "backgroundColor", "rgba(0, 0, 0, 0)"],
				["#token-dock", "backgroundColor", "rgb(123, 134, 145)", "::before"],
				["#token-input", "color", "rgb(178, 189, 190)"],
				["#token-input", "backgroundColor", "rgb(189, 190, 201)"],
				["#token-input", "color", "rgb(190, 201, 212)", "::placeholder"],
				["#token-panel", "backgroundColor", "rgb(212, 223, 234)"],
				["#token-panel", "boxShadow", "none"],
			]);
			await force("#token-toggle", ["hover"]);
			await force("#token-dock", ["hover"]);
			await expect([
				["#token-toggle", "backgroundColor", "rgb(56, 67, 78)"],
				["#token-dock", "color", "rgb(134, 145, 156)"],
				["#token-dock", "backgroundColor", "rgb(145, 156, 167)", "::before"],
			]);
			await force("#token-toggle", ["hover", "active"]);
			await force("#token-dock", ["hover", "active"]);
			await expect([
				["#token-toggle", "backgroundColor", "rgb(67, 78, 89)"],
				["#token-dock", "backgroundColor", "rgb(156, 167, 178)", "::before"],
			]);
			await read(() => {
				document.querySelector("#token-toggle").disabled = true;
				document.querySelector("#token-dock").disabled = true;
				document
					.querySelector("#token-input")
					.setAttribute("aria-invalid", "true");
			});
			await expect([
				["#token-toggle", "--ui-button-background-color", "rgb(78,89,90)"],
				["#token-dock", "color", "rgb(167, 178, 189)"],
				["#token-input", "borderTopColor", "rgb(201, 212, 223)"],
			]);
			return {
				scopedPalette: true,
				stateSelectors: true,
				independentControls: true,
				inputSelectors: true,
				backgroundValues: true,
			};
		} finally {
			await read(() => document.querySelector("#theme-token-probe").remove());
		}
	})();

	const backdrop = await read(() => {
		const root = document.documentElement;
		const before = root.style.cssText;
		const panel = document.querySelector(".ui-panel");
		const readout = document.querySelector(".ui-readout");
		const hudGroup = document.querySelector(".ui-hud-group");
		const meter = document.querySelector(".ui-meter");
		const chat = document.querySelector(".chat-lines");
		if (!panel || !readout || !hudGroup || !meter || !chat)
			throw new Error("Missing backdrop specimen surfaces.");
		const nested = document.createElement("span");
		nested.className = "ui-readout";
		chat.append(nested);
		const hudFilters = () => [
			getComputedStyle(readout, "::before").backdropFilter,
			getComputedStyle(hudGroup, "::before").backdropFilter,
			getComputedStyle(meter).backdropFilter,
			getComputedStyle(chat).backdropFilter,
		];
		try {
			root.style.setProperty("--ui-backdrop-filter", "blur(3px)");
			if (
				getComputedStyle(panel).backdropFilter !== "blur(3px)" ||
				hudFilters().some((value) => value !== "blur(3px)")
			)
				throw new Error(
					"Shared backdrop did not reach panels and HUD backings.",
				);
			const style = document.createElement("style");
			style.id = "hud-filter-probe";
			style.textContent =
				"@layer overrides { .ui-theme :is(.ui-readout, .ui-hud-group, .ui-hud-button, .ui-hud-surface, .ui-meter) { --ui-backdrop-filter: blur(7px); } }";
			document.head.append(style);
			if (
				getComputedStyle(panel).backdropFilter !== "blur(3px)" ||
				hudFilters().some((value) => value !== "blur(7px)")
			)
				throw new Error("HUD-only backdrop override did not stay HUD-local.");
			if (getComputedStyle(nested, "::before").backdropFilter !== "none")
				throw new Error("Nested HUD decoration compounded filtering.");
			return { shared: true, hudOverride: true, nested: true };
		} finally {
			root.style.cssText = before;
			document.querySelector("#hud-filter-probe")?.remove();
			nested.remove();
		}
	});
	// Simultaneous state sheet uses actual recipe pseudo-selectors, not lookalike specimen classes.
	await force("[data-hover]", ["hover"]);
	await force("[data-pressed]", ["active"]);
	await force("[data-focus]", ["focus-visible"]);
	const contrast = {};
	const motion = await read(async () => {
		const api = window.__HOLTBURGER_3D_BROWSER_HARNESS__;
		const initial = api.state();
		const canvas = document.querySelector("canvas");
		const camera = initial.camera;
		if (camera === null)
			throw new Error("The theme motion specimen requires a realized camera.");
		for (let step = 1; step <= 30; step++) {
			api.setOutdoorCamera(
				camera.landblockId,
				camera.position,
				camera.yawDegrees + step / 2,
				camera.pitchDegrees,
			);
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		const final = api.state();
		if (
			final.frames <= initial.frames ||
			document.querySelector("canvas") !== canvas
		)
			throw new Error(
				"World presentation did not survive the moving theme specimen.",
			);
		return {
			camera,
			framesBefore: initial.frames,
			framesAfter: final.frames,
			finalYaw: final.camera.yawDegrees,
		};
	});
	await saveScreenshot("world-motion", await capture());
	await read((camera) => {
		window.__HOLTBURGER_3D_BROWSER_HARNESS__.setOutdoorCamera(
			camera.landblockId,
			camera.position,
			camera.yawDegrees,
			camera.pitchDegrees,
		);
	}, motion.camera);
	for (const [name, background, opaqueOverride, alternate] of [
		["world", "world", false, false],
		["bright", "bright", false, false],
		["dark", "dark", false, false],
		["opaque", "bright", true, false],
		["steel", "world", false, true],
	]) {
		await configure(background, opaqueOverride, alternate);
		await saveScreenshot(name, await capture());
		const samples = await read(() => {
			const texts = [...document.querySelectorAll("[data-contrast]")].map(
				(element) => {
					// Sample behind the text, excluding decorative borders and rounded corners.
					const range = document.createRange();
					range.selectNodeContents(element);
					const box = range.getBoundingClientRect(),
						style = getComputedStyle(element);
					return {
						role: element.dataset.contrast,
						color: style.color,
						left: box.left,
						top: box.top,
						width: box.width,
						height: box.height,
					};
				},
			);
			const element = document.querySelector("[data-normal]");
			const box = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			const boundary = {
				color: style.borderLeftColor,
				left: box.left,
				top: box.top,
				height: box.height,
			};
			const focused = document.querySelector("[data-focus]");
			const focusBox = focused.getBoundingClientRect();
			const focusStyle = getComputedStyle(focused);
			const focus = {
				color: focusStyle.outlineColor,
				width: Number.parseFloat(focusStyle.outlineWidth),
				offset: Number.parseFloat(focusStyle.outlineOffset),
				left: focusBox.left,
				top: focusBox.top,
				height: focusBox.height,
			};
			// Remove glyphs only for the backing capture. Materials, shadows, and layout are unchanged.
			for (const element of document.querySelectorAll("[data-contrast]")) {
				element.style.setProperty("transition", "none", "important");
				element.style.setProperty("color", "transparent", "important");
			}
			return { texts, boundary, focus, scale: devicePixelRatio };
		});
		const backing = await capture();
		await saveScreenshot(`${name}-backing`, backing);
		await read(() => {
			for (const element of document.querySelectorAll("[data-contrast]")) {
				element.style.removeProperty("color");
				// Flush the restored color before reenabling transitions.
				getComputedStyle(element).getPropertyValue("color");
				element.style.removeProperty("transition");
			}
		});
		contrast[name] = await read(
			async (png, samples) => {
				const image = new Image();
				image.src = `data:image/png;base64,${png}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.width;
				canvas.height = image.height;
				const context = canvas.getContext("2d");
				context.drawImage(image, 0, 0);
				const pixels = context.getImageData(
					0,
					0,
					image.width,
					image.height,
				).data;
				const rgb = (css) =>
					css
						.match(/[\d.]+/g)
						.slice(0, 3)
						.map(Number);
				const luminance = (color) =>
					color
						.map((channel) => {
							const value = channel / 255;
							return value <= 0.04045
								? value / 12.92
								: ((value + 0.055) / 1.055) ** 2.4;
						})
						.reduce(
							(sum, channel, index) =>
								sum + channel * [0.2126, 0.7152, 0.0722][index],
							0,
						);
				const ratio = (a, b) => {
					const light = luminance(a),
						dark = luminance(b);
					return (
						(Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
					);
				};
				const pixel = (x, y) => {
					const offset =
						(Math.floor(y * samples.scale) * canvas.width +
							Math.floor(x * samples.scale)) *
						4;
					return Array.from(pixels.slice(offset, offset + 3));
				};
				const result = {};
				for (const sample of samples.texts) {
					const ratios = [];
					for (
						let y = sample.top + 4;
						y < Math.min(innerHeight, sample.top + sample.height - 3);
						y += 4
					)
						for (
							let x = sample.left + 4;
							x < Math.min(innerWidth, sample.left + sample.width - 3);
							x += 4
						) {
							if (
								document
									.elementFromPoint(x, y)
									?.closest("[data-contrast]")
									?.getAttribute("data-contrast") !== sample.role
							)
								continue;
							ratios.push(ratio(rgb(sample.color), pixel(x, y)));
						}
					if (!ratios.length)
						throw new Error(`Contrast sample is not visible: ${sample.role}`);
					result[sample.role] = Math.min(...ratios);
				}
				const edge = samples.boundary,
					y = edge.top + edge.height / 2;
				result["control boundary"] = Math.min(
					ratio(rgb(edge.color), pixel(edge.left + 5, y)),
					ratio(rgb(edge.color), pixel(edge.left - 2, y)),
				);
				const ring = samples.focus,
					ringY = ring.top + ring.height / 2;
				result["focus ring"] = Math.min(
					ratio(
						rgb(ring.color),
						pixel(ring.left - ring.offset - ring.width - 1, ringY),
					),
					ratio(
						rgb(ring.color),
						pixel(ring.left - Math.max(1, Math.floor(ring.offset / 2)), ringY),
					),
				);
				return result;
			},
			backing,
			samples,
		);
		for (const [role, ratio] of Object.entries(contrast[name])) {
			const target =
				role === "control boundary" || role === "focus ring" ? 3 : 4.5;
			if (!(ratio >= target))
				throw new Error(
					`${name}: ${role} contrast ${ratio.toFixed(2)} < ${target}; samples=${JSON.stringify(samples)}`,
				);
		}
	}
	await configure("world");
	// Native focus and pointer dispatch exercise the DOM; forced states above only stage the sheet.
	await force("[data-focus]", []);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	const focus = await read(() => {
		const element = document.activeElement,
			style = getComputedStyle(element);
		return {
			visible: element.matches(":focus-visible"),
			width: style.outlineWidth,
			style: style.outlineStyle,
		};
	});
	if (!focus.visible || focus.width !== "2px" || focus.style !== "solid")
		throw new Error("Native keyboard focus did not expose the theme ring.");
	const point = (selector) =>
		read((selector) => {
			const element = document.querySelector(selector);
			element.scrollIntoView({ block: "nearest", inline: "nearest" });
			const box = element.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		}, selector);
	const click = async (selector) => {
		const at = await point(selector);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			clickCount: 1,
			...at,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			...at,
		});
	};
	await click("[data-send]");
	const sent = await read(() =>
		document
			.querySelector(".chat-lines")
			.textContent.includes("Another round?"),
	);
	if (!sent)
		throw new Error(
			"The themed chat submit control did not receive its native click.",
		);
	const before = await point("[data-overlap] .ui-frame");
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...before,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		buttons: 1,
		x: before.x - 40,
		y: before.y - 30,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		x: before.x - 40,
		y: before.y - 30,
	});
	const after = await point("[data-overlap] .ui-frame");
	if (
		Math.abs(after.x - before.x + 40) > 1 ||
		Math.abs(after.y - before.y + 30) > 1
	)
		throw new Error("Frame decoration interfered with window dragging.");
	const overlap = await read(() => {
		const button = document.querySelector("[data-overlap-button]"),
			box = button.getBoundingClientRect();
		return button.contains(
			document.elementFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2,
			),
		);
	});
	if (!overlap)
		throw new Error(
			"An overlapping panel intercepted the front window's control.",
		);
	const resizeBefore = await read(() => {
		const box = document
			.querySelector("[data-overlap]")
			.getBoundingClientRect();
		const handle = document
			.querySelector("[data-resize]")
			.getBoundingClientRect();
		return {
			x: handle.left + handle.width / 2,
			y: handle.top + handle.height / 2,
			width: box.width,
			height: box.height,
		};
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		x: resizeBefore.x,
		y: resizeBefore.y,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		buttons: 1,
		x: resizeBefore.x + 30,
		y: resizeBefore.y + 20,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		x: resizeBefore.x + 30,
		y: resizeBefore.y + 20,
	});
	const resizeAfter = await read(() => {
		const box = document
			.querySelector("[data-overlap]")
			.getBoundingClientRect();
		return { width: box.width, height: box.height };
	});
	if (
		resizeAfter.width <= resizeBefore.width ||
		resizeAfter.height <= resizeBefore.height
	)
		throw new Error(
			`The panel specimen's pointer resize handle did not resize its window: ${JSON.stringify({ resizeBefore, resizeAfter })}`,
		);
	await force("[data-resize]", ["focus-visible"]);
	const focusContainment = await read(() => {
		const handle = document.querySelector("[data-resize]");
		const box = handle.getBoundingClientRect();
		const windowBox = document
			.querySelector("[data-overlap]")
			.getBoundingClientRect();
		const style = getComputedStyle(handle);
		const ring =
			parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
		return (
			box.right + ring < windowBox.right && box.bottom + ring < windowBox.bottom
		);
	});
	if (!focusContainment)
		throw new Error("The resizable panel clips its handle's focus ring.");
	await force("[data-resize]", []);
	await client.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	const transition = await read(
		() =>
			getComputedStyle(document.querySelector("[data-normal]"))
				.transitionDuration,
	);
	if (transition !== "0s")
		throw new Error("Reduced motion did not disable control transitions.");
	await configure("world", true);
	const opaque = await read(
		() => getComputedStyle(document.querySelector(".ui-panel")).backdropFilter,
	);
	if (opaque !== "none")
		throw new Error("Opaque override retained a backdrop filter.");
	await configure("world");
	const fallback = await read(() => {
		// Exercise the real baseline declarations by removing only the feature-supported enhancement.
		const removed = [];
		const containers = [];
		const visit = (sheet) => {
			containers.push(sheet);
			for (const rule of sheet.cssRules)
				if (rule instanceof CSSLayerBlockRule) visit(rule);
		};
		for (const sheet of document.styleSheets) visit(sheet);
		for (const sheet of containers) {
			for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
				const rule = sheet.cssRules[i];
				if (
					rule instanceof CSSSupportsRule &&
					rule.conditionText.includes("backdrop-filter")
				) {
					removed.push({ sheet, index: i, text: rule.cssText });
					sheet.deleteRule(i);
				}
			}
		}
		if (!removed.length)
			throw new Error("No backdrop enhancement found to exercise fallback.");
		const style = getComputedStyle(document.querySelector(".ui-panel"));
		const result = {
			filter: style.backdropFilter,
			background: style.backgroundColor,
		};
		window.__UI_THEME_RESTORE_FALLBACK__ = () => {
			for (const { sheet, index, text } of removed.reverse())
				sheet.insertRule(text, index);
			delete window.__UI_THEME_RESTORE_FALLBACK__;
		};
		return result;
	});
	await saveScreenshot("fallback", await capture());
	await read(() => window.__UI_THEME_RESTORE_FALLBACK__());
	if (fallback.filter !== "none" || fallback.background.startsWith("rgba"))
		throw new Error(
			"Unsupported-filter baseline is not opaque and unfiltered.",
		);
	await force("[data-focus]", ["focus-visible"]);
	await configure("world");
	return {
		evidence: {
			application,
			backdrop,
			controlColors,
			motion,
			contrast,
			focus,
			focusContainment,
			sent,
			drag: { before, after },
			resize: { before: resizeBefore, after: resizeAfter },
			overlap,
			opaque,
			transition,
			fallback,
		},
	};
}
