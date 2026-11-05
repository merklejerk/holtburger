# Synthetic content fixtures

`minimal-content.hba.fixture` is a synthetic HBA v2 containing one authored test palette
(`eor/portal:0x04000001`, one opaque white color) and the 3D admission sentinel
(`eor/portal:0x0500000C`, a synthetic surface texture with no render surfaces).
It contains no retail content. The sentinel lets recovery probes reach later bootstrap
failures instead of stopping at profile admission.
`minimal-content.dat.fixture` encodes the identical records in a retail-layout
base portal DAT (dataset 1, subset 0). The sidecar smoke copies each to a temporary
archive path to exercise real archive
opening, mode admission, and orderly shutdown without runtime asset dependencies.

This is deliberately sufficient only for shallow host startup. Region, scene,
and client bootstrap requests must still fail when their necessary assets are
requested. It does not represent a complete installation.

The layout follows `holtburger-dat/src/archive.rs`: 24-byte header, 12-byte
uncompressed palette, 13-byte surface texture, 44-byte namespace index, and two
60-byte resource index entries. Update this fixture when the archive format changes.

The DAT is 6,144 bytes: a header at `0x140`, 1,024-byte sectors, a single-leaf
directory starting at 2,048 and chained across two sectors, and the palette at
4,096. The surface texture starts at 5,120. The directory has 62 empty branch
pointers and two uncompressed records.
All other bytes are zero. It contains no retail content.
