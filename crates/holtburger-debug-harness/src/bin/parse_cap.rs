use anyhow::Result;
use holtburger_core::protocol::messages::{
    FRAGMENT_HEADER_SIZE, FragmentHeader, GameMessage, HEADER_SIZE, PacketHeader, packet_flags,
};
use holtburger_core::session::capture::CaptureReader;
use std::env;

fn hex(b: &[u8]) -> String {
    b.iter()
        .map(|x| format!("{:02X}", x))
        .collect::<Vec<_>>()
        .join(" ")
}

fn main() -> Result<()> {
    env_logger::init();
    let args: Vec<String> = env::args().collect();
    let path = args.get(1).map(|s| s.as_str()).unwrap_or("caps/repro.cap");
    println!("Parsing capture: {}", path);

    let mut reader = CaptureReader::open(path)?;
    let mut idx = 0usize;
    while let Some(entry) = reader.read_next()? {
        println!(
            "\n== Entry {}: {:?} {} len={} ==",
            idx,
            entry.direction,
            entry.addr,
            entry.data.len()
        );
        let data = entry.data;
        if data.len() < HEADER_SIZE {
            println!(" Packet too short: {} bytes", data.len());
            idx += 1;
            continue;
        }
        let mut offset = 0usize;
        let header = PacketHeader::unpack(&data, &mut offset).expect("Failed to unpack header");
        println!(
            " PacketHeader: seq={} flags={:08X} id={} size={} checksum={:08X}",
            header.sequence, header.flags, header.id, header.size, header.checksum
        );
        let payload = &data[offset..];
        if header.flags & packet_flags::ACK_SEQUENCE != 0 && payload.len() >= 4 {
            let ack = u32::from_le_bytes(payload[0..4].try_into().unwrap());
            println!("  Optional ACK_SEQUENCE: ack={}", ack);
            offset += 4;
        }

        // Walk fragments
        let mut frag_offset = offset;
        while frag_offset + FRAGMENT_HEADER_SIZE <= payload.len() {
            let fh = FragmentHeader::unpack(payload, &mut frag_offset)
                .expect("Failed to unpack fragment header");
            let frag_data_size = (fh.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
            let start = frag_offset;
            let end = (start + frag_data_size).min(payload.len());
            let frag_data = &payload[start..end];
            println!(
                "  Fragment: sequence={} id=0x{:08X} count={} index={} size={} queue=0x{:04X}",
                fh.sequence, fh.id, fh.count, fh.index, fh.size, fh.queue
            );
            println!(
                "   frag_data ({} bytes): {}",
                frag_data.len(),
                hex(frag_data)
            );
            if !frag_data.is_empty() {
                match GameMessage::unpack(frag_data) {
                    Some(msg) => println!("   => Message: {:?}", msg),
                    None => println!("   => Message: <could not unpack>"),
                }
            }
            frag_offset = end;
            // align to 4 bytes
            offset = (offset + 3) & !3;
        }

        idx += 1;
    }

    Ok(())
}
