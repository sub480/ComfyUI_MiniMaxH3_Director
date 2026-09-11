"""Output layout shared by MiniMax H3 Director features."""

from __future__ import annotations

from pathlib import Path

import folder_paths


H3_OUTPUT_DIR_NAME = "H3_D_NEO"
H3_INPUT_DIR_NAME = "H3_D_NEO"
SNAPSHOTS_DIR_NAME = "snapshots"
SEGMENT_EXPORT_DIR_NAME = "segment_export"
SEGMENT_CACHE_DIR_NAME = "segment_cache"
INPUT_UPLOADS_DIR_NAME = "uploads"
INPUT_REFERENCES_DIR_NAME = "references"
INPUT_PACKS_DIR_NAME = "packs"


def h3_output_path(*parts: str) -> Path:
    """Return a path below ``output/H3_D_NEO`` without creating directories."""
    return Path(folder_paths.get_output_directory(), H3_OUTPUT_DIR_NAME, *parts)


def h3_input_path(*parts: str) -> Path:
    """Return a path below ``input/H3_D_NEO`` without creating directories."""
    return Path(folder_paths.get_input_directory(), H3_INPUT_DIR_NAME, *parts)
