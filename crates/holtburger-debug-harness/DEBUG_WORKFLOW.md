# Protocol Debugging & Reverse Engineering Workflow

This guide details the "DeluluDev Approved" workflow for crushing protocol bugs without losing your rizz. When the parser panics or the data looks mid, follow these steps.

## 1. The "Isolate & Reproduce" Pattern

Don't try to debug a live TUI session. It's too noisy. Instead, isolate the problematic packet.

### Step A: Locate the Packet
Before you can extract it, you need to find it.
- **Option 1: Wireshark.** Open the `.cap` file. Find the packet (e.g., Opcode `0xF7B0`). Look at the "Packet Details" pane to find its **Offset** in the file (often called "File Offset") and its **Total Length**.
- **Option 2: Grep/Hexdump.** If you know the Opcode bytes (e.g., `B0 F7 00 00` for GameEvent), searching via hexdump can work for quick scans.

### Step B: Extract Raw Hex
Once you have the `[OFFSET]` and `[SIZE]`, use `dd` to dump it to a scratch file called `repro.hex`.

```bash
# Example: Extracting a packet at offset 12345 with size 200 bytes
dd if=caps/session0.cap bs=1 skip=12345 count=200 | hexdump -ve '1/1 "%.2x"' > repro.hex
```

### Step C: The Debug Harness
Use the `holtburger-debug-harness` to create a throwaway binary.
1. Create a new file in `src/bin/repro_bug.rs`.
2. Load the `repro.hex`.
3. Call the core parser directly (e.g., `GameMessage::unpack` or `unpack_player_description`).
4. **The Secret Sauce:** Add manual offset logging to find exactly where the parser and the data diverge.

```rust
let mut offset = 0;
// Print offsets after every field to find the "drift"
println!("Offset after Name: {}", offset); 
```

## 2. Searching for Ground Truth

Never guess. Guessing is cringe. Use the ACE Server submodule as the source of truth.

### Key Locations in ACE:
- **Packet Structure:** `ACE/Source/ACE.Server/Network/GameEvent/Events/`
  - Look for `GameEvent[MessageName].cs`. This is where the `WriteEventBody` or `Pack` logic lives.
- **Low-Level Serialization:** `ACE/Source/ACE.Server/Network/Extensions.cs`
  - Check `WriteString16L`, `WritePackedDword`, and `Align` to see how ACE handles padding and compression.
- **Data Models:** `ACE/Source/ACE.Entity/Models/`
  - Useful for checking the fixed-width size of structs.
  - **WARNING:** ACE Entity structs often map to Database storage, which may differ from the Wire format! Always cross-reference `GameEvent` code to see if fields like `Status` or timestamps are actually skipped during serialization.

### The "Active Verification" Strategy
Don't just read the C# code—run it. Static analysis (reading) assumes you understand the inheritance and extension methods perfectly. You probably don't.
1. **Create a Test:** Add a temporary test in `ACE/Source/ACE.Server.Tests/`.
2. **Serialize to Hex:** Instantiate the struct or message, populate it with known values, serialize it using ACE's own writers, and print the hex.
3. **Compare & Conquer:** This gives you the "Gold Standard" bytes. If your Rust parser reads these bytes and produces a different result, your parser is wrong. If the "Gold Standard" bytes don't match `repro.hex`, then ACE handles that scenario differently than you think.

**Pro-Tip: The "Writer Scan":** When reading C# `Pack` methods, pay close attention to the `Writer.Write` argument type. 
- `Writer.Write(intVal)` is 4 bytes.
- `Writer.Write((ushort)intVal)` is 2 bytes. 
- A common mistake is seeing a field name like `Ranks` and assuming it's a `uint32` just because most numbers in AC are. If you see a cast to `ushort` or `byte`, that's your smoking gun for a potential "Drift Bug."

## 3. Advanced Diagnostic Techniques

### The "Drift Calculation"
If your parser reads garbage data after a list/vector, you have a size mismatch in the list items.
1. Identify the *start* valid offset after the list (e.g., the next header).
2. Identify where your parser *currently* is.
3. Calculate `Diff = Actual_Offset - Expected_Offset`.
4. Divide `Diff` by the `Item_Count` of the list.
   - *Example:* We drifted 76 bytes / 38 skills = 2 bytes per skill. That's exactly the size of a `ushort`. We probably missed (or over-read) a field like `Status`. Skills are exactly 32 bytes in the `PlayerDescription` vector.

### The Corruption Sanity Check
Before blaming the parser logic, rule out reassembly failures. Scan your `repro.hex` for protocol headers that shouldn't be there.
- Search for `F7 B1` (Fragment Header) or `F7 B0` (Game Event) inside the payload.
- If found, your Pcap reassembly is broken.
- If NOT found, the data is clean, and your parser is wrong.

## 4. Rewarding Discoveries

- **Padding Nuance:** Top-level `String16L` in AC is almost always padded to a 4-byte boundary (including the 2-byte length). However, strings inside **Property Hash Tables** are **NOT** padded. 
- **Wait for Fragments:** If a message is too large for one packet, it will be fragmented. Ensure the `extractor` bin is used to reassemble fragments before parsing.
- **Fail-Soft Parsing:** When writing parsers for large vectors (Enchants, Skills), always use `break` on truncation instead of `panic!`. It makes the client much more stable in a live environment.

## 5. Best Practices

1. **Document the Fix:** Immediately update `docs/serialization.md` (and other relevant docs) if you find a new protocol quirk.
2. **Fixture Tests:** Once a bug is fixed, copy the `repro.hex` into a new `#[test]` in `messages.rs` as a regression fixture.
3. **Colocate Logic:** Keep the `debug-harness` clean. If a tool is generally useful, move it to a bin in `holtburger-debug-harness`.

Stay cracked. 💻🔥
