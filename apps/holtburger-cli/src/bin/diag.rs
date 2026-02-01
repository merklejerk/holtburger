use anyhow::Result;
use clap::Parser;
use holtburger_core::{Client, ClientCommand, ClientEvent};
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,
    #[arg(short, long, default_value_t = 9000)]
    port: u16,
    #[arg(short = 'a', long, default_value = "test")]
    account: String,
    #[arg(short = 'P', long, default_value = "test")]
    password: String,
    #[arg(short, long)]
    character: Option<String>,
    #[arg(long)]
    capture: Option<String>,
    #[arg(long)]
    replay: Option<String>,
    #[arg(short, long, default_value_t = 30)]
    timeout: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    println!("Diagnostic Harness starting...");

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    let mut client = if let Some(replay_path) = &args.replay {
        Client::new_replay(replay_path, &args.account, args.character.clone())?
    } else {
        Client::new(
            &args.server,
            args.port,
            &args.account,
            args.character.clone(),
        )
        .await?
    };

    if let Some(capture_path) = args.capture {
        let caps_dir = std::path::Path::new("caps");
        if !caps_dir.exists() {
            std::fs::create_dir_all(caps_dir)?;
        }

        let mut final_path = capture_path.clone();
        let path = std::path::Path::new(&capture_path);
        if path.parent() == Some(std::path::Path::new("")) {
            final_path = format!("caps/{}", capture_path);
        }

        client.session.set_capture(&final_path)?;
    }

    client.set_event_tx(event_tx);
    client.set_command_rx(command_rx);

    let password = args.password.clone();
    let client_handle = tokio::spawn(async move {
        match client.run(&password).await {
            Err(e) if !e.to_string().contains("Graceful disconnect") => {
                log::error!("Client error: {}", e);
            }
            _ => {}
        }
    });

    let timeout = tokio::time::sleep(Duration::from_secs(args.timeout));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    ClientEvent::Message(msg) => println!(">>> {}", msg.text),
                    ClientEvent::CharacterList(chars) => {
                        println!("Characters received:");
                        for (id, name) in &chars { println!("  - {} ({:08X})", name, id); }

                        let target_name = args.character.as_deref().unwrap_or("buddy");
                        if !chars.is_empty() {
                            let mut selected = false;
                            for (id, name) in &chars {
                                if name.to_lowercase().contains(&target_name.to_lowercase()) {
                                    println!("Selecting character {}...", name);
                                    let _ = command_tx.send(ClientCommand::SelectCharacter(*id));
                                    selected = true;
                                    break;
                                }
                            }
                            if !selected {
                                println!("No match for '{}', selecting first character...", target_name);
                                let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(1));
                            }
                        }
                    }
                    ClientEvent::World(we) => {
                        println!("World Event: {:?}", we);
                    }
                    _ => {}
                }
            }
            _ = &mut timeout => {
                println!("Harness timeout reached.");
                break;
            }
            _ = tokio::signal::ctrl_c() => {
                println!("\nUser interrupt, shutting down.");
                break;
            }
        }
    }

    let _ = command_tx.send(ClientCommand::Quit);
    let _ = client_handle.await;
    Ok(())
}
