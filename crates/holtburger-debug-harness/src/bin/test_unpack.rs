use std::fs;
use holtburger_core::protocol::messages::GameMessage;

fn main() {
    let bytes = fs::read("/home/cluracan/code/holtburger/caps/extracted/00005.bin").expect("Failed to read bin");
    println!("Read {} bytes", bytes.len());
    
    // The bin file contains the message starting with opcode F7 B0
    let msg = GameMessage::unpack(&bytes);
    
    match msg {
        Some(GameMessage::PlayerDescription(ref data)) => {
            println!("Successfully unpacked PlayerDescription for {} ({:08X})", data.name, data.guid);
            
            let message = GameMessage::PlayerDescription(data.clone());
            let packed = message.pack();
            
            println!("Original size: {}", bytes.len());
            println!("Packed size:   {}", packed.len());
            
            if bytes == packed {
                println!("MATCH! Bit-identical roundtrip!");
            } else {
                println!("MISMATCH!");
                // Find first difference
                for i in 0..bytes.len().min(packed.len()) {
                    if bytes[i] != packed[i] {
                        println!("First difference at offset {}: Expected {:02X}, got {:02X}", i, bytes[i], packed[i]);
                        
                        let start = i.saturating_sub(16);
                        let end = (i + 16).min(bytes.len()).min(packed.len());
                        println!("Context (Expected): {:02X?}", &bytes[start..end]);
                        println!("Context (Packed):   {:02X?}", &packed[start..end]);
                        break;
                    }
                }
                if bytes.len() != packed.len() {
                    println!("Lengths differ: Expected {}, got {}", bytes.len(), packed.len());
                }
            }
        }
        _ => {
            println!("Got other message: {:?}", msg);
        }
    }
}
