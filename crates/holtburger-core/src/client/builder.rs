use crate::session::Session;
use crate::world::WorldState;
use anyhow::Result;
use std::net::SocketAddr;
use std::time::Instant;

use super::{Client, ClientState};

impl Client {
    pub async fn new(
        server_ip: &str,
        server_port: u16,
        account_name: &str,
        character_preference: Option<String>,
        dats_path: std::path::PathBuf,
    ) -> Result<Self> {
        let target = format!("{}:{}", server_ip, server_port).parse::<SocketAddr>()?;
        let session = Session::new(target).await?;
        Self::create_with_session(session, account_name, character_preference, dats_path)
    }

    pub fn new_replay(
        replay_path: &str,
        account_name: &str,
        character_preference: Option<String>,
        dats_path: std::path::PathBuf,
    ) -> Result<Self> {
        // Replay doesn't strictly need a target addr, but we can use a dummy one
        // Use 9001 for World server traffic (player spawns!)
        let target = "127.0.0.1:9001".parse::<SocketAddr>()?;
        let session = Session::new_replay(replay_path, target)?;
        Self::create_with_session(session, account_name, character_preference, dats_path)
    }

    fn create_with_session(
        session: Session,
        account_name: &str,
        character_preference: Option<String>,
        dats_path: std::path::PathBuf,
    ) -> Result<Self> {
        let mut portal_dat: Option<std::sync::Arc<dyn holtburger_dat::ResourceProvider>> = None;
        let mut cell_dat: Option<std::sync::Arc<dyn holtburger_dat::ResourceProvider>> = None;

        match holtburger_dat::open_provider(dats_path.join("portal")) {
            Ok(p) => {
                log::info!(
                    "Loaded portal data from {}",
                    dats_path.join("portal").display()
                );
                portal_dat = Some(p);
            }
            Err(e) => {
                log::warn!("Could not load portal data: {}", e);
            }
        }

        match holtburger_dat::open_provider(dats_path.join("cell")) {
            Ok(p) => {
                log::info!("Loaded cell data from {}", dats_path.join("cell").display());
                cell_dat = Some(p);
            }
            Err(e) => {
                log::warn!("Could not load cell data: {}", e);
            }
        }

        if portal_dat.is_none() || cell_dat.is_none() {
            return Err(anyhow::anyhow!(
                "Failed to load required DAT files from {}. Ensure portal.dat/hba and cell.dat/hba exist.",
                dats_path.display()
            ));
        }

        Ok(Client {
            session,
            world: WorldState::new(portal_dat, cell_dat),
            account_name: account_name.to_string(),
            characters: Vec::new(),
            character_id: None,
            character_preference,
            state: ClientState::Connected,
            event_tx: None,
            command_rx: None,
            connection_cookie: 0,
            message_dump_dir: None,
            message_counter: 0,
            move_target: None,
            last_move_sync: Instant::now(),
            last_move_pos: holtburger_common::position::WorldPosition::default(),
            last_move_pos_time: Instant::now(),
            last_sent_pos_seq: None,
        })
    }
}
