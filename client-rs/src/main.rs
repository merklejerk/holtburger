use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers, EnableMouseCapture, DisableMouseCapture, MouseEventKind},
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
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
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
        input_history: Vec::new(),
        history_index: None,
        characters: Vec::new(),
        state: ui::UIState::Chat, // Default to chat
        selected_character_index: 0,
        scroll_offset: 0,
    };

    // Run client in background
    let password = args.password.clone();
    let client_handle = tokio::spawn(async move {
        let _ = client.run(&password).await;
    });

    loop {
        terminal.draw(|f| ui::ui(f, &app_state))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(key) => {
                    match key.code {
                        KeyCode::Enter => match app_state.state {
                            ui::UIState::Chat => {
                                let input = app_state.input.drain(..).collect::<String>();
                                if input.is_empty() {
                                    continue;
                                }
                                if input == "/quit" || input == "/exit" {
                                    let _ = command_tx.send(ClientCommand::Quit);
                                    break;
                                }
                                app_state.input_history.push(input.clone());
                                app_state.history_index = None;
                                let _ = command_tx.send(ClientCommand::Talk(input));
                                app_state.scroll_offset = 0;
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
                            if app_state.state == ui::UIState::CharacterSelection {
                                if app_state.selected_character_index > 0 {
                                    app_state.selected_character_index -= 1;
                                }
                            } else if app_state.state == ui::UIState::Chat {
                                if key.modifiers.contains(KeyModifiers::SHIFT) {
                                    app_state.scroll_offset += 1;
                                } else if !app_state.input_history.is_empty() {
                                    let new_index = match app_state.history_index {
                                        Some(idx) if idx > 0 => Some(idx - 1),
                                        Some(_) => Some(0),
                                        None => Some(app_state.input_history.len() - 1),
                                    };
                                    if let Some(idx) = new_index {
                                        app_state.history_index = Some(idx);
                                        app_state.input = app_state.input_history[idx].clone();
                                    }
                                }
                            }
                        }
                        KeyCode::Down => {
                            if app_state.state == ui::UIState::CharacterSelection {
                                if app_state.selected_character_index + 1 < app_state.characters.len() {
                                    app_state.selected_character_index += 1;
                                }
                            } else if app_state.state == ui::UIState::Chat {
                                if key.modifiers.contains(KeyModifiers::SHIFT) {
                                    app_state.scroll_offset = app_state.scroll_offset.saturating_sub(1);
                                } else if let Some(idx) = app_state.history_index {
                                    if idx + 1 < app_state.input_history.len() {
                                        app_state.history_index = Some(idx + 1);
                                        app_state.input = app_state.input_history[idx + 1].clone();
                                    } else {
                                        app_state.history_index = None;
                                        app_state.input.clear();
                                    }
                                }
                            }
                        }
                        KeyCode::PageUp => {
                            if app_state.state == ui::UIState::Chat {
                                app_state.scroll_offset += 10;
                            }
                        }
                        KeyCode::PageDown => {
                            if app_state.state == ui::UIState::Chat {
                                app_state.scroll_offset = app_state.scroll_offset.saturating_sub(10);
                            }
                        }
                        KeyCode::Home => {
                            if app_state.state == ui::UIState::Chat && key.modifiers.contains(KeyModifiers::SHIFT) {
                                app_state.scroll_offset = app_state.messages.len();
                            }
                        }
                        KeyCode::End => {
                            if app_state.state == ui::UIState::Chat && key.modifiers.contains(KeyModifiers::SHIFT) {
                                app_state.scroll_offset = 0;
                            }
                        }
                        KeyCode::Char(c) => {
                            app_state.input.push(c);
                        }
                        KeyCode::Backspace => {
                            app_state.input.pop();
                        }
                        KeyCode::Esc => {
                            let _ = command_tx.send(ClientCommand::Quit);
                            break;
                        }
                        _ => {}
                    }
                }
                Event::Mouse(mouse) => {
                    if app_state.state == ui::UIState::Chat {
                        match mouse.kind {
                            MouseEventKind::ScrollUp => app_state.scroll_offset += 3,
                            MouseEventKind::ScrollDown => {
                                app_state.scroll_offset = app_state.scroll_offset.saturating_sub(3);
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        while let Ok(event) = event_rx.try_recv() {
            match event {
                ClientEvent::Message(msg) => {
                    app_state.messages.push(msg);
                    if app_state.scroll_offset > 0 {
                        app_state.scroll_offset += 1;
                    }
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
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;

    // Wait for client to finish disconnecting
    let _ = client_handle.await;

    Ok(())
}
