"""MiniMax H3 conditioning — delegates to ComfyUI official MiniMaxH3 nodes."""

from __future__ import annotations

from ..lib.ref_images import REF_IMAGE_KEY_PREFIX, flatten_reference_kwargs
from ..lib.task_modes import TASK_DESCRIPTIONS, infer_task


def _load_minimax_nodes():
    try:
        from comfy_extras.nodes_minimax_h3 import (
            MiniMaxH3ImageToVideo,
            MiniMaxH3ReferenceToVideo,
        )
    except ImportError as exc:
        raise RuntimeError(
            "H3_D_NEO requires ComfyUI official MiniMax H3 nodes "
            "(comfy_extras.nodes_minimax_h3). Upgrade to ComfyUI with PR #15224 merged."
        ) from exc
    return MiniMaxH3ImageToVideo, MiniMaxH3ReferenceToVideo


def _unpack_positive_latent(out):
    args = None
    if hasattr(out, "args"):
        args = out.args
    elif isinstance(out, (tuple, list)):
        args = out
    if args and len(args) >= 2:
        return args[0], args[1]
    raise RuntimeError(f"MiniMax H3 conditioning returned unexpected output: {type(out)!r}")


def _reference_images_dict_from_kwargs(kwargs: dict) -> dict | None:
    nested = kwargs.get("ref_images")
    if isinstance(nested, dict) and nested:
        out = {k: v for k, v in nested.items() if v is not None}
        return out or None

    refs = flatten_reference_kwargs(kwargs)
    out: dict[str, object] = {}
    for key, value in refs.items():
        if value is None:
            continue
        idx = key.removeprefix(REF_IMAGE_KEY_PREFIX)
        out[f"ref_image_{idx}"] = value
    return out or None


def _reference_videos_dict(ref_videos: dict | None) -> dict | None:
    if not ref_videos:
        return None
    out = {k: v for k, v in ref_videos.items() if v is not None}
    return out or None


def _task_hint(task_key: str, ref_images, ref_videos) -> str:
    ref_image_count = len(ref_images or {})
    ref_video_count = len(ref_videos or {})
    mode = infer_task(ref_image_count, ref_video_count)
    hint = f"{task_key or mode.value} — {TASK_DESCRIPTIONS[mode]} (MiniMax H3)"
    if ref_image_count or ref_video_count:
        hint += f" (~{ref_image_count} ref image(s), {ref_video_count} ref video(s))"
    return hint


def run_minimax_conditioning(
    *,
    clip,
    vae,
    audio_vae,
    prompt: str,
    width: int,
    height: int,
    length: int,
    task_key: str,
    first_frame=None,
    last_frame=None,
    ref_images=None,
    ref_videos=None,
    ref_video_audios=None,
    ref_audios=None,
    ref_image_size: str = "match",
    **kwargs,
):
    """Build positive conditioning + AV latent via official MiniMax H3 nodes."""
    MiniMaxH3ImageToVideo, MiniMaxH3ReferenceToVideo = _load_minimax_nodes()

    ref_images = ref_images or _reference_images_dict_from_kwargs(kwargs)
    ref_videos = _reference_videos_dict(ref_videos)

    use_reference = (
        task_key in {"r2v", "v2v", "rv2v"}
        or ref_images
        or ref_videos
        or ref_audios
        or ref_video_audios
    )

    if use_reference:
        if audio_vae is None:
            raise ValueError("MiniMax H3 r2v/v2v/rv2v / reference conditioning requires audio_vae.")
        out = MiniMaxH3ReferenceToVideo.execute(
            clip=clip,
            vae=vae,
            audio_vae=audio_vae,
            prompt=prompt,
            width=width,
            height=height,
            length=length,
            ref_image_size=ref_image_size,
            ref_images=ref_images,
            ref_videos=ref_videos,
            ref_video_audios=ref_video_audios,
            ref_audios=ref_audios,
        )
    else:
        out = MiniMaxH3ImageToVideo.execute(
            clip,
            vae,
            prompt,
            width,
            height,
            length,
            first_frame=first_frame,
            last_frame=last_frame,
        )

    positive, latent = _unpack_positive_latent(out)
    hint = _task_hint(task_key, ref_images, ref_videos)
    return positive, [], latent, hint
