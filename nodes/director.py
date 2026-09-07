"""MiniMax H3 Director — timeline UI + official MiniMax H3 AV execution."""

from __future__ import annotations

import hashlib
import json

import comfy.samplers

from ..director.executor_core import execute_director_plan_core
from ..director.refine_pack import pack_director_builtin_refine
from .director_common import (
    finalize_director_outputs,
    prepare_director_plan,
    timeline_required_inputs,
    director_perf_inputs,
)
from .director_refine import director_refine_widget_inputs

_CATEGORY = "MiniMaxH3"

_DEFAULT_GLOBAL_PROMPT = "A cinematic scene with natural motion and synchronized ambience"


_DIRECTOR_LINKED_INPUTS = frozenset({
    "model",
    "model_r2v",
    "video_vae",
    "audio_vae",
    "clip",
    "refine_model",
    "upscale_model",
    "sigmas",
    "refine_sigmas",
})


def _director_is_changed_value(value):
    """Convert ordinary Director inputs into a stable, compact cache value.

    ``IS_CHANGED`` replaces ComfyUI's default input hashing.  Keep this
    intentionally limited to JSON-like values: linked model/latent objects are
    invalidated by their upstream nodes, while their repr often contains a
    process-specific address and would make every queue a cache miss.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {
            str(key): _director_is_changed_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        items = [_director_is_changed_value(item) for item in value]
        return sorted(items, key=lambda item: repr(item)) if isinstance(value, (set, frozenset)) else items
    # External group packs are normally dataclasses/simple objects.  Include
    # their data without hashing model/tensor payloads embedded in them.
    attrs = getattr(value, "__dict__", None)
    if isinstance(attrs, dict):
        return {
            "type": f"{type(value).__module__}.{type(value).__qualname__}",
            "data": _director_is_changed_value(attrs),
        }
    return {"type": f"{type(value).__module__}.{type(value).__qualname__}"}


def _director_input_signature(kwargs: dict, pre_cache_signature: str) -> str:
    inputs = {
        key: _director_is_changed_value(value)
        for key, value in kwargs.items()
        if key not in _DIRECTOR_LINKED_INPUTS
    }
    payload = json.dumps(
        {"inputs": inputs, "pre_cache": pre_cache_signature},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _live_tae_vae_choices():
    try:
        from ..director.tae_preview import list_vae_approx_names
        return ["auto", *list_vae_approx_names()]
    except Exception:
        return ["auto"]


def director_timeline_required_inputs() -> dict:
    """Timeline widgets — defaults aligned with official MiniMax H3 workflow templates."""
    inputs = timeline_required_inputs()
    combo_options, combo_meta = inputs["task_type"]

    gp_meta = dict(inputs["global_prompt"][1])
    gp_meta["default"] = _DEFAULT_GLOBAL_PROMPT
    gp_meta["tooltip"] = (
        "User prompt — sent directly to MiniMaxH3ImageToVideo / ReferenceToVideo. "
        "r2v: <Picture 1>. v2v: source-timeline edit (<Video 1>). "
        "rv2v: source timeline + reference images (<Video 1> + <Picture N>)."
    )

    frames_meta = dict(inputs["total_frames"][1])
    frames_meta["default"] = 124
    frames_meta["tooltip"] = (
        "Frame count at 24 fps; snapped to MiniMax 17k+5 grid (124 ≈ 5s)."
    )

    return {
        **inputs,
        "task_type": (combo_options, combo_meta),
        "global_prompt": ("STRING", gp_meta),
        "total_frames": ("INT", frames_meta),
    }


class MiniMaxH3Director:
    """In-node timeline Director using ComfyUI official MiniMax H3 pipeline."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {
                        "tooltip": (
                            "MiniMax H3 UNET (UNETLoader). "
                            "t2v / i2v / fl2v 以及混合模式中的这三类组用 ImageToVideo（fl2va）。"
                            "r2v / v2v / rv2v 仍接此口（ref2va）。"
                            "混合模式的 r2v 组请另接可选 model_r2v。"
                        ),
                    },
                ),
                "video_vae": (
                    "VAE",
                    {"tooltip": "MiniMax H3 video VAE (minimax_h3_video_vae)."},
                ),
                "audio_vae": (
                    "VAE",
                    {"tooltip": "MiniMax H3 audio VAE (minimax_h3_audio_vae). Required for r2v / v2v / rv2v."},
                ),
                "clip": (
                    "CLIP",
                    {"tooltip": "CLIPLoader type=minimax (qwen3vl)."},
                ),
                **director_timeline_required_inputs(),
            },
            "optional": {
                "model_r2v": (
                    "MODEL",
                    {
                        "tooltip": (
                            "可选 ReferenceToVideo UNET（ref2va）。"
                            "混合模式中 r2v 组使用此模型；不接则回退到 model。"
                            "纯 r2v / v2v / rv2v 仍只用上面的 model 口。"
                        ),
                    },
                ),
                "i2v_groups": (
                    "MMX_DIR_GROUP",
                    {
                        "tooltip": (
                            "External Image to Video group(s) (t2v / i2v / fl2v). "
                            "When connected, overrides UI cards for execution (external priority). "
                            "Connect Group (Image to Video).group, or Groups Combine."
                        ),
                    },
                ),
                "lora_trigger_words": (
                    "STRING",
                    {
                        "forceInput": True,
                        "default": "",
                        "tooltip": (
                            "可选。LoRA 触发词。r2v 追加到文末 style_tags 块；"
                            "其它模式拼到每组提示词最前面（mh3turbo, <原提示词>）。"
                            "不接或为空则不改提示词。"
                        ),
                    },
                ),
                "r2v_groups": (
                    "MMX_DIR_GROUP",
                    {
                        "tooltip": (
                            "External Reference to Video group(s). "
                            "When connected, overrides UI cards for execution (external priority). "
                            "Connect Group (Reference to Video).group, or Groups Combine."
                        ),
                    },
                ),
                "refine": (
                    "MMX_DIR_REFINE",
                    {
                        "tooltip": (
                            "可选。外接 MiniMax H3 Director Refine pack。"
                            "接线后覆盖导演台内置「二采」控件。"
                            "不接则用上方「二采」分组；分组关闭=单次采样。"
                        ),
                    },
                ),
                "refine_model": (
                    "MODEL",
                    {
                        "tooltip": (
                            "可选二采 UNET。不接则用导演台主模型。"
                            "适合一采挂 Turbo LoRA、二采卸掉或换另一套。"
                        ),
                    },
                ),
                "upscale_model": (
                    "UPSCALE_MODEL",
                    {
                        "tooltip": (
                            "可选像素放大模型（RealESRGAN 等）。"
                            "仅 mode=upscale 且 upscale_method=lanczos 时使用。"
                        ),
                    },
                ),
                "bd_grp_advanced": ("BDGROUP", {"default": "高级采样"}),
                "steps": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 200,
                        "tooltip": (
                            "一采步数（官方模板 25）。"
                            "接了 sigmas 口后忽略此项，改用外接噪声表。"
                        ),
                    },
                ),
                "sampler": (
                    comfy.samplers.KSampler.SAMPLERS,
                    {
                        "default": "res_multistep",
                        "tooltip": "Official template: KSamplerSelect res_multistep.",
                    },
                ),
                "scheduler": (
                    comfy.samplers.KSampler.SCHEDULERS,
                    {
                        "default": "simple",
                        "tooltip": (
                            "一采调度器（官方模板 simple）。"
                            "接了 sigmas 口后忽略此项，改用外接噪声表。"
                        ),
                    },
                ),
                "shift_video": (
                    "FLOAT",
                    {"default": 12.0, "min": 0.01, "max": 100.0, "step": 0.01, "tooltip": "MiniMaxH3SigmaShift shift_video."},
                ),
                "shift_audio": (
                    "FLOAT",
                    {"default": 3.0, "min": 0.01, "max": 100.0, "step": 0.01, "tooltip": "MiniMaxH3SigmaShift shift_audio."},
                ),
                "live_tae_vae": (
                    _live_tae_vae_choices(),
                    {
                        "default": "auto",
                        "tooltip": (
                            "实时预览 TinyVAE / taeh3（扫描 models/vae_approx）。"
                            "auto=自动选用 minimax-h3/taeh3。"
                        ),
                    },
                ),
                **director_perf_inputs(),
                **director_refine_widget_inputs(),
                "sigmas": (
                    "SIGMAS",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "可选。一采噪声表，接 BasicScheduler 或 ManualSigmas。"
                            "接线后覆盖导演台「步数」和「调度器」（采样器下拉仍有效）。"
                            "BasicScheduler 请接 SigmaShift 之后的同一套 H3 MODEL。"
                            "不接则仍用步数 + 调度器、denoise=1 自动算表。"
                        ),
                    },
                ),
                "refine_sigmas": (
                    "SIGMAS",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "可选。二采噪声表，接 BasicScheduler 或 ManualSigmas。"
                            "接线后覆盖二采步数 / 调度器 / denoise / 低噪加步。"
                            "不接则用「二采」分组内部算表。"
                        ),
                    },
                ),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **_kwargs):
        if input_types is not None:
            expected = {
                "model": "MODEL",
                "model_r2v": "MODEL",
                "video_vae": "VAE",
                "audio_vae": "VAE",
                "clip": "CLIP",
            }
            for name, want in expected.items():
                got = input_types.get(name)
                if got is not None and got != want:
                    return f"{name}: expected {want}, linked node returns {got}."
            got_sigmas = input_types.get("sigmas")
            if got_sigmas is not None and got_sigmas != "SIGMAS":
                return f"sigmas: expected SIGMAS, linked node returns {got_sigmas}."
            got_refine_model = input_types.get("refine_model")
            if got_refine_model is not None and got_refine_model != "MODEL":
                return f"refine_model: expected MODEL, linked node returns {got_refine_model}."
            got_refine_sigmas = input_types.get("refine_sigmas")
            if got_refine_sigmas is not None and got_refine_sigmas != "SIGMAS":
                return f"refine_sigmas: expected SIGMAS, linked node returns {got_refine_sigmas}."
        return True

    @classmethod
    def IS_CHANGED(cls, unique_id=None, **kwargs):
        # Fingerprint both execution inputs and .pre cache files.  The old
        # implementation discarded kwargs and therefore returned the same
        # value when only timeline_data/runSelection changed; ComfyUI then
        # reused the previous node output, making preview and exported MP4
        # appear to come from the previous run.
        from ..director.segment_cache import first_pass_cache_disk_signature

        pre_cache_signature = first_pass_cache_disk_signature(unique_id)
        return _director_input_signature(kwargs, pre_cache_signature)

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "INT", "IMAGE", "STRING", "IMAGE")
    RETURN_NAMES = ("images", "audio", "fps", "frame_count", "source_images", "report", "images_pre_refine")
    OUTPUT_IS_LIST = (True, True, False, False, True, False, True)
    FUNCTION = "execute"
    CATEGORY = _CATEGORY
    DESCRIPTION = (
        "MiniMax H3 Director: MiniMaxH3ImageToVideo / ReferenceToVideo conditioning, "
        "single-stage KSampler + MiniMaxH3SigmaShift, LTXVSeparateAVLatent decode. "
        "Supports t2v / i2v / fl2v / mixed / r2v / v2v / rv2v. "
        "Optional i2v_groups / r2v_groups accept multi-group packs from Director Group nodes "
        "(external priority over UI cards). Built-in 二采 group runs a second sample / upscale; "
        "optional refine pack still overrides the in-node widgets. "
        "images_pre_refine is the first-pass video before refine. "
        "Defaults: 0.4MP 16:9 (864×480), 5s / 124 frames @ 24 fps."
    )

    def execute(
        self,
        model,
        video_vae,
        audio_vae,
        clip,
        task_type,
        global_prompt,
        frame_rate,
        width,
        height,
        ref_max_size,
        total_frames,
        timeline_data,
        unique_id=None,
        model_r2v=None,
        i2v_groups=None,
        r2v_groups=None,
        lora_trigger_words="",
        refine=None,
        refine_model=None,
        upscale_model=None,
        refine_sigmas=None,
        sigmas=None,
        steps=25,
        sampler="res_multistep",
        scheduler="simple",
        cfg=1.0,
        seed=0,
        shift_video=12.0,
        shift_audio=3.0,
        export_source_images=False,
        live_tae_vae="auto",
        **kwargs,
    ):
        if refine is None:
            refine = pack_director_builtin_refine(
                enabled=kwargs.get("refine_enable", False),
                refine_model=refine_model,
                upscale_model=upscale_model,
                refine_sigmas=refine_sigmas,
                **kwargs,
            )
        del kwargs

        plan = prepare_director_plan(
            timeline_data=timeline_data,
            task_type=task_type,
            global_prompt=global_prompt,
            total_frames=total_frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=ref_max_size,
            unique_id=unique_id,
            i2v_groups=i2v_groups,
            r2v_groups=r2v_groups,
            refine=refine,
            lora_trigger_words=lora_trigger_words,
        )
        raw = getattr(plan, "raw", None)
        if isinstance(raw, dict):
            vae_name = "" if str(live_tae_vae or "").strip() in ("", "auto") else str(live_tae_vae).strip()
            raw["liveTaeVae"] = vae_name

        try:
            combined, segment_outputs, segment_audios, report, export_frame_counts, pre_combined, pre_segments = (
                execute_director_plan_core(
                    plan,
                    node_id=unique_id,
                    model=model,
                    model_r2v=model_r2v,
                    vae=video_vae,
                    audio_vae=audio_vae,
                    clip=clip,
                    cfg=cfg,
                    seed=seed,
                    steps=steps,
                    sampler=sampler,
                    scheduler=scheduler,
                    sigmas=sigmas,
                    shift_video=shift_video,
                    shift_audio=shift_audio,
                    clear_vram_between_segments=True,
                )
            )

            return finalize_director_outputs(
                plan,
                combined,
                segment_outputs,
                report,
                export_source_images=export_source_images,
                segment_audios=segment_audios,
                segment_frame_counts=export_frame_counts,
                pre_refine_combined=pre_combined,
                pre_refine_segments=pre_segments,
            )
        finally:
            # Full source/reference PCM is execution-scoped.
            cache = getattr(plan, "audio_decode_cache", None)
            if isinstance(cache, dict):
                cache.clear()
            for item in getattr(plan, "global_ref_audios", None) or []:
                if getattr(item, "audio_path", ""):
                    item.audio = None
