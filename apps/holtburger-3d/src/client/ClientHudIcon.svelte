<script lang="ts">
	import BuffedIcon from "../assets/icons/hud-buffed.svg?component";
	import DebuffedIcon from "../assets/icons/hud-debuffed.svg?component";
	import EncumberedIcon from "../assets/icons/hud-encumbered.svg?component";
	import SickIcon from "../assets/icons/hud-sick.svg?component";
	import CombatIcon from "../assets/icons/hud-combat.svg?component";
	import InventoryIcon from "../assets/icons/hud-inventory.svg?component";
	import TrainingIcon from "../assets/icons/hud-training.svg?component";
	import SpellsIcon from "../assets/icons/hud-spells.svg?component";
	import PartyIcon from "../assets/icons/hud-party.svg?component";
	import MapIcon from "../assets/icons/hud-map.svg?component";
	import JournalIcon from "../assets/icons/hud-journal.svg?component";
	import SettingsIcon from "../assets/icons/hud-settings.svg?component";
	import DebugIcon from "../assets/icons/hud-debug.svg?component";
	import SpeechIcon from "../assets/icons/hud-speech.svg?component";
	import PreciseJumpIcon from "../assets/icons/hud-precise-jump.svg?component";
	import InteractIcon from "../assets/icons/hud-interact.svg?component";
	import SplitIcon from "../assets/icons/hud-split.svg?component";
	import ExamineIcon from "../assets/icons/hud-examine.svg?component";
	import HelmetIcon from "../assets/icons/helmet.svg?component";
	import CloakIcon from "../assets/icons/hud-cloak.svg?component";
	import SaveLoadoutIcon from "../assets/icons/hud-save-loadout.svg?component";
	import SelectTextIcon from "../assets/icons/hud-select-text.svg?component";
	import AddIcon from "../assets/icons/hud-add.svg?component";
	import ResetIcon from "../assets/icons/hud-reset.svg?component";
	import LockedIcon from "../assets/icons/hud-locked.svg?component";
	import UnlockedIcon from "../assets/icons/hud-unlocked.svg?component";
	export type ClientHudIconName =
		| "buffed"
		| "debuffed"
		| "encumbered"
		| "sick"
		| "inventory"
		| "combat"
		| "training"
		| "spells"
		| "party"
		| "map"
		| "journal"
		| "settings"
		| "debug"
		| "speech"
		| "precise-jump"
		| "interact"
		| "split"
		| "examine"
		| "helmet"
		| "cloak"
		| "save-loadout"
		/** Pointer over text for enabling chat-history selection. */
		| "select-text"
		| "add"
		| "reset"
		| "locked"
		| "unlocked";

	interface Props {
		readonly name: ClientHudIconName;
	}

	const { name }: Props = $props();
	const icons = {
		buffed: BuffedIcon,
		debuffed: DebuffedIcon,
		encumbered: EncumberedIcon,
		sick: SickIcon,
		combat: CombatIcon,
		inventory: InventoryIcon,
		training: TrainingIcon,
		spells: SpellsIcon,
		party: PartyIcon,
		map: MapIcon,
		journal: JournalIcon,
		settings: SettingsIcon,
		debug: DebugIcon,
		speech: SpeechIcon,
		"precise-jump": PreciseJumpIcon,
		interact: InteractIcon,
		split: SplitIcon,
		examine: ExamineIcon,
		helmet: HelmetIcon,
		cloak: CloakIcon,
		"save-loadout": SaveLoadoutIcon,
		"select-text": SelectTextIcon,
		add: AddIcon,
		reset: ResetIcon,
		locked: LockedIcon,
		unlocked: UnlockedIcon,
	} satisfies Record<ClientHudIconName, typeof HelmetIcon>;
	const Icon = $derived(icons[name]);
</script>

<Icon />
