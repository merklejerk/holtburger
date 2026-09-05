import { getContext, setContext } from "svelte";
import { ViewportInputGate } from "./viewport-input-gate";

/** Svelte ownership key; each mounted app provides its own independent gate. */
const VIEWPORT_INPUT = Symbol("viewport-input");

/** Install the viewport gate at the app composition root. */
export function provideViewportInputGate(): ViewportInputGate {
	return setContext(VIEWPORT_INPUT, new ViewportInputGate());
}

/** UI descendants participate in the app's gate without passing it through unrelated panels. */
export function useViewportInputGate(): ViewportInputGate {
	const gate = getContext<ViewportInputGate | undefined>(VIEWPORT_INPUT);
	if (gate === undefined)
		throw new Error("Viewport input gate was not provided by the app.");
	return gate;
}
