import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import type { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import { UiTooltipController, type UiTooltipDisclosure } from "./ui-tooltip";
import { UI_SCALE_CHANGE_EVENT } from "./ui-scale";

const TARGET = "[data-ui-tooltip]";
// A nested control or explicit native sub-hint owns its own hover interaction.
const HINT_BOUNDARY =
	'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [title]:not([title=""])';
const VIEWPORT_MARGIN = 8;
const TARGET_GAP = 4;

/** One scoped, delegated browser lifetime; cells publish text without owning popup resources. */
export function mountUiTooltip(
	root: HTMLElement,
	surface: HTMLElement,
	keyboard: KeyboardInputPolicy,
): () => void {
	const doc = root.ownerDocument;
	const win = doc.defaultView;
	if (win === null) throw new Error("Tooltips require a browser window.");
	let disposed = false;
	let pressed = false;
	let pointed: HTMLElement | null = null;
	let pointerPosition: { x: number; y: number } | null = null;
	let described: HTMLElement | null = null;
	let observed: HTMLElement | null = null;
	const resolve = (node: EventTarget | null): HTMLElement | null => {
		if (
			!(node instanceof Element) ||
			!root.contains(node) ||
			surface.contains(node)
		)
			return null;
		for (
			let element: Element | null = node;
			element !== null && root.contains(element);
			element = element.parentElement
		) {
			if (element instanceof HTMLElement && element.matches(TARGET))
				return element;
			if (element.matches(HINT_BOUNDARY)) return null;
		}
		return null;
	};
	const eligible = (target: HTMLElement): boolean => {
		if (
			!root.contains(target) ||
			!target.isConnected ||
			!target.dataset.uiTooltip ||
			target.closest("[hidden], [inert]") ||
			!target.checkVisibility({
				visibilityProperty: true,
				opacityProperty: true,
			})
		)
			return false;
		const modal = keyboard.activeModal;
		if (modal !== null && !modal.contains(target)) return false;
		if (
			pointed === target &&
			pointerPosition !== null &&
			resolve(doc.activeElement) !== target
		) {
			const hit = doc.elementFromPoint(pointerPosition.x, pointerPosition.y);
			if (hit === null || (!target.contains(hit) && !surface.contains(hit)))
				return false;
		}
		return true;
	};
	const position = () => {
		const target = controller.visible;
		if (target === null) return;
		const rect = target.getBoundingClientRect();
		// The surface can move into a modal with a different inherited zoom.
		// Match the anchor's effective scale once; browser bounds remain screen pixels.
		const scale = target.currentCSSZoom;
		const parent = surface.parentElement;
		if (parent === null) throw new Error("Tooltip surface has no parent.");
		surface.style.zoom = String(scale / parent.currentCSSZoom);
		surface.style.setProperty("--ui-scale", String(scale));
		const { width, height } = surface.getBoundingClientRect();
		const top =
			rect.bottom + TARGET_GAP + height <= win.innerHeight - VIEWPORT_MARGIN
				? rect.bottom + TARGET_GAP
				: rect.top - TARGET_GAP - height;
		surface.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, win.innerWidth - width - VIEWPORT_MARGIN)) / scale}px`;
		surface.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, win.innerHeight - height - VIEWPORT_MARGIN)) / scale}px`;
	};
	const removeDescription = () => {
		if (described === null) return;
		const ids = (described.getAttribute("aria-describedby") ?? "")
			.split(/\s+/)
			.filter((id) => id && id !== surface.id);
		if (ids.length > 0)
			described.setAttribute("aria-describedby", ids.join(" "));
		else described.removeAttribute("aria-describedby");
		described = null;
	};
	const updateText = () => {
		const target = controller.visible;
		if (target === null) return;
		const text = target.dataset.uiTooltip;
		if (text === undefined)
			throw new Error("Visible tooltip lost its owning label.");
		if (surface.textContent !== text) surface.textContent = text;
		position();
	};
	const reconcileMutations = (records: MutationRecord[]) => {
		if (records.every((record) => surface.contains(record.target))) return;
		const newDialog = records.some(
			(record) =>
				record.type === "childList" &&
				Array.from(record.addedNodes).some(
					(node) =>
						node instanceof Element &&
						(node.matches("dialog[open]") ||
							node.querySelector("dialog[open]") !== null),
				),
		);
		if (newDialog) reset();
		else {
			controller.refresh();
			// A retained target can move into a different ancestor without changing identity.
			if (
				observed !== null &&
				records.some(
					(record) =>
						record.type === "childList" &&
						[...record.addedNodes, ...record.removedNodes].some((node) =>
							node.contains(observed),
						),
				)
			)
				observeAncestry(observed);
			updateText();
		}
	};
	const mutations = new MutationObserver(reconcileMutations);
	const ancestry = new MutationObserver(reconcileMutations);
	const resize = new ResizeObserver(position);
	const observeAncestry = (target: HTMLElement | null) => {
		ancestry.disconnect();
		for (
			let ancestor: HTMLElement | null = target;
			ancestor !== null;
			ancestor = ancestor.parentElement
		) {
			// Observe only the engaged ancestry for style changes, not every slot's cooldown animation.
			ancestry.observe(ancestor, {
				childList: true,
				attributes: true,
				attributeFilter: [
					"data-ui-tooltip",
					"hidden",
					"inert",
					"open",
					"class",
					"style",
				],
			});
		}
	};
	const watch = (target: HTMLElement | null) => {
		if (target === observed) return;
		mutations.disconnect();
		resize.disconnect();
		observed = target;
		observeAncestry(target);
		if (target === null) return;
		mutations.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["hidden", "inert", "open"],
		});
		resize.observe(target);
		resize.observe(surface);
	};
	const controller = new UiTooltipController(
		SHARED_FRONTEND_TUNING.tooltips,
		eligible,
		(disclosure: UiTooltipDisclosure<HTMLElement> | null) => {
			const target = disclosure?.kind === "visible" ? disclosure.target : null;
			removeDescription();
			if (surface.isConnected && surface.matches(":popover-open"))
				surface.hidePopover();
			// A top-layer popover outside a native modal still inherits its implicit inertness.
			// Keep one surface, but place it inside the engaged modal before showing it.
			const parent = target === null ? root : (keyboard.activeModal ?? root);
			if (surface.parentElement !== parent) parent.append(surface);
			if (target === null) surface.textContent = "";
			else {
				updateText();
				const ids = new Set(
					(target.getAttribute("aria-describedby") ?? "")
						.split(/\s+/)
						.filter(Boolean),
				);
				ids.add(surface.id);
				target.setAttribute("aria-describedby", [...ids].join(" "));
				described = target;
				surface.showPopover();
				position();
			}
			watch(disclosure === null ? null : disclosure.target);
		},
		() => win.performance.now(),
	);
	const reset = () => {
		pointed = null;
		controller.reset();
	};
	const point = (event: PointerEvent, node: EventTarget | null) => {
		if (event.pointerType === "touch") return;
		pressed = event.buttons !== 0;
		if (pressed || doc.pointerLockElement !== null) return;
		pointerPosition = { x: event.clientX, y: event.clientY };
		pointed = resolve(node);
		controller.hoverSurface(node instanceof Node && surface.contains(node));
		controller.point(pointed);
	};
	const move = (event: PointerEvent) => point(event, event.target);
	const leave = (event: PointerEvent) => point(event, event.relatedTarget);
	const focus = () =>
		queueMicrotask(() => {
			if (disposed || pressed || doc.pointerLockElement !== null) return;
			controller.focus(resolve(doc.activeElement));
		});
	const outsideSurface = (event: Event) =>
		!(event.target instanceof Node && surface.contains(event.target));
	const press = (event: PointerEvent) => {
		if (!outsideSurface(event)) return;
		pressed = true;
		reset();
	};
	const release = (event: PointerEvent) => {
		pressed = event.buttons !== 0;
	};
	const cancel = () => {
		pressed = false;
		reset();
	};
	const interrupt = (event: Event) => {
		if (outsideSurface(event)) reset();
	};
	const toggle = (event: Event) => {
		if (
			event instanceof ToggleEvent &&
			event.newState === "open" &&
			event.target instanceof Element &&
			event.target !== surface &&
			event.target.matches("dialog, [popover]") &&
			event.target.getAttribute("aria-hidden") !== "true"
		)
			reset();
	};
	const visibility = () => {
		if (doc.hidden) cancel();
	};
	const dismiss = keyboard.bindHintDismissal(() => controller.dismiss());
	// Capture sees native disabled-control descendants and never changes event propagation.
	const events = new AbortController();
	const options = { capture: true, signal: events.signal };
	doc.addEventListener("pointerover", move, options);
	doc.addEventListener("pointermove", move, options);
	doc.addEventListener("pointerout", leave, options);
	doc.addEventListener("pointerdown", press, options);
	doc.addEventListener("pointerup", release, options);
	doc.addEventListener("pointercancel", cancel, options);
	doc.addEventListener("lostpointercapture", cancel, options);
	doc.addEventListener("focusin", focus, options);
	doc.addEventListener("focusout", focus, options);
	for (const type of ["click", "auxclick", "contextmenu", "wheel", "scroll"])
		doc.addEventListener(type, interrupt, options);
	// The later toggle event can arrive after focus opened a hint in the new surface.
	doc.addEventListener("beforetoggle", toggle, options);
	doc.addEventListener("pointerlockchange", cancel, options);
	doc.addEventListener("visibilitychange", visibility, options);
	win.addEventListener("blur", cancel, options);
	win.addEventListener("resize", reset, options);
	win.addEventListener(UI_SCALE_CHANGE_EVENT, reset, options);
	return () => {
		disposed = true;
		events.abort();
		dismiss();
		reset();
		mutations.disconnect();
		ancestry.disconnect();
		resize.disconnect();
	};
}
