use anyhow::Result;
use clap::Parser;
use holtburger::client::{Client, ClientCommand, ClientEvent};
use tokio::sync::mpsc;

#[derive(clap::Subcommand, Debug, Clone)]
enum Commands {
    /// List all characters on the account and exit
    ListCharacters,
    /// Login and stay connected (echo chat)
    Connect {
        /// Automatically select character by name or index
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
    #[arg(short = 'P', long)]
    password: String,

    /// Timeout in seconds for CLI operations
    #[arg(short, long, default_value_t = 10)]
    timeout: u64,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

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

    let mut client = Client::new(
        &args.server,
        args.port,
        &args.account,
        character_pref.clone(),
    )
    .await?;
    client.set_event_tx(event_tx);
    client.set_command_rx(command_rx);

    let password = args.password.clone();
    let client_handle = tokio::spawn(async move {
        match client.run(&password).await {
            Err(e) if !e.to_string().contains("Graceful disconnect") => {
                log::error!("Client task error: {}", e);
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
                        for (id, name) in chars {
                            println!("  - {} (ID: {:08X})", name, id);
                        }
                        let _ = command_tx.send(ClientCommand::Quit);
                        let _ = client_handle.await;
                        return Ok(());
                    }
                }
                    _ = &mut timeout => {
                        eprintln!("Error: Timed out waiting for response (after {}s).", args.timeout);
                        let _ = command_tx.send(ClientCommand::Quit);
                        let _ = client_handle.await;
                        std::process::exit(1);
                    }
            }
        },
        Commands::Connect { .. } => {
            println!("Connected. Press Ctrl-C to exit.");
            loop {
                tokio::select! {
                    Some(event) = event_rx.recv() => {
                        match event {
                            ClientEvent::Message(msg) => {
                                println!("{}", msg);
                            }
                            ClientEvent::CharacterList(chars) => {
                                println!(
                                    "Available characters: {:?}",
                                    chars.iter().map(|c| &c.1).collect::<Vec<_>>()
                                );
                                if character_pref.is_none() {
                                    println!("No character specified, selecting first by default...");
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
