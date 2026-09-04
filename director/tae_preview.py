"""Lightweight MiniMax H3 TAE / Latent2RGB previews during sampling.

Uses ``models/vae_approx/taeh3.safetensors`` when present (Kijai / madebyollin
flat TinyVAE, 24-ch). Falls back to Latent2RGB so the UI still updates.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageOps

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.tae_preview")

_DEFAULT_TAE_NAME = "taeh3.safetensors"
_lock = threading.Lock()
_decoders: dict[str, Any] = {}
_decoder_failed: set[str] = set()


def _place(model, device, dtype):
    model = model.eval().to(device=device, dtype=dtype)
    if torch.device(device).type == "cuda":
        model.to(memory_format=torch.channels_last)
    return model


def _build_tae_decoder(sd: dict):
    # Mirror KJNodes TinyVAEDecoder layout recovery (flat indexed modules).
    from comfy.taesd.taesd import Block, Clamp, conv

    by_index: dict[int, dict] = {}
    for k, v in sd.items():
        head, _, rest = k.partition(".")
        if not head.isdigit():
            raise ValueError(f"not a flat TAE decoder state dict (unexpected key '{k}')")
        by_index.setdefault(int(head), {})[rest] = v

    modules = []
    for i in range(max(by_index) + 1):
        entry = by_index.get(i)
        if entry is None:
            modules.append(Clamp() if i == 0 else nn.ReLU() if i == 2 else nn.Upsample(scale_factor=2))
        elif "conv.0.weight" in entry:
            w = entry["conv.0.weight"]
            if "pool.0.weight" in entry:
                modules.append(Block(w.shape[1], w.shape[0], use_midblock_gn=True))
            else:
                modules.append(Block(w.shape[1], w.shape[0]))
        elif "weight" in entry:
            w = entry["weight"]
            modules.append(conv(w.shape[1], w.shape[0], bias="bias" in entry))
        else:
            raise ValueError(f"unrecognized TAE decoder module at index {i}: {sorted(entry)}")
    return nn.Sequential(*modules)


class _TinyVAEDecoder:
    def __init__(self, sd, device=None, dtype=None):
        import comfy.model_management as mm

        prefix = ""
        first = next(iter(sd))
        if not first.split(".")[0].isdigit():
            prefix = first.split(".")[0] + "."
            sd = {k[len(prefix):]: v for k, v in sd.items() if k.startswith(prefix)}

        self.device = device if device is not None else mm.vae_device()
        self.dtype = dtype if dtype is not None else mm.vae_dtype(
            self.device, [torch.float16, torch.bfloat16]
        )
        self.model = _build_tae_decoder(sd)
        self.model.load_state_dict(sd)
        self.model = _place(self.model, self.device, self.dtype)
        self.latent_channels = self.model[1].weight.shape[1]

    @torch.inference_mode()
    def decode_frame(self, latent_bchw: torch.Tensor) -> torch.Tensor:
        """[1,C,H,W] -> [H',W',3] float in 0..1"""
        out = self.model(latent_bchw.to(device=self.device, dtype=self.dtype))
        return out[0].movedim(0, -1).float().clamp(0, 1).cpu()

    @torch.inference_mode()
    def decode_video(self, latent_bcthw: torch.Tensor, frame_indices=None) -> torch.Tensor:
        """[B,C,T,H,W] -> [n,H',W',3] float in 0..1"""
        x = latent_bcthw[0]
        indices = range(int(x.shape[1])) if frame_indices is None else list(frame_indices)
        frames = [self.decode_frame(x[:, int(t)].unsqueeze(0)) for t in indices]
        return torch.stack(frames, dim=0)


def _is_taehv_state_dict(sd: dict) -> bool:
    return "decoder.1.weight" in sd and "decoder.22.bias" in sd


class _TAEHVDecoder:
    """Temporal TAEHV (minimax-h3/taeh3.safetensors). Decode only."""

    def __init__(self, sd, device=None, dtype=None):
        from comfy.taesd.taehv import TAEHV, conv
        import comfy.model_management as mm

        latent_channels = int(sd["decoder.1.weight"].shape[1])
        patch_size = max(1, int(round((sd["decoder.22.bias"].shape[0] / 3) ** 0.5)))
        model = TAEHV(latent_channels=latent_channels)
        if model.patch_size != patch_size:
            model.patch_size = patch_size
            model.encoder[0] = conv(3 * patch_size ** 2, model.encoder[0].out_channels)
            model.decoder[-1] = conv(model.decoder[-1].in_channels, 3 * patch_size ** 2)
        model.load_state_dict(sd)
        del model.encoder
        self.device = device if device is not None else mm.vae_device()
        self.dtype = dtype if dtype is not None else mm.vae_dtype(
            self.device, [torch.float16, torch.bfloat16]
        )
        self.model = _place(model, self.device, self.dtype)
        self.latent_channels = latent_channels
        self.is_h3 = latent_channels == 24 and patch_size == 2

    @torch.inference_mode()
    def _decode(self, latent: torch.Tensor) -> torch.Tensor:
        out = self.model.decode(latent.to(device=self.device, dtype=self.dtype))
        return out.to(dtype=torch.float32)

    @torch.inference_mode()
    def decode_frame(self, latent_bchw: torch.Tensor) -> torch.Tensor:
        rgb = self._decode(latent_bchw.unsqueeze(2))[0, :, 0]
        return rgb.movedim(0, -1).float().clamp(0, 1).cpu()

    @torch.inference_mode()
    def decode_video(self, latent_bcthw: torch.Tensor, frame_indices=None) -> torch.Tensor:
        t_total = int(latent_bcthw.shape[2])
        n = t_total if frame_indices is None else max(1, min(len(list(frame_indices)), t_total))
        # MemBlock is causal — decode a prefix rather than random timestamps.
        clip = latent_bcthw[:1, :, :n]
        rgb = self._decode(clip)[0].movedim(0, -1).float().clamp(0, 1).cpu()
        if rgb.shape[0] > n:
            picks = torch.linspace(0, rgb.shape[0] - 1, n).round().long()
            rgb = rgb[picks]
        return rgb


_VAE_APPROX_EXTS = {".safetensors", ".pt", ".pth", ".ckpt", ".bin"}


def list_vae_approx_names() -> list[str]:
    """Scan models/vae_approx (and extra paths) every call so the UI stays current."""
    found: set[str] = set()
    try:
        import folder_paths
        for name in folder_paths.get_filename_list("vae_approx") or []:
            found.add(str(name).replace("\\", "/"))
        roots = []
        try:
            roots = list(folder_paths.get_folder_paths("vae_approx") or [])
        except Exception:
            roots = []
        for root in roots:
            if not root or not os.path.isdir(root):
                continue
            for dirpath, _, files in os.walk(root):
                for fn in files:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext not in _VAE_APPROX_EXTS:
                        continue
                    rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                    found.add(rel)
    except Exception as exc:
        log.debug("vae_approx scan failed: %s", exc)
    return sorted(found, key=str.lower)


def default_tae_name() -> str:
    names = list_vae_approx_names()
    for cand in ("minimax-h3/taeh3.safetensors", "taeh3.safetensors"):
        if cand in names:
            return cand
    for n in names:
        low = n.lower().replace("\\", "/")
        if "taeh3" in low or "vaeh3" in low:
            return n
    return ""


def get_tae_decoder(name: str | None = None):
    chosen = str(name or "").strip()
    if not chosen:
        chosen = default_tae_name()
    if not chosen:
        return None
    if chosen in _decoder_failed:
        return None
    cached = _decoders.get(chosen)
    if cached is not None:
        return cached
    with _lock:
        cached = _decoders.get(chosen)
        if cached is not None or chosen in _decoder_failed:
            return cached
        try:
            import folder_paths
            import comfy.utils

            path = folder_paths.get_full_path("vae_approx", chosen)
            if path is None:
                log.info("TAE preview: %s not found in models/vae_approx — using Latent2RGB.", chosen)
                _decoder_failed.add(chosen)
                return None
            sd = comfy.utils.load_torch_file(path, safe_load=True)
            dec = _TAEHVDecoder(sd) if _is_taehv_state_dict(sd) else _TinyVAEDecoder(sd)
            _decoders[chosen] = dec
            kind = "TAEHV" if isinstance(dec, _TAEHVDecoder) else "TinyVAE"
            log.info("TAE preview: loaded %s (%s, %d-ch).", chosen, kind, dec.latent_channels)
            return dec
        except Exception as exc:
            log.warning("TAE preview: failed to load %s (%s) — using Latent2RGB.", chosen, exc)
            _decoder_failed.add(chosen)
            return None


def _video_latent_from_x0(x0: Any) -> torch.Tensor | None:
    """Return video stream as [B,C,T,H,W] from NestedTensor / plain tensor."""
    try:
        # NestedTensor has unbind(); plain torch.Tensor also has unbind — do not use that.
        if not isinstance(x0, torch.Tensor) and hasattr(x0, "unbind"):
            parts = x0.unbind()
            if parts:
                x0 = parts[0]
        elif isinstance(x0, (tuple, list)) and x0:
            x0 = x0[0]
        if not isinstance(x0, torch.Tensor):
            return None
        if x0.ndim == 5:
            return x0
        if x0.ndim == 4:
            return x0.unsqueeze(2)
    except Exception as exc:
        log.debug("TAE preview: could not unpack x0: %s", exc)
    return None


LIVE_PREVIEW_MAX_FRAMES = 16
LIVE_PREVIEW_FPS = 16.0


def _latent2rgb_pil(video: torch.Tensor, t: int | None = None) -> Image.Image | None:
    try:
        from comfy.latent_formats import MiniMaxH3Video
        import latent_preview

        fmt = MiniMaxH3Video()
        previewer = latent_preview.Latent2RGBPreviewer(
            fmt.latent_rgb_factors,
            fmt.latent_rgb_factors_bias,
        )
        if t is None:
            t = int(video.shape[2] // 2)
        t = max(0, min(int(t), int(video.shape[2]) - 1))
        frame = video[:1, :, t]
        out = previewer.decode_latent_to_preview(frame)
        if isinstance(out, Image.Image):
            return out.convert("RGB")
    except Exception as exc:
        log.debug("Latent2RGB preview failed: %s", exc)
    return None


def _finish_preview_pil(pil: Image.Image, *, max_side: int = 512) -> Image.Image:
    min_side = 256
    longest = max(int(pil.width), int(pil.height))
    if longest > 0 and longest < min_side:
        scale = min_side / float(longest)
        pil = pil.resize(
            (max(1, int(round(pil.width * scale))), max(1, int(round(pil.height * scale)))),
            Image.Resampling.NEAREST if hasattr(Image, "Resampling") else Image.NEAREST,
        )
    if max_side and max_side > 0 and (pil.width > max_side or pil.height > max_side):
        pil = ImageOps.contain(pil, (max_side, max_side), Image.LANCZOS)
    return pil


def x0_to_preview_pil(x0: Any, *, max_side: int = 512) -> Image.Image | None:
    pils = x0_to_preview_pils(x0, max_side=max_side, max_frames=1)
    return pils[0] if pils else None


def x0_to_preview_pils(
    x0: Any,
    *,
    max_side: int = 512,
    max_frames: int = LIVE_PREVIEW_MAX_FRAMES,
    tae_name: str | None = None,
) -> list[Image.Image]:
    """Decode a temporal strip of x0 (KJ-style animated TAE preview)."""
    video = _video_latent_from_x0(x0)
    if video is None or video.numel() == 0:
        return []

    t_total = max(1, int(video.shape[2]))
    n = max(1, min(int(max_frames or 1), t_total))
    if n >= t_total:
        indices = list(range(t_total))
    else:
        indices = np.linspace(0, t_total - 1, n).round().astype(int).tolist()

    dec = get_tae_decoder(tae_name)
    out: list[Image.Image] = []
    if dec is not None and int(video.shape[1]) == int(dec.latent_channels):
        try:
            rgb = dec.decode_video(video[:1], frame_indices=indices)
            for i in range(int(rgb.shape[0])):
                arr = (rgb[i].numpy() * 255.0).clip(0, 255).astype(np.uint8)
                out.append(_finish_preview_pil(Image.fromarray(arr, mode="RGB"), max_side=max_side))
            if out:
                return out
        except Exception as exc:
            log.warning("TAE decode failed, falling back to Latent2RGB: %s", exc)
            out = []

    for t in indices:
        pil = _latent2rgb_pil(video, t)
        if pil is None:
            continue
        out.append(_finish_preview_pil(pil, max_side=max_side))
    return out


def pil_to_jpeg_b64(pil: Image.Image, *, quality: int = 80) -> str:
    import base64
    import io

    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=int(quality))
    return base64.b64encode(buf.getvalue()).decode("ascii")
