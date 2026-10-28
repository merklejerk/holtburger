use super::types::{DEFAULT_LOGIN_PROTOCOL_VERSION, Session};
use anyhow::{Result, anyhow};
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::utils::build_login_payload;
use holtburger_protocol::messages::*;
use std::time::Duration;
use tokio::time::Instant;

impl Session {
    pub async fn send_login_request(&mut self, account_name: &str, password: &str) -> Result<()> {
        self.send_login_request_with_version(account_name, password, DEFAULT_LOGIN_PROTOCOL_VERSION)
            .await
    }

    pub async fn send_login_request_with_version(
        &mut self,
        account_name: &str,
        password: &str,
        client_version: &str,
    ) -> Result<()> {
        log::debug!(">>> Sending Login Request for account {}", account_name);
        let sequence = self.packet_sequence;
        let header = PacketHeader {
            flags: packet_flags::LOGIN_REQUEST,
            sequence,
            ..Default::default()
        };
        let payload = build_login_payload(account_name, password, sequence, client_version);
        self.send_login_packet(header, &payload).await
    }

    pub(crate) fn handle_handshake_request(
        &mut self,
        crd: ConnectRequestData,
    ) -> Result<Option<f64>> {
        log::debug!("<<< Handshake Request (Incoming): {:?}", crd);
        let first = self.last_control_scheduled.is_none();
        if first {
            self.connection_cookie = crd.cookie;
            self.client_id = crd.client_id;
            self.isaac_c2s = Some(Isaac::new(crd.client_seed));
            self.isaac_s2c = Some(Isaac::new(crd.server_seed));
            self.packet_sequence = 2;
            self.has_server_seq = true;
            // Retail SharedInit (acclient.c:360237) starts pacing with connection setup.
            self.last_control_scheduled = Some(Instant::now());
        } else if self.connection_cookie != crd.cookie {
            return Err(anyhow!(
                "Connect request changed cookie on an active session"
            ));
        }

        let activation_port =
            self.server_addr.port().checked_add(1).ok_or_else(|| {
                anyhow!("server activation port overflow for {}", self.server_addr)
            })?;
        let mut activation_addr = self.server_addr;
        activation_addr.set_port(activation_port);
        if first {
            self.pending_server_source_addr = Some(activation_addr);
        }

        let resp_header = PacketHeader {
            flags: packet_flags::CONNECT_RESPONSE,
            sequence: 1,
            id: 0,
            size: transport::CONNECT_RESPONSE_SIZE as u16,
            ..Default::default()
        };
        let payload = self.connection_cookie.to_le_bytes();

        self.queue_handshake(
            resp_header,
            &payload,
            activation_addr,
            Instant::now() + Duration::from_millis(transport::ACE_HANDSHAKE_RACE_DELAY_MS),
        )?;

        Ok(first.then_some(crd.time))
    }

    pub fn handle_handshake_response(&mut self, cookie: u64, client_id: u16) {
        log::debug!(
            "<<< Handshake Response: Cookie={:016X} NetID={:04X}",
            cookie,
            client_id
        );
        self.connection_cookie = cookie;
        self.client_id = client_id;
    }
}
