/** MiniMax H3 Director Refine — show canvas widgets like Director output bar. */

import { app } from "../../scripts/app.js";
import {
    CUSTOM_ASPECT_RATIO,
    resolutionFromSelector,
    snapResolutionDim,
} from "./minimax_gen_timeline.js";
import {
    applyDirectorRefinePassDefaults,
    directorRefineActive,
    scheduleDirectorPassCacheRefresh,
} from "./minimax_image_batch.js";

const REFINE_CLASS = "MiniMaxH3DirectorRefine";
const DIRECTOR_CLASSES = new Set(["MiniMaxH3Director", "ComfyMiniMaxH3Director"]);
const FOLLOW_DIRECTOR_ASPECT = "跟随导演台";

function isRefineNode(node) {
    const cls = node?.comfyClass || node?.type || "";
    return cls === REFINE_CLASS;
}

function widgetByName(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

function widgetValue(w) {
    if (!w) return undefined;
    const v = w.value;
    if (v && typeof v === "object") {
        if (typeof v.content === "string") return v.content;
        if (typeof v.value === "string") return v.value;
    }
    return v;
}

function setWidgetVisible(node, name, visible) {
    const w = widgetByName(node, name);
    if (!w) return;
    w.hidden = !visible;
    if (!w.options) w.options = {};
    w.options.hidden = !visible;
    if (visible) {
        if (w._mmxOrigComputeSize) {
            w.computeSize = w._mmxOrigComputeSize;
            delete w._mmxOrigComputeSize;
        } else if (w.computeSize) {
            delete w.computeSize;
        }
        if (w.element) w.element.style.display = "";
    } else {
        if (!w._mmxOrigComputeSize && typeof w.computeSize === "function") {
            w._mmxOrigComputeSize = w.computeSize.bind(w);
        }
        w.computeSize = () => [0, -4];
        if (w.element) w.element.style.display = "none";
    }
}

function isCustomAspect(value) {
    const v = String(value ?? "").trim();
    return v === CUSTOM_ASPECT_RATIO || v === "Custom" || v.startsWith("自定义");
}

const ASPECT_CHOICES = new Set([
    FOLLOW_DIRECTOR_ASPECT,
    "Follow Director",
    CUSTOM_ASPECT_RATIO,
    "Custom",
    "1:1 (方形)",
    "2:3 (竖版照片)",
    "3:2 (横版照片)",
    "3:4 (竖版标准)",
    "4:3 (标准)",
    "9:16 (竖屏)",
    "16:9 (宽屏)",
    "21:9 (超宽)",
]);

const UPSCALE_METHOD_VALUES = new Set(["lanczos", "nvidia_rtx_vsr", "h3_latent"]);
const SEED_MODE_VALUES = new Set(["inherit", "offset"]);
const SAMPLER_HINTS = new Set([
    "euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral",
    "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde",
    "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
    "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v",
    "deis", "res_multistep", "res_multistep_ancestral", "gradient_estimation",
    "er_sde", "seeds_2", "seeds_3", "sa_solver", "sa_solver_pece",
    "uni_pc", "uni_pc_bh2", "ddim",
]);

function looksLikeUpscaleMethod(value) {
    return UPSCALE_METHOD_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function looksLikeSampler(value) {
    return SAMPLER_HINTS.has(String(value ?? "").trim().toLowerCase());
}

function clampPasses(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(9999, n);
}

function migrateRefineWidgetOrder(node) {
    const samplerW = widgetByName(node, "sampler");
    const passesW = widgetByName(node, "passes");
    const methodW = widgetByName(node, "upscale_method");
    if (samplerW && !looksLikeSampler(widgetValue(samplerW))) {
        samplerW.value = "euler";
    }
    if (passesW) {
        passesW.value = clampPasses(widgetValue(passesW));
    }
    const tilesW = widgetByName(node, "n_tiles");
    if (tilesW) {
        const n = Math.round(Number(widgetValue(tilesW)));
        tilesW.value = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 2;
    }
    if (methodW && !looksLikeUpscaleMethod(widgetValue(methodW))) {
        methodW.value = "h3_latent";
    }
}

function migrateLegacyPrePassesValues(node) {
    const seedW = widgetByName(node, "seed_mode");
    const aspectW = widgetByName(node, "aspect_ratio");
    const mpW = widgetByName(node, "megapixels");
    const widthW = widgetByName(node, "width");
    const heightW = widgetByName(node, "height");
    const skipW = widgetByName(node, "skip_fl2v");
    const rawSeed = widgetValue(seedW);
    if (!seedW || SEED_MODE_VALUES.has(String(rawSeed ?? "").trim().toLowerCase())) return;

    // Workflows saved before `passes` was inserted load every following value
    // one slot early: seed_mode gets the aspect ratio, aspect gets MP, etc.
    if (ASPECT_CHOICES.has(rawSeed)) {
        const rawAspect = widgetValue(aspectW);
        const rawMp = widgetValue(mpW);
        const rawWidth = widgetValue(widthW);
        const rawHeight = widgetValue(heightW);
        seedW.value = "inherit";
        if (aspectW) aspectW.value = rawSeed;
        const mp = Number(rawAspect);
        if (mpW && Number.isFinite(mp) && mp >= 0.1 && mp <= 16) mpW.value = mp;
        const width = Number(rawMp);
        if (widthW && Number.isFinite(width) && width >= 32 && width <= 8192) widthW.value = width;
        const height = Number(rawWidth);
        if (heightW && Number.isFinite(height) && height >= 32 && height <= 8192) heightW.value = height;
        if (skipW && (rawHeight === true || rawHeight === false)) skipW.value = rawHeight;
        node._mmxRecoveredLegacyRefineValues = true;
        return;
    }
    seedW.value = "inherit";
}

function migrateRefineWidgets(node) {
    migrateLegacyPrePassesValues(node);
    migrateRefineWidgetOrder(node);
    const seedW = widgetByName(node, "seed_mode");
    const aspectW = widgetByName(node, "aspect_ratio");
    const mpW = widgetByName(node, "megapixels");
    const widthW = widgetByName(node, "width");
    const heightW = widgetByName(node, "height");
    if (seedW && !SEED_MODE_VALUES.has(String(widgetValue(seedW) ?? "").trim().toLowerCase())) {
        seedW.value = "inherit";
    }
    if (aspectW && !ASPECT_CHOICES.has(widgetValue(aspectW))) {
        aspectW.value = FOLLOW_DIRECTOR_ASPECT;
    }
    if (mpW) {
        const n = Number(widgetValue(mpW));
        if (!Number.isFinite(n) || n < 0.1 || n > 16) mpW.value = 1.0;
    }
    if (widthW) {
        const n = Number(widgetValue(widthW));
        if (!Number.isFinite(n) || n < 32 || n > 8192) widthW.value = 1280;
    }
    if (heightW) {
        const n = Number(widgetValue(heightW));
        if (!Number.isFinite(n) || n < 32 || n > 8192) heightW.value = 720;
    }
    setWidgetVisible(node, "schedule", false);
    setWidgetVisible(node, "denoise", false);
    setWidgetVisible(node, "steps", false);
    setWidgetVisible(node, "sigmas_text", false);
    setWidgetVisible(node, "sigmas", false);
    setWidgetVisible(node, "h3_latent_model", false);
    setWidgetVisible(node, "upscale_model", false);
    setWidgetVisible(node, "confirm_first_pass", false);
    setWidgetVisible(node, "first_pass_cache_status", false);
}

function isFollowAspect(value) {
    const v = String(value ?? "").trim();
    if (v === "0" || v === "0.0") return true;
    return !v || v === FOLLOW_DIRECTOR_ASPECT || v === "Follow Director";
}

function setAspectProgrammatic(node, value) {
    const aspectW = widgetByName(node, "aspect_ratio");
    if (!aspectW || widgetValue(aspectW) === value) return;
    node._mmxAspectProgrammatic = true;
    try {
        aspectW.value = value;
        aspectW.callback?.(value);
    } finally {
        node._mmxAspectProgrammatic = false;
    }
}

function syncFollowDirectorAspect(node) {
    if (!isRefineNode(node) || node._mmxAspectUserSet) return;
    const aspectW = widgetByName(node, "aspect_ratio");
    if (!aspectW || isCustomAspect(widgetValue(aspectW))) return;
    setAspectProgrammatic(node, FOLLOW_DIRECTOR_ASPECT);
}

function readMode(node) {
    const named = widgetByName(node, "mode");
    const raw = String(widgetValue(named) ?? "").toLowerCase();
    if (raw.includes("latent_upscale") || raw.includes("latent")) return "latent_upscale";
    if (raw.includes("upscale")) return "upscale";
    if (raw.includes("refine")) return "refine";
    for (const w of node.widgets || []) {
        const s = String(widgetValue(w) ?? "").toLowerCase();
        if (s === "latent_upscale") return "latent_upscale";
        if (s === "upscale") return "upscale";
        if (s === "refine") return "refine";
    }
    return null;
}

function syncRefineComputedSize(node) {
    const aspectW = widgetByName(node, "aspect_ratio");
    const mpW = widgetByName(node, "megapixels");
    const widthW = widgetByName(node, "width");
    const heightW = widgetByName(node, "height");
    if (!aspectW || isFollowAspect(widgetValue(aspectW)) || isCustomAspect(widgetValue(aspectW))) return;
    const resolved = resolutionFromSelector(widgetValue(aspectW), widgetValue(mpW) ?? 1.0);
    if (!resolved) return;
    if (widthW) widthW.value = resolved.width;
    if (heightW) heightW.value = resolved.height;
}

function readUpscaleMethod(node) {
    return String(widgetValue(widgetByName(node, "upscale_method")) ?? "").trim().toLowerCase();
}

function boolWidgetValue(node, name) {
    const value = widgetValue(widgetByName(node, name));
    return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function syncRefineWidgetVisibility(node) {
    const mode = readMode(node);
    const upscale = mode === "upscale";
    const latentOnly = mode === "latent_upscale";
    const needsCanvas = upscale || latentOnly;
    const aspect = widgetValue(widgetByName(node, "aspect_ratio"));
    const follow = isFollowAspect(aspect);
    const custom = isCustomAspect(aspect);
    setWidgetVisible(node, "aspect_ratio", needsCanvas);
    setWidgetVisible(node, "megapixels", needsCanvas && !custom);
    setWidgetVisible(node, "width", needsCanvas && custom);
    setWidgetVisible(node, "height", needsCanvas && custom);
    const method = readUpscaleMethod(node);
    const showH3Model = latentOnly || (upscale && method === "h3_latent");
    setWidgetVisible(node, "upscale_method", upscale);
    setWidgetVisible(node, "latent_upscale_model", showH3Model);
    setWidgetVisible(node, "h3_latent_model", false);
    setWidgetVisible(node, "upscale_model", false);
    setWidgetVisible(node, "schedule", false);
    setWidgetVisible(node, "denoise", false);
    setWidgetVisible(node, "steps", false);
    setWidgetVisible(node, "sigmas_text", false);
    setWidgetVisible(node, "sigmas", false);
    setWidgetVisible(node, "sampler", !latentOnly);
    setWidgetVisible(node, "passes", !latentOnly);
    setWidgetVisible(node, "seed_mode", !latentOnly);
    const nTiles = Math.max(1, Math.round(Number(widgetValue(widgetByName(node, "n_tiles"))) || 2));
    const tiled = !latentOnly && nTiles > 1;
    const seamOn = tiled && boolWidgetValue(node, "refine_seams");
    setWidgetVisible(node, "n_tiles", !latentOnly);
    setWidgetVisible(node, "tile_axis", tiled);
    setWidgetVisible(node, "tile_overlap", tiled);
    setWidgetVisible(node, "max_size_for_no_tile", tiled);
    setWidgetVisible(node, "refine_seams", tiled);
    setWidgetVisible(node, "refine_steps", seamOn);
    setWidgetVisible(node, "target_width", false);
    setWidgetVisible(node, "target_height", false);
    setWidgetVisible(node, "confirm_first_pass", false);
    setWidgetVisible(node, "first_pass_cache_status", false);
    if (needsCanvas && !follow && !custom) syncRefineComputedSize(node);
    try {
        const size = node.computeSize?.();
        if (Array.isArray(size) && size.length >= 2) {
            node.setSize?.([node.size?.[0] || size[0], size[1]]);
        }
    } catch {
        /* ignore */
    }
    node.setDirtyCanvas?.(true, true);
}

function hookWidget(node, name, fn) {
    if (!node._mmxRefineHooked) node._mmxRefineHooked = new Set();
    if (node._mmxRefineHooked.has(name)) return;
    const w = widgetByName(node, name);
    if (!w) return;
    node._mmxRefineHooked.add(name);
    const prev = w.callback;
    w.callback = function (...args) {
        const r = prev?.apply(this, args);
        fn();
        return r;
    };
}

function installRefineResolutionUI(node) {
    const onAspect = () => {
        const aspectW = widgetByName(node, "aspect_ratio");
        const widthW = widgetByName(node, "width");
        const heightW = widgetByName(node, "height");
        if (aspectW && isCustomAspect(widgetValue(aspectW)) && widthW && heightW) {
            widthW.value = snapResolutionDim(widgetValue(widthW) || 1280);
            heightW.value = snapResolutionDim(widgetValue(heightW) || 720);
        }
        syncRefineWidgetVisibility(node);
    };
    hookWidget(node, "mode", () => syncRefineWidgetVisibility(node));
    hookWidget(node, "upscale_method", () => syncRefineWidgetVisibility(node));
    hookWidget(node, "n_tiles", () => syncRefineWidgetVisibility(node));
    hookWidget(node, "refine_seams", () => syncRefineWidgetVisibility(node));
    hookWidget(node, "aspect_ratio", () => {
        if (!node._mmxAspectProgrammatic) node._mmxAspectUserSet = true;
        onAspect();
    });
    hookWidget(node, "megapixels", () => syncRefineComputedSize(node));
    hookWidget(node, "width", () => {
        const w = widgetByName(node, "width");
        if (w) w.value = snapResolutionDim(widgetValue(w));
    });
    hookWidget(node, "height", () => {
        const w = widgetByName(node, "height");
        if (w) w.value = snapResolutionDim(widgetValue(w));
    });
    if (!node._mmxRefineOnWidgetChanged) {
        node._mmxRefineOnWidgetChanged = true;
        const prev = node.onWidgetChanged;
        node.onWidgetChanged = function (name, ...rest) {
            const r = prev?.apply(this, [name, ...rest]);
            if (
                name === "mode"
                || name === "upscale_method"
                || name === "aspect_ratio"
                || name === "megapixels"
                || name === "n_tiles"
                || name === "refine_seams"
            ) {
                migrateRefineWidgets(this);
                syncRefineWidgetVisibility(this);
            }
            return r;
        };
    }
}

const DIRECTOR_REFINE_DETAIL_WIDGETS = [
    "refine_mode",
    "refine_upscale_method",
    "refine_latent_upscale_model",
    "refine_sampler",
    "refine_passes",
    "refine_sample_steps",
    "refine_scheduler",
    "refine_denoise",
    "refine_extra_steps",
    "refine_start_at_sigma",
    "refine_end_at_sigma",
    "refine_spacing",
    "refine_seed_mode",
    "refine_aspect_ratio",
    "refine_megapixels",
    "refine_width",
    "refine_height",
    "refine_skip_fl2v",
    "refine_tile",
    "refine_n_tiles",
    "refine_tile_axis",
    "refine_tile_overlap",
    "refine_max_size_for_no_tile",
    "refine_seams",
    "refine_seam_steps",
];

function directorHasNamedLink(node, name) {
    const inp = (node?.inputs || []).find((item) => String(item?.name) === name);
    if (!inp) return false;
    if (inp.link != null) return true;
    return Array.isArray(inp.links) && inp.links.length > 0;
}

function directorHasRefineLink(node) {
    return directorHasNamedLink(node, "refine");
}

function readDirectorRefineMode(node) {
    const raw = String(widgetValue(widgetByName(node, "refine_mode")) ?? "").toLowerCase();
    if (raw.includes("latent_upscale") || raw.includes("latent")) return "latent_upscale";
    if (raw.includes("upscale")) return "upscale";
    if (raw.includes("refine")) return "refine";
    return "refine";
}

function syncDirectorBuiltinRefineWidgets(node) {
    if (!node || !DIRECTOR_CLASSES.has(node.comfyClass || node.type || "")) return;
    setWidgetVisible(node, "refine_model", false);
    setWidgetVisible(node, "upscale_model", false);
    setWidgetVisible(node, "refine_sigmas", false);
    const linked = directorHasRefineLink(node);
    const enabled = boolWidgetValue(node, "refine_enable");
    setWidgetVisible(node, "refine_enable", !linked);
    const show = enabled && !linked;
    for (const name of DIRECTOR_REFINE_DETAIL_WIDGETS) {
        setWidgetVisible(node, name, false);
    }
    if (!show) {
        try {
            const size = node.computeSize?.();
            if (Array.isArray(size) && size.length >= 2) {
                node.setSize?.([node.size?.[0] || size[0], size[1]]);
            }
        } catch {
            /* ignore */
        }
        node.setDirtyCanvas?.(true, true);
        return;
    }
    const mode = readDirectorRefineMode(node);
    const upscale = mode === "upscale";
    const latentOnly = mode === "latent_upscale";
    const needsCanvas = upscale || latentOnly;
    const aspect = widgetValue(widgetByName(node, "refine_aspect_ratio"));
    const follow = isFollowAspect(aspect);
    const custom = isCustomAspect(aspect);
    const method = String(widgetValue(widgetByName(node, "refine_upscale_method")) ?? "").trim().toLowerCase();
    const showH3Model = latentOnly || (upscale && method === "h3_latent");
    const sigmasWired = directorHasNamedLink(node, "refine_sigmas");
    const tileOn = !latentOnly && boolWidgetValue(node, "refine_tile");
    const seamOn = tileOn && boolWidgetValue(node, "refine_seams");
    setWidgetVisible(node, "refine_mode", true);
    setWidgetVisible(node, "refine_upscale_method", upscale);
    setWidgetVisible(node, "refine_latent_upscale_model", showH3Model);
    setWidgetVisible(node, "refine_sampler", !latentOnly);
    setWidgetVisible(node, "refine_passes", !latentOnly);
    setWidgetVisible(node, "refine_sample_steps", !latentOnly && !sigmasWired);
    setWidgetVisible(node, "refine_scheduler", !latentOnly && !sigmasWired);
    setWidgetVisible(node, "refine_denoise", !latentOnly && !sigmasWired);
    const extraOn = Number(widgetValue(widgetByName(node, "refine_extra_steps")) || 0) > 0;
    setWidgetVisible(node, "refine_extra_steps", !latentOnly && !sigmasWired);
    setWidgetVisible(node, "refine_start_at_sigma", !latentOnly && !sigmasWired && extraOn);
    setWidgetVisible(node, "refine_end_at_sigma", !latentOnly && !sigmasWired && extraOn);
    setWidgetVisible(node, "refine_spacing", !latentOnly && !sigmasWired && extraOn);
    setWidgetVisible(node, "refine_seed_mode", !latentOnly);
    setWidgetVisible(node, "refine_aspect_ratio", needsCanvas);
    setWidgetVisible(node, "refine_megapixels", needsCanvas && !custom);
    setWidgetVisible(node, "refine_width", needsCanvas && custom);
    setWidgetVisible(node, "refine_height", needsCanvas && custom);
    setWidgetVisible(node, "refine_skip_fl2v", true);
    setWidgetVisible(node, "refine_tile", !latentOnly);
    setWidgetVisible(node, "refine_n_tiles", tileOn);
    setWidgetVisible(node, "refine_tile_axis", tileOn);
    setWidgetVisible(node, "refine_tile_overlap", tileOn);
    setWidgetVisible(node, "refine_max_size_for_no_tile", tileOn);
    setWidgetVisible(node, "refine_seams", tileOn);
    setWidgetVisible(node, "refine_seam_steps", seamOn);
    if (needsCanvas && !follow && !custom) {
        const mpW = widgetByName(node, "refine_megapixels");
        const widthW = widgetByName(node, "refine_width");
        const heightW = widgetByName(node, "refine_height");
        const resolved = resolutionFromSelector(aspect, widgetValue(mpW) ?? 1.0);
        if (resolved) {
            if (widthW) widthW.value = resolved.width;
            if (heightW) heightW.value = resolved.height;
        }
    }
    try {
        const size = node.computeSize?.();
        if (Array.isArray(size) && size.length >= 2) {
            node.setSize?.([node.size?.[0] || size[0], size[1]]);
        }
    } catch {
        /* ignore */
    }
    node.setDirtyCanvas?.(true, true);
}

function hookDirectorBuiltinRefine(node) {
    if (!node || node._mmxDirectorRefineHooked) return;
    node._mmxDirectorRefineHooked = true;
    const names = ["refine_enable", "refine_mode", "refine_upscale_method", "refine_aspect_ratio", "refine_n_tiles", "refine_tile", "refine_seams", "refine_extra_steps", "refine_megapixels"];
    for (const name of names) {
        hookWidget(node, name, () => {
            syncDirectorBuiltinRefineWidgets(node);
            if (name === "refine_enable") {
                applyDirectorRefinePassDefaults(node._minimaxEditor, directorRefineActive(node));
                rememberDirectorRefineActive(node);
            }
        });
    }
}

function rememberDirectorRefineActive(node) {
    if (!node) return;
    node._mmxRefineActive = directorRefineActive(node);
}

function maybeApplyDirectorPassDefaults(node) {
    const now = directorRefineActive(node);
    if (node._mmxRefineActive === now) return;
    const prev = node._mmxRefineActive;
    node._mmxRefineActive = now;
    if (prev === undefined) return;
    applyDirectorRefinePassDefaults(node._minimaxEditor, now);
}

function refreshRefineNode(node) {
    if (!isRefineNode(node)) return;
    installRefineResolutionUI(node);
    migrateRefineWidgets(node);
    syncFollowDirectorAspect(node);
    syncRefineWidgetVisibility(node);
}

function refreshAllRefineNodes() {
    const graph = app.graph ?? app.canvas?.graph;
    for (const node of graph?._nodes ?? graph?.nodes ?? []) {
        refreshRefineNode(node);
    }
}

function scheduleRefineRefresh(node) {
    refreshRefineNode(node);
    queueMicrotask(() => refreshRefineNode(node));
    setTimeout(() => refreshRefineNode(node), 0);
    setTimeout(() => refreshRefineNode(node), 80);
    setTimeout(() => refreshRefineNode(node), 250);
}

app.registerExtension({
    name: "ComfyUI.MiniMaxH3DirectorRefine",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (DIRECTOR_CLASSES.has(nodeData?.name)) {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (...args) {
                const r = onNodeCreated?.apply(this, args);
                hookDirectorBuiltinRefine(this);
                syncDirectorBuiltinRefineWidgets(this);
                rememberDirectorRefineActive(this);
                queueMicrotask(() => {
                    syncDirectorBuiltinRefineWidgets(this);
                    rememberDirectorRefineActive(this);
                });
                return r;
            };
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (...args) {
                const r = onConfigure?.apply(this, args);
                hookDirectorBuiltinRefine(this);
                syncDirectorBuiltinRefineWidgets(this);
                rememberDirectorRefineActive(this);
                return r;
            };
            const onWidgetChanged = nodeType.prototype.onWidgetChanged;
            nodeType.prototype.onWidgetChanged = function (...args) {
                const result = onWidgetChanged?.apply(this, args);
                const name = String(args[0] || "");
                scheduleDirectorPassCacheRefresh(this);
                refreshAllRefineNodes();
                syncDirectorBuiltinRefineWidgets(this);
                if (name === "refine_enable") {
                    applyDirectorRefinePassDefaults(this._minimaxEditor, directorRefineActive(this));
                    rememberDirectorRefineActive(this);
                }
                return result;
            };
            const onConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (...args) {
                const result = onConnectionsChange?.apply(this, args);
                scheduleDirectorPassCacheRefresh(this);
                refreshAllRefineNodes();
                syncDirectorBuiltinRefineWidgets(this);
                maybeApplyDirectorPassDefaults(this);
                return result;
            };
            return;
        }
        if (nodeData?.name !== REFINE_CLASS) return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const r = onNodeCreated?.apply(this, args);
            scheduleRefineRefresh(this);
            return r;
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const r = onConfigure?.apply(this, args);
            scheduleRefineRefresh(this);
            return r;
        };
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (...args) {
            const r = onConnectionsChange?.apply(this, args);
            syncRefineWidgetVisibility(this);
            const director = this.graph?._nodes?.find?.((n) => {
                const inp = n?.inputs?.find((item) => item?.name === "refine");
                if (inp?.link == null) return false;
                const link = this.graph?.links?.[inp.link] ?? this.graph?._links?.[inp.link];
                return String(link?.origin_id) === String(this.id);
            });
            if (director) scheduleDirectorPassCacheRefresh(director);
            return r;
        };
    },
    nodeCreated(node) {
        scheduleRefineRefresh(node);
        if (DIRECTOR_CLASSES.has(node?.comfyClass || node?.type || "")) {
            hookDirectorBuiltinRefine(node);
            syncDirectorBuiltinRefineWidgets(node);
            rememberDirectorRefineActive(node);
        }
    },
    loadedGraphNode(node) {
        scheduleRefineRefresh(node);
        if (DIRECTOR_CLASSES.has(node?.comfyClass || node?.type || "")) {
            hookDirectorBuiltinRefine(node);
            syncDirectorBuiltinRefineWidgets(node);
            rememberDirectorRefineActive(node);
        }
    },
    afterConfigureGraph() {
        refreshAllRefineNodes();
        setTimeout(refreshAllRefineNodes, 100);
        const graph = app.graph ?? app.canvas?.graph;
        for (const node of graph?._nodes ?? graph?.nodes ?? []) {
            if (DIRECTOR_CLASSES.has(node?.comfyClass || node?.type || "")) {
                hookDirectorBuiltinRefine(node);
                syncDirectorBuiltinRefineWidgets(node);
                rememberDirectorRefineActive(node);
            }
        }
    },
});
