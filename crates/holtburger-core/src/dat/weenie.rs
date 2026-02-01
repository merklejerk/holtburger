use super::utils::{align_boundary, read_pstring};
use crate::protocol::properties::{PropertyDataId, PropertyString};
use anyhow::Result;
use binrw::BinRead;
use binrw::io::Cursor;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct Weenie {
    pub wcid: u32,
    pub weenie_type: u32,
    pub properties_int: HashMap<u32, i32>,
    pub properties_int64: HashMap<u32, i64>,
    pub properties_bool: HashMap<u32, bool>,
    pub properties_float: HashMap<u32, f64>,
    pub properties_string: HashMap<u32, String>,
    pub properties_did: HashMap<u32, u32>,
    pub properties_iid: HashMap<u32, u32>,
}

impl Weenie {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(data);

        let wcid = u32::read_le(&mut cursor)?;
        let weenie_type = u32::read_le(&mut cursor)?;
        let _flags = u32::read_le(&mut cursor)?;

        let mut weenie = Weenie {
            wcid,
            weenie_type,
            ..Default::default()
        };

        // Int Bucket
        let count_int = u16::read_le(&mut cursor)?;
        for _ in 0..count_int {
            let key = u32::read_le(&mut cursor)?;
            let value = i32::read_le(&mut cursor)?;
            weenie.properties_int.insert(key, value);
        }

        // Int64 Bucket
        let count_int64 = u16::read_le(&mut cursor)?;
        for _ in 0..count_int64 {
            let key = u32::read_le(&mut cursor)?;
            let value = i64::read_le(&mut cursor)?;
            weenie.properties_int64.insert(key, value);
        }

        // Bool Bucket
        let count_bool = u16::read_le(&mut cursor)?;
        for _ in 0..count_bool {
            let key = u32::read_le(&mut cursor)?;
            let value = u8::read(&mut cursor)? != 0;
            weenie.properties_bool.insert(key, value);
        }

        // Float Bucket
        let count_float = u16::read_le(&mut cursor)?;
        for _ in 0..count_float {
            let key = u32::read_le(&mut cursor)?;
            let value = f64::read_le(&mut cursor)?;
            weenie.properties_float.insert(key, value);
        }

        // String Bucket
        let count_string = u16::read_le(&mut cursor)?;
        for _ in 0..count_string {
            let key = u32::read_le(&mut cursor)?;
            let value = read_pstring(&mut cursor, 2)?;
            weenie.properties_string.insert(key, value);
            let _ = align_boundary(&mut cursor, 4);
        }

        // DID Bucket
        let count_did = u16::read_le(&mut cursor)?;
        for _ in 0..count_did {
            let key = u32::read_le(&mut cursor)?;
            let value = u32::read_le(&mut cursor)?;
            weenie.properties_did.insert(key, value);
        }

        // IID Bucket
        let count_iid = u16::read_le(&mut cursor)?;
        for _ in 0..count_iid {
            let key = u32::read_le(&mut cursor)?;
            let value = u32::read_le(&mut cursor)?;
            weenie.properties_iid.insert(key, value);
        }

        Ok(weenie)
    }

    pub fn name(&self) -> Option<&String> {
        self.properties_string.get(&(PropertyString::Name as u32))
    }

    pub fn icon_id(&self) -> Option<u32> {
        self.properties_did
            .get(&(PropertyDataId::Icon as u32))
            .copied()
    }
}
