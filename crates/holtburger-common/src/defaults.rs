/// Default sell rate for promissory notes/trade notes.
///
/// Ground truth from ACE Server: `if (itemType == ItemType.PromissoryNote) sellRate = 1.15;`
pub const PROMISSORY_NOTE_SELL_RATE: f32 = 1.15;

/// The default price for most items when a better value can't be calculated.
pub const DEFAULT_PRICE: u32 = 1;

/// The offset from the ceil calculation for vendor prices to ensure bit-perfect matching with retail.
///
/// Ground truth from ACE Server: `Math.Ceiling((float)sellRate * value) - 0.1`
pub const VENDOR_CEIL_OFFSET: f32 = 0.1;
