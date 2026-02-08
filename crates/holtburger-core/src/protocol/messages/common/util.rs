pub fn ac_hash_sort<T: Copy + Ord, V, F>(items: &mut [(T, V)], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|a, b| {
        let id_a = to_u32(a.0);
        let id_b = to_u32(b.0);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

pub fn ac_hash_sort_keys<T: Copy + Ord, F>(items: &mut [T], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|&a, &b| {
        let id_a = to_u32(a);
        let id_b = to_u32(b);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_table_sorting() {
        let mut items = vec![
            (1u32, "one"),
            (65u32, "sixty-five"),  // Bucket 1 (65 % 64)
            (25u32, "twenty-five"), // Bucket 25
        ];

        // Using 64 buckets
        ac_hash_sort(&mut items, 64, |k| k);

        // Expected order:
        // 1. GUID 1 (Bucket 1)
        // 2. GUID 65 (Bucket 1)
        // 3. GUID 25 (Bucket 25)
        assert_eq!(items[0].0, 1);
        assert_eq!(items[1].0, 65);
        assert_eq!(items[2].0, 25);
    }
}
