"""Add hybrid-GPU driver hints to the unsigned Windows Electron executable."""

import argparse
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import struct
import tempfile

import lief


# These exact exported DWORD names are the NVIDIA Optimus and AMD PowerXpress contracts.
GPU_HINT_EXPORTS = ("NvOptimusEnablement", "AmdPowerXpressRequestHighPerformance")
GPU_HINT_VALUE = 1


@dataclass(frozen=True)
class SectionSnapshot:
    """Original section layout and bytes that the export rewrite must preserve."""

    name: str  # PE section identity.
    address: int  # Relative virtual address used by the loader.
    virtual_size: int  # Meaningful in-memory size, excluding raw alignment padding.
    raw_offset: int  # Original file position, used to restore alignment padding.
    raw_size: int  # On-disk byte count, including padding.
    characteristics: int  # Original access and content flags.
    digest: str  # SHA-256 of all original section bytes, including padding.


def read_pe(path: Path) -> lief.PE.Binary:
    """Require a parseable Windows executable rather than accepting a missing parse result."""
    binary = lief.PE.parse(path)
    if binary is None:
        raise ValueError(f"Cannot parse Windows executable: {path}")
    return binary


def require_exports(binary: lief.PE.Binary) -> lief.PE.Export:
    """Require Electron's existing export table before inspecting or extending it."""
    exports = binary.get_export()
    if exports is None:
        raise ValueError("Windows Electron executable has no export table")
    return exports


def export_identities(exports: lief.PE.Export) -> dict[str, tuple[int, int | tuple[str, str]]]:
    """Snapshot Electron's fully named table; reject layouts a name-keyed map would lose."""
    entries = list(exports.entries)
    if (any(not entry.name for entry in entries)
            or len({entry.name for entry in entries}) != exports.export_addr_table_cnt):
        raise ValueError("GPU hint patching requires one unique export name per ordinal")
    return {
        entry.name: (
            entry.ordinal,
            (entry.forward_information.library, entry.forward_information.function)
            if entry.is_forwarded else entry.address,
        )
        for entry in entries
    }


def section_digest(path: Path, section: lief.PE.Section) -> str:
    """Hash raw section bytes without materializing Electron's large code section."""
    with path.open("rb") as stream:
        stream.seek(section.pointerto_raw_data)
        remaining = section.sizeof_raw_data
        digest = hashlib.sha256()
        while remaining:
            data = stream.read(min(remaining, 4 * 1024 * 1024))
            if not data:
                raise ValueError(f"Truncated PE section: {section.name}")
            digest.update(data)
            remaining -= len(data)
    return digest.hexdigest()


def verify_gpu_hints(path: Path) -> None:
    """Require both vendor exports to point at file-backed DWORDs containing one."""
    binary = read_pe(path)
    exports = require_exports(binary)
    entries = {entry.name: entry for entry in exports.entries}
    with path.open("rb") as stream:
        for name in GPU_HINT_EXPORTS:
            if name not in entries:
                raise ValueError(f"Windows GPU hint export is missing: {name}")
            entry = entries[name]
            if entry.is_forwarded:
                raise ValueError(f"Windows GPU hint must be exported data: {name}")
            section = binary.section_from_rva(entry.address)
            if section is None or not (
                section.virtual_address <= entry.address
                and entry.address + 4 <= section.virtual_address + section.sizeof_raw_data
            ):
                raise ValueError(f"Windows GPU hint is not file-backed: {name}")
            stream.seek(binary.rva_to_offset(entry.address))
            value, = struct.unpack("<I", stream.read(4))
            if value != GPU_HINT_VALUE:
                raise ValueError(f"Windows GPU hint must contain {GPU_HINT_VALUE}: {name}")


def patch_gpu_hints(path: Path) -> None:
    """Validate a temporary rewrite before atomically replacing the packaged executable."""
    binary = read_pe(path)
    exports = require_exports(binary)
    if any(entry.name in GPU_HINT_EXPORTS for entry in exports.entries):
        # Upstream Electron may eventually supply the complete contract itself.
        verify_gpu_hints(path)
        return
    if binary.has_signatures:
        raise ValueError("GPU hint patching requires an unsigned Windows executable")
    original_exports = export_identities(exports)
    snapshots = [SectionSnapshot(
        section.name, section.virtual_address, section.virtual_size,
        section.pointerto_raw_data, section.sizeof_raw_data, section.characteristics,
        section_digest(path, section),
    ) for section in binary.sections]
    directories = [(directory.type, directory.rva, directory.size)
                   for directory in binary.data_directories
                   if directory.type != lief.PE.DataDirectory.TYPES.EXPORT_TABLE]
    entrypoint = binary.optional_header.addressof_entrypoint
    imagebase = binary.optional_header.imagebase
    section = lief.PE.Section(".gpuhint")
    section.content = list(struct.pack("<II", GPU_HINT_VALUE, GPU_HINT_VALUE))
    section.characteristics = (
        lief.PE.Section.CHARACTERISTICS.CNT_INITIALIZED_DATA
        | lief.PE.Section.CHARACTERISTICS.MEM_READ
        | lief.PE.Section.CHARACTERISTICS.MEM_WRITE
    )
    added = binary.add_section(section)
    if added is None:
        raise ValueError("Cannot allocate Windows GPU hint data section")
    for index, name in enumerate(GPU_HINT_EXPORTS):
        exports.add_entry(name, added.virtual_address + index * 4)
    config = lief.PE.Builder.config_t()
    config.exports = True
    config.export_section = ".gpuexp"
    # Rebuild only exports; preserve resource, relocation, TLS and debug directory contents.
    for option in ("debug", "load_configuration", "relocations", "resources", "tls"):
        setattr(config, option, False)
    # Close the temporary handle before LIEF opens it, including on Windows.
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".exe", delete=False) as temporary:
        output = Path(temporary.name)
    try:
        binary.write(output, config)
        patched = read_pe(output)
        preserved_sections = []
        # LIEF zero-fills raw alignment padding. Restore it to preserve entire original sections.
        with path.open("rb") as source, output.open("r+b") as destination:
            for snapshot in snapshots:
                target = patched.get_section(snapshot.name)
                if target is None:
                    raise ValueError(f"Original PE section was removed: {snapshot.name}")
                # Debug metadata can contain file offsets, so unchanged RVAs alone are insufficient.
                if (
                    target.virtual_address,
                    target.virtual_size,
                    target.pointerto_raw_data,
                    target.sizeof_raw_data,
                    target.characteristics,
                ) != (
                    snapshot.address,
                    snapshot.virtual_size,
                    snapshot.raw_offset,
                    snapshot.raw_size,
                    snapshot.characteristics,
                ):
                    raise ValueError(f"Original PE section layout changed: {snapshot.name}")
                if snapshot.raw_size > snapshot.virtual_size:
                    source.seek(snapshot.raw_offset + snapshot.virtual_size)
                    destination.seek(target.pointerto_raw_data + snapshot.virtual_size)
                    destination.write(source.read(snapshot.raw_size - snapshot.virtual_size))
                preserved_sections.append((snapshot, target))
        for snapshot, target in preserved_sections:
            if section_digest(output, target) != snapshot.digest:
                raise ValueError(f"Original PE section bytes changed: {snapshot.name}")
        actual_exports = export_identities(require_exports(patched))
        if set(actual_exports) != set(original_exports) | set(GPU_HINT_EXPORTS):
            raise ValueError("Windows export rewrite added or removed unexpected names")
        for name, identity in original_exports.items():
            if actual_exports[name] != identity:
                raise ValueError(f"Original Windows export changed: {name}")
        if patched.optional_header.addressof_entrypoint != entrypoint:
            raise ValueError("Windows entry point changed during GPU hint patching")
        if patched.optional_header.imagebase != imagebase:
            raise ValueError("Windows image base changed during GPU hint patching")
        if [(directory.type, directory.rva, directory.size)
            for directory in patched.data_directories
            if directory.type != lief.PE.DataDirectory.TYPES.EXPORT_TABLE] != directories:
            raise ValueError("Windows non-export data directories changed")
        verify_gpu_hints(output)
        shutil.copymode(path, output)
        os.replace(output, path)
    finally:
        output.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("patch", "verify"))
    parser.add_argument("executable", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "patch":
        patch_gpu_hints(arguments.executable)
        print("Windows GPU hint exports verified")
    else:
        verify_gpu_hints(arguments.executable)


if __name__ == "__main__":
    main()
