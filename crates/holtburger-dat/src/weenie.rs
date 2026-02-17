use crate::Result;
use crate::utils::{align_boundary, read_pstring};
use binrw::BinRead;
use binrw::io::Cursor;
use holtburger_common::properties::{PropertyDataId, PropertyString};
use std::collections::HashMap;
use std::io::{Read, Seek};

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
        Self::unpack_from_reader(&mut cursor)
    }

    pub fn unpack_from_reader<R: Read + Seek>(reader: &mut R) -> Result<Self> {
        let wcid = u32::read_le(reader)?;
        let weenie_type = u32::read_le(reader)?;
        let _flags = u32::read_le(reader)?;

        let mut weenie = Weenie {
            wcid,
            weenie_type,
            ..Default::default()
        };

        // Int Bucket
        let count_int = u16::read_le(reader)?;
        for _ in 0..count_int {
            let key = u32::read_le(reader)?;
            let value = i32::read_le(reader)?;
            weenie.properties_int.insert(key, value);
        }

        // Int64 Bucket
        let count_int64 = u16::read_le(reader)?;
        for _ in 0..count_int64 {
            let key = u32::read_le(reader)?;
            let value = i64::read_le(reader)?;
            weenie.properties_int64.insert(key, value);
        }

        // Bool Bucket
        let count_bool = u16::read_le(reader)?;
        for _ in 0..count_bool {
            let key = u32::read_le(reader)?;
            let value = u8::read(reader)? != 0;
            weenie.properties_bool.insert(key, value);
        }

        // Float Bucket
        let count_float = u16::read_le(reader)?;
        for _ in 0..count_float {
            let key = u32::read_le(reader)?;
            let value = f64::read_le(reader)?;
            weenie.properties_float.insert(key, value);
        }

        // String Bucket
        let count_string = u16::read_le(reader)?;
        for _ in 0..count_string {
            let key = u32::read_le(reader)?;
            let value = read_pstring(reader, 2)?;
            weenie.properties_string.insert(key, value);
            let _ = align_boundary(reader, 4);
        }

        // DID Bucket
        let count_did = u16::read_le(reader)?;
        for _ in 0..count_did {
            let key = u32::read_le(reader)?;
            let value = u32::read_le(reader)?;
            weenie.properties_did.insert(key, value);
        }

        // IID Bucket
        let count_iid = u16::read_le(reader)?;
        for _ in 0..count_iid {
            let key = u32::read_le(reader)?;
            let value = u32::read_le(reader)?;
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

#[derive(Debug, Clone, Default)]
pub struct WeenieTable {
    pub id: u32,
    pub entries: HashMap<u32, Weenie>,
}

impl WeenieTable {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(data);

        let id = u32::read_le(&mut cursor)?;
        let count = u16::read_le(&mut cursor)?;
        let _bucket_size = u16::read_le(&mut cursor)?;

        let mut entries = HashMap::with_capacity(count as usize);
        for _ in 0..count {
            let key = u32::read_le(&mut cursor)?;
            let weenie = Weenie::unpack_from_reader(&mut cursor)?;
            entries.insert(key, weenie);
        }

        Ok(Self { id, entries })
    }
}
