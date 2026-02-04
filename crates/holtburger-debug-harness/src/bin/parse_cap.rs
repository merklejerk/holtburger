use anyhow::Result;
use holtburger_core::session::capture::CaptureReader;
use holtburger_core::protocol::messages::{PacketHeader, FragmentHeader, GameMessage, packet_flags, HEADER_SIZE, FRAGMENT_HEADER_SIZE};
use std::env;

fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02X}", x)).collect::<Vec<_>>().join(" ") }

fn main() -> Result<()> {
    env_logger::init();
    let args: Vec<String> = env::args().collect();
    let path = args.get(1).map(|s| s.as_str()).unwrap_or("caps/repro.cap");
    println!("Parsing capture: {}", path);

    let mut reader = CaptureReader::open(path)?;
    let mut idx = 0usize;
    while let Some(entry) = reader.read_next()? {
        println!("\n== Entry {}: {:?} {} len={} ==", idx, entry.direction, entry.addr, entry.data.len());
        let data = entry.data;
        if data.len() < HEADER_SIZE {
            println!(" Packet too short: {} bytes", data.len());
            idx+=1; continue;
        }
        let header = PacketHeader::unpack(&data[..HEADER_SIZE]);
        println!(" PacketHeader: seq={} flags={:08X} id={} size={} checksum={:08X}", header.sequence, header.flags, header.id, header.size, header.checksum);
        let mut offset = 0usize;
        let payload = &data[HEADER_SIZE..];
        if header.flags & packet_flags::ACK_SEQUENCE != 0 {
            if payload.len() >= 4 {
                let ack = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                println!("  Optional ACK_SEQUENCE: ack={}", ack);
                offset += 4;
            }
        }

        // Walk fragments
        while offset + FRAGMENT_HEADER_SIZE <= payload.len() {
            let fh = FragmentHeader::unpack(&payload[offset..offset+FRAGMENT_HEADER_SIZE]);
            let frag_data_size = (fh.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
            let start = offset + FRAGMENT_HEADER_SIZE;
            let end = (start + frag_data_size).min(payload.len());
            let frag_data = &payload[start..end];
            println!("  Fragment: sequence={} id=0x{:08X} count={} index={} size={} queue=0x{:04X}", fh.sequence, fh.id, fh.count, fh.index, fh.size, fh.queue);
            println!("   frag_data ({} bytes): {}", frag_data.len(), hex(frag_data));
            if !frag_data.is_empty() {
                match GameMessage::unpack(frag_data) {
                    Some(msg) => println!("   => Message: {:?}", msg),
                    None => println!("   => Message: <could not unpack>")
                }
            }
            offset = end;
            // align to 4 bytes
            offset = (offset + 3) & !3;
        }

        idx += 1;
    }

    Ok(())
}
