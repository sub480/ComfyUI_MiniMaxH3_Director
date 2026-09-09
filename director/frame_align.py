"""Exact frame-count alignment for Director merge / cache / preview outputs."""

from __future__ import annotations

import torch

# MiniMax H3 is trained at 24 fps (audio latent 40 Hz on this clock). Not user-editable.
H3_FPS = 24.0


def minimax_align_frame_count(frame_count: int) -> int:
    """Round up to MiniMax H3 17k+5 frame grid (5, 22, 39, …)."""
    n = max(5, int(frame_count))
    while n % 17 != 5:
        n += 1
    return n


def minimax_floor_frame_count(frame_count: int) -> int:
    """Round down to the MiniMax H3 17k+5 frame grid without padding."""
    n = int(frame_count)
    if n < 5:
        return 0
    return 5 + ((n - 5) // 17) * 17


def pad_or_trim_frames(frames: torch.Tensor, target_len: int) -> torch.Tensor:
    """Trim to at most target_len frames. Does not fabricate last-frame duplicates."""
    target_len = max(0, int(target_len))
    if target_len <= 0:
        return frames[:0]
    if int(frames.shape[0]) > target_len:
        return frames[:target_len]
    return frames
