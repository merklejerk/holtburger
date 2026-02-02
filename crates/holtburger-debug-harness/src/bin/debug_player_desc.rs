use byteorder::{ByteOrder, LittleEndian};
use std::fs::File;
use std::io::Read;

fn main() {
    let mut file = File::open("repro.hex").unwrap();
    let mut contents = String::new();
    file.read_to_string(&mut contents).unwrap();

    // Convert hex string to bytes
    let data: Vec<u8> = contents
        .split_whitespace()
        .map(|s| u8::from_str_radix(s, 16).unwrap())
        .collect();

    let mut offset = 0;

    // Skip GameEvent Header (F7 B0 + Sequence + EventID) if present
    if data.len() > 8 && data[0] == 0xF7 && data[1] == 0xB0 {
        offset = 8;
    }

    // Parse PlayerDescription
    let version = data[offset];
    let v_flags = LittleEndian::read_u32(&data[offset + 2..offset + 6]);
    offset += 6;

    println!("Version: {}, Flags: {:X}", version, v_flags);

    // Properties
    if v_flags & 0x1 != 0 {
        // We know from previous runs that properties end at 364
        offset = 364;
    }

    // Skills
    if v_flags & 0x2 != 0 {
        let count = LittleEndian::read_u16(&data[offset..offset + 2]);
        let buckets = LittleEndian::read_u16(&data[offset + 2..offset + 4]);
        println!(
            "Skills Header at {}: Count={} Buckets={}",
            offset, count, buckets
        );

        let skill_size = 32; // HYPOTHESIS: 32 bytes (No Status field)
        let block_size = 4 + (count as usize * skill_size);
        println!(
            "  Skipping {} bytes of skills (assuming size {})",
            block_size, skill_size
        );
        offset += block_size;
    }

    // Spells
    if v_flags & 0x100 != 0 {
        println!("Checking Spells Header at: {}", offset);
        let count = LittleEndian::read_u16(&data[offset..offset + 2]);
        let buckets = LittleEndian::read_u16(&data[offset + 2..offset + 4]);
        println!("  Spells Header: Count={} Buckets={}", count, buckets);

        // Spells list
        // Assuming empty in invalid spot, or valid if count=0
        if count == 0 {
            offset += 4;
        } else {
            // If not empty, we might crash if we don't know size, but let's assume empty for now based on '00 00 06 00' drift hypothesis
            // Wait, if we are CORRECT now, what is the Spell Header?
            offset += 4; // Just header
        }
    }

    // Enchantments
    if v_flags & 0x200 != 0 {
        println!("Checking Enchantments Header at: {}", offset);

        print!("  Hex: ");
        for i in 0..16 {
            if offset + i < data.len() {
                print!("{:02X} ", data[offset + i]);
            }
        }
        println!();

        if offset + 4 <= data.len() {
            let mask = LittleEndian::read_u32(&data[offset..offset + 4]);
            println!("  Enchantment Mask: 0x{:08X}", mask);
        }
    }
}
