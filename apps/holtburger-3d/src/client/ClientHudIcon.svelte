<script lang="ts">
	import EmotesIcon from "../assets/icons/hud-emotes.svg?component";
	import BuffedIcon from "../assets/icons/hud-buffed.svg?component";
	import DebuffedIcon from "../assets/icons/hud-debuffed.svg?component";
	import EncumberedIcon from "../assets/icons/hud-encumbered.svg?component";
	import SickIcon from "../assets/icons/hud-sick.svg?component";
	import CombatIcon from "../assets/icons/hud-combat.svg?component";
	import InventoryIcon from "../assets/icons/hud-inventory.svg?component";
	import TrainingIcon from "../assets/icons/hud-training.svg?component";
	import SpellsIcon from "../assets/icons/hud-spells.svg?component";
	import PartyIcon from "../assets/icons/hud-party.svg?component";
	import WorldIcon from "../assets/icons/hud-world.svg?component";
	import JournalIcon from "../assets/icons/hud-journal.svg?component";
	import SettingsIcon from "../assets/icons/hud-settings.svg?component";
	import DebugIcon from "../assets/icons/hud-debug.svg?component";
	import SpeechIcon from "../assets/icons/hud-speech.svg?component";
	import TellIcon from "../assets/icons/hud-tell.svg?component";
	import PreciseJumpIcon from "../assets/icons/hud-precise-jump.svg?component";
	import InteractIcon from "../assets/icons/hud-interact.svg?component";
	import SplitIcon from "../assets/icons/hud-split.svg?component";
	import ExamineIcon from "../assets/icons/hud-examine.svg?component";
	import HelmetIcon from "../assets/icons/helmet.svg?component";
	import CloakIcon from "../assets/icons/hud-cloak.svg?component";
	import SaveLoadoutIcon from "../assets/icons/hud-save-loadout.svg?component";
	import SelectTextIcon from "../assets/icons/hud-select-text.svg?component";
	import AddIcon from "../assets/icons/hud-add.svg?component";
	import EditIcon from "../assets/icons/hud-edit.svg?component";
	import EyeIcon from "../assets/icons/hud-eye.svg?component";
	import NearbyIcon from "../assets/icons/hud-nearby.svg?component";
	import BellIcon from "../assets/icons/hud-bell.svg?component";
	import BellActiveIcon from "../assets/icons/hud-bell-active.svg?component";
	import TeleportIcon from "../assets/icons/hud-teleport.svg?component";
	import ResetIcon from "../assets/icons/hud-reset.svg?component";
	import LockedIcon from "../assets/icons/hud-locked.svg?component";
	import UnlockedIcon from "../assets/icons/hud-unlocked.svg?component";
	import LeaderIcon from "../assets/icons/hud-leader.svg?component";
	import RemoveIcon from "../assets/icons/hud-remove.svg?component";
	import TradeIcon from "../assets/icons/hud-trade.svg?component";
	import InviteIcon from "../assets/icons/hud-invite.svg?component";
	import OnlineIcon from "../assets/icons/hud-online.svg?component";
	import OfflineIcon from "../assets/icons/hud-offline.svg?component";
	export type ClientHudIconName =
		| "emotes"
		| "buffed"
		| "debuffed"
		| "encumbered"
		| "sick"
		| "inventory"
		| "combat"
		| "training"
		| "spells"
		| "party"
		| "world"
		| "journal"
		| "settings"
		| "debug"
		| "speech"
		/** Envelope identifies a private tell destination. */
		| "tell"
		| "precise-jump"
		| "interact"
		| "trade"
		| "invite"
		/** Filled presence dot for an online character. */
		| "online"
		/** Hollow presence dot for an offline character. */
		| "offline"
		| "split"
		| "examine"
		| "helmet"
		| "cloak"
		| "save-loadout"
		/** Pointer over text for enabling chat-history selection. */
		| "select-text"
		| "add"
		/** Pencil for editing an existing entry. */
		| "edit"
		/** Eye for opening map visibility controls. */
		| "eye"
		/** Radar sweep and blips for the nearby entity catalog. */
		| "nearby"
		/** Outlined bell for an inactive exact-name alert. */
		| "bell"
		/** Filled bell for an enabled exact-name alert. */
		| "bell-active"
		/** Portal and arrow for standard recall actions. */
		| "teleport"
		| "reset"
		| "locked"
		| "unlocked"
		/** Crown for granting party leadership. */
		| "leader"
		/** Cross for removing a member. */
		| "remove";

	interface Props {
		readonly name: ClientHudIconName;
	}

	const { name }: Props = $props();
	const icons = {
		emotes: EmotesIcon,
		buffed: BuffedIcon,
		debuffed: DebuffedIcon,
		encumbered: EncumberedIcon,
		sick: SickIcon,
		combat: CombatIcon,
		inventory: InventoryIcon,
		training: TrainingIcon,
		spells: SpellsIcon,
		party: PartyIcon,
		world: WorldIcon,
		journal: JournalIcon,
		settings: SettingsIcon,
		debug: DebugIcon,
		speech: SpeechIcon,
		tell: TellIcon,
		"precise-jump": PreciseJumpIcon,
		interact: InteractIcon,
		trade: TradeIcon,
		invite: InviteIcon,
		online: OnlineIcon,
		offline: OfflineIcon,
		split: SplitIcon,
		examine: ExamineIcon,
		helmet: HelmetIcon,
		cloak: CloakIcon,
		"save-loadout": SaveLoadoutIcon,
		"select-text": SelectTextIcon,
		add: AddIcon,
		edit: EditIcon,
		eye: EyeIcon,
		nearby: NearbyIcon,
		bell: BellIcon,
		"bell-active": BellActiveIcon,
		reset: ResetIcon,
		teleport: TeleportIcon,
		locked: LockedIcon,
		unlocked: UnlockedIcon,
		leader: LeaderIcon,
		remove: RemoveIcon,
	} satisfies Record<ClientHudIconName, typeof HelmetIcon>;
	const Icon = $derived(icons[name]);
</script>

<Icon />
