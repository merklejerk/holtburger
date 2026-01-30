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

    let args: Vec<String> = std::env::args().collect();
    let account = args.get(1).map(|s| s.as_str()).unwrap_or("test");
    let password = args.get(2).map(|s| s.as_str()).unwrap_or("test");

    let mut client = Client::new("127.0.0.1", 9000, account, None).await?;
    client.set_event_tx(event_tx);
    client.set_command_rx(_command_rx);

    let password_clone = password.to_string();
    let client_handle = tokio::spawn(async move {
        match client.run(&password_clone).await {
            Err(e) if !e.to_string().contains("Graceful disconnect") => {
                eprintln!("Client error: {}", e);
            }
            _ => {}
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
                            let mut selected = false;
                            for (id, name) in &chars {
                                if name.contains("Buddy") {
                                    println!("Selecting character {}...", name);
                                    let _ = command_tx.send(ClientCommand::SelectCharacter(*id));
                                    selected = true;
                                    break;
                                }
                            }
                            if !selected {
                                println!("Selecting first character...");
                                let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(1));
                            }
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

    let _ = command_tx.send(ClientCommand::Quit);
    let _ = client_handle.await;

    Ok(())
}
