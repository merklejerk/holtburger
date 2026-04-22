use holtburger_protocol::messages::movement::InterpretedMotionCommand;

pub fn motion_command_for_soul_emote_pose(pose: &str) -> Option<InterpretedMotionCommand> {
    let raw = match pose {
        "AFKState" => 0x011b,
        "AkimboState" => 0x00f2,
        "AtEaseState" => 0x0149,
        "ATOYOT" => 0x00f9,
        "Beckon" => 0x007a,
        "BeSeeingYou" => 0x007b,
        "BlowKiss" => 0x007c,
        "BowDeepState" => 0x00ec,
        "Cheer" => 0x004c,
        "ClapHands" => 0x007e,
        "ClapHandsState" => 0x00ed,
        "Cringe" => 0x0091,
        "CrossArmsState" => 0x00ee,
        "Cry" => 0x007f,
        "CurtseyState" => 0x011a,
        "DrudgeDance" => 0x0151,
        "DrudgeDanceState" => 0x0144,
        "HaveASeat" => 0x0152,
        "HaveASeatState" => 0x0148,
        "HeartyLaugh" => 0x0089,
        "Helper" => 0x0135,
        "KneelState" => 0x00f7,
        "Knock" => 0x014f,
        "Laugh" => 0x0080,
        "LeanState" => 0x00f6,
        "MeditateState" => 0x011c,
        "MimeDrink" => 0x0082,
        "MimeEat" => 0x0081,
        "Mock" => 0x00cb,
        "Nod" => 0x0083,
        "NudgeLeft" => 0x014a,
        "NudgeRight" => 0x014b,
        "PleadState" => 0x00f8,
        "PointDown" => 0x014e,
        "PointDownState" => 0x0143,
        "PointLeft" => 0x014c,
        "PointLeftState" => 0x0140,
        "PointRight" => 0x014d,
        "PointRightState" => 0x0141,
        "PointState" => 0x00f0,
        "PossumState" => 0x0145,
        "PrayState" => 0x00eb,
        "ReadState" => 0x0146,
        "SaluteState" => 0x00f3,
        "ScanHorizon" => 0x0150,
        "ScratchHead" => 0x008b,
        "ScratchHeadState" => 0x00f4,
        "ShakeFist" => 0x0079,
        "ShakeFistState" => 0x00ea,
        "ShakeHead" => 0x0085,
        "Shiver" => 0x0094,
        "Shoo" => 0x0095,
        "Shrug" => 0x0086,
        "SitBackState" => 0x013f,
        "SitCrossleggedState" => 0x013e,
        "SitState" => 0x013d,
        "SlouchState" => 0x00fa,
        "SmackHead" => 0x008c,
        "SnowAngelState" => 0x0118,
        "Spit" => 0x0097,
        "SurrenderState" => 0x00fb,
        "TalktotheHandState" => 0x0142,
        "TapFootState" => 0x00f5,
        "Teapot" => 0x00cc,
        "ThinkerState" => 0x0147,
        "WarmHands" => 0x0119,
        "Wave" => 0x0087,
        "WaveHigh" => 0x008e,
        "WaveLow" => 0x008f,
        "WaveState" => 0x00f1,
        "WindedState" => 0x00fd,
        "WoahState" => 0x00fc,
        "YawnStretch" => 0x0090,
        "YMCA" => 0x009b,
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
}
