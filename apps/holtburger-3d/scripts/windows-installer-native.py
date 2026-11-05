"""Narrow Windows API bridge for the app's Node installer verification."""

import ctypes
from ctypes import wintypes
import json
import sys
import winreg


def registration(key_name: str) -> None:
    """Return the per-user installer registration without localized CLI parsing."""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_name)
    except FileNotFoundError:
        print("null")
        return
    with key:
        print(json.dumps({
            "location": winreg.QueryValueEx(key, "InstallLocation")[0],
            "version": winreg.QueryValueEx(key, "DisplayVersion")[0],
        }))


def delete_lock(path: str) -> None:
    """Hold a real deny-delete handle until the owning Node process closes stdin."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    ]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    # Allow readers/writers, but omit FILE_SHARE_DELETE to block installer cleanup.
    handle = kernel.CreateFileW(path, 0x80000000, 0x1 | 0x2, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        print("locked", flush=True)
        sys.stdin.buffer.read(1)
    finally:
        if not kernel.CloseHandle(handle):
            raise ctypes.WinError(ctypes.get_last_error())


if __name__ == "__main__":
    operation, argument = sys.argv[1:]
    if operation == "registration":
        registration(argument)
    elif operation == "delete-lock":
        delete_lock(argument)
    else:
        raise ValueError(f"Unknown native installer operation: {operation}")
