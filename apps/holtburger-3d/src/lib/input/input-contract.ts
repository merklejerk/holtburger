/** A keyboard binding uses browser key names; modifiers are optional constraints. */
export interface KeyBinding {
	/** Case-insensitive browser key value, including a literal space for the space bar. */
	readonly key: string;
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
	| "preciseJump"
	| "cancel"
	| "enterWorld"
	| "chat"
	| "chatPreviousPage"
	| "chatNextPage";

/** Viewport gestures with configurable activation buttons. */
type ViewportPointerAction =
	| "clientInteract"
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
	/** Browser pointer buttons assigned to each viewport gesture. */
	readonly pointer: Readonly<Record<ViewportPointerAction, readonly number[]>>;
}
