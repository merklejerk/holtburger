import assert from "node:assert/strict";

/** Native browser selection and pointer clicks through both production inline-link wrappers. */
export async function probeInlineTags(client, evaluateExpression) {
	const evaluate = (expression) => evaluateExpression(client, expression);
	await evaluate(`(async () => {
  const { mountInlineTagFixture } = await import('/src/harness/browser/client-inline-tag-fixture.ts');
  globalThis.__INLINE_TAG_PROBE__ = await mountInlineTagFixture();
 })()`);
	try {
		for (const kind of ["entity", "coordinates"]) {
			const selector = `[data-inline-tag-probe="${kind}"] [role="button"]`;
			const point = await evaluate(`(() => {
    document.getSelection().removeAllRanges();
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing inline link');
    const r = element.getBoundingClientRect();
    return { x: r.left - 10, clickX: r.left + r.width / 2, endX: r.right - 2, y: r.top + r.height / 2 };
   })()`);
			const mouse = (type, x, buttons = 0) =>
				client.send("Input.dispatchMouseEvent", {
					type,
					x,
					y: point.y,
					button: type === "mouseMoved" && buttons === 0 ? "none" : "left",
					buttons,
					clickCount: type === "mouseMoved" ? 0 : 1,
				});
			await mouse("mouseMoved", point.x);
			await mouse("mousePressed", point.x, 1);
			for (let step = 1; step <= 8; step++)
				await mouse(
					"mouseMoved",
					point.x + ((point.endX - point.x) * step) / 8,
					1,
				);
			await mouse("mouseReleased", point.endX);
			const selected = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const selection = document.getSelection();
    return { count: globalThis.__INLINE_TAG_PROBE__.read().${kind}, highlighted: !selection.isCollapsed && selection.containsNode(element, true), text: selection.toString(), hit: document.elementFromPoint(${point.clickX}, ${point.y})?.outerHTML, select: getComputedStyle(element).userSelect, pointer: getComputedStyle(element).pointerEvents };
   })()`);
			assert.equal(
				selected.highlighted,
				true,
				`${kind}: native drag must highlight link text ${JSON.stringify(selected)}`,
			);
			assert.equal(
				selected.count,
				0,
				`${kind}: selecting text must not activate the link`,
			);
			await mouse("mouseMoved", point.clickX);
			await mouse("mousePressed", point.clickX, 1);
			await mouse("mouseReleased", point.clickX);
			assert.equal(
				await evaluate(`globalThis.__INLINE_TAG_PROBE__.read().${kind}`),
				1,
				`${kind}: clicking highlighted text must activate`,
			);
			const keyboard = await evaluate(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const pointer = globalThis.__INLINE_TAG_PROBE__.read().${kind};
    await new Promise(resolve => setTimeout(resolve, 0));
    element.focus();
    selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    return { pointer, keyboard: globalThis.__INLINE_TAG_PROBE__.read().${kind} };
   })()`);
			assert.deepEqual(
				keyboard,
				{ pointer: 2, keyboard: 4 },
				`${kind}: retained highlights must permit fresh clicks and keyboard activation`,
			);
		}
		return {
			nativeSelectionDrag: true,
			highlightedEntityClick: true,
			highlightedCoordinateClick: true,
			keyboard: true,
		};
	} finally {
		await evaluate(
			"(async () => { await globalThis.__INLINE_TAG_PROBE__.cleanup(); delete globalThis.__INLINE_TAG_PROBE__; })()",
		);
	}
}
