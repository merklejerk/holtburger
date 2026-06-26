use anyhow::{Context, Result, bail};
use clap::Parser;
use holtburger_content::{
    ContentRepository, ResolvedMaterialSource, build_gfx_obj_render_geometry,
};
use holtburger_dat::file_type::{
    Animation, GfxObj, Palette, PixelFormatId, RenderSurface, SetupModel,
    setup_model::AnimationHookPayload,
};
use holtburger_dat::graphics::Frame;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::BTreeMap;
use std::io::Cursor;

type Vec3Tuple = (f32, f32, f32);
type BoundsTuple = (Vec3Tuple, Vec3Tuple);

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long)]
    did: Vec<String>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    if args.did.is_empty() {
        bail!("provide at least one --did value");
    }

    let content = ContentRepository::from_hba_path(args.dats)?;
    for did in args.did {
        let id = parse_hex_u32(&did)?;
        match id >> 24 {
            0x01 => inspect_gfx_obj(&content, id)?,
            0x02 => inspect_setup_model(&content, id)?,
            family => bail!("unsupported static source DID 0x{id:08x} family 0x{family:02x}"),
        }
    }

    Ok(())
}

fn inspect_setup_model(content: &ContentRepository, setup_model_id: u32) -> Result<()> {
    let setup_model = read_setup_model(content, setup_model_id)?;
    println!("setupModel=0x{:08x}", setup_model.id);
    println!(
        "  flags=0x{:08x} parts={} parentIndices={} defaultScales={} placements={} cylSpheres={} spheres={} lights={}",
        setup_model.flags,
        setup_model.parts.len(),
        setup_model.parent_index.len(),
        setup_model.default_scale.len(),
        setup_model.placement_frames.len(),
        setup_model.cyl_spheres.len(),
        setup_model.spheres.len(),
        setup_model.lights.len(),
    );
    println!(
        "  height={:.6} radius={:.6} stepUp={:.6} stepDown={:.6}",
        setup_model.height, setup_model.radius, setup_model.step_up, setup_model.step_down,
    );
    println!(
        "  sortingSphere center=({:.6},{:.6},{:.6}) radius={:.6}",
        setup_model.sorting_sphere.center.x,
        setup_model.sorting_sphere.center.y,
        setup_model.sorting_sphere.center.z,
        setup_model.sorting_sphere.radius,
    );
    println!(
        "  selectionSphere center=({:.6},{:.6},{:.6}) radius={:.6}",
        setup_model.selection_sphere.center.x,
        setup_model.selection_sphere.center.y,
        setup_model.selection_sphere.center.z,
        setup_model.selection_sphere.radius,
    );
    println!(
        "  defaults animation={} script={} motionTable={} soundTable={} scriptTable={}",
        format_optional_did(setup_model.default_animation),
        format_optional_did(setup_model.default_script),
        format_optional_did(setup_model.default_motion_table),
        format_optional_did(setup_model.default_sound_table),
        format_optional_did(setup_model.default_script_table),
    );

    let mut placement_keys = setup_model
        .placement_frames
        .keys()
        .copied()
        .collect::<Vec<_>>();
    placement_keys.sort();
    println!("  placementKeys={placement_keys:?}");
    if !setup_model.parent_index.is_empty() {
        println!("  parentIndices={:?}", setup_model.parent_index);
    }
    for key in &placement_keys {
        if let Some(placement) = setup_model.placement_frames.get(key) {
            println!(
                "  placement[{key}] parts={} hooks={}",
                placement.anim_frame.frames.len(),
                placement.anim_frame.hooks.len(),
            );
            print_frame_samples_owned("    placementFrame", &placement.anim_frame.frames);
        }
    }

    if let Some(default_animation_id) = setup_model.default_animation {
        inspect_animation(content, default_animation_id)?;
    }
    if let Some(default_script_id) = setup_model.default_script {
        inspect_physics_script(content, default_script_id)?;
    }

    for (part_index, gfx_obj_id) in setup_model.parts.iter().copied().enumerate() {
        let scale = setup_model
            .default_scale
            .get(part_index)
            .map(|scale| format!("({:.6},{:.6},{:.6})", scale.x, scale.y, scale.z))
            .unwrap_or_else(|| "none".to_string());
        println!("  part={part_index} gfx=0x{gfx_obj_id:08x} defaultScale={scale}");
        inspect_gfx_obj(content, gfx_obj_id)?;
    }

    Ok(())
}

fn inspect_animation(content: &ContentRepository, animation_id: u32) -> Result<()> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_id))
        .with_context(|| format!("failed to read Animation 0x{animation_id:08X}"))?;
    let animation = Animation::read(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse Animation 0x{animation_id:08X}"))?;

    let mut hook_type_counts = BTreeMap::<u32, usize>::new();
    let mut total_hooks = 0usize;
    for frame in &animation.part_frames {
        total_hooks += frame.hooks.len();
        for hook in &frame.hooks {
            *hook_type_counts.entry(hook.hook_type).or_default() += 1;
        }
    }

    println!(
        "  defaultAnimation=0x{animation_id:08x} stored=0x{:08x} flags=0x{:08x} parts={} frames={} posFrames={} hooks={}",
        animation.id,
        animation.flags.bits(),
        animation.num_parts,
        animation.num_frames,
        animation.pos_frames.len(),
        total_hooks,
    );
    if !hook_type_counts.is_empty() {
        println!("    hookTypeCounts={hook_type_counts:?}");
    }
    for (frame_index, frame) in animation.part_frames.iter().enumerate() {
        for (hook_index, hook) in frame.hooks.iter().enumerate() {
            println!(
                "    frame[{frame_index}] hook[{hook_index}] type={} direction={} payload={}",
                hook.hook_type,
                hook.direction,
                format_animation_hook_payload(&hook.payload),
            );
        }
    }
    if let Some((min, max)) = animation_pos_frame_bounds(&animation) {
        println!(
            "    posFrameBounds min=({:.6},{:.6},{:.6}) max=({:.6},{:.6},{:.6})",
            min.0, min.1, min.2, max.0, max.1, max.2,
        );
    }
    print_animation_motion_summary(&animation);

    Ok(())
}

fn inspect_physics_script(content: &ContentRepository, script_id: u32) -> Result<()> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, script_id))
        .with_context(|| format!("failed to read PhysicsScript 0x{script_id:08X}"))?;
    let mut cursor = Cursor::new(resource.bytes);
    let stored_script_id = read_u32(&mut cursor)?;
    if stored_script_id != script_id {
        println!("  defaultScriptHeader=0x{stored_script_id:08x} expected=0x{script_id:08x}");
    }
    let hook_count = read_u32(&mut cursor)?;
    println!("  defaultScript=0x{script_id:08x} hookCount={hook_count}");
    for hook_index in 0..hook_count {
        let start_time = read_f64(&mut cursor)?;
        let hook_type = read_u32(&mut cursor)?;
        let direction = read_i32(&mut cursor)?;
        let payload = read_hook_payload(&mut cursor, hook_type)?;
        align_cursor_4(&mut cursor);
        println!(
            "    hook[{hook_index}] start={start_time:.6} type={} direction={} payload={}",
            hook_type,
            direction,
            format_hook_payload(&payload),
        );
    }

    Ok(())
}

fn inspect_gfx_obj(content: &ContentRepository, gfx_obj_id: u32) -> Result<()> {
    let gfx_obj = read_gfx_obj(content, gfx_obj_id)?;
    let render_geometry = build_gfx_obj_render_geometry(&gfx_obj);
    let mut drawing_surface_counts = BTreeMap::<i16, usize>::new();
    for polygon in gfx_obj.polygons.values() {
        *drawing_surface_counts
            .entry(polygon.pos_surface)
            .or_default() += 1;
    }

    println!("gfxObj=0x{:08x}", gfx_obj.id);
    println!(
        "  flags={:?} surfaces={} vertices={} drawingPolygons={} physicsPolygons={} drawingBsp={} physicsBsp={} degrade={}",
        gfx_obj.flags,
        gfx_obj.surfaces.len(),
        gfx_obj.vertex_array.vertices.len(),
        gfx_obj.polygons.len(),
        gfx_obj.physics_polygons.len(),
        gfx_obj.drawing_bsp.is_some(),
        gfx_obj.physics_bsp.is_some(),
        format_optional_did(gfx_obj.did_degrade),
    );
    println!(
        "  sortCenter=({:.6},{:.6},{:.6})",
        gfx_obj.sort_center.x, gfx_obj.sort_center.y, gfx_obj.sort_center.z,
    );
    println!("  surfaces={}", format_u32_list(&gfx_obj.surfaces));
    println!("  drawingPosSurfaceUseCounts={drawing_surface_counts:?}");
    match content.resolve_gfx_obj_material_slots(gfx_obj_id) {
        Ok(slots) => {
            println!("  materialSlots={}", slots.len());
            for slot in slots {
                println!(
                    "    slot={} material=0x{:08x} type=0x{:08x} source={} translucency={:.6} luminosity={:.6} diffuse={:.6}",
                    slot.slot_index,
                    slot.material.surface_id,
                    slot.material.surface_type.bits(),
                    format_material_source(&slot.material.source),
                    slot.material.translucency,
                    slot.material.luminosity,
                    slot.material.diffuse,
                );
                print_material_alpha_summary(content, &slot.material.source)?;
            }
        }
        Err(error) => {
            println!("  materialSlotsError={error:#}");
        }
    }
    println!(
        "  renderTriangles={} invalidPolygons={} skippedPolygons={} bounds={}",
        render_geometry.triangles.len(),
        render_geometry.invalid_polygons.len(),
        render_geometry.skipped_polygon_count,
        render_geometry
            .bounds
            .as_ref()
            .map(|bounds| format!(
                "min=({:.6},{:.6},{:.6}) max=({:.6},{:.6},{:.6})",
                bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z,
            ))
            .unwrap_or_else(|| "none".to_string()),
    );
    println!();

    Ok(())
}

fn print_material_alpha_summary(
    content: &ContentRepository,
    source: &ResolvedMaterialSource,
) -> Result<()> {
    let ResolvedMaterialSource::Texture(texture) = source else {
        return Ok(());
    };

    for (surface_index, render_surface_id) in texture.render_surface_ids.iter().copied().enumerate()
    {
        let render_surface = match read_render_surface(content, render_surface_id) {
            Ok(render_surface) => render_surface,
            Err(error) => {
                println!(
                    "      renderSurface[{surface_index}]=0x{render_surface_id:08x} error={error:#}"
                );
                continue;
            }
        };
        println!(
            "      renderSurface[{surface_index}]=0x{render_surface_id:08x} {}x{} format={:?}/0x{:x} bytes={} defaultPalette={}",
            render_surface.width,
            render_surface.height,
            render_surface.format,
            render_surface.format_raw,
            render_surface.source_data.len(),
            format_optional_did(render_surface.default_palette_id),
        );

        if matches!(
            render_surface.format,
            PixelFormatId::P8 | PixelFormatId::Index16
        ) {
            if let Some(palette_id) = render_surface.default_palette_id {
                let palette = read_palette(content, palette_id)?;
                println!(
                    "        paletteAlpha {}",
                    summarize_indexed_palette_alpha(
                        &palette,
                        render_surface.format,
                        &render_surface.source_data
                    )
                );
            }
        } else if render_surface.format == PixelFormatId::A8R8G8B8 {
            println!(
                "        argbAlpha {}",
                summarize_argb_alpha(&render_surface.source_data)
            );
        } else if render_surface.format == PixelFormatId::A4R4G4B4 {
            println!(
                "        argb4444Alpha {}",
                summarize_argb4444_alpha(&render_surface.source_data)
            );
        }
    }

    Ok(())
}

fn animation_pos_frame_bounds(animation: &Animation) -> Option<BoundsTuple> {
    let first = animation.pos_frames.first()?;
    let mut min = (first.origin.x, first.origin.y, first.origin.z);
    let mut max = min;
    for frame in &animation.pos_frames {
        min.0 = min.0.min(frame.origin.x);
        min.1 = min.1.min(frame.origin.y);
        min.2 = min.2.min(frame.origin.z);
        max.0 = max.0.max(frame.origin.x);
        max.1 = max.1.max(frame.origin.y);
        max.2 = max.2.max(frame.origin.z);
    }
    Some((min, max))
}

fn print_animation_motion_summary(animation: &Animation) {
    let num_parts = animation.num_parts as usize;
    if animation.part_frames.is_empty() || num_parts == 0 {
        return;
    }

    for part_index in 0..num_parts {
        let frames = animation
            .part_frames
            .iter()
            .filter_map(|frame| frame.frames.get(part_index))
            .collect::<Vec<_>>();
        if frames.is_empty() {
            continue;
        }
        let first = frames[0];
        let mut origin_min = first.origin;
        let mut origin_max = first.origin;
        let mut max_origin_delta = 0.0f32;
        let mut angle_min = quaternion_angle_degrees(&first.orientation);
        let mut angle_max = angle_min;
        for frame in &frames {
            origin_min.x = origin_min.x.min(frame.origin.x);
            origin_min.y = origin_min.y.min(frame.origin.y);
            origin_min.z = origin_min.z.min(frame.origin.z);
            origin_max.x = origin_max.x.max(frame.origin.x);
            origin_max.y = origin_max.y.max(frame.origin.y);
            origin_max.z = origin_max.z.max(frame.origin.z);
            max_origin_delta = max_origin_delta.max(first.origin.distance(&frame.origin));
            let angle = quaternion_angle_degrees(&frame.orientation);
            angle_min = angle_min.min(angle);
            angle_max = angle_max.max(angle);
        }
        println!(
            "    partMotion[{part_index}] originMin={} originMax={} maxOriginDelta={:.6} quatAngleDegRange=({:.3},{:.3})",
            format_vector3(&origin_min),
            format_vector3(&origin_max),
            max_origin_delta,
            angle_min,
            angle_max,
        );
        print_frame_samples("      sample", frames.as_slice());
    }
}

fn print_frame_samples(label: &str, frames: &[&Frame]) {
    if frames.is_empty() {
        return;
    }

    let mut sample_indices = vec![0usize];
    if frames.len() > 2 {
        sample_indices.push(frames.len() / 2);
    }
    if frames.len() > 1 {
        sample_indices.push(frames.len() - 1);
    }
    sample_indices.sort_unstable();
    sample_indices.dedup();

    for index in sample_indices {
        if let Some(frame) = frames.get(index) {
            println!("{label}[{index}] {}", format_frame(frame));
        }
    }
}

fn print_frame_samples_owned(label: &str, frames: &[Frame]) {
    let frame_refs = frames.iter().collect::<Vec<_>>();
    print_frame_samples(label, frame_refs.as_slice());
}

fn format_animation_hook_payload(payload: &AnimationHookPayload) -> String {
    match payload {
        AnimationHookPayload::NoPayload => "none".to_string(),
        AnimationHookPayload::Raw(bytes) => format_raw_hook_payload(bytes),
        AnimationHookPayload::ReplaceObject(bytes) => format_raw_bytes(bytes),
        AnimationHookPayload::TextureVelocity(payload) => {
            format!(
                "textureVelocity(u={:.6},v={:.6})",
                payload.u_speed, payload.v_speed
            )
        }
        AnimationHookPayload::TextureVelocityPart(payload) => format!(
            "textureVelocityPart(part={},u={:.6},v={:.6})",
            payload.part_index, payload.u_speed, payload.v_speed,
        ),
    }
}

fn format_raw_hook_payload(bytes: &[u8]) -> String {
    if bytes.len() == 12 {
        let x = f32::from_le_bytes(bytes[0..4].try_into().expect("slice length is fixed"));
        let y = f32::from_le_bytes(bytes[4..8].try_into().expect("slice length is fixed"));
        let z = f32::from_le_bytes(bytes[8..12].try_into().expect("slice length is fixed"));
        format!("{} vec3=({x:.6},{y:.6},{z:.6})", format_raw_bytes(bytes))
    } else {
        format_raw_bytes(bytes)
    }
}

fn read_setup_model(content: &ContentRepository, setup_model_id: u32) -> Result<SetupModel> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
        .with_context(|| format!("failed to read SetupModel 0x{setup_model_id:08X}"))?;
    SetupModel::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse SetupModel 0x{setup_model_id:08X}"))
}

fn read_gfx_obj(content: &ContentRepository, gfx_obj_id: u32) -> Result<GfxObj> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
        .with_context(|| format!("failed to read GfxObj 0x{gfx_obj_id:08X}"))?;
    GfxObj::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse GfxObj 0x{gfx_obj_id:08X}"))
}

fn read_render_surface(
    content: &ContentRepository,
    render_surface_id: u32,
) -> Result<RenderSurface> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, render_surface_id))
        .with_context(|| format!("failed to read RenderSurface 0x{render_surface_id:08X}"))?;
    RenderSurface::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse RenderSurface 0x{render_surface_id:08X}"))
}

fn read_palette(content: &ContentRepository, palette_id: u32) -> Result<Palette> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, palette_id))
        .with_context(|| format!("failed to read Palette 0x{palette_id:08X}"))?;
    Palette::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse Palette 0x{palette_id:08X}"))
}

fn parse_hex_u32(value: &str) -> Result<u32> {
    Ok(u32::from_str_radix(value.trim_start_matches("0x"), 16)?)
}

fn format_optional_did(value: Option<u32>) -> String {
    value
        .map(|did| format!("0x{did:08x}"))
        .unwrap_or_else(|| "none".to_string())
}

fn format_u32_list(values: &[u32]) -> String {
    let joined = values
        .iter()
        .map(|value| format!("0x{value:08x}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{joined}]")
}

fn summarize_indexed_palette_alpha(
    palette: &Palette,
    format: PixelFormatId,
    texture_bytes: &[u8],
) -> String {
    let mut used = [false; 256];
    match format {
        PixelFormatId::P8 => {
            for index in texture_bytes {
                used[usize::from(*index)] = true;
            }
        }
        PixelFormatId::Index16 => {
            for index in texture_bytes.chunks_exact(2) {
                let index = u16::from_le_bytes([index[0], index[1]]);
                if let Some(used) = used.get_mut(usize::from(index)) {
                    *used = true;
                }
            }
        }
        _ => {}
    }

    let mut used_count = 0usize;
    let mut zero_alpha = 0usize;
    let mut nonzero_alpha = 0usize;
    let mut samples = Vec::new();
    for (index, is_used) in used.iter().copied().enumerate() {
        if !is_used {
            continue;
        }
        used_count += 1;
        let color = palette.colors_argb.get(index).copied().unwrap_or(0);
        let alpha = color >> 24;
        if alpha == 0 {
            zero_alpha += 1;
        } else {
            nonzero_alpha += 1;
        }
        if samples.len() < 8 {
            samples.push(format!("{index}:0x{color:08x}"));
        }
    }

    format!(
        "palette=0x{:08x} used={} zeroAlpha={} nonzeroAlpha={} samples=[{}]",
        palette.id,
        used_count,
        zero_alpha,
        nonzero_alpha,
        samples.join(","),
    )
}

fn summarize_argb_alpha(bytes: &[u8]) -> String {
    let mut zero_alpha = 0usize;
    let mut nonzero_alpha = 0usize;
    for pixel in bytes.chunks_exact(4) {
        if pixel[3] == 0 {
            zero_alpha += 1;
        } else {
            nonzero_alpha += 1;
        }
    }
    format!("zeroAlpha={zero_alpha} nonzeroAlpha={nonzero_alpha}")
}

fn summarize_argb4444_alpha(bytes: &[u8]) -> String {
    let mut zero_alpha = 0usize;
    let mut nonzero_alpha = 0usize;
    for pixel in bytes.chunks_exact(2) {
        let value = u16::from_le_bytes([pixel[0], pixel[1]]);
        if (value >> 12) == 0 {
            zero_alpha += 1;
        } else {
            nonzero_alpha += 1;
        }
    }
    format!("zeroAlpha={zero_alpha} nonzeroAlpha={nonzero_alpha}")
}

fn format_material_source(source: &ResolvedMaterialSource) -> String {
    match source {
        ResolvedMaterialSource::SolidColor(color) => format!("solid(0x{color:08x})"),
        ResolvedMaterialSource::Texture(texture) => format!(
            "texture(surfaceTexture=0x{:08x}, renderSurfaces={}, palette={}, defaultPalettes={})",
            texture.surface_texture_id,
            format_u32_list(&texture.render_surface_ids),
            format_optional_did(texture.palette_id),
            format_u32_list(&texture.render_surface_default_palette_ids),
        ),
    }
}

enum HookPayload {
    NoPayload,
    Raw(Vec<u8>),
}

fn read_hook_payload(cursor: &mut Cursor<Vec<u8>>, hook_type: u32) -> Result<HookPayload> {
    let size = match hook_type {
        0 | 4 | 17 => 0,
        1 | 2 | 6 | 14 | 15 | 16 | 18 | 25 => 4,
        12 | 19 | 23 => 8,
        8 | 10 | 20 | 22 => 12,
        7 | 9 | 11 | 21 | 24 => 16,
        3 => 28,
        13 | 26 => 40,
        5 => {
            let start = cursor.position();
            let mut bytes = read_bytes(cursor, 4)?;
            let upper = u16::from_le_bytes([bytes[2], bytes[3]]);
            if (upper & 0x8000) != 0 {
                bytes.extend(read_bytes(cursor, 2)?);
            }
            return Ok(HookPayload::Raw(bytes_with_start(start, bytes)));
        }
        _ => bail!("unsupported hook type {hook_type}"),
    };
    if size == 0 {
        Ok(HookPayload::NoPayload)
    } else {
        Ok(HookPayload::Raw(read_bytes(cursor, size)?))
    }
}

fn format_hook_payload(payload: &HookPayload) -> String {
    match payload {
        HookPayload::NoPayload => "none".to_string(),
        HookPayload::Raw(bytes) => format_raw_bytes(bytes),
    }
}

fn format_raw_bytes(bytes: &[u8]) -> String {
    format!(
        "raw({})",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn format_frame(frame: &Frame) -> String {
    format!(
        "origin={} quat=({:.6},{:.6},{:.6},{:.6}) angleDeg={:.3}",
        format_vector3(&frame.origin),
        frame.orientation.w,
        frame.orientation.x,
        frame.orientation.y,
        frame.orientation.z,
        quaternion_angle_degrees(&frame.orientation),
    )
}

fn format_vector3(vector: &holtburger_common::Vector3) -> String {
    format!("({:.6},{:.6},{:.6})", vector.x, vector.y, vector.z)
}

fn quaternion_angle_degrees(quaternion: &holtburger_common::Quaternion) -> f32 {
    let magnitude = (quaternion.w * quaternion.w
        + quaternion.x * quaternion.x
        + quaternion.y * quaternion.y
        + quaternion.z * quaternion.z)
        .sqrt();
    if magnitude <= f32::EPSILON {
        return 0.0;
    }
    let w = (quaternion.w / magnitude).clamp(-1.0, 1.0);
    (2.0 * w.acos()).to_degrees()
}

fn read_u32(cursor: &mut Cursor<Vec<u8>>) -> Result<u32> {
    let bytes = read_bytes(cursor, 4)?;
    Ok(u32::from_le_bytes(
        bytes.try_into().expect("read size is fixed"),
    ))
}

fn read_i32(cursor: &mut Cursor<Vec<u8>>) -> Result<i32> {
    let bytes = read_bytes(cursor, 4)?;
    Ok(i32::from_le_bytes(
        bytes.try_into().expect("read size is fixed"),
    ))
}

fn read_f64(cursor: &mut Cursor<Vec<u8>>) -> Result<f64> {
    let bytes = read_bytes(cursor, 8)?;
    Ok(f64::from_le_bytes(
        bytes.try_into().expect("read size is fixed"),
    ))
}

fn read_bytes(cursor: &mut Cursor<Vec<u8>>, size: usize) -> Result<Vec<u8>> {
    let start = cursor.position() as usize;
    let end = start + size;
    let bytes = cursor.get_ref();
    if end > bytes.len() {
        bail!("script payload ended unexpectedly at byte {start}, wanted {size} bytes");
    }
    let result = bytes[start..end].to_vec();
    cursor.set_position(end as u64);
    Ok(result)
}

fn bytes_with_start(_start: u64, bytes: Vec<u8>) -> Vec<u8> {
    bytes
}

fn align_cursor_4(cursor: &mut Cursor<Vec<u8>>) {
    let remainder = cursor.position() % 4;
    if remainder != 0 {
        cursor.set_position(cursor.position() + (4 - remainder));
    }
}
