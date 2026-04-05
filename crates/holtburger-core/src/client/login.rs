use anyhow::Result;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use std::time::Duration;

pub(super) struct LoginState {
    pub(super) connection_cookie: u64,
}

impl LoginState {
    pub(super) fn new() -> Self {
        Self {
            connection_cookie: 0,
        }
    }

    pub(super) async fn send_login_request(
        &mut self,
        account_name: &str,
        password: &str,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!(">>> Sending Login Request for account {}", account_name);
        let header = PacketHeader {
            flags: packet_flags::LOGIN_REQUEST,
            sequence: session.packet_sequence,
            ..Default::default()
        };
        let payload = build_login_payload(account_name, password, session.packet_sequence, "1802");
        session.packet_sequence += 1;
        session.send_packet(header, &payload).await?;
        Ok(())
    }

    pub(super) async fn handle_handshake_request(
        &mut self,
        crd: ConnectRequestData,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!("<<< Handshake Request (Incoming): {:?}", crd);
        self.connection_cookie = crd.cookie;
        session.client_id = crd.client_id;
        session.isaac_c2s = Some(Isaac::new(crd.client_seed));
        session.isaac_s2c = Some(Isaac::new(crd.server_seed));

        let resp_header = PacketHeader {
            flags: packet_flags::CONNECT_RESPONSE,
            sequence: 1,
            id: 0,
            size: 8,
            ..Default::default()
        };
        session.packet_sequence = 2;

        let mut payload = Vec::new();
        payload.extend_from_slice(&self.connection_cookie.to_le_bytes());

        let mut activation_addr = session.server_addr;
        activation_addr.set_port(session.server_addr.port() + 1);

        tokio::time::sleep(Duration::from_millis(
            holtburger_protocol::messages::transport::ACE_HANDSHAKE_RACE_DELAY_MS,
        ))
        .await;
        log::debug!(">>> Sending Handshake Response to {}", activation_addr);
        session
            .send_packet_to_addr(resp_header, &payload, activation_addr)
            .await?;
        Ok(())
    }

    pub(super) async fn handle_handshake_response(
        &mut self,
        cookie: u64,
        client_id: u16,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!(
            "<<< Handshake Response: Cookie={:016X} NetID={:04X}",
            cookie,
            client_id
        );
        self.connection_cookie = cookie;
        session.client_id = client_id;

        Ok(())
    }
}
