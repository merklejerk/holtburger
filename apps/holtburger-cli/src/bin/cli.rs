use anyhow::Result;
use clap::Parser;
use holtburger_core::{Client, ClientCommand, ClientEvent};
use tokio::sync::mpsc;

#[derive(clap::Subcommand, Debug, Clone)]
enum Commands {
    ListCharacters,
    Connect {
        #[arg(short, long)]
        character: Option<String>,
    },
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,
    #[arg(short, long, default_value_t = 9000)]
    port: u16,
    #[arg(short = 'a', long)]
    account: String,
    #[arg(short = 'P', long, default_value = "")]
    password: String,
    #[arg(short, long, default_value_t = 10)]
    timeout: u64,
    #[arg(short, long)]
    verbose: bool,
    #[arg(long)]
    capture: Option<String>,
    #[arg(long)]
    replay: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let log_level = if args.verbose {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    env_logger::Builder::new().filter(None, log_level).init();

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    let character_pref = match &args.command {
        Commands::Connect { character } => character.clone(),
        _ => None,
    };

    let mut client = if let Some(replay_path) = args.replay {
        Client::new_replay(&replay_path, &args.account, character_pref.clone())?
    } else {
        Client::new(
            &args.server,
            args.port,
            &args.account,
            character_pref.clone(),
        )
        .await?
    };

    if let Some(mut capture_path) = args.capture {
        let caps_dir = std::path::Path::new("caps");
        if !caps_dir.exists() {
            std::fs::create_dir_all(caps_dir)?;
        }

        let path = std::path::Path::new(&capture_path);
        if path.parent() == Some(std::path::Path::new("")) {
            capture_path = format!("caps/{}", capture_path);
        }

        client.session.set_capture(&capture_path)?;
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

    let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(args.timeout));
    tokio::pin!(timeout);

    match args.command {
        Commands::ListCharacters => loop {
            tokio::select! {
                Some(event) = event_rx.recv() => {
                    if let ClientEvent::CharacterList(chars) = event {
                        println!("Characters for account {}:", args.account);
                        for character in chars { println!("  - {} (ID: {:08X})", character.name, character.guid); }
                        let _ = command_tx.send(ClientCommand::Quit);
                        let _ = client_handle.await;
                        return Ok(());
                    }
                }
                _ = &mut timeout => {
                    eprintln!("Timed out.");
                    let _ = command_tx.send(ClientCommand::Quit);
                    let _ = client_handle.await;
                    std::process::exit(1);
                }
            }
        },
        Commands::Connect { .. } => {
            println!("Connected. Ctrl-C to exit.");
            loop {
                tokio::select! {
                    Some(event) = event_rx.recv() => {
                        match event {
                            ClientEvent::Message(msg) => { println!("{}", msg.text); }
                            ClientEvent::CharacterList(chars) => {
                                println!("Available characters: {:?}", chars.iter().map(|c| &c.name).collect::<Vec<_>>());
                                if character_pref.is_none() {
                                    println!("Selecting first character...");
                                    let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(1));
                                }
                            }
                            _ => {}
                        }
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("\nDisconnecting...");
                        let _ = command_tx.send(ClientCommand::Quit);
                        break;
                    }
                }
            }
            let _ = client_handle.await;
        }
    }
    Ok(())
}
