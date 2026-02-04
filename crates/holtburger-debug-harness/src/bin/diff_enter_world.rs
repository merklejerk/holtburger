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

#[derive(Debug)]
struct FragSummary {
    sequence: u32,
    id: u32,
    count: u16,
    index: u16,
    size: u16,
    queue: u16,
    data_hex: String,
    msg: Option<GameMessage>,
}

#[derive(Debug)]
struct EntrySummary {
    idx: usize,
    dir: String,
    _timestamp_ms: u64,
    ts_rel: i64,
    header: Option<PacketHeader>,
    optional_ack: Option<u32>,
    frags: Vec<FragSummary>,
}

use holtburger_core::session::capture::CaptureEntry;

fn summarize_entries(
    entries: &[anyhow::Result<CaptureEntry>],
    _enter_idx: usize,
    base_ts: u64,
    before_ms: u64,
    after_ms: u64,
) -> Vec<EntrySummary> {
    let mut out = Vec::new();
    let start_ts = base_ts.saturating_sub(before_ms);
    let end_ts = base_ts + after_ms;
    for (i, e_res) in entries.iter().enumerate() {
        if let Ok(e) = e_res {
            if e.timestamp_ms < start_ts || e.timestamp_ms > end_ts {
                continue;
            }
            let ts_rel = (e.timestamp_ms as i64) - (base_ts as i64);
            let mut header = None;
            let mut optional_ack = None;
            let mut frags = Vec::new();
            let data = &e.data;
            if data.len() >= HEADER_SIZE {
                let mut header_offset = 0;
                let h = PacketHeader::unpack(data, &mut header_offset);
                header = h;
                let mut offset = 0usize;
                let payload = &data[header_offset..];
                if let Some(h) = &header
                    && h.flags & packet_flags::ACK_SEQUENCE != 0 && payload.len() >= 4 {
                        optional_ack = Some(u32::from_le_bytes(payload[0..4].try_into().unwrap()));
                        offset += 4;
                }
                while offset + FRAGMENT_HEADER_SIZE <= payload.len() {
                    let mut fh_offset = offset;
                    let fh = FragmentHeader::unpack(payload, &mut fh_offset).unwrap();
                    let frag_data_size = (fh.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
                    let start = fh_offset;
                    let end = (start + frag_data_size).min(payload.len());
                    let frag_data = &payload[start..end];
                    let msg = std::panic::catch_unwind(|| GameMessage::unpack(frag_data))
                        .ok()
                        .and_then(|m| m);
                    frags.push(FragSummary {
                        sequence: fh.sequence,
                        id: fh.id,
                        count: fh.count,
                        index: fh.index,
                        size: fh.size,
                        queue: fh.queue,
                        data_hex: hex(frag_data),
                        msg,
                    });
                    offset = end;
                    offset = (offset + 3) & !3;
                }
            }
            out.push(EntrySummary {
                idx: i,
                dir: format!("{:?}", e.direction),
                _timestamp_ms: e.timestamp_ms,
                ts_rel,
                header,
                optional_ack,
                frags,
            });
        }
    }
    out
}

fn print_summary_list(list: &[EntrySummary]) {
    for s in list {
        println!(
            "== idx={} dir={} ts_rel={}ms hdr={:?} ack={:?}",
            s.idx,
            s.dir,
            s.ts_rel,
            s.header.as_ref().map(|h| format!(
                "seq={} flags=0x{:08X} id={} size={} chk=0x{:08X}",
                h.sequence, h.flags, h.id, h.size, h.checksum
            )),
            s.optional_ack
        );
        for f in &s.frags {
            println!(
                "  Frag seq={} id=0x{:08X} count={} idx={} size={} q=0x{:04X} data={} msg={:?}",
                f.sequence, f.id, f.count, f.index, f.size, f.queue, f.data_hex, f.msg
            );
        }
    }
}

fn main() -> Result<()> {
    env_logger::init();
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        println!("Usage: diff_enter_world <capA> <capB> [opcode_hex] [before_ms] [after_ms]");
        return Ok(());
    }
    let a_path = &args[1];
    let b_path = &args[2];
    let opcode = args
        .get(3)
        .map(|s| u32::from_str_radix(s.trim_start_matches("0x"), 16).unwrap())
        .unwrap_or(0xF7C8);
    let before_ms: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(100);
    let after_ms: u64 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(1000);

    println!(
        "Diffing opcode 0x{:04X} between '{}' and '{}' (window -{}ms/+{}ms)",
        opcode, a_path, b_path, before_ms, after_ms
    );

    let mut ra = CaptureReader::open(a_path)?;
    let mut rb = CaptureReader::open(b_path)?;

    // Read all entries
    let mut a_entries = Vec::new();
    while let Some(e) = ra.read_next()? {
        a_entries.push(Ok(e));
    }
    let mut b_entries = Vec::new();
    while let Some(e) = rb.read_next()? {
        b_entries.push(Ok(e));
    }

    // Find first entry with frag that starts with opcode bytes
    let find_opcode_idx = |entries: &[anyhow::Result<CaptureEntry>]| -> Option<usize> {
        for (i, e_res) in entries.iter().enumerate() {
            if let Ok(e) = e_res {
                let data = &e.data;
                if data.len() < HEADER_SIZE {
                    continue;
                }
                let payload = &data[HEADER_SIZE..];
                let mut offset = 0usize;
                if payload.len() >= 4
                    && ((u32::from_le_bytes(payload[0..4].try_into().unwrap()) == opcode)
                        || (payload[0] == ((opcode) & 0xFF) as u8
                            && payload[1] == ((opcode >> 8) & 0xFF) as u8))
                {
                    // Direct match at payload start
                    return Some(i);
                }
                if payload.len() >= 4
                    && (u32::from_le_bytes(payload[0..4].try_into().unwrap()) != 0)
                {
                    // Skip optional ack if present
                    offset = 4;
                }
                while offset + FRAGMENT_HEADER_SIZE <= payload.len() {
                    let mut frag_offset = offset;
                    let fh = FragmentHeader::unpack(payload, &mut frag_offset)
                        .expect("Failed to unpack fragment header");
                    let frag_data_size = (fh.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
                    let start = offset + FRAGMENT_HEADER_SIZE;
                    let end = (start + frag_data_size).min(payload.len());
                    let frag_data = &payload[start..end];
                    if frag_data.len() >= 4
                        && frag_data[0] == ((opcode) & 0xFF) as u8
                        && frag_data[1] == ((opcode >> 8) & 0xFF) as u8
                    {
                        return Some(i);
                    }
                    offset = end;
                    offset = (offset + 3) & !3;
                }
            }
        }
        None
    };

    let a_idx = find_opcode_idx(&a_entries);
    let b_idx = find_opcode_idx(&b_entries);

    if a_idx.is_none() || b_idx.is_none() {
        println!(
            "Could not find opcode 0x{:04X} in one of the captures (A:{:?} B:{:?})",
            opcode, a_idx, b_idx
        );
        return Ok(());
    }

    let a_idx = a_idx.unwrap();
    let b_idx = b_idx.unwrap();
    let a_base_ts = match &a_entries[a_idx] {
        Ok(e) => e.timestamp_ms,
        _ => 0,
    };
    let b_base_ts = match &b_entries[b_idx] {
        Ok(e) => e.timestamp_ms,
        _ => 0,
    };

    println!(
        "Found in A at idx={} ts={} ; in B at idx={} ts={}",
        a_idx, a_base_ts, b_idx, b_base_ts
    );

    let a_window = summarize_entries(&a_entries, a_idx, a_base_ts, before_ms, after_ms);
    let b_window = summarize_entries(&b_entries, b_idx, b_base_ts, before_ms, after_ms);

    println!("\n--- Capture A: window ({} entries) ---", a_window.len());
    print_summary_list(&a_window);
    println!("\n--- Capture B: window ({} entries) ---", b_window.len());
    print_summary_list(&b_window);

    // Precise alignment: find the EnterWorld frag inside each window and compare those entries directly
    fn find_window_frag_idx(win: &[EntrySummary], opcode: u32) -> Option<usize> {
        let b0 = (opcode & 0xFF) as u8;
        let b1 = ((opcode >> 8) & 0xFF) as u8;
        for (i, e) in win.iter().enumerate() {
            for f in &e.frags {
                let parts: Vec<&str> = f.data_hex.split_whitespace().collect();
                if parts.len() >= 2
                    && parts[0] == format!("{:02X}", b0)
                    && parts[1] == format!("{:02X}", b1)
                {
                    return Some(i);
                }
            }
        }
        None
    }

    let a_ent_idx = find_window_frag_idx(&a_window, opcode);
    let b_ent_idx = find_window_frag_idx(&b_window, opcode);
    println!("\n--- Precise EnterWorld comparison ---");
    println!(
        " A window EnterWorld idx={:?}; B window EnterWorld idx={:?}",
        a_ent_idx, b_ent_idx
    );
    if let (Some(ai), Some(bi)) = (a_ent_idx, b_ent_idx) {
        let ae = &a_window[ai];
        let be = &b_window[bi];
        println!(
            "\n EnterWorld Packet A: idx={} ts_rel={}ms dir={} hdr={:?} ack={:?}",
            ae.idx,
            ae.ts_rel,
            ae.dir,
            ae.header.as_ref().map(|h| format!(
                "seq={} flags=0x{:08X} id={} size={} chk=0x{:08X}",
                h.sequence, h.flags, h.id, h.size, h.checksum
            )),
            ae.optional_ack
        );
        println!(
            " EnterWorld Packet B: idx={} ts_rel={}ms dir={} hdr={:?} ack={:?}",
            be.idx,
            be.ts_rel,
            be.dir,
            be.header.as_ref().map(|h| format!(
                "seq={} flags=0x{:08X} id={} size={} chk=0x{:08X}",
                h.sequence, h.flags, h.id, h.size, h.checksum
            )),
            be.optional_ack
        );
        // find frag details
        let fa = ae.frags.iter().find(|f| {
            f.data_hex.starts_with(&format!(
                "{:02X} {:02X}",
                (opcode & 0xFF),
                ((opcode >> 8) & 0xFF)
            ))
        });
        let fb = be.frags.iter().find(|f| {
            f.data_hex.starts_with(&format!(
                "{:02X} {:02X}",
                (opcode & 0xFF),
                ((opcode >> 8) & 0xFF)
            ))
        });
        if let (Some(fa), Some(fb)) = (fa, fb) {
            println!(
                "\n  Frag A: seq={} id=0x{:08X} size={} q=0x{:04X} data={}",
                fa.sequence, fa.id, fa.size, fa.queue, fa.data_hex
            );
            println!(
                "  Frag B: seq={} id=0x{:08X} size={} q=0x{:04X} data={}",
                fb.sequence, fb.id, fb.size, fb.queue, fb.data_hex
            );
            if fa.data_hex != fb.data_hex {
                println!("  Payload DIFF: A != B (hex mismatch)");
            } else {
                println!("  Payload MATCH");
            }
            let a_hdr_str = ae.header.as_ref().map(|h| {
                format!(
                    "seq={} flags=0x{:08X} id={} size={} chk=0x{:08X}",
                    h.sequence, h.flags, h.id, h.size, h.checksum
                )
            });
            let b_hdr_str = be.header.as_ref().map(|h| {
                format!(
                    "seq={} flags=0x{:08X} id={} size={} chk=0x{:08X}",
                    h.sequence, h.flags, h.id, h.size, h.checksum
                )
            });
            if a_hdr_str != b_hdr_str {
                println!(
                    "  Header DIFF between EnterWorld packets: A={:?} B={:?}",
                    a_hdr_str, b_hdr_str
                );
            }
            if ae.optional_ack != be.optional_ack {
                println!(
                    "  Optional ACK DIFF: A={:?} B={:?}",
                    ae.optional_ack, be.optional_ack
                );
            }
        }

        // Server-ready check (0xF7DF)
        let server_ready_opcode = 0xF7DFu32;
        let a_srv = find_window_frag_idx(&a_window, server_ready_opcode);
        let b_srv = find_window_frag_idx(&b_window, server_ready_opcode);
        println!("\n ServerReady presence: A={:?} ; B={:?}", a_srv, b_srv);
        if let Some(bsi) = b_srv {
            println!(
                "  B ServerReady entry: idx={} ts_rel={}ms frags=",
                b_window[bsi].idx, b_window[bsi].ts_rel
            );
            for f in &b_window[bsi].frags {
                println!("    {}", f.data_hex);
            }
        }
        if let Some(asi) = a_srv {
            println!(
                "  A ServerReady entry: idx={} ts_rel={}ms frags=",
                a_window[asi].idx, a_window[asi].ts_rel
            );
            for f in &a_window[asi].frags {
                println!("    {}", f.data_hex);
            }
        }
    } else {
        println!(
            "Could not align EnterWorld packet in one of the windows (A:{:?} B:{:?}). See full windows above.",
            a_ent_idx, b_ent_idx
        );
    }

    // Fallback: previous index-wise comparison (kept for context)
    println!("\n--- Field-by-field comparison (index-wise) ---");
    let n = std::cmp::min(a_window.len(), b_window.len());
    for i in 0..n {
        let aa = &a_window[i];
        let bb = &b_window[i];
        println!(
            "\n++ Pair i={} ts_rel_A={}ms ts_rel_B={}ms dirA={} dirB={}",
            i, aa.ts_rel, bb.ts_rel, aa.dir, bb.dir
        );
        // Compare header
        match (&aa.header, &bb.header) {
            (Some(ha), Some(hb)) => {
                if ha.sequence != hb.sequence
                    || ha.flags != hb.flags
                    || ha.id != hb.id
                    || ha.size != hb.size
                    || ha.checksum != hb.checksum
                {
                    println!(
                        "  Header DIFF: A(seq={},flags=0x{:08X},id={},size={},chk=0x{:08X}) vs B(seq={},flags=0x{:08X},id={},size={},chk=0x{:08X})",
                        ha.sequence,
                        ha.flags,
                        ha.id,
                        ha.size,
                        ha.checksum,
                        hb.sequence,
                        hb.flags,
                        hb.id,
                        hb.size,
                        hb.checksum
                    );
                } else {
                    println!(
                        "  Header MATCH: seq={}, flags=0x{:08X}, id={}, size={}, chk=0x{:08X}",
                        ha.sequence, ha.flags, ha.id, ha.size, ha.checksum
                    );
                }
            }
            (Some(ha), None) => println!(
                "  Header A present, B missing: A(seq={},flags=0x{:08X})",
                ha.sequence, ha.flags
            ),
            (None, Some(hb)) => println!(
                "  Header B present, A missing: B(seq={},flags=0x{:08X})",
                hb.sequence, hb.flags
            ),
            (None, None) => println!("  No headers parsed for either entry"),
        }
        if aa.optional_ack != bb.optional_ack {
            println!(
                "  Optional ACK DIFF: A={:?}  B={:?}",
                aa.optional_ack, bb.optional_ack
            );
        }
        // Compare first fragment data if present
        let fa = aa.frags.first();
        let fb = bb.frags.first();
        match (fa, fb) {
            (Some(fa), Some(fb)) => {
                if fa.data_hex != fb.data_hex {
                    println!(
                        "  Frag0 DIFF: A.data={} vs B.data={}",
                        fa.data_hex, fb.data_hex
                    );
                } else {
                    println!(
                        "  Frag0 MATCH: {} bytes",
                        fa.data_hex.split_whitespace().count()
                    );
                }
            }
            (Some(_), None) => println!("  Frag A present, B missing"),
            (None, Some(_)) => println!("  Frag B present, A missing"),
            (None, None) => println!("  No fragments in either"),
        }
    }

    Ok(())
}
