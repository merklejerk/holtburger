use crate::world::physics_types::{Plane, Sphere};
use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BspType {
    Drawing = 0,
    Physics = 1,
    Cell = 2,
}

#[derive(Debug, Clone)]
pub enum BspNode {
    Port(BspPortal),
    Leaf(BspLeaf),
    Internal(InternalNode),
}

#[derive(Debug, Clone)]
pub struct BspPortal {
    pub plane: Plane,
    pub pos: Box<BspNode>,
    pub neg: Box<BspNode>,
    pub poly_ids: Vec<u16>,
    pub portal_polys: Vec<PortalPoly>,
}

#[derive(Debug, Clone)]
pub struct BspLeaf {
    pub index: i32,
    pub solid: i32,
    pub sphere: Option<Sphere>,
    pub poly_ids: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct InternalNode {
    pub tag: [u8; 4],
    pub plane: Plane,
    pub pos: Option<Box<BspNode>>,
    pub neg: Option<Box<BspNode>>,
    pub sphere: Option<Sphere>,
    pub poly_ids: Vec<u16>,
}

#[derive(BinRead, Debug, Clone, Copy, PartialEq, Eq)]
#[br(little)]
pub struct PortalPoly {
    pub portal_index: i16,
    pub poly_id: i16,
}

impl BspNode {
    pub fn read<R: Read + Seek>(reader: &mut R, tree_type: BspType) -> BinResult<Self> {
        let mut tag = [0u8; 4];
        reader.read_exact(&mut tag)?;

        // Match on the literal disk order (Little Endian bytes of ASCII "BPnn" etc.)
        // AC stores these as 4-byte strings.
        match &tag {
            b"TROP" => Ok(BspNode::Port(BspPortal::read(reader, tree_type)?)), // PORT
            b"FAEL" => Ok(BspNode::Leaf(BspLeaf::read(reader, tree_type)?)),   // LEAF
            _ => Ok(BspNode::Internal(InternalNode::read(
                reader, tree_type, tag,
            )?)),
        }
    }

    /// Check if a sphere intersects any "solid" space within this BSP tree.
    pub fn intersects_solid(
        &self,
        center: &crate::world::physics_types::Vector3,
        radius: f32,
    ) -> bool {
        match self {
            BspNode::Port(p) => {
                let dist = p.plane.distance_to_point(center);
                if dist > radius {
                    p.pos.intersects_solid(center, radius)
                } else if dist < -radius {
                    p.neg.intersects_solid(center, radius)
                } else {
                    // Straddle: check both sides
                    p.pos.intersects_solid(center, radius) || p.neg.intersects_solid(center, radius)
                }
            }
            BspNode::Leaf(l) => {
                // If it's a solid leaf, and the sphere could possibly be in it, it's a hit.
                // We trust the tree structure to lead us to the right leaf,
                // but checking the bounding sphere is a safe extra layer.
                if l.solid == 1 {
                    if let Some(s) = &l.sphere {
                        return s.intersects(center, radius);
                    }
                    return true;
                }
                false
            }
            BspNode::Internal(i) => {
                // Early exit using bounding sphere if present.
                if let Some(s) = &i.sphere
                    && !s.intersects(center, radius)
                {
                    return false;
                }

                let dist = i.plane.distance_to_point(center);

                // If the sphere is on the positive side (or straddling), check the positive subtree.
                if dist >= -radius
                    && let Some(pos) = &i.pos
                    && pos.intersects_solid(center, radius)
                {
                    return true;
                }

                // If the sphere is on the negative side (or straddling), check the negative subtree.
                if dist <= radius
                    && let Some(neg) = &i.neg
                    && neg.intersects_solid(center, radius)
                {
                    return true;
                }

                false
            }
        }
    }
}

impl BspPortal {
    pub fn read<R: Read + Seek>(reader: &mut R, tree_type: BspType) -> BinResult<Self> {
        let plane = Plane::read_le(reader)?;
        let pos = Box::new(BspNode::read(reader, tree_type)?);
        let neg = Box::new(BspNode::read(reader, tree_type)?);

        let mut poly_ids = Vec::new();
        let mut portal_polys = Vec::new();

        if tree_type == BspType::Drawing {
            let _sphere = Sphere::read_le(reader)?;
            let num_polys = u32::read_le(reader)?;
            let num_portals = u32::read_le(reader)?;

            for _ in 0..num_polys {
                poly_ids.push(u16::read_le(reader)?);
            }

            for _ in 0..num_portals {
                portal_polys.push(PortalPoly::read(reader)?);
            }
        }

        Ok(BspPortal {
            plane,
            pos,
            neg,
            poly_ids,
            portal_polys,
        })
    }
}

impl BspLeaf {
    pub fn read<R: Read + Seek>(reader: &mut R, tree_type: BspType) -> BinResult<Self> {
        let index = i32::read_le(reader)?;
        let mut solid = 0;
        let mut sphere = None;
        let mut poly_ids = Vec::new();

        if tree_type == BspType::Physics {
            solid = i32::read_le(reader)?;
            sphere = Some(Sphere::read_le(reader)?);
            let num_polys = u32::read_le(reader)?;
            for _ in 0..num_polys {
                poly_ids.push(u16::read_le(reader)?);
            }
        }

        Ok(BspLeaf {
            index,
            solid,
            sphere,
            poly_ids,
        })
    }
}

impl InternalNode {
    pub fn read<R: Read + Seek>(
        reader: &mut R,
        tree_type: BspType,
        tag: [u8; 4],
    ) -> BinResult<Self> {
        let plane = Plane::read_le(reader)?;

        let mut pos = None;
        let mut neg = None;

        // Bitmask for child existence based on tag:
        // BPnn (nnPB): Pos
        // BPIn (nIPB): Pos
        // BpIN (NIPb): Neg
        // BpnN (NnPb): Neg
        // BPIN (NIPB): Both
        // BPnN (NnPB): Both
        match &tag {
            b"nnPB" | b"nIPB" => {
                pos = Some(Box::new(BspNode::read(reader, tree_type)?));
            }
            b"NIPb" | b"NnPb" => {
                neg = Some(Box::new(BspNode::read(reader, tree_type)?));
            }
            b"NIPB" | b"NnPB" => {
                pos = Some(Box::new(BspNode::read(reader, tree_type)?));
                neg = Some(Box::new(BspNode::read(reader, tree_type)?));
            }
            _ => {}
        }

        let mut sphere = None;
        let mut poly_ids = Vec::new();

        if tree_type != BspType::Cell {
            sphere = Some(Sphere::read_le(reader)?);
            if tree_type != BspType::Physics {
                let num_polys = u32::read_le(reader)?;
                for _ in 0..num_polys {
                    poly_ids.push(u16::read_le(reader)?);
                }
            }
        }

        Ok(InternalNode {
            tag,
            plane,
            pos,
            neg,
            sphere,
            poly_ids,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_bsp_leaf_parsing() {
        let mut data = Vec::new();
        data.extend_from_slice(b"FAEL"); // LEAF
        data.extend_from_slice(&(123i32).to_le_bytes()); // Index
        data.extend_from_slice(&(1i32).to_le_bytes()); // Solid
        // Sphere (Center {0,0,0}, Radius 5.0)
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(5.0f32).to_le_bytes());
        // NumPolys
        data.extend_from_slice(&(2u32).to_le_bytes());
        // PolyIds
        data.extend_from_slice(&(10u16).to_le_bytes());
        data.extend_from_slice(&(20u16).to_le_bytes());

        let mut cursor = Cursor::new(data);
        let node = BspNode::read(&mut cursor, BspType::Physics).unwrap();

        if let BspNode::Leaf(leaf) = node {
            assert_eq!(leaf.index, 123);
            assert_eq!(leaf.solid, 1);
            assert_eq!(leaf.sphere.unwrap().radius, 5.0);
            assert_eq!(leaf.poly_ids, vec![10, 20]);
        } else {
            panic!("Expected Leaf node");
        }
    }

    #[test]
    fn test_recursive_bsp_internal() {
        let mut data = Vec::new();
        // Root: BPnn (only pos child)
        data.extend_from_slice(b"nnPB");
        // Plane (Normal {0,1,0}, D -10)
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(1.0f32).to_le_bytes());
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(-10.0f32).to_le_bytes());

        // Pos Child: LEAF
        data.extend_from_slice(b"FAEL");
        data.extend_from_slice(&(1i32).to_le_bytes()); // Index
        data.extend_from_slice(&(0i32).to_le_bytes()); // Solid
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sphere Center X
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sphere Center Y
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sphere Center Z
        data.extend_from_slice(&(1.0f32).to_le_bytes()); // Sphere Radius
        data.extend_from_slice(&(0u32).to_le_bytes()); // NumPolys

        // Internal Sphere (for the BPnn node)
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(10.0f32).to_le_bytes());
        data.extend_from_slice(&(0.0f32).to_le_bytes());
        data.extend_from_slice(&(20.0f32).to_le_bytes());

        let mut cursor = Cursor::new(data);
        let node = BspNode::read(&mut cursor, BspType::Physics).unwrap();

        if let BspNode::Internal(node) = node {
            assert_eq!(&node.tag, b"nnPB");
            assert!(node.pos.is_some());
            assert!(node.neg.is_none());
            assert_eq!(node.sphere.unwrap().radius, 20.0);

            if let BspNode::Leaf(child) = *node.pos.unwrap() {
                assert_eq!(child.index, 1);
            } else {
                panic!("Expected Leaf child");
            }
        } else {
            panic!("Expected Internal node");
        }
    }
}
