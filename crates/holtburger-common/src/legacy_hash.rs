/// Retail legacy hash consumes signed Windows-1252 bytes, not Unicode codepoints.
/// acclient.c:287412; preserving source bytes avoids a lossy text round trip.
pub fn legacy_string_hash(bytes: &[u8]) -> u32 {
    let mut hash = 0u32;
    for &byte in bytes.iter().take_while(|&&byte| byte != 0) {
        hash = hash
            .wrapping_mul(16)
            .wrapping_add(i32::from(byte as i8) as u32);
        let high = hash & 0xf0000000;
        if high != 0 {
            hash = (hash ^ (high >> 24)) & 0x0fffffff;
        }
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_string_hash_uses_signed_source_bytes_and_stops_at_nul() {
        assert_eq!(legacy_string_hash(b"A"), 65);
        assert_eq!(legacy_string_hash(&[b'A', 0x92]), 930);
        assert_eq!(legacy_string_hash(b"A\0ignored"), 65);
    }
}
