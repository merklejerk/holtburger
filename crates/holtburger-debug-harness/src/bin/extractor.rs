use anyhow::Result;
use clap::Parser;
use holtburger_core::{Client, ClientCommand, WireEvent};
use std::path::PathBuf;
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
    replay: Option<String>,
    #[arg(short, long, default_value_t = 30)]
    timeout: u64,
    #[arg(short, long, default_value = "extracted_messages")]
    out_dir: String,
    #[arg(short, long)]
    dats: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let dats_path = args
        .dats
        .clone()
        .or_else(|| std::env::var("HOLTBURGER_DATS").ok())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("./dats"));

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
        Client::new_replay(
            replay_path,
            &args.account,
            args.character.clone(),
            dats_path,
        )?
    } else {
        Client::new(
            &args.server,
            args.port,
            &args.account,
            args.character.clone(),
            dats_path,
        )
        .await?
    };

    client.message_dump_dir = Some(out_dir);
    let mut wire_rx = client.subscribe_wire_events();
    client.set_command_rx(command_rx);

    // Forward broadcast to mpsc for the loop
    let event_tx_inner = event_tx.clone();
    tokio::spawn(async move {
        while let Ok(event) = wire_rx.recv().await {
            if event_tx_inner.send(event).is_err() {
                break;
            }
        }
    });

    let _ = command_tx.send(ClientCommand::Login(args.password.clone()));
    let mut client_handle = tokio::spawn(async move {
        match client.run().await {
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
                if let WireEvent::CharacterList(chars) = event {
                    println!("Characters received:");
                    for entry in &chars { println!("  - {} ({:08X})", entry.name, entry.guid); }

                    let target_name = args.character.as_deref().unwrap_or("");
                    if !chars.is_empty() {
                        let mut selected_id = None;
                        if target_name.is_empty() {
                            selected_id = Some(chars[0].guid);
                        } else {
                            for entry in &chars {
                                if entry.name.to_lowercase().contains(&target_name.to_lowercase()) {
                                    selected_id = Some(entry.guid);
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
            }
            _ = &mut timeout => {
                println!("Timeout reached, exiting.");
                break;
            }
            _ = &mut client_handle => {
                println!("Client handle finished, exiting.");
                break;
            }
        }
    }

    Ok(())
}
