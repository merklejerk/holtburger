use std::time::{Duration, Instant};
use crate::protocol::messages::{CharacterEntry, GameMessage, ViewContentsItem};
use crate::world::WorldEvent;

#[derive(Debug, Clone)]
pub enum ChatMessageKind {
    Info,
    System,
    Chat,
    Tell,
    Emote,
    Error,
    Warning,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub kind: ChatMessageKind,
    pub text: String,
}

#[derive(Debug, PartialEq, Clone)]
pub enum ClientState {
    Connected,
    CharacterSelection(Vec<CharacterEntry>),
    EnteringWorld,
    InWorld,
}

#[derive(Debug, Clone)]
pub enum ClientEvent {
    Message(ChatMessage),
    CharacterList(Vec<CharacterEntry>),
    PlayerEntered {
        guid: u32,
        name: String,
    },
    StatusUpdate {
        state: ClientState,
        logon_retry: Option<(u32, u32, Option<Instant>)>,
        enter_retry: Option<(u32, u32, Option<Instant>)>,
    },
    World(Box<WorldEvent>),
    GameMessage(Box<GameMessage>),
    PingResponse,
    ViewContents {
        container: u32,
        items: Vec<ViewContentsItem>,
    },
    RawMessage(Vec<u8>),
    LogMessage(String),
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    SelectCharacter(u32),
    SelectCharacterByIndex(usize),
    Talk(String),
    Ping,
    Identify(u32),
    Use(u32),
    Drop(u32),
    Get(u32),
    MoveItem {
        item: u32,
        container: u32,
        placement: u32,
    },
    Quit,
}

#[derive(Debug, Clone)]
pub(crate) struct RetryState {
    pub(crate) active: bool,
    pub(crate) next_time: Option<Instant>,
    pub(crate) backoff_secs: u64,
    pub(crate) attempts: u32,
    pub(crate) max_attempts: u32,
}

impl RetryState {
    pub(crate) fn new(max_attempts: u32) -> Self {
        Self {
            active: false,
            next_time: None,
            backoff_secs: 5,
            attempts: 0,
            max_attempts,
        }
    }

    pub(crate) fn reset(&mut self) {
        self.active = false;
        self.next_time = None;
        self.attempts = 0;
        self.backoff_secs = 5;
    }

    pub(crate) fn schedule(&mut self) {
        if !self.active {
            self.active = true;
            self.attempts = 0;
            self.backoff_secs = 5;
            self.next_time = Some(Instant::now() + Duration::from_secs(self.backoff_secs));
        }
    }

    pub(crate) fn tick(&mut self, now: Instant) -> bool {
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
