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
		reducedTransparency = false,
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
			{ background, reducedTransparency, alternate },
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
	for (const [name, background, reduced, alternate] of [
		["world", "world", false, false],
		["bright", "bright", false, false],
		["dark", "dark", false, false],
		["opaque", "bright", true, false],
		["texture-free", "world", false, true],
	]) {
		await configure(background, reduced, alternate);
		await saveScreenshot(name, await capture());
		const samples = await read(() => {
			const texts = [...document.querySelectorAll("[data-contrast]")].map(
				(element) => {
					const box = element.getBoundingClientRect(),
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
			"Overlapping glass intercepted the front window's control.",
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
			`The glass specimen's pointer resize handle did not resize its window: ${JSON.stringify({ resizeBefore, resizeAfter })}`,
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
		throw new Error(
			"The resizable glass surface clips its handle's focus ring.",
		);
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
	const reduced = await read(
		() => getComputedStyle(document.querySelector(".ui-glass")).backdropFilter,
	);
	if (reduced !== "none")
		throw new Error("Reduced transparency retained a backdrop filter.");
	await configure("world");
	const fallback = await read(() => {
		// Exercise the real baseline declarations by removing only the feature-supported enhancement.
		const removed = [];
		for (const sheet of document.styleSheets) {
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
		const style = getComputedStyle(document.querySelector(".ui-glass"));
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
			motion,
			contrast,
			focus,
			focusContainment,
			sent,
			drag: { before, after },
			resize: { before: resizeBefore, after: resizeAfter },
			overlap,
			reduced,
			transition,
			fallback,
		},
	};
}
