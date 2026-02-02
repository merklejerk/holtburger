use anyhow::Result;
use clap::Parser;
use holtburger_core::{Client, ClientCommand, ClientEvent};
use std::time::Duration;
use tokio::sync::mpsc;
use std::path::PathBuf;

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
    replay: Option<String>,
    #[arg(short, long, default_value_t = 30)]
    timeout: u64,
    #[arg(short, long, default_value = "messages")]
    out_dir: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    let out_dir = PathBuf::from(&args.out_dir);
    if !out_dir.exists() {
        std::fs::create_dir_all(&out_dir)?;
    } else {
        // Clean out existing messages
        for entry in std::fs::read_dir(&out_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                std::fs::remove_file(entry.path())?;
            }
        }
    }

    println!("Message Extractor starting...");
    println!("Dumping messages to: {}", out_dir.display());

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

    client.message_dump_dir = Some(out_dir);
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

    let timeout_duration = Duration::from_secs(args.timeout);
    let timeout = tokio::time::sleep(timeout_duration);
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    ClientEvent::CharacterList(chars) => {
                        println!("Characters received:");
                        for (id, name) in &chars { println!("  - {} ({:08X})", name, id); }

                        let target_name = args.character.as_deref().unwrap_or("");
                        if !chars.is_empty() {
                            let mut selected_id = None;
                            if target_name.is_empty() {
                                selected_id = Some(chars[0].0);
                            } else {
                                for (id, name) in &chars {
                                    if name.to_lowercase().contains(&target_name.to_lowercase()) {
                                        selected_id = Some(*id);
                                        break;
                                    }
                                }
                            }

                            if let Some(id) = selected_id {
                                println!("Selecting character ID {:08X}...", id);
                                let _ = command_tx.send(ClientCommand::SelectCharacter(id));
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ = &mut timeout => {
                println!("Timeout reached, exiting.");
                break;
            }
            _ = client_handle => {
                println!("Client handle finished, exiting.");
                break;
            }
        }
    }

    Ok(())
}
