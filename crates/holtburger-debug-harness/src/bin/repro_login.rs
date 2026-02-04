use anyhow::Result;
use holtburger_core::{Client, ClientCommand, ClientEvent, ClientState};
use tokio::sync::mpsc;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Debug)
        .init();

    println!("Starting full login validation test...");
    
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    let mut client = Client::new(
        "127.0.0.1",
        9000,
        "test",
        None,
    ).await?;
    client.session.set_capture("caps/repro.cap")?;

    client.set_event_tx(event_tx);
    client.set_command_rx(command_rx);

    let _client_handle = tokio::spawn(async move {
        if let Err(e) = client.run("test").await {
            log::error!("Client error: {}", e);
        }
    });

    let timeout = tokio::time::sleep(Duration::from_secs(30));
    tokio::pin!(timeout);

    let mut selected = false;

    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    ClientEvent::Message(msg) => {
                        println!("CHAT/SYS: {:?}", msg.text);
                    }
                    ClientEvent::CharacterList(chars) => {
                        println!("Character list received: {} characters", chars.len());
                        if chars.is_empty() {
                            println!("Error: Found 0 characters on 'test' account.");
                            return Ok(());
                        }
                        if !selected {
                            println!("Selecting first character: {}", chars[0].name);
                            command_tx.send(ClientCommand::SelectCharacter(chars[0].guid))?;
                            selected = true;
                        }
                    }
                    ClientEvent::StatusUpdate { state, .. } => {
                        println!("State Change: {:?}", state);
                        if let ClientState::InWorld = state {
                            println!("SUCCESS: Logged into world!");
                            return Ok(());
                        }
                    }
                    ClientEvent::PlayerEntered { name, guid } => {
                        println!("SUCCESS: Player entered world! Char={} GUID={:08X}", name, guid);
                        return Ok(());
                    }
                    _ => {}
                }
            }
            _ = &mut timeout => {
                println!("Timed out waiting for login sequence to complete.");
                break;
            }
        }
    }

    Ok(())
}
