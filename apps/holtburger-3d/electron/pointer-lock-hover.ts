import type { Event, MouseInputEvent, WebContents } from "electron";
import { z } from "zod";

/** Original widget and screen coordinates used for the unlocked hover restoration event. */
export const pointerPositionSchema = z.object({
	/** Horizontal position inside the renderer widget. */
	x: z.number().int(),
	/** Vertical position inside the renderer widget. */
	y: z.number().int(),
	/** Screen-space horizontal position used by Chromium's movement accounting. */
	globalX: z.number().int(),
	/** Screen-space vertical position used by Chromium's movement accounting. */
	globalY: z.number().int(),
});

/** Original unlocked position captured by the isolated preload before acquiring pointer lock. */
export type PointerPosition = z.infer<typeof pointerPositionSchema>;

/** Native Wayland can retain relative orbit coordinates after unlock, including for later clicks.
 * Restore renderer hover and retain the correct button position until native movement resynchronizes.
 * Chromium 152: WaylandEventSource::SetRelativePointerMotionEnabled clears relative motion without
 * restoring its cursor cache; WaylandWindow::MoveCursorTo is unimplemented.
 */
export class PointerLockHover {
	/** Document-local event injection; no operating-system cursor warping is involved. */
	readonly #contents: Pick<
		WebContents,
		"sendInputEvent" | "isFocused" | "isDestroyed"
	>;
	/** Widget-only click coordinates; screen coordinates must remain native on button edges. */
	#clickPosition: Pick<MouseInputEvent, "x" | "y"> | null = null;
	/** Injected replacements re-enter Electron's interception hook synchronously. */
	#injecting = false;
	/** Physical edges fence a delayed unlock correction from a newly started hold. */
	readonly #buttons = new Set<NonNullable<MouseInputEvent["button"]>>();

	constructor(
		contents: Pick<WebContents, "sendInputEvent" | "isFocused" | "isDestroyed">,
	) {
		this.#contents = contents;
	}

	/** Do not replay a released gesture into a new hold or an unfocused/retired document. */
	restore(position: PointerPosition): void {
		if (
			this.#contents.isDestroyed() ||
			!this.#contents.isFocused() ||
			this.#buttons.size !== 0
		)
			return;
		this.#clickPosition = { x: position.x, y: position.y };
		this.#send({ type: "mouseMove", ...position });
	}

	/** Correct stationary click targeting while retaining the native movement baseline. */
	beforeMouse(
		event: Pick<Event, "preventDefault">,
		input: MouseInputEvent,
	): void {
		if (this.#injecting) return;
		if (input.type === "mouseDown" || input.type === "mouseUp") {
			if (input.button === undefined)
				throw new Error("Native mouse button edges require a button.");
			if (input.type === "mouseDown") this.#buttons.add(input.button);
			else this.#buttons.delete(input.button);
		}
		if (
			input.type === "mouseMove" ||
			input.type === "mouseEnter" ||
			input.type === "mouseLeave"
		) {
			this.#clickPosition = null;
			return;
		}
		if (
			this.#clickPosition === null ||
			(input.type !== "mouseDown" &&
				input.type !== "mouseUp" &&
				input.type !== "contextMenu")
		)
			return;
		event.preventDefault();
		// Blink seeds the next movement delta from the button's screen position. Replacing it
		// with the visible cursor origin makes the next locked move repeat the prior orbit delta.
		// Widget coordinates alone own hit testing; leave native screen coordinates intact.
		this.#send({ ...input, ...this.#clickPosition });
	}

	/** Native listeners outlive renderer documents; neither positions nor held buttons survive focus loss. */
	clear(): void {
		this.#clickPosition = null;
		this.#buttons.clear();
	}

	#send(input: MouseInputEvent): void {
		this.#injecting = true;
		try {
			this.#contents.sendInputEvent(input);
		} finally {
			this.#injecting = false;
		}
	}
}
