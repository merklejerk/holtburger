use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use holtburger::client::{Client, ClientCommand, ClientEvent};
use holtburger::ui::{self, AppState};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::io;
use tokio::sync::mpsc;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Server IP address
    #[arg(short, long, default_value = "127.0.0.1")]
    server: String,

    /// Server port
    #[arg(short, long, default_value_t = 9000)]
    port: u16,

    /// Account name
    #[arg(short, long)]
    account: String,

    /// Account password
    #[arg(short = 'P', long)]
    password: String,

    /// Character name or index
    #[arg(short, long)]
    character: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let (command_tx, command_rx) = mpsc::unbounded_channel();

    let mut client = Client::new(&args.server, args.port, &args.account, args.character).await?;
    client.set_event_tx(event_tx);
    client.set_command_rx(command_rx);

    let mut app_state = AppState {
        messages: Vec::new(),
        input: String::new(),
        characters: Vec::new(),
        state: ui::UIState::Chat, // Default to chat
        selected_character_index: 0,
    };

    // Run client in background
    let password = args.password.clone();
    tokio::spawn(async move {
        let _ = client.run(&password).await;
    });

    loop {
        terminal.draw(|f| ui::ui(f, &app_state))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Enter => match app_state.state {
                        ui::UIState::Chat => {
                            let input = app_state.input.drain(..).collect::<String>();
                            if input == "/quit" || input == "/exit" {
                                break;
                            }
                            let _ = command_tx.send(ClientCommand::Talk(input));
                        }
                        ui::UIState::CharacterSelection => {
                            if !app_state.characters.is_empty() {
                                let _ = command_tx.send(ClientCommand::SelectCharacterByIndex(
                                    app_state.selected_character_index + 1,
                                ));
                                app_state.state = ui::UIState::Chat;
                            }
                        }
                    },
                    KeyCode::Up => {
                        if app_state.state == ui::UIState::CharacterSelection
                            && app_state.selected_character_index > 0
                        {
                            app_state.selected_character_index -= 1;
                        }
                    }
                    KeyCode::Down => {
                        if app_state.state == ui::UIState::CharacterSelection
                            && app_state.selected_character_index + 1 < app_state.characters.len()
                        {
                            app_state.selected_character_index += 1;
                        }
                    }
                    KeyCode::Char(c) => {
                        app_state.input.push(c);
                    }
                    KeyCode::Backspace => {
                        app_state.input.pop();
                    }
                    KeyCode::Esc => {
                        break;
                    }
                    _ => {}
                }
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            match event {
                ClientEvent::Message(msg) => {
                    app_state.messages.push(msg);
                }
                ClientEvent::CharacterList(chars) => {
                    app_state.characters = chars;
                    app_state.state = ui::UIState::CharacterSelection;
                    app_state.selected_character_index = 0;
                }
            }
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
