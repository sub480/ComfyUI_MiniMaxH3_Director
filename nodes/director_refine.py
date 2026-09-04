"""Graph packer: Refine / upscale config for MiniMax H3 Director.refine."""

from __future__ import annotations

import comfy.samplers

from ..director.h3_latent_upscale import list_h3_latent_upscale_models
from ..director.refine_pack import (
    ASPECT_RATIO_CHOICES,
    DEFAULT_MAX_SIZE_FOR_NO_TILE,
    DEFAULT_N_TILES,
    DEFAULT_REFINE_DENOISE,
    DEFAULT_REFINE_END_AT_SIGMA,
    DEFAULT_REFINE_EXTRA_STEPS,
    DEFAULT_REFINE_SAMPLE_STEPS,
    DEFAULT_REFINE_SCHEDULER,
    DEFAULT_REFINE_SIGMA_SAMPLER,
    DEFAULT_REFINE_START_AT_SIGMA,
    DEFAULT_SEAM_REFINE_STEPS,
    DEFAULT_SIGMA_SPACING,
    DEFAULT_TILE_OVERLAP,
    DEFAULT_UPSCALE_MEGAPIXELS,
    FOLLOW_DIRECTOR_ASPECT,
    MAX_REFINE_PASSES,
    MMX_DIR_REFINE,
    REFINE_MODES,
    SEED_MODES,
    SIGMA_SPACINGS,
    TILE_AXES,
    UPSCALE_METHODS,
    infer_upscale_target,
    pack_refine,
)

_CATEGORY = "MiniMaxH3"


def director_refine_widget_inputs() -> dict:
    """Director in-node 二采 widgets. Appended after 性能 so old widget indices stay stable."""
    return {
        "bd_grp_refine": ("BDGROUP", {"default": "二采"}),
        "refine_enable": (
            "BOOLEAN",
            {
                "default": False,
                "tooltip": (
                    "启用二采：每段在一采之后再跑精修/放大。"
                    "关闭=只一采；打开后各组默认切到二采。"
                    "外接 Refine 节点时仍以外接配置为准。"
                ),
            },
        ),
        "refine_mode": (
            list(REFINE_MODES),
            {
                "default": "refine",
                "tooltip": (
                    "refine = 同分辨率二采（精修）。"
                    "upscale = 先放大到目标画布再二采。"
                    "latent_upscale = 只放大 H3 latent，不再二采。"
                ),
            },
        ),
        "refine_upscale_method": (
            list(UPSCALE_METHODS),
            {
                "default": "h3_latent",
                "tooltip": (
                    "仅 mode=upscale。"
                    "h3_latent = 先按目标画布放大 H3 视频 latent，再二采。"
                    "lanczos = 像素插值；可另接 upscale_model。"
                    "nvidia_rtx_vsr = NVIDIA RTX Video Super Resolution。"
                ),
            },
        ),
        "refine_latent_upscale_model": (
            list_h3_latent_upscale_models(),
            {
                "tooltip": (
                    "H3 3D latent 放大权重。"
                    "放到 ComfyUI/models/latent_upscale_models/。"
                    "mode=latent_upscale，或 upscale + h3_latent 时使用。"
                ),
            },
        ),
        "refine_sampler": (
            comfy.samplers.KSampler.SAMPLERS,
            {
                "default": DEFAULT_REFINE_SIGMA_SAMPLER,
                "tooltip": "二采采样器。海螺案例用 euler。",
            },
        ),
        "refine_passes": (
            "INT",
            {
                "default": 1,
                "min": 1,
                "max": MAX_REFINE_PASSES,
                "tooltip": "精修次数。upscale 只在第 1 次放大。latent_upscale 不二采。",
            },
        ),
        "refine_sample_steps": (
            "INT",
            {
                "default": DEFAULT_REFINE_SAMPLE_STEPS,
                "min": 1,
                "max": 200,
                "tooltip": "二采步数。接了 refine_sigmas 口后忽略。",
            },
        ),
        "refine_scheduler": (
            comfy.samplers.KSampler.SCHEDULERS,
            {
                "default": DEFAULT_REFINE_SCHEDULER,
                "tooltip": "二采调度器。接了 refine_sigmas 口后忽略。",
            },
        ),
        "refine_denoise": (
            "FLOAT",
            {
                "default": DEFAULT_REFINE_DENOISE,
                "min": 0.0,
                "max": 1.0,
                "step": 0.01,
                "tooltip": "二采 denoise（BasicScheduler）。接了 refine_sigmas 口后忽略。",
            },
        ),
        "refine_extra_steps": (
            "INT",
            {
                "default": DEFAULT_REFINE_EXTRA_STEPS,
                "min": 0,
                "max": 15,
                "tooltip": "低噪区间额外加步。0 = 关闭。接了 refine_sigmas 口后忽略。",
            },
        ),
        "refine_start_at_sigma": (
            "FLOAT",
            {
                "default": DEFAULT_REFINE_START_AT_SIGMA,
                "min": 0.0,
                "max": 20.0,
                "step": 0.01,
                "tooltip": "开始低噪加步的 sigma 阈值。",
            },
        ),
        "refine_end_at_sigma": (
            "FLOAT",
            {
                "default": DEFAULT_REFINE_END_AT_SIGMA,
                "min": 0.0,
                "max": 5.0,
                "step": 0.01,
                "tooltip": "低噪加步结束的 sigma。",
            },
        ),
        "refine_spacing": (
            list(SIGMA_SPACINGS),
            {
                "default": DEFAULT_SIGMA_SPACING,
                "tooltip": "低噪加步插值曲线。cosine 在趋近 0 时更密。",
            },
        ),
        "refine_seed_mode": (
            list(SEED_MODES),
            {
                "default": "inherit",
                "tooltip": "inherit = 用导演台 seed；offset = 每轮 seed+1、+2…。",
            },
        ),
        "refine_aspect_ratio": (
            list(ASPECT_RATIO_CHOICES),
            {
                "default": FOLLOW_DIRECTOR_ASPECT,
                "tooltip": "放大目标画布比例。默认跟随导演台输出。",
            },
        ),
        "refine_megapixels": (
            "FLOAT",
            {
                "default": DEFAULT_UPSCALE_MEGAPIXELS,
                "min": 0.0,
                "max": 16.0,
                "step": 0.1,
                "tooltip": "放大百万像素。跟随导演台或比例预设时生效。",
            },
        ),
        "refine_width": (
            "INT",
            {
                "default": 1280,
                "min": 0,
                "max": 8192,
                "step": 32,
                "tooltip": "自定义宽度（×32）。仅「自定义」时生效。",
            },
        ),
        "refine_height": (
            "INT",
            {
                "default": 720,
                "min": 0,
                "max": 8192,
                "step": 32,
                "tooltip": "自定义高度（×32）。仅「自定义」时生效。",
            },
        ),
        "refine_skip_fl2v": (
            "BOOLEAN",
            {
                "default": True,
                "tooltip": "跳过首尾帧（fl2v）镜头的二采/放大。",
            },
        ),
        "refine_tile": (
            "BOOLEAN",
            {
                "default": True,
                "tooltip": "高清二采空间分块。关闭=整幅采样。",
            },
        ),
        "refine_n_tiles": (
            "INT",
            {
                "default": DEFAULT_N_TILES,
                "min": 1,
                "max": 8,
                "step": 1,
                "tooltip": "分块数。仅分块开启时有效。",
            },
        ),
        "refine_tile_axis": (
            list(TILE_AXES),
            {
                "default": "auto",
                "tooltip": "分块轴。auto = 取 latent 较长边。",
            },
        ),
        "refine_tile_overlap": (
            "INT",
            {
                "default": DEFAULT_TILE_OVERLAP,
                "min": 0,
                "max": 32,
                "step": 1,
                "tooltip": "相邻块 latent 重叠宽度。1 ≈ 原图像素 16。",
            },
        ),
        "refine_max_size_for_no_tile": (
            "INT",
            {
                "default": DEFAULT_MAX_SIZE_FOR_NO_TILE,
                "min": 8,
                "max": 256,
                "step": 1,
                "tooltip": "目标轴 latent 边长 ≤ 此值时自动整幅。默认 64 ≈ 480p 不分块。",
            },
        ),
        "refine_seams": (
            "BOOLEAN",
            {
                "default": True,
                "tooltip": "分块接缝精修备用开关。",
            },
        ),
        "refine_seam_steps": (
            "INT",
            {
                "default": DEFAULT_SEAM_REFINE_STEPS,
                "min": 1,
                "max": 25,
                "step": 1,
                "tooltip": "接缝精修使用 SIGMAS 末尾这么多步。",
            },
        ),
    }


class MiniMaxH3DirectorRefine:
    """Pack refine/upscale settings. Connect ``refine`` to Director.refine.

    ``refine``: same-resolution second sample.
    ``upscale``: enlarge to target canvas then second-sample.
    ``latent_upscale``: H3 latent enlarge only, no second sample.
    Second sample uses SIGMAS from BasicScheduler / ManualSigmas.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (
                    list(REFINE_MODES),
                    {
                        "default": "refine",
                        "tooltip": (
                            "refine = 同分辨率二采（精修）。"
                            "upscale = 先放大到目标画布再二采。"
                            "latent_upscale = 只放大 H3 latent，不再二采。"
                        ),
                    },
                ),
                "upscale_method": (
                    list(UPSCALE_METHODS),
                    {
                        "default": "h3_latent",
                        "tooltip": (
                            "仅 mode=upscale。"
                            "h3_latent = 先按目标画布放大 H3 视频 latent，再二采"
                            "（下方选 3D 权重）。"
                             "放大后会按图一独立二采重建 I2V/FL2V keyframe；"
                             "高清二采默认按空间分块以降低 DiT 显存。"
                            "lanczos = 像素插值；可另接 upscale_model（RealESRGAN 等）。"
                            "nvidia_rtx_vsr = NVIDIA RTX Video Super Resolution"
                            "（需 nvidia-vfx + NVIDIA GPU）。"
                        ),
                    },
                ),
                "latent_upscale_model": (
                    list_h3_latent_upscale_models(),
                    {
                        "tooltip": (
                            "H3 3D latent 放大权重。"
                            "放到 ComfyUI/models/latent_upscale_models/，"
                            "文件名含 3d（如 minimax_h3_latent_upscaler_3d_*.safetensors）。"
                            "mode=latent_upscale，或 upscale + h3_latent 时使用。"
                        ),
                    },
                ),
                "sampler": (
                    comfy.samplers.KSampler.SAMPLERS,
                    {
                        "default": DEFAULT_REFINE_SIGMA_SAMPLER,
                        "tooltip": (
                            "二采采样器。海螺案例用 euler；"
                            "BasicScheduler 高质量二采常用 res_multistep。"
                        ),
                    },
                ),
                "passes": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": MAX_REFINE_PASSES,
                        "tooltip": (
                            "精修次数。1 = 一次二采。"
                            "upscale 时只有第 1 次放大，之后都是同分辨率精修。"
                            "latent_upscale 不二采，此值无效。"
                        ),
                    },
                ),
            },
            "optional": {
                "refine_model": (
                    "MODEL",
                    {
                        "tooltip": (
                            "Second-pass UNET (二采模型)。"
                            "不接则用导演台主模型。"
                            "适合一采挂 Turbo LoRA、二采卸掉或换另一套。"
                        ),
                    },
                ),
                "sigmas": (
                    "SIGMAS",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "二采噪声表。接 Comfy 自带 BasicScheduler 或 ManualSigmas。"
                            "mode=refine / upscale 时必须接线。"
                            "BasicScheduler 请接和二采相同的 MODEL（导演台主模型或 refine_model）。"
                            "H3 的 SigmaShift 仍由 Refine 内部套上。"
                        ),
                    },
                ),
                "upscale_model": (
                    "UPSCALE_MODEL",
                    {
                        "tooltip": (
                            "可选。用「加载放大模型」接入，例如 RealESRGAN_x2plus。"
                            "仅 mode=upscale 且 upscale_method=lanczos 时使用。"
                            "不接则纯 lanczos 插值。选 nvidia_rtx_vsr / h3_latent 时忽略此口。"
                        ),
                    },
                ),
                "seed_mode": (
                    list(SEED_MODES),
                    {
                        "default": "inherit",
                        "tooltip": "inherit = 用导演台 seed；offset = 每轮 seed+1、+2…。",
                    },
                ),
                "aspect_ratio": (
                    list(ASPECT_RATIO_CHOICES),
                    {
                        "default": FOLLOW_DIRECTOR_ASPECT,
                        "tooltip": (
                            "放大目标画布，算法同导演台「输出分辨率」。"
                            "默认「跟随导演台」：比例与导演台输出一致，尺寸用下方百万像素。"
                            "比例预设：忽略导演台比例，按所选比例 + 百万像素。"
                            "自定义：直接填宽高（对齐 ×32）。"
                        ),
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": DEFAULT_UPSCALE_MEGAPIXELS,
                        "min": 0.0,
                        "max": 16.0,
                        "step": 0.1,
                        "tooltip": (
                            "百万像素，同导演台 ResolutionSelector。"
                            "1.0 MP 在 16:9 约为 1376×768（对齐 32）。"
                            "跟随导演台或比例预设时生效。"
                        ),
                    },
                ),
                "width": (
                    "INT",
                    {
                        "default": 1280,
                        "min": 0,
                        "max": 8192,
                        "step": 32,
                        "tooltip": "自定义宽度（×32）。仅「自定义」时生效。",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 720,
                        "min": 0,
                        "max": 8192,
                        "step": 32,
                        "tooltip": "自定义高度（×32）。仅「自定义」时生效。",
                    },
                ),
                "skip_fl2v": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "跳过首尾帧（fl2v）镜头的二采/放大。"
                            "二采会改画面，容易把钉死的首尾帧画飘；默认跳过以保护关键帧。"
                            "关掉则 fl2v 也走精修 / latent 放大。"
                        ),
                    },
                ),
                "n_tiles": (
                    "INT",
                    {
                        "default": DEFAULT_N_TILES,
                        "min": 1,
                        "max": 8,
                        "step": 1,
                        "tooltip": (
                            "高清二采空间分块数。1 = 整幅采样（旧行为）。"
                            "默认 2：画布较大时切开采样再融合，降低 DiT 显存。"
                            "音频完整透传；匹配画布的 I2V/FL2V 关键帧按块裁切。"
                        ),
                    },
                ),
                "tile_axis": (
                    list(TILE_AXES),
                    {
                        "default": "auto",
                        "tooltip": "分块轴。auto = 取 latent 较长边（H 或 W）。",
                    },
                ),
                "tile_overlap": (
                    "INT",
                    {
                        "default": DEFAULT_TILE_OVERLAP,
                        "min": 0,
                        "max": 32,
                        "step": 1,
                        "tooltip": (
                            "相邻块在 latent 域的重叠宽度。"
                            "1 ≈ 原图像素 16。建议 4~8；过大几乎等于整幅，省不了显存。"
                        ),
                    },
                ),
                "max_size_for_no_tile": (
                    "INT",
                    {
                        "default": DEFAULT_MAX_SIZE_FOR_NO_TILE,
                        "min": 8,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "目标轴 latent 边长 ≤ 此值时自动整幅采样。"
                            "默认 64：约 480p 不分块，720p 及以上才切。"
                        ),
                    },
                ),
                "refine_seams": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "逐步同步融合失败时的备用接缝精修。"
                            "当前分块对所有采样器逐步同步并把 RoPE 对齐到整幅画布，此开关不会再跑第二轮。"
                        ),
                    },
                ),
                "refine_steps": (
                    "INT",
                    {
                        "default": DEFAULT_SEAM_REFINE_STEPS,
                        "min": 1,
                        "max": 25,
                        "step": 1,
                        "tooltip": "接缝精修使用 SIGMAS 末尾这么多步。仅 refine_seams 开启时有效。",
                    },
                ),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **_kwargs):
        # Skip combo/min checks so old workflows (target_width=0 → aspect_ratio) can load.
        return True

    RETURN_TYPES = (MMX_DIR_REFINE, "INT", "INT")
    RETURN_NAMES = ("refine", "width", "height")
    FUNCTION = "pack"
    CATEGORY = _CATEGORY
    DESCRIPTION = (
        "MiniMax H3 Director Refine: connect to Director.refine. "
        "Director.images is the refined / upscaled result; "
        "Director.images_pre_refine is the first-pass video (before second sample). "
        "Second sample uses SIGMAS from BasicScheduler / ManualSigmas. "
        "Upscale / latent_upscale canvas uses the same aspect + megapixels / custom W×H as Director. "
        "Director first-pass stays at its own resolution; Refine target is the enlarge size. "
        "width / height are the resolved target canvas (×32). "
        "Does not sample by itself — no IMAGE output. "
        "Per-group 一采/二采 is on the Director timeline cards. "
        "HD second sample can spatially tile (n_tiles); audio is not split."
    )

    def pack(
        self,
        mode="refine",
        upscale_method="h3_latent",
        sampler="",
        passes=1,
        seed_mode="inherit",
        aspect_ratio=FOLLOW_DIRECTOR_ASPECT,
        megapixels=DEFAULT_UPSCALE_MEGAPIXELS,
        width=1280,
        height=720,
        skip_fl2v=True,
        n_tiles=DEFAULT_N_TILES,
        tile_axis="auto",
        tile_overlap=DEFAULT_TILE_OVERLAP,
        max_size_for_no_tile=DEFAULT_MAX_SIZE_FOR_NO_TILE,
        refine_seams=True,
        refine_steps=DEFAULT_SEAM_REFINE_STEPS,
        latent_upscale_model=None,
        upscale_model=None,
        h3_latent_model="",
        sigmas=None,
        refine_model=None,
        model=None,
        target_width=0,
        target_height=0,
        **kwargs,
    ):
        del kwargs
        try:
            mp = float(megapixels)
        except (TypeError, ValueError):
            mp = DEFAULT_UPSCALE_MEGAPIXELS
        if mp < 0.1:
            mp = DEFAULT_UPSCALE_MEGAPIXELS
        try:
            w = int(width or 0)
        except (TypeError, ValueError):
            w = 1280
        try:
            h = int(height or 0)
        except (TypeError, ValueError):
            h = 720
        if w < 32:
            w = 1280
        if h < 32:
            h = 720
        try:
            n_passes = int(passes or 1)
        except (TypeError, ValueError):
            n_passes = 1
        if n_passes < 1:
            n_passes = 1
        pack = pack_refine(
            mode=mode,
            passes=n_passes,
            seed_mode=seed_mode,
            aspect_ratio=aspect_ratio,
            megapixels=mp,
            width=w,
            height=h,
            target_width=target_width,
            target_height=target_height,
            skip_fl2v=skip_fl2v,
            n_tiles=n_tiles,
            tile_axis=tile_axis,
            tile_overlap=tile_overlap,
            max_size_for_no_tile=max_size_for_no_tile,
            refine_seams=refine_seams,
            refine_steps=refine_steps,
            upscale_method=upscale_method,
            sample_model=refine_model if refine_model is not None else model,
            latent_upscale_model=latent_upscale_model if latent_upscale_model is not None else h3_latent_model,
            upscale_model=upscale_model,
            sampler=sampler,
            sigmas=sigmas,
        )
        out_w = int(pack.get("target_width") or 0)
        out_h = int(pack.get("target_height") or 0)
        if out_w <= 0 or out_h <= 0:
            out_w, out_h = infer_upscale_target(0, 0)
        return (pack, int(out_w), int(out_h))
