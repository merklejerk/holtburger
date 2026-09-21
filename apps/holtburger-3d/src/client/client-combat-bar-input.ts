import type { AppInput } from "../lib/input/app-input";
import type {
	CombatBreakpointIndex,
	CombatHeightIndex,
} from "../lib/input/input-contract";

/** Gameplay dispatch for physical-combat shortcuts after keyboard scope arbitration. */
export function handleCombatBarKeydown(
	input: AppInput,
	event: KeyboardEvent,
	enabled: boolean,
	selectBreakpoint: (index: CombatBreakpointIndex) => void,
	selectHeight: (index: CombatHeightIndex) => void,
): boolean {
	if (!enabled || event.defaultPrevented || event.isComposing) return false;
	const height = input.combatHeight(event);
	const breakpoint = input.combatBreakpoint(event);
	if (height === null && breakpoint === null) return false;
	event.preventDefault();
	if (!event.repeat) {
		if (height !== null) selectHeight(height);
		else if (breakpoint !== null) selectBreakpoint(breakpoint);
	}
	return true;
}
