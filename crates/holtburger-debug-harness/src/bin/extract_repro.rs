use hex::ToHex;
use std::fs::File;
use std::io::{BufReader, Read};

fn main() {
    let pcap = File::open("/home/cluracan/code/holtburger/caps/session0.cap").unwrap();
    let mut reader = BufReader::new(pcap);
    let mut buffer = Vec::new();
    reader.read_to_end(&mut buffer).unwrap();

    let sig = [
        0xB0, 0xF7, 0x00, 0x00, 0x01, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x13, 0x00, 0x00,
        0x00,
    ];

    if let Some(pos) = buffer.windows(sig.len()).position(|w| w == sig) {
        println!("Found signature at offset {}", pos);
        let len = 2008;
        let data = &buffer[pos..pos + len];
        std::fs::write(
            "/home/cluracan/code/holtburger/crates/holtburger-core/repro.hex",
            data.encode_hex::<String>(),
        )
        .unwrap();
        println!("Wrote 2008 bytes to repro.hex");
    } else {
        println!("Could not find signature in pcap");
    }
}
