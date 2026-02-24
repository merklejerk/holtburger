use crate::session::Session;
use crate::world::WorldState;
use anyhow::Result;
use std::net::SocketAddr;
use tokio::sync::broadcast;

use super::{Client, ClientState, auth::AuthState, movement::MovementSystem};

impl Client {
    pub async fn new(
        server_ip: &str,
        server_port: u16,
        account_name: &str,
        character_preference: Option<String>,
        dats_path: std::path::PathBuf,
    ) -> Result<Self> {
        let target = format!("{}:{}", server_ip, server_port).parse::<SocketAddr>()?;

        let session_future = Session::new(target);
        let dats_path_clone = dats_path.clone();

        let dat_future = tokio::task::spawn_blocking(move || {
            let mut portal_dat = None;
            let mut cell_dat = None;

            match holtburger_dat::open_provider(dats_path_clone.join("portal")) {
                Ok(p) => {
                    log::info!(
                        "Loaded portal data from {}",
                        dats_path_clone.join("portal").display()
                    );
                    portal_dat = Some(p);
                }
                Err(e) => {
                    log::warn!("Could not load portal data: {}", e);
                }
            }

            match holtburger_dat::open_provider(dats_path_clone.join("cell")) {
                Ok(p) => {
                    log::info!(
                        "Loaded cell data from {}",
                        dats_path_clone.join("cell").display()
                    );
                    cell_dat = Some(p);
                }
                Err(e) => {
                    log::warn!("Could not load cell data: {}", e);
                }
            }

            (portal_dat, cell_dat)
        });

        let (session_res, dat_res) = tokio::join!(session_future, dat_future);
        let session = session_res?;
        let (portal_dat, cell_dat) = dat_res?;

        Self::create_with_session_and_dats(
            session,
            account_name,
            character_preference,
            dats_path,
            portal_dat,
            cell_dat,
        )
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

        let mut portal_dat = None;
        let mut cell_dat = None;

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

        Self::create_with_session_and_dats(
            session,
            account_name,
            character_preference,
            dats_path,
            portal_dat,
            cell_dat,
        )
    }

    fn create_with_session_and_dats(
        session: Session,
        account_name: &str,
        character_preference: Option<String>,
        dats_path: std::path::PathBuf,
        portal_dat: Option<std::sync::Arc<dyn holtburger_dat::ResourceProvider>>,
        cell_dat: Option<std::sync::Arc<dyn holtburger_dat::ResourceProvider>>,
    ) -> Result<Self> {
        if portal_dat.is_none() || cell_dat.is_none() {
            return Err(anyhow::anyhow!(
                "Failed to load required DAT files from {}. Ensure portal.dat/hba and cell.dat/hba exist.",
                dats_path.display()
            ));
        }

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (state_event_tx, _) = broadcast::channel(512);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(Client {
            session,
            world: WorldState::new(portal_dat, cell_dat),
            state: ClientState::Connected,
            wire_event_tx,
            state_event_tx,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: None,
            message_counter: 0,
            movement: MovementSystem::new(),
            auth: AuthState::new(account_name.to_string(), character_preference),
        })
    }
}
