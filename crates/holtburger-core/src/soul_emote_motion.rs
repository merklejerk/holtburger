use holtburger_protocol::messages::movement::InterpretedMotionCommand;

pub fn motion_command_for_soul_emote_pose(pose: &str) -> Option<InterpretedMotionCommand> {
    // Retail string2command uses strnicmp (acclient.c:683022). Six mounted pose names are uppercase.
    let raw = match pose.to_ascii_lowercase().as_str() {
        "afkstate" => 0x011b,
        "akimbostate" => 0x00f2,
        "ateasestate" => 0x0149,
        "atoyot" => 0x00f9,
        "beckon" => 0x007a,
        "beseeingyou" => 0x007b,
        "blowkiss" => 0x007c,
        "bowdeepstate" => 0x00ec,
        "cheer" => 0x004c,
        "claphands" => 0x007e,
        "claphandsstate" => 0x00ed,
        "cringe" => 0x0091,
        "crossarmsstate" => 0x00ee,
        "cry" => 0x007f,
        "curtseystate" => 0x011a,
        "drudgedance" => 0x0151,
        "drudgedancestate" => 0x0144,
        "haveaseat" => 0x0152,
        "haveaseatstate" => 0x0148,
        "heartylaugh" => 0x0089,
        "helper" => 0x0135,
        "kneelstate" => 0x00f7,
        "knock" => 0x014f,
        "laugh" => 0x0080,
        "leanstate" => 0x00f6,
        "meditatestate" => 0x011c,
        "mimedrink" => 0x0082,
        "mimeeat" => 0x0081,
        "mock" => 0x00cb,
        "nod" => 0x0083,
        "nudgeleft" => 0x014a,
        "nudgeright" => 0x014b,
        "pleadstate" => 0x00f8,
        "pointdown" => 0x014e,
        "pointdownstate" => 0x0143,
        "pointleft" => 0x014c,
        "pointleftstate" => 0x0140,
        "pointright" => 0x014d,
        "pointrightstate" => 0x0141,
        "pointstate" => 0x00f0,
        "possumstate" => 0x0145,
        "praystate" => 0x00eb,
        "readstate" => 0x0146,
        "salutestate" => 0x00f3,
        "scanhorizon" => 0x0150,
        "scratchhead" => 0x008b,
        "scratchheadstate" => 0x00f4,
        "shakefist" => 0x0079,
        "shakefiststate" => 0x00ea,
        "shakehead" => 0x0085,
        "shiver" => 0x0094,
        "shoo" => 0x0095,
        "shrug" => 0x0086,
        "sitbackstate" => 0x013f,
        "sitcrossleggedstate" => 0x013e,
        "sitstate" => 0x013d,
        "slouchstate" => 0x00fa,
        "smackhead" => 0x008c,
        "snowangelstate" => 0x0118,
        "spit" => 0x0097,
        "surrenderstate" => 0x00fb,
        "talktothehandstate" => 0x0142,
        "tapfootstate" => 0x00f5,
        "teapot" => 0x00cc,
        "thinkerstate" => 0x0147,
        "warmhands" => 0x0119,
        "wave" => 0x0087,
        "wavehigh" => 0x008e,
        "wavelow" => 0x008f,
        "wavestate" => 0x00f1,
        "windedstate" => 0x00fd,
        "woahstate" => 0x00fc,
        "yawnstretch" => 0x0090,
        "ymca" => 0x009b,
        _ => return None,
    };

    Some(InterpretedMotionCommand(raw))
}

#[cfg(test)]
mod tests {
    use super::motion_command_for_soul_emote_pose;
    use holtburger_protocol::messages::movement::InterpretedMotionCommand;

    #[test]
    fn wave_pose_maps_to_ace_low_bits() {
        assert_eq!(
            motion_command_for_soul_emote_pose("Wave"),
            Some(InterpretedMotionCommand(0x0087))
        );
    }
    #[test]
    fn authored_uppercase_poses_resolve_like_retail_string2command() {
        for (pose, command) in [
            ("CLAPHANDSSTATE", 0x00ed),
            ("SCRATCHHEADSTATE", 0x00f4),
            ("SHAKEFISTSTATE", 0x00ea),
            ("SNOWANGELSTATE", 0x0118),
            ("WARMHANDS", 0x0119),
            ("WAVESTATE", 0x00f1),
        ] {
            assert_eq!(
                motion_command_for_soul_emote_pose(pose),
                Some(InterpretedMotionCommand(command))
            );
        }
        assert_eq!(motion_command_for_soul_emote_pose("unknown"), None);
    }
}
