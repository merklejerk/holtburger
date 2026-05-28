use anyhow::{Context, Result, anyhow, bail};
use holtburger_dat::file_type::{PixelFormatId, RenderSurface};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Rgba {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

pub(super) fn validate_compressed_source(render_surface: &RenderSurface) -> Result<()> {
    let expected = compressed_byte_length(
        render_surface.width,
        render_surface.height,
        render_surface.format,
    )
    .with_context(|| format!("RenderSurface 0x{:08X} is not DXT", render_surface.id))?;
    if render_surface.source_data.len() != expected {
        bail!(
            "RenderSurface 0x{:08X} expected {expected} compressed bytes, got {}",
            render_surface.id,
            render_surface.source_data.len()
        );
    }
    Ok(())
}

pub(super) fn decode_dxt_surface_downsampled_2x(
    render_surface: &RenderSurface,
) -> Result<Vec<Rgba>> {
    let source_width = usize::try_from(render_surface.width).context("source width fits usize")?;
    let source_height =
        usize::try_from(render_surface.height).context("source height fits usize")?;
    let target_width = usize::try_from(next_mip_dimension(render_surface.width))
        .context("target width fits usize")?;
    let target_height = usize::try_from(next_mip_dimension(render_surface.height))
        .context("target height fits usize")?;
    let mut target = vec![
        Rgba {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
        };
        target_width * target_height
    ];
    let blocks_x = block_count(render_surface.width);
    let blocks_y = block_count(render_surface.height);
    let bytes_per_block = usize::from(
        render_surface
            .format
            .block_compressed_bytes_per_4x4_block()
            .ok_or_else(|| anyhow!("unsupported DXT format {:?}", render_surface.format))?,
    );
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            let offset = (block_y * blocks_x + block_x) * bytes_per_block;
            let block = &render_surface.source_data[offset..offset + bytes_per_block];
            let values = decode_dxt_block_values(block, render_surface.format)?;
            let source_x = block_x * 4;
            let source_y = block_y * 4;
            if source_x + 4 <= source_width && source_y + 4 <= source_height {
                write_downsampled_full_dxt_block(
                    &values,
                    block_x * 2,
                    block_y * 2,
                    target_width,
                    &mut target,
                );
            } else {
                write_downsampled_edge_dxt_block(
                    &values,
                    source_x,
                    source_y,
                    source_width,
                    source_height,
                    target_width,
                    &mut target,
                );
            }
        }
    }
    Ok(target)
}

pub(super) fn decode_dxt_surface_rgba8_bytes(render_surface: &RenderSurface) -> Result<Vec<u8>> {
    let pixels = decode_dxt_surface(render_surface)?;
    let mut bytes = Vec::with_capacity(pixels.len() * 4);
    for pixel in pixels {
        bytes.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
    }
    Ok(bytes)
}

pub(super) fn downsample_rgba_2x(
    source: &[Rgba],
    source_width: u32,
    source_height: u32,
) -> Result<Vec<Rgba>> {
    let target_width = next_mip_dimension(source_width);
    let target_height = next_mip_dimension(source_height);
    let source_width_usize = usize::try_from(source_width).context("source width fits usize")?;
    let source_height_usize = usize::try_from(source_height).context("source height fits usize")?;
    let target_width_usize = usize::try_from(target_width).context("target width fits usize")?;
    let target_height_usize = usize::try_from(target_height).context("target height fits usize")?;

    if source_width.is_multiple_of(2) && source_height.is_multiple_of(2) {
        return downsample_rgba_2x_even(source, source_width_usize, target_width_usize);
    }

    let mut target = Vec::with_capacity(target_width_usize * target_height_usize);
    for y in 0..target_height_usize {
        for x in 0..target_width_usize {
            let mut r = 0u32;
            let mut g = 0u32;
            let mut b = 0u32;
            let mut a = 0u32;
            let mut count = 0u32;
            for source_y in [y * 2, y * 2 + 1] {
                if source_y >= source_height_usize {
                    continue;
                }
                for source_x in [x * 2, x * 2 + 1] {
                    if source_x >= source_width_usize {
                        continue;
                    }
                    let pixel = source[source_y * source_width_usize + source_x];
                    r += u32::from(pixel.r);
                    g += u32::from(pixel.g);
                    b += u32::from(pixel.b);
                    a += u32::from(pixel.a);
                    count += 1;
                }
            }
            target.push(Rgba {
                r: average_u8(r, count),
                g: average_u8(g, count),
                b: average_u8(b, count),
                a: average_u8(a, count),
            });
        }
    }
    Ok(target)
}

pub(super) fn encode_dxt_surface(
    pixels: &[Rgba],
    width: u32,
    height: u32,
    format: PixelFormatId,
) -> Result<Vec<u8>> {
    let expected_pixels = usize::try_from(width)
        .and_then(|w| usize::try_from(height).map(|h| w * h))
        .context("mip dimensions fit usize")?;
    if pixels.len() != expected_pixels {
        bail!("mip pixel count mismatch");
    }
    let byte_len = compressed_byte_length(width, height, format)
        .ok_or_else(|| anyhow!("unsupported DXT encode format {:?}", format))?;
    let mut bytes = vec![0u8; byte_len];
    let blocks_x = block_count(width);
    let blocks_y = block_count(height);
    let bytes_per_block = usize::from(
        format
            .block_compressed_bytes_per_4x4_block()
            .ok_or_else(|| anyhow!("unsupported DXT encode format {:?}", format))?,
    );
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            let block = collect_block_pixels(pixels, width, height, block_x, block_y);
            let block_index = block_y * blocks_x + block_x;
            let offset = block_index * bytes_per_block;
            encode_dxt_block(&block, format, &mut bytes[offset..offset + bytes_per_block])?;
        }
    }
    Ok(bytes)
}

pub(super) fn next_mip_dimension(value: u32) -> u32 {
    (value / 2).max(1)
}

fn compressed_byte_length(width: u32, height: u32, format: PixelFormatId) -> Option<usize> {
    let bytes_per_block = usize::from(format.block_compressed_bytes_per_4x4_block()?);
    Some(block_count(width) * block_count(height) * bytes_per_block)
}

fn block_count(size: u32) -> usize {
    usize::try_from(size.div_ceil(4)).expect("block count fits usize")
}

fn decode_dxt_surface(render_surface: &RenderSurface) -> Result<Vec<Rgba>> {
    let width = usize::try_from(render_surface.width).context("width fits usize")?;
    let height = usize::try_from(render_surface.height).context("height fits usize")?;
    let mut pixels = vec![
        Rgba {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
        };
        width * height
    ];
    let blocks_x = block_count(render_surface.width);
    let blocks_y = block_count(render_surface.height);
    let bytes_per_block = usize::from(
        render_surface
            .format
            .block_compressed_bytes_per_4x4_block()
            .ok_or_else(|| anyhow!("unsupported DXT format {:?}", render_surface.format))?,
    );
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            let offset = (block_y * blocks_x + block_x) * bytes_per_block;
            let block = &render_surface.source_data[offset..offset + bytes_per_block];
            let values = decode_dxt_block_values(block, render_surface.format)?;
            for local_y in 0..4usize {
                let y = block_y * 4 + local_y;
                if y >= height {
                    continue;
                }
                for local_x in 0..4usize {
                    let x = block_x * 4 + local_x;
                    if x >= width {
                        continue;
                    }
                    pixels[y * width + x] = values[local_y * 4 + local_x];
                }
            }
        }
    }
    Ok(pixels)
}

fn decode_dxt_block_values(block: &[u8], format: PixelFormatId) -> Result<[Rgba; 16]> {
    let (alpha_values, color_offset) = match format {
        PixelFormatId::Dxt1 => ([255u8; 16], 0usize),
        PixelFormatId::Dxt3 => (decode_dxt3_alpha(&block[0..8]), 8usize),
        PixelFormatId::Dxt5 => (decode_dxt5_alpha(&block[0..8]), 8usize),
        _ => bail!("unsupported DXT block format {:?}", format),
    };
    let mut values = decode_dxt_color_values(&block[color_offset..color_offset + 8], format);
    for (value, alpha) in values.iter_mut().zip(alpha_values) {
        value.a = alpha;
    }
    Ok(values)
}

fn write_downsampled_full_dxt_block(
    values: &[Rgba; 16],
    target_x: usize,
    target_y: usize,
    target_width: usize,
    target: &mut [Rgba],
) {
    target[target_y * target_width + target_x] =
        average_rgba_2x2(values[0], values[1], values[4], values[5]);
    target[target_y * target_width + target_x + 1] =
        average_rgba_2x2(values[2], values[3], values[6], values[7]);
    target[(target_y + 1) * target_width + target_x] =
        average_rgba_2x2(values[8], values[9], values[12], values[13]);
    target[(target_y + 1) * target_width + target_x + 1] =
        average_rgba_2x2(values[10], values[11], values[14], values[15]);
}

fn write_downsampled_edge_dxt_block(
    values: &[Rgba; 16],
    source_x: usize,
    source_y: usize,
    source_width: usize,
    source_height: usize,
    target_width: usize,
    target: &mut [Rgba],
) {
    let mut sums = [(0u32, 0u32, 0u32, 0u32, 0u32); 4];
    for local_y in 0..4usize {
        let y = source_y + local_y;
        if y >= source_height {
            continue;
        }
        for local_x in 0..4usize {
            let x = source_x + local_x;
            if x >= source_width {
                continue;
            }
            let target_local = (local_y / 2) * 2 + (local_x / 2);
            let pixel = values[local_y * 4 + local_x];
            let (r, g, b, a, count) = &mut sums[target_local];
            *r += u32::from(pixel.r);
            *g += u32::from(pixel.g);
            *b += u32::from(pixel.b);
            *a += u32::from(pixel.a);
            *count += 1;
        }
    }

    let target_x = source_x / 2;
    let target_y = source_y / 2;
    for local_target_y in 0..2usize {
        for local_target_x in 0..2usize {
            let (r, g, b, a, count) = sums[local_target_y * 2 + local_target_x];
            if count == 0 {
                continue;
            }
            target[(target_y + local_target_y) * target_width + target_x + local_target_x] = Rgba {
                r: average_u8(r, count),
                g: average_u8(g, count),
                b: average_u8(b, count),
                a: average_u8(a, count),
            };
        }
    }
}

fn average_rgba_2x2(
    top_left: Rgba,
    top_right: Rgba,
    bottom_left: Rgba,
    bottom_right: Rgba,
) -> Rgba {
    Rgba {
        r: average_u8(
            u32::from(top_left.r)
                + u32::from(top_right.r)
                + u32::from(bottom_left.r)
                + u32::from(bottom_right.r),
            4,
        ),
        g: average_u8(
            u32::from(top_left.g)
                + u32::from(top_right.g)
                + u32::from(bottom_left.g)
                + u32::from(bottom_right.g),
            4,
        ),
        b: average_u8(
            u32::from(top_left.b)
                + u32::from(top_right.b)
                + u32::from(bottom_left.b)
                + u32::from(bottom_right.b),
            4,
        ),
        a: average_u8(
            u32::from(top_left.a)
                + u32::from(top_right.a)
                + u32::from(bottom_left.a)
                + u32::from(bottom_right.a),
            4,
        ),
    }
}

fn decode_dxt3_alpha(block: &[u8]) -> [u8; 16] {
    let mut values = [255u8; 16];
    for index in 0..16usize {
        let byte = block[index / 2];
        let nibble = if index % 2 == 0 {
            byte & 0x0f
        } else {
            (byte >> 4) & 0x0f
        };
        values[index] = (nibble << 4) | nibble;
    }
    values
}

fn decode_dxt5_alpha(block: &[u8]) -> [u8; 16] {
    let alpha0 = block[0];
    let alpha1 = block[1];
    let palette = dxt5_alpha_palette(alpha0, alpha1);
    let mut bits = 0u64;
    for index in 0..6usize {
        bits |= u64::from(block[2 + index]) << (8 * index);
    }
    let mut values = [255u8; 16];
    for (index, value) in values.iter_mut().enumerate() {
        let palette_index =
            usize::try_from((bits >> (index * 3)) & 0x07).expect("alpha palette index fits usize");
        *value = palette[palette_index];
    }
    values
}

fn dxt5_alpha_palette(alpha0: u8, alpha1: u8) -> [u8; 8] {
    if alpha0 > alpha1 {
        [
            alpha0,
            alpha1,
            lerp_u8(alpha0, alpha1, 6, 1, 7),
            lerp_u8(alpha0, alpha1, 5, 2, 7),
            lerp_u8(alpha0, alpha1, 4, 3, 7),
            lerp_u8(alpha0, alpha1, 3, 4, 7),
            lerp_u8(alpha0, alpha1, 2, 5, 7),
            lerp_u8(alpha0, alpha1, 1, 6, 7),
        ]
    } else {
        [
            alpha0,
            alpha1,
            lerp_u8(alpha0, alpha1, 4, 1, 5),
            lerp_u8(alpha0, alpha1, 3, 2, 5),
            lerp_u8(alpha0, alpha1, 2, 3, 5),
            lerp_u8(alpha0, alpha1, 1, 4, 5),
            0,
            255,
        ]
    }
}

fn decode_dxt_color_values(block: &[u8], format: PixelFormatId) -> [Rgba; 16] {
    let color0 = u16::from_le_bytes([block[0], block[1]]);
    let color1 = u16::from_le_bytes([block[2], block[3]]);
    let palette = dxt_color_palette(color0, color1, format);
    let bits = u32::from_le_bytes([block[4], block[5], block[6], block[7]]);
    let mut values = [Rgba {
        r: 0,
        g: 0,
        b: 0,
        a: 255,
    }; 16];
    for (index, value) in values.iter_mut().enumerate() {
        let palette_index =
            usize::try_from((bits >> (index * 2)) & 0x03).expect("color palette index fits usize");
        *value = palette[palette_index];
    }
    values
}

fn dxt_color_palette(color0: u16, color1: u16, format: PixelFormatId) -> [Rgba; 4] {
    let c0 = rgb565_to_rgba(color0);
    let c1 = rgb565_to_rgba(color1);
    if format != PixelFormatId::Dxt1 || color0 > color1 {
        [
            c0,
            c1,
            Rgba {
                r: lerp_u8(c0.r, c1.r, 2, 1, 3),
                g: lerp_u8(c0.g, c1.g, 2, 1, 3),
                b: lerp_u8(c0.b, c1.b, 2, 1, 3),
                a: 255,
            },
            Rgba {
                r: lerp_u8(c0.r, c1.r, 1, 2, 3),
                g: lerp_u8(c0.g, c1.g, 1, 2, 3),
                b: lerp_u8(c0.b, c1.b, 1, 2, 3),
                a: 255,
            },
        ]
    } else {
        [
            c0,
            c1,
            Rgba {
                r: lerp_u8(c0.r, c1.r, 1, 1, 2),
                g: lerp_u8(c0.g, c1.g, 1, 1, 2),
                b: lerp_u8(c0.b, c1.b, 1, 1, 2),
                a: 255,
            },
            Rgba {
                r: 0,
                g: 0,
                b: 0,
                a: 0,
            },
        ]
    }
}

fn rgb565_to_rgba(value: u16) -> Rgba {
    Rgba {
        r: scale_bits_to_byte(u32::from((value >> 11) & 0x1f), 5),
        g: scale_bits_to_byte(u32::from((value >> 5) & 0x3f), 6),
        b: scale_bits_to_byte(u32::from(value & 0x1f), 5),
        a: 255,
    }
}

fn rgba_to_rgb565(color: Rgba) -> u16 {
    let r = (u16::from(color.r) * 31 + 127) / 255;
    let g = (u16::from(color.g) * 63 + 127) / 255;
    let b = (u16::from(color.b) * 31 + 127) / 255;
    (r << 11) | (g << 5) | b
}

fn downsample_rgba_2x_even(
    source: &[Rgba],
    source_width: usize,
    target_width: usize,
) -> Result<Vec<Rgba>> {
    if !source.len().is_multiple_of(source_width) {
        bail!("even downsample source pixel count does not match width");
    }
    let source_height = source.len() / source_width;
    let target_height = source_height / 2;
    let mut target = Vec::with_capacity(target_width * target_height);
    for y in 0..target_height {
        let top_row = y * 2 * source_width;
        let bottom_row = top_row + source_width;
        for x in 0..target_width {
            let left = x * 2;
            target.push(average_rgba_2x2(
                source[top_row + left],
                source[top_row + left + 1],
                source[bottom_row + left],
                source[bottom_row + left + 1],
            ));
        }
    }
    Ok(target)
}

fn collect_block_pixels(
    pixels: &[Rgba],
    width: u32,
    height: u32,
    block_x: usize,
    block_y: usize,
) -> [Rgba; 16] {
    let width_usize = usize::try_from(width).expect("width fits usize");
    let height_usize = usize::try_from(height).expect("height fits usize");
    let mut block = [Rgba {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    }; 16];
    for local_y in 0..4usize {
        let y = (block_y * 4 + local_y).min(height_usize.saturating_sub(1));
        for local_x in 0..4usize {
            let x = (block_x * 4 + local_x).min(width_usize.saturating_sub(1));
            block[local_y * 4 + local_x] = pixels[y * width_usize + x];
        }
    }
    block
}

fn encode_dxt_block(block: &[Rgba; 16], format: PixelFormatId, target: &mut [u8]) -> Result<()> {
    match format {
        PixelFormatId::Dxt1 => encode_dxt_color_block(block, PixelFormatId::Dxt1, target),
        PixelFormatId::Dxt3 => {
            encode_dxt3_alpha_block(block, &mut target[0..8]);
            encode_dxt_color_block(block, PixelFormatId::Dxt3, &mut target[8..16]);
        }
        PixelFormatId::Dxt5 => {
            encode_dxt5_alpha_block(block, &mut target[0..8]);
            encode_dxt_color_block(block, PixelFormatId::Dxt5, &mut target[8..16]);
        }
        _ => bail!("unsupported DXT encode format {:?}", format),
    }
    Ok(())
}

fn encode_dxt_color_block(block: &[Rgba; 16], format: PixelFormatId, target: &mut [u8]) {
    if let Some(color) = uniform_rgb565(block) {
        target[0..2].copy_from_slice(&color.to_le_bytes());
        target[2..4].copy_from_slice(&color.to_le_bytes());
        target[4..8].copy_from_slice(&0u32.to_le_bytes());
        return;
    }

    let (min_color, max_color) = block_color_range(block);
    let mut color0 = rgba_to_rgb565(max_color);
    let mut color1 = rgba_to_rgb565(min_color);
    if color0 <= color1 {
        std::mem::swap(&mut color0, &mut color1);
    }
    target[0..2].copy_from_slice(&color0.to_le_bytes());
    target[2..4].copy_from_slice(&color1.to_le_bytes());
    let palette = dxt_color_palette(color0, color1, format);
    let mut bits = 0u32;
    for (index, pixel) in block.iter().enumerate() {
        let palette_index = nearest_color_index(*pixel, &palette);
        bits |= u32::try_from(palette_index).expect("palette index fits u32") << (index * 2);
    }
    target[4..8].copy_from_slice(&bits.to_le_bytes());
}

fn uniform_rgb565(block: &[Rgba; 16]) -> Option<u16> {
    let first = block[0];
    block
        .iter()
        .all(|pixel| pixel.r == first.r && pixel.g == first.g && pixel.b == first.b)
        .then(|| rgba_to_rgb565(first))
}

fn block_color_range(block: &[Rgba; 16]) -> (Rgba, Rgba) {
    let mut min_r = block[0];
    let mut max_r = block[0];
    let mut min_g = block[0];
    let mut max_g = block[0];
    let mut min_b = block[0];
    let mut max_b = block[0];
    for pixel in block {
        if pixel.r < min_r.r {
            min_r = *pixel;
        }
        if pixel.r > max_r.r {
            max_r = *pixel;
        }
        if pixel.g < min_g.g {
            min_g = *pixel;
        }
        if pixel.g > max_g.g {
            max_g = *pixel;
        }
        if pixel.b < min_b.b {
            min_b = *pixel;
        }
        if pixel.b > max_b.b {
            max_b = *pixel;
        }
    }

    let red_range = max_r.r - min_r.r;
    let green_range = max_g.g - min_g.g;
    let blue_range = max_b.b - min_b.b;
    let (first, second) = if green_range >= red_range && green_range >= blue_range {
        (min_g, max_g)
    } else if red_range >= blue_range {
        (min_r, max_r)
    } else {
        (min_b, max_b)
    };

    if color_luma(first) <= color_luma(second) {
        (first, second)
    } else {
        (second, first)
    }
}

fn color_luma(color: Rgba) -> u32 {
    u32::from(color.r) * 77 + u32::from(color.g) * 150 + u32::from(color.b) * 29
}

fn color_distance(left: Rgba, right: Rgba) -> u32 {
    channel_distance(left.r, right.r)
        + channel_distance(left.g, right.g)
        + channel_distance(left.b, right.b)
}

fn nearest_color_index(pixel: Rgba, palette: &[Rgba; 4]) -> usize {
    let mut best_index = 0usize;
    let mut best_distance = u32::MAX;
    for (index, candidate) in palette.iter().enumerate() {
        let distance = color_distance(pixel, *candidate);
        if distance < best_distance {
            best_distance = distance;
            best_index = index;
        }
    }
    best_index
}

fn channel_distance(left: u8, right: u8) -> u32 {
    let delta = i32::from(left) - i32::from(right);
    u32::try_from(delta * delta).expect("squared channel delta is non-negative")
}

fn encode_dxt3_alpha_block(block: &[Rgba; 16], target: &mut [u8]) {
    if let Some(alpha) = uniform_alpha(block) {
        let nibble = alpha >> 4;
        target.fill(nibble | (nibble << 4));
        return;
    }

    for (byte, pair) in target.iter_mut().zip(block.chunks_exact(2)) {
        let low = pair[0].a >> 4;
        let high = pair[1].a >> 4;
        *byte = low | (high << 4);
    }
}

fn encode_dxt5_alpha_block(block: &[Rgba; 16], target: &mut [u8]) {
    if let Some(alpha) = uniform_alpha(block) {
        target[0] = alpha;
        target[1] = alpha;
        target[2..8].fill(0);
        return;
    }

    let min_alpha = block.iter().map(|pixel| pixel.a).min().unwrap_or(0);
    let max_alpha = block.iter().map(|pixel| pixel.a).max().unwrap_or(0);
    target[0] = max_alpha;
    target[1] = min_alpha;
    let palette = dxt5_alpha_palette(max_alpha, min_alpha);
    let mut bits = 0u64;
    for (index, pixel) in block.iter().enumerate() {
        let palette_index = nearest_alpha_index(pixel.a, &palette);
        bits |= u64::try_from(palette_index).expect("alpha palette index fits u64") << (index * 3);
    }
    for byte_index in 0..6usize {
        target[2 + byte_index] = ((bits >> (byte_index * 8)) & 0xff) as u8;
    }
}

fn uniform_alpha(block: &[Rgba; 16]) -> Option<u8> {
    let first = block[0].a;
    block.iter().all(|pixel| pixel.a == first).then_some(first)
}

fn nearest_alpha_index(alpha: u8, palette: &[u8; 8]) -> usize {
    let mut best_index = 0usize;
    let mut best_distance = u32::MAX;
    for (index, candidate) in palette.iter().enumerate() {
        let distance = channel_distance(alpha, *candidate);
        if distance < best_distance {
            best_distance = distance;
            best_index = index;
        }
    }
    best_index
}

fn scale_bits_to_byte(value: u32, bit_count: u32) -> u8 {
    let max_value = (1u32 << bit_count) - 1;
    u8::try_from((value * 255 + (max_value / 2)) / max_value).expect("scaled byte fits u8")
}

fn lerp_u8(left: u8, right: u8, left_weight: u32, right_weight: u32, divisor: u32) -> u8 {
    average_u8(
        u32::from(left) * left_weight + u32::from(right) * right_weight,
        divisor,
    )
}

fn average_u8(sum: u32, count: u32) -> u8 {
    u8::try_from((sum + (count / 2)) / count).expect("average byte fits u8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fused_dxt_decode_downsample_matches_full_decode_then_downsample() {
        let source_width = 8;
        let source_height = 8;
        let source_pixels = (0..source_width * source_height)
            .map(|index| Rgba {
                r: u8::try_from((index * 17) % 251).expect("red fits byte"),
                g: u8::try_from((index * 29) % 253).expect("green fits byte"),
                b: u8::try_from((index * 41) % 247).expect("blue fits byte"),
                a: 255,
            })
            .collect::<Vec<_>>();
        let source_data = encode_dxt_surface(
            &source_pixels,
            source_width,
            source_height,
            PixelFormatId::Dxt1,
        )
        .expect("test source should encode");
        let render_surface = RenderSurface {
            id: 0x0600_2345,
            unknown: 0,
            width: source_width,
            height: source_height,
            format: PixelFormatId::Dxt1,
            format_raw: PixelFormatId::Dxt1.raw(),
            source_data,
            default_palette_id: None,
        };

        let full_decode = decode_dxt_surface_for_test(&render_surface).expect("full decode");
        let expected =
            downsample_rgba_2x(&full_decode, source_width, source_height).expect("downsample");
        let fused = decode_dxt_surface_downsampled_2x(&render_surface).expect("fused decode");

        assert_eq!(fused, expected);
    }

    fn decode_dxt_surface_for_test(render_surface: &RenderSurface) -> Result<Vec<Rgba>> {
        decode_dxt_surface(render_surface)
    }
}
