use anyhow::Result;
use holtburger::client::{Client, ClientCommand, ClientEvent};
use std::time::Duration;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();

    println!("Diagnostic Client starting...");

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, _command_rx) = mpsc::unbounded_channel();

    let mut client = Client::new("127.0.0.1", 9000, "admin", None).await?;
    client.set_event_tx(event_tx);
    client.set_command_rx(_command_rx);

    tokio::spawn(async move {
        if let Err(e) = client.run("admin").await {
            eprintln!("Client error: {}", e);
        }
    });

    let timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    ClientEvent::Message(msg) => println!(">>> {}", msg),
                    ClientEvent::CharacterList(chars) => {
                        println!("Characters received:");
                        for (id, name) in &chars {
                            println!("  - {} ({:08X})", name, id);
                        }
                        if !chars.is_empty() {
                            println!("Selecting first character...");
                            let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(1));
                        }
                    }
                }
            }
            _ = &mut timeout => {
                println!("Timeout.");
                break;
            }
        }
    }

    Ok(())
}
