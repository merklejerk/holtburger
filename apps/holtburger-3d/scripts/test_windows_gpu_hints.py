"""Exercise executable patching with generated PE files, without runtime assets."""

from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import lief

from windows_gpu_hints import GPU_HINT_EXPORTS, GPU_HINT_VALUE, patch_gpu_hints, verify_gpu_hints


def make_executable(path: Path) -> None:
    """Create direct, aliased and forwarded exports plus nonzero raw code padding."""
    factory = lief.PE.Factory.create(lief.PE.PE_TYPE.PE32_PLUS)
    section = lief.PE.Section(".text")
    section.content = [0xc3] * 16
    section.virtual_size = len(section.content)
    section.sizeof_raw_data = 512
    section.characteristics = (
        lief.PE.Section.CHARACTERISTICS.CNT_CODE
        | lief.PE.Section.CHARACTERISTICS.MEM_READ
        | lief.PE.Section.CHARACTERISTICS.MEM_EXECUTE
    )
    factory.add_section(section)
    binary = factory.get()
    address = binary.sections[0].virtual_address
    binary.optional_header.addressof_entrypoint = address
    forwarded = lief.PE.ExportEntry("forwarded", 0)
    forwarded.set_forward_info("KERNEL32", "Sleep")
    binary.set_export(lief.PE.Export("fixture.exe", [
        lief.PE.ExportEntry("original", address),
        lief.PE.ExportEntry("alias", address),
        forwarded,
    ]))
    config = lief.PE.Builder.config_t()
    config.exports = True
    binary.write(path, config)
    code = lief.PE.parse(path).get_section(".text")
    with path.open("r+b") as stream:
        stream.seek(code.pointerto_raw_data + code.virtual_size)
        stream.write(b"\xcc" * (code.sizeof_raw_data - code.virtual_size))


class WindowsGpuHintTests(unittest.TestCase):
    """Patching preserves loader contracts and never commits an unverified output."""

    def test_adds_hints_without_changing_original_exports_or_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            before = lief.PE.parse(path)
            original = {entry.name: (entry.ordinal, entry.address)
                        for entry in before.get_export().entries if not entry.is_forwarded}
            section = before.get_section(".text")
            code = path.read_bytes()[section.pointerto_raw_data:
                                     section.pointerto_raw_data + section.sizeof_raw_data]
            patch_gpu_hints(path)
            verify_gpu_hints(path)
            after = lief.PE.parse(path)
            entries = {entry.name: entry for entry in after.get_export().entries}
            self.assertEqual(set(entries), set(original) | {"forwarded"} | set(GPU_HINT_EXPORTS))
            for name, expected in original.items():
                self.assertEqual((entries[name].ordinal, entries[name].address), expected)
            self.assertTrue(entries["forwarded"].is_forwarded)
            self.assertEqual(entries["forwarded"].forward_information.function, "Sleep")
            section = after.get_section(".text")
            self.assertEqual(path.read_bytes()[section.pointerto_raw_data:
                                              section.pointerto_raw_data + section.sizeof_raw_data], code)
            self.assertEqual(after.optional_header.addressof_entrypoint,
                             before.optional_header.addressof_entrypoint)

    def test_repeated_patch_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            patch_gpu_hints(path)
            original = path.read_bytes()
            patch_gpu_hints(path)
            self.assertEqual(path.read_bytes(), original)

    def test_missing_hint_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            with self.assertRaisesRegex(ValueError, "export is missing"):
                verify_gpu_hints(path)

    def test_ordinal_only_export_is_rejected_before_rewriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            binary = lief.PE.parse(path)
            exports = binary.get_export()
            directory = binary.data_directory(lief.PE.DataDirectory.TYPES.EXPORT_TABLE)
            # The next address slot already contains a valid string RVA. Expose it as an
            # ordinal-only data export using IMAGE_EXPORT_DIRECTORY.NumberOfFunctions.
            function_count_offset = 20
            with path.open("r+b") as stream:
                stream.seek(binary.rva_to_offset(directory.rva) + function_count_offset)
                stream.write(struct.pack("<I", exports.export_addr_table_cnt + 1))
            original = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "one unique export name per ordinal"):
                patch_gpu_hints(path)
            self.assertEqual(path.read_bytes(), original)

    def test_invalid_hint_value_is_rejected_without_repatching(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            patch_gpu_hints(path)
            binary = lief.PE.parse(path)
            entry = next(entry for entry in binary.get_export().entries
                         if entry.name == GPU_HINT_EXPORTS[0])
            with path.open("r+b") as stream:
                stream.seek(binary.rva_to_offset(entry.address))
                stream.write(struct.pack("<I", GPU_HINT_VALUE ^ 1))
            original = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "must contain"):
                patch_gpu_hints(path)
            self.assertEqual(path.read_bytes(), original)

    def test_failed_verification_preserves_input_and_removes_temporary_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.exe"
            make_executable(path)
            original = path.read_bytes()
            with patch("windows_gpu_hints.verify_gpu_hints", side_effect=ValueError("rejected output")):
                with self.assertRaisesRegex(ValueError, "rejected output"):
                    patch_gpu_hints(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(temporary).iterdir()), [path])
