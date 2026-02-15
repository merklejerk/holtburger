use crate::world::entity::Entity;
use crate::world::stats::{Resistances, Vital};
use crate::world::WorldEvent;
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::{CharacterEntry, GameMessage, ViewContentsItem};
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Clone, Copy, Eq)]
pub enum ErrorSource {
    Wire,
    State,
    Client,
}

#[derive(Debug, PartialEq, Clone, Copy, Eq)]
pub enum ErrorKind {
    Weenie,
    Character,
    Client,
    Transport,
}

#[derive(Debug, PartialEq, Clone)]
pub enum ClientState {
    Connected,
    CharacterSelection(Vec<CharacterEntry>),
    EnteringWorld,
    InWorld,
    Disconnected,
}

#[derive(Debug, Clone)]
pub enum ClientEvent {
    CharacterList(Vec<CharacterEntry>),
    PlayerEntered {
        guid: Guid,
        name: String,
    },
    StatusUpdate {
        state: ClientState,
    },
    ServerMessage(String),
    CharacterError(CharacterError),
    ClientError(String),
    WeenieError {
        error_id: u32,
        message: Option<String>,
    },
    InventoryServerSaveFailed {
        item_guid: Guid,
        error: holtburger_protocol::errors::WeenieError,
    },
    BootAccount(String),
    World(Box<WorldEvent>),
    GameMessage(Box<GameMessage>),
    Chat {
        sender: String,
        message: String,
    },
    Emote {
        sender: String,
        text: String,
    },
    PingResponse,
    ViewContents {
        container: Guid,
        items: Vec<ViewContentsItem>,
    },
    RawMessage(Vec<u8>),
    LogMessage(String),
    UseDone {
        error_id: u32,
    },
    ResourcesResolved(Vec<ResolvedResource>),
}

#[derive(Debug, Clone)]
pub struct ResolvedSpellSummary {
    pub spell_id: u32,
    pub name: Option<String>,
    pub school: Option<u32>,
    pub icon: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum ClientViewEvent {
    StatusUpdate {
        state: ClientState,
    },
    PlayerStatsSkillsUpdated {
        attributes: HashMap<crate::world::stats::AttributeType, crate::world::stats::Attribute>,
        skills: HashMap<crate::world::stats::SkillType, crate::world::stats::Skill>,
        resistances: Resistances,
        armor: i32,
        vitae: f32,
        level_info: crate::world::stats::CharacterLevelInfo,
    },
    PlayerVitalUpdated {
        vital: Vital,
    },
    PlayerSpellsUpdated {
        spell_ids: Vec<u32>,
        resolved: Vec<ResolvedSpellSummary>,
    },
    PlayerEnchantmentsUpdated {
        enchantments: Vec<Enchantment>,
        resolved_names: HashMap<u32, String>,
    },
    ErrorRaised {
        source: ErrorSource,
        kind: ErrorKind,
        code: Option<u32>,
        message: String,
        is_transient: bool,
    },
    EntityUpserted {
        entity: Box<Entity>,
    },
    EntityRemoved {
        guid: Guid,
    },
}

#[derive(Debug, Clone)]
pub enum ResourceDescriptor {
    Spell(u32),
}

#[derive(Debug, Clone)]
pub enum ResolvedResource {
    Spell {
        spell_id: u32,
        info: Box<holtburger_dat::file_type::spell_table::SpellBase>,
    },
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    Login(String),
    SelectCharacter(Guid),
    SelectCharacterByIndex(usize),
    EnterWorld,
    Talk(String),
    Tell {
        target: String,
        message: String,
    },
    Ping,
    Identify(Guid),
    Use(Guid),
    Drop(Guid),
    Get(Guid),
    MoveItem {
        item: Guid,
        container: Guid,
        placement: u32,
    },
    GetAndWield {
        item: Guid,
        equip_mask: u32,
    },
    SplitToWield {
        item: Guid,
        equip_mask: u32,
        amount: u32,
    },
    Jump {
        extent: f32,
        velocity: Vector3,
    },
    SetState(u32),
    TurnTo {
        heading: f32,
    },
    MoveTo {
        target: Guid,
    },
    RaiseAttribute {
        attribute: crate::world::stats::AttributeType,
        xp_spent: u32,
    },
    RaiseVital {
        vital: crate::world::stats::VitalType,
        xp_spent: u32,
    },
    RaiseSkill {
        skill: crate::world::stats::SkillType,
        xp_spent: u32,
    },
    TrainSkill {
        skill: crate::world::stats::SkillType,
        credits: u32,
    },
    GiveObjectRequest {
        target: Guid,
        item: Guid,
        amount: i32,
    },
    UseWithTarget {
        item: Guid,
        target: Guid,
    },
    CastTargetedSpell {
        target: Guid,
        spell_id: u32,
    },
    CastUntargetedSpell {
        spell_id: u32,
    },
    ResolveResources(Vec<ResourceDescriptor>),
    SetCombatMode(holtburger_protocol::messages::combat::CombatMode),
    SetNoClip(bool),
    CancelAttack,
    SyncPosition,
    Quit,
}

#[derive(Debug, Clone)]
pub struct RetryState {
    pub active: bool,
    pub next_time: Option<Instant>,
    pub backoff_secs: u64,
    pub attempts: u32,
    pub max_attempts: u32,
}

impl RetryState {
    pub fn new(max_attempts: u32) -> Self {
        Self {
            active: false,
            next_time: None,
            backoff_secs: 5,
            attempts: 0,
            max_attempts,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.next_time = None;
        self.attempts = 0;
        self.backoff_secs = 5;
    }

    pub fn schedule(&mut self) {
        if !self.active {
            self.active = true;
            self.attempts = 0;
            self.backoff_secs = 5;
            self.next_time = Some(Instant::now() + Duration::from_secs(self.backoff_secs));
        }
    }

    pub fn tick(&mut self, now: Instant) -> bool {
        if self.active && self.next_time.is_some_and(|t| now >= t) {
            if self.attempts >= self.max_attempts {
                self.active = false;
                self.next_time = None;
                false
            } else {
                self.attempts += 1;
                self.backoff_secs = std::cmp::min(self.backoff_secs * 2, 300);
                self.next_time = Some(now + Duration::from_secs(self.backoff_secs));
                true
            }
        } else {
            false
        }
    }
}
