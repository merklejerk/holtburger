use anyhow::Result;
use holtburger_core::{Client, ClientCommand, ClientEvent};
use tokio::sync::mpsc;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Debug)
        .init();

    println!("Starting connection test...");
    
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, _command_rx) = mpsc::unbounded_channel();

    let mut client = Client::new(
        "127.0.0.1",
        9000,
        "test",
        None,
    ).await?;

    client.set_event_tx(event_tx);
    client.set_command_rx(_command_rx);

    let client_handle = tokio::spawn(async move {
        if let Err(e) = client.run("test").await {
            log::error!("Client error: {}", e);
        }
    });

    let timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    ClientEvent::Message(msg) => {
                        println!("MSG: {:?}", msg.text);
                    }
                    ClientEvent::CharacterList(chars) => {
                        println!("Success! Character list received: {} characters", chars.len());
                        return Ok(());
                    }
                    ClientEvent::StatusUpdate { state, .. } => {
                        println!("State Change: {:?}", state);
                    }
                    _ => {}
                }
            }
            _ = &mut timeout => {
                println!("Timed out waiting for character list.");
                break;
            }
        }
    }

    Ok(())
}
