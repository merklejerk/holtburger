use holtburger_debug_harness::prelude::*;
use holtburger_core::Client;
use std::time::Duration;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    println!("Starting reproduction login client...");
    
    let mut client = Client::new("127.0.0.1", 9000, "test", None).await?;
    
    let (tx, mut rx) = mpsc::unbounded_channel();
    client.set_event_tx(tx);
    
    let mut client_handle = {
        let (tx, rx) = mpsc::unbounded_channel();
        let (ctx, crx) = mpsc::unbounded_channel();
        client.set_event_tx(tx);
        client.set_command_rx(crx);
        
        let handle = tokio::spawn(async move {
            client.run("test").await
        });
        (handle, rx, ctx)
    };

    let (_, ref mut event_rx, ref mut cmd_tx) = client_handle;
    println!("Waiting for events...");
    
    let timeout = Duration::from_secs(30);
    let start = std::time::Instant::now();
    let mut selected = false;
    
    while start.elapsed() < timeout {
        if let Ok(event) = event_rx.try_recv() {
            println!("Event: {:?}", event);
            if let holtburger_core::ClientEvent::CharacterList(chars) = event {
                if !selected && !chars.is_empty() {
                    println!("Selecting character: {}", chars[0].guid);
                    cmd_tx.send(holtburger_core::ClientCommand::SelectCharacter(chars[0].guid))?;
                    selected = true;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    println!("Timeout reached.");
    Ok(())
}
