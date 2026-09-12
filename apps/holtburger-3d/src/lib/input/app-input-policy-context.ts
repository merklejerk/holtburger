import { getContext, onMount, setContext } from "svelte";
import { KeyboardInputPolicy } from "./keyboard-input-policy";
import { ViewportInputGate } from "./viewport-input-gate";

/** Each mounted app has one keyboard policy and one world-interaction availability gate. */
interface AppInputPolicy {
	/** Explicit UI keyboard ownership and event routing. */
	readonly keyboard: KeyboardInputPolicy;
	/** Scene/modal availability and cancellation of world gestures. */
	readonly viewport: ViewportInputGate;
}

const APP_INPUT_POLICY = Symbol("app-input-policy");

/** Install shared frontend policy once at the app composition root. */
export function provideAppInputPolicy(): AppInputPolicy {
	const viewport = new ViewportInputGate();
	const keyboard = new KeyboardInputPolicy(viewport);
	const policy = setContext(APP_INPUT_POLICY, { viewport, keyboard });
	onMount(() => keyboard.mount(document));
	return policy;
}

/** Descendants declare participation without threading policy through unrelated panels. */
export function useAppInputPolicy(): AppInputPolicy {
	const policy = getContext<AppInputPolicy | undefined>(APP_INPUT_POLICY);
	if (policy === undefined)
		throw new Error("App input policy was not provided.");
	return policy;
}
