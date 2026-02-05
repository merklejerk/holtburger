use crate::protocol::messages::{CharacterEntry, GameMessage, ViewContentsItem};
use crate::world::WorldEvent;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Clone)]
pub enum ClientState {
    Connected,
    CharacterSelection(Vec<CharacterEntry>),
    EnteringWorld,
    InWorld,
}

#[derive(Debug, Clone)]
pub enum ClientEvent {
    CharacterList(Vec<CharacterEntry>),
    PlayerEntered {
        guid: u32,
        name: String,
    },
    StatusUpdate {
        state: ClientState,
    },
    ServerMessage(String),
    CharacterError(u32),
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
        container: u32,
        items: Vec<ViewContentsItem>,
    },
    RawMessage(Vec<u8>),
    LogMessage(String),
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    Login(String),
    SelectCharacter(u32),
    SelectCharacterByIndex(usize),
    EnterWorld,
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
