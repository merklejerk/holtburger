/** A binding selects either a layout-resolved key or a physical code, plus modifier constraints. */
export type KeyBinding = KeyModifiers &
	(
		| {
				/** Case-insensitive layout-resolved key, including a literal space. */
				readonly key: string;
				/** Key and code selectors are mutually exclusive. */
				readonly code?: never;
		  }
		| {
				/** Exact physical code, unaffected by Shift or keyboard layout. */
				readonly code: string;
				/** Key and code selectors are mutually exclusive. */
				readonly key?: never;
		  }
	);

/** Optional exact modifier constraints; omitted modifiers permit either state. */
interface KeyModifiers {
	/** When supplied, require this Shift state; omission permits either state. */
	readonly shift?: boolean;
	/** Optional exact Control constraint. */
	readonly ctrl?: boolean;
	/** Optional exact Alt constraint. */
	readonly alt?: boolean;
	/** Optional exact Meta constraint. */
	readonly meta?: boolean;
}

/** Serializable action bindings, suitable for supplying resolved installation preferences. */
export type InputBindings<Action extends string> = Readonly<
	Record<Action, readonly KeyBinding[]>
>;

/** Browser facts needed by the resolver; DOM ownership remains with the mounted frontend. */
export interface InputKeyEvent {
	/** Layout-resolved browser key name. */
	readonly key: string;
	/** Physical identity, when the browser or event source supplies it. */
	readonly code?: string;
	/** Current Shift state for chord matching. */
	readonly shiftKey: boolean;
	/** Current Control state; absent on modifier-free synthetic events. */
	readonly ctrlKey?: boolean;
	/** Current Alt state; absent on modifier-free synthetic events. */
	readonly altKey?: boolean;
	/** Current Meta state; absent on modifier-free synthetic events. */
	readonly metaKey?: boolean;
	/** Browser auto-repeat, absent on synthetic one-shot events. */
	readonly repeat?: boolean;
}

/** Character intent shared by client play and Explorer possession. */
export type CharacterAction =
	| "forward"
	| "backward"
	| "turnLeft"
	| "turnRight"
	| "strafeLeft"
	| "strafeRight"
	| "walk"
	| "jump";

/** Explorer camera intent, independent of keyboard layout. */
export type FlyAction =
	| Exclude<CharacterAction, "jump" | "walk">
	| "ascend"
	| "descend"
	| "precision";

/** Client commands whose bindings are resolved by their active UI owner. */
type ClientShortcut =
	| "selectSelf"
	| "nextCreature"
	| "previousCreature"
	| "nextNonCreature"
	| "previousNonCreature"
	| "interact"
	| "examine"
	| "give"
	| "toggleCombat"
	| "toggleAutoRun"
	| "preciseJump"
	| "cancel"
	| "enterWorld"
	| "chat"
	| "chatPreviousPage"
	| "chatNextPage";

/** Viewport gestures with configurable activation buttons. */
type ViewportPointerAction =
	| "clientInteract"
	| "clientExamine"
	| "preciseJumpActivate"
	| "possessionOrbit"
	| "flyRotate"
	| "flyPan";

/** Complete resolved input policy, independent of the selected defaults or their consumers. */
export interface InputConfiguration {
	/** Shared grounded controls for client play and Explorer possession. */
	readonly character: InputBindings<CharacterAction>;
	/** Explorer free and physical camera controls. */
	readonly fly: InputBindings<FlyAction>;
	/** Client and chat shortcuts, interpreted within their UI context. */
	readonly client: InputBindings<ClientShortcut>;
	/** Numbered bar/cell bindings and their scoped navigation and modifier policy. */
	readonly actionBars: ActionBarInputConfiguration;
	/** Gameplay-only spell shortcuts; focused UI scopes retain priority. */
	readonly spellBar: {
		readonly tabs: NumberedInputBindings;
		readonly cells: NumberedInputBindings;
	};
	/** Five attack-power/accuracy breakpoints interpreted while melee or missile combat is active. */
	readonly combatBar: {
		readonly breakpoints: CombatBreakpointInputBindings;
		/** Top-to-bottom attack-height choices interpreted in the same combat scope. */
		readonly heights: CombatHeightInputBindings;
	};
	/** Browser pointer buttons assigned to each viewport gesture. */
	readonly pointer: Readonly<Record<ViewportPointerAction, readonly number[]>>;
}

/** Zero-based positions of the ten numbered bars and cells. */
export type InputDigitIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** Zero-based positions of the five combat breakpoints bound to keys 1–5. */
export type CombatBreakpointIndex = 0 | 1 | 2 | 3 | 4;
/** Zero-based top-to-bottom positions of the three physical attack heights. */
export type CombatHeightIndex = 0 | 1 | 2;
/** Each numbered position accepts any number of alternative bindings, including none. */
type NumberedInputBindings = Readonly<
	Record<InputDigitIndex, readonly KeyBinding[]>
>;
type CombatBreakpointInputBindings = Readonly<
	Record<CombatBreakpointIndex, readonly KeyBinding[]>
>;
type CombatHeightInputBindings = Readonly<
	Record<CombatHeightIndex, readonly KeyBinding[]>
>;
/** Spatial intent independent of the physical navigation keys. */
export type ActionBarDirection = "up" | "down" | "left" | "right";
/** Bindings interpreted only by a focused action bar, except focus acquisition. */
interface ActionBarInputConfiguration {
	/** Position order is 1–9, then 0; these acquire the bar's keyboard scope. */
	readonly focus: NumberedInputBindings;
	/** Position order is 1–9, then 0; these immediately activate a cell. */
	readonly cells: NumberedInputBindings;
	/** Navigation, execution, and dismissal within the focused bar. */
	readonly commands: InputBindings<ActionBarDirection | "confirm" | "cancel">;
	/** Held modifier selecting the alternate equipment side for both keys and clicks. */
	readonly alternate: "shift" | "ctrl" | "alt" | "meta";
}
