use holtburger_dat::file_type::RegionDesc;

/// Complete static data decoded from the host repository's one active RegionDesc.
///
/// The repository selects the active content scope. Consumers must not treat the descriptor's
/// `region_number` as a loader selector.
#[derive(Debug, Clone)]
pub struct ActiveRegionData {
    pub descriptor: RegionDesc,
}

impl ActiveRegionData {
    pub fn new(descriptor: RegionDesc) -> Self {
        Self { descriptor }
    }
}
