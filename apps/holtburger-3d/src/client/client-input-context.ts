import { getContext, setContext } from "svelte";
import type { AppInput } from "../lib/input/app-input";

const CLIENT_INPUT = Symbol("client-input");

/** Give one mounted client tree the same replaceable input instance. */
export function provideClientInput(input: AppInput): AppInput {
	return setContext(CLIENT_INPUT, input);
}

/** Read the mounted client's input policy without using Explorer's static default. */
export function useClientInput(): AppInput {
	const input = getContext<AppInput | undefined>(CLIENT_INPUT);
	if (input === undefined) throw new Error("Client input was not provided.");
	return input;
}
