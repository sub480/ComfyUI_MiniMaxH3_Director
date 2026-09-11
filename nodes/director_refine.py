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
    REFINE_MODES,
    SEED_MODES,
    SIGMA_SPACINGS,
    TILE_AXES,
    UPSCALE_METHODS,
)


def director_refine_widget_inputs() -> dict:
    """Director in-node 二采 widgets. Appended after 性能 so old widget indices stay stable."""
    return {
        "bd_grp_refine": ("BDGROUP", {"default": "二采"}),
        "refine_enable": (
            "BOOLEAN",
            {
                "default": True,
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
                "default": "upscale",
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
                "tooltip": "二采步数。",
            },
        ),
        "refine_scheduler": (
            comfy.samplers.KSampler.SCHEDULERS,
            {
                "default": DEFAULT_REFINE_SCHEDULER,
                "tooltip": "二采调度器。",
            },
        ),
        "refine_denoise": (
            "FLOAT",
            {
                "default": DEFAULT_REFINE_DENOISE,
                "min": 0.0,
                "max": 1.0,
                "step": 0.01,
                "tooltip": "二采 denoise（BasicScheduler）。",
            },
        ),
        "refine_extra_steps": (
            "INT",
            {
                "default": DEFAULT_REFINE_EXTRA_STEPS,
                "min": 0,
                "max": 15,
                "tooltip": "低噪区间额外加步。0 = 关闭。",
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
                "default": False,
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
