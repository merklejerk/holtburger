with open("apps/holtburger-cli/src/pages/game/state.rs", "r") as f:
    state_code = f.read()

state_code = state_code.replace("    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {\n        let mut result = UpdateResult::new();\n        match event {\n", """    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        match event {
            ClientViewEvent::LogMessage(_)
            | ClientViewEvent::ServerMessage { .. }
            | ClientViewEvent::Chat { .. }
            | ClientViewEvent::Emote { .. }
            | ClientViewEvent::PingResponse
            | ClientViewEvent::BootAccount(_)
            | ClientViewEvent::NetPulse { .. }
            | ClientViewEvent::Disconnected => {
                self.chat.handle_event(event);
            }\n""")
with open("apps/holtburger-cli/src/pages/game/state.rs", "w") as f:
    f.write(state_code)
