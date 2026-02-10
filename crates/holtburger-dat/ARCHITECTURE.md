# DAT File Architecture 📚

The "Library" crate responsible for reading and parsing Asheron's Call's local data files (Portal, Cell, and Language DATs).

## Key Components

### 1. The Database ([src/lib.rs](src/lib.rs))
The `DatDatabase` remains the primary entry point for looking up resources by their ID. It handles the underlying file IO and directory indexing.

### 2. File Systems ([src/file_type/](src/file_type/))
Contains parsers for specific file types found inside the DATs:
- `gfx_obj`: 3D model data.
- `weenie`: Object templates (the "Blueprints" for monsters and items).
- `landblock`: Terrain and heightmap data.

### 3. Landblocks ([src/landblock.rs](src/landblock.rs))
Specific logic for parsing the complex terrain structure of Dereth, including cells and building positions.

## Performance
We use memoization and caching where possible to ensure that looking up a monster's stats or a 3D model's dimensions doesn't block the main engine's tick.
