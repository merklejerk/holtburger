//! Process-level OS scheduling and timer-resolution policy for the native sidecar.
//!
//! Electron launches `holtburger-3d-host` as a windowless child process (`windowsHide: true`).
//! On Windows 10 and 11, the kernel can classify headless child processes into EcoQoS
//! (`PROCESS_POWER_THROTTLING_EXECUTION_SPEED`) and ignore global timer-resolution requests
//! (`PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION`), stalling the 30 ms authority heartbeat
//! onto efficiency cores or coarse timer quanta while the foreground WebGL window remains smooth.

use std::io;

/// Win32 `PROCESS_POWER_THROTTLING_EXECUTION_SPEED` (`0x1`), supported since Windows 10 1709.
const EXECUTION_SPEED_MASK: u32 = 0x1;

/// Win32 `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION` (`0x4`), introduced in Windows 11.
const IGNORE_TIMER_RESOLUTION_MASK: u32 = 0x4;

/// Win32 `ERROR_INVALID_PARAMETER` (`87`), returned on Windows 10 for Windows 11 mask bits.
const WIN32_ERROR_INVALID_PARAMETER: i32 = 87;

#[cfg(windows)]
const _: () = {
    use windows_sys::Win32::Foundation::ERROR_INVALID_PARAMETER;
    use windows_sys::Win32::System::Threading::{
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
    };

    assert!(EXECUTION_SPEED_MASK == PROCESS_POWER_THROTTLING_EXECUTION_SPEED);
    assert!(IGNORE_TIMER_RESOLUTION_MASK == PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION);
    assert!(WIN32_ERROR_INVALID_PARAMETER == ERROR_INVALID_PARAMETER as i32);
};

/// Named throttling control cleared on the current host process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PowerThrottlingControl {
    name: &'static str,
    mask: u32,
    /// True only when supported Windows 10 kernels legitimately reject this newer Windows 11 bit.
    allow_unsupported_parameter: bool,
}

const POWER_THROTTLING_CONTROLS: [PowerThrottlingControl; 2] = [
    // Applied independently so Windows 10 kernels that reject IGNORE_TIMER_RESOLUTION still retain
    // the EXECUTION_SPEED opt-out, while any invalid-parameter failure on EXECUTION_SPEED itself
    // remains visible.
    PowerThrottlingControl {
        name: "PROCESS_POWER_THROTTLING_EXECUTION_SPEED",
        mask: EXECUTION_SPEED_MASK,
        allow_unsupported_parameter: false,
    },
    PowerThrottlingControl {
        name: "PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION",
        mask: IGNORE_TIMER_RESOLUTION_MASK,
        allow_unsupported_parameter: true,
    },
];

/// Unexpected OS failure while clearing a supported process power-throttling flag.
#[derive(Debug)]
struct PowerThrottlingFailure {
    control: &'static str,
    error: io::Error,
}

/// Opts the current sidecar process out of OS background execution-speed and timer throttling.
pub fn disable_process_power_throttling() {
    for failure in opt_out_of_power_throttling_with(clear_platform_power_throttling_flag) {
        log::warn!(
            "Could not clear {} on host process: {}",
            failure.control,
            failure.error
        );
    }
}

fn opt_out_of_power_throttling_with(
    mut clear_flag: impl FnMut(u32) -> io::Result<()>,
) -> Vec<PowerThrottlingFailure> {
    let mut failures = Vec::new();
    for control in POWER_THROTTLING_CONTROLS {
        if let Err(error) = clear_flag(control.mask) {
            let unsupported = control.allow_unsupported_parameter
                && error.raw_os_error() == Some(WIN32_ERROR_INVALID_PARAMETER);
            if !unsupported {
                failures.push(PowerThrottlingFailure {
                    control: control.name,
                    error,
                });
            }
        }
    }
    failures
}

#[cfg(windows)]
fn clear_platform_power_throttling_flag(control_mask: u32) -> io::Result<()> {
    use std::mem::size_of;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_STATE, ProcessPowerThrottling, SetProcessInformation,
    };

    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: control_mask,
        StateMask: 0,
    };
    // SAFETY: `GetCurrentProcess()` returns the pseudo-handle for this process, and `state`
    // points to a valid initialized `PROCESS_POWER_THROTTLING_STATE` matching `size_of` bytes.
    let ok = unsafe {
        SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            (&raw const state).cast(),
            size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn clear_platform_power_throttling_flag(control_mask: u32) -> io::Result<()> {
    let _ = control_mask;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_execution_speed_and_timer_resolution_masks_independently() {
        let mut observed = Vec::new();
        let failures = opt_out_of_power_throttling_with(|mask| {
            observed.push(mask);
            Ok(())
        });

        assert!(failures.is_empty());
        assert_eq!(
            observed,
            vec![EXECUTION_SPEED_MASK, IGNORE_TIMER_RESOLUTION_MASK]
        );
    }

    #[test]
    fn windows_10_unsupported_timer_mask_preserves_execution_speed_opt_out() {
        let mut observed = Vec::new();
        let failures = opt_out_of_power_throttling_with(|mask| {
            observed.push(mask);
            if mask == IGNORE_TIMER_RESOLUTION_MASK {
                return Err(io::Error::from_raw_os_error(WIN32_ERROR_INVALID_PARAMETER));
            }
            Ok(())
        });

        assert!(failures.is_empty());
        assert_eq!(
            observed,
            vec![EXECUTION_SPEED_MASK, IGNORE_TIMER_RESOLUTION_MASK]
        );
    }

    #[test]
    fn invalid_parameter_on_execution_speed_is_not_suppressed() {
        let failures = opt_out_of_power_throttling_with(|mask| {
            if mask == EXECUTION_SPEED_MASK {
                return Err(io::Error::from_raw_os_error(WIN32_ERROR_INVALID_PARAMETER));
            }
            Ok(())
        });

        assert_eq!(failures.len(), 1);
        assert_eq!(
            failures[0].control,
            "PROCESS_POWER_THROTTLING_EXECUTION_SPEED"
        );
        assert_eq!(
            failures[0].error.raw_os_error(),
            Some(WIN32_ERROR_INVALID_PARAMETER)
        );
    }
}
