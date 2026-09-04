/** MiniMax H3 Director Refine — show canvas widgets like Director output bar. */

import { app } from "../../scripts/app.js";
import {
    CUSTOM_ASPECT_RATIO,
    RESOLUTION_ASPECTS,
    resolutionFromSelector,
    snapResolutionDim,
} from "./minimax_gen_timeline.js";
import { t } from "./minimax_i18n.js";
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
        w.draw = function () {};
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

function isTruthyFlag(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value == null) return false;
    const text = String(value).trim().toLowerCase();
    return text === "true" || text === "yes" || text === "on";
}

function boolWidgetValue(node, name) {
    return isTruthyFlag(widgetValue(widgetByName(node, name)));
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

const DIRECTOR_SAMPLE_COMFY_WIDGETS = [
    "bd_grp_sample",
    "seed",
    "control_after_generate",
    "control after generate",
    "bd_grp_advanced",
    "steps",
    "sampler",
    "scheduler",
    "shift_video",
    "shift_audio",
    "live_tae_vae",
    "bd_grp_perf",
    "clear_vram_between_segments",
];

const DIRECTOR_REFINE_COMFY_WIDGETS = [
    "bd_grp_refine",
    "refine_enable",
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
    "refine_model",
    "upscale_model",
    "refine_sigmas",
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

function hideDirectorRefineComfyWidgets(node) {
    if (!node) return;
    for (const name of DIRECTOR_SAMPLE_COMFY_WIDGETS) {
        setWidgetVisible(node, name, false);
    }
    for (const name of DIRECTOR_REFINE_COMFY_WIDGETS) {
        setWidgetVisible(node, name, false);
    }
    const seed = widgetByName(node, "seed");
    for (const linked of seed?.linkedWidgets || []) {
        if (linked?.name) setWidgetVisible(node, linked.name, false);
        else {
            linked.hidden = true;
            if (!linked.options) linked.options = {};
            linked.options.hidden = true;
            linked.computeSize = () => [0, -4];
        }
    }
}

function controlAfterWidget(node) {
    return widgetByName(node, "control_after_generate")
        || widgetByName(node, "control after generate");
}

export function closePassPanels(editor, except) {
    if (except !== "sample") {
        editor._mmxSamplePanelOpen = false;
        editor.samplePanelEl?.classList.add("hidden");
        editor.sampleCfgBtn?.classList.remove("active");
    }
    if (except !== "refine") {
        editor._mmxRefinePanelOpen = false;
        editor.refinePanelEl?.classList.add("hidden");
    }
    if (except !== "preview") {
        editor._mmxPreviewPanelOpen = false;
        editor.previewPanelEl?.classList.add("hidden");
    }
}

export function mountDirectorSamplePanel(editor) {
    const node = editor?.node;
    const bar = editor?.outputBarEl;
    if (!node || !bar || editor._mmxSamplePanelMounted) return;
    editor._mmxSamplePanelMounted = true;
    hideDirectorRefineComfyWidgets(node);

    const wrap = document.createElement("span");
    wrap.className = "bd-out-refine-wrap";
    wrap.innerHTML = `<button type="button" class="bd-btn" data-r="sample-cfg" data-i18n="widget.sampleConfig">${t("widget.sampleConfig")}</button>`;
    const tools = bar.querySelector(".bd-live-preview-tools");
    if (tools) bar.insertBefore(wrap, tools);
    else bar.appendChild(wrap);

    const samplerVals = comboValues(node, "sampler", ["res_multistep"]);
    const schedulerVals = comboValues(node, "scheduler", ["simple"]);
    const ctrlW = controlAfterWidget(node);
    const ctrlVals = comboValues(node, ctrlW?.name || "control_after_generate", ["fixed", "increment", "decrement", "randomize"]);

    const panel = document.createElement("div");
    panel.className = "bd-refine-panel hidden";
    panel.setAttribute("data-r", "sample-panel");
    panel.innerHTML = [
        refinePanelFieldHtml("seed", "widget.seed", "种子",
            `<input type="number" data-w="seed" min="0" max="18446744073709551615" step="1">`),
        refinePanelFieldHtml("ctrl", "widget.controlAfterGenerate", "生成前后定制",
            `<select data-w="${ctrlW?.name || "control_after_generate"}">${optionHtml(ctrlVals, widgetValue(ctrlW))}</select>`),
        refinePanelFieldHtml("steps", "widget.steps", "步数",
            `<input type="number" data-w="steps" min="1" max="200" step="1">`),
        refinePanelFieldHtml("sampler", "widget.sampler", "采样器",
            `<select data-w="sampler">${optionHtml(samplerVals, widgetValue(widgetByName(node, "sampler")))}</select>`),
        refinePanelFieldHtml("scheduler", "widget.scheduler", "调度器",
            `<select data-w="scheduler">${optionHtml(schedulerVals, widgetValue(widgetByName(node, "scheduler")))}</select>`),
        refinePanelFieldHtml("shiftv", "widget.shiftVideo", "shift video",
            `<input type="number" data-w="shift_video" min="0.01" max="100" step="0.01">`),
        refinePanelFieldHtml("shifta", "widget.shiftAudio", "shift audio",
            `<input type="number" data-w="shift_audio" min="0.01" max="100" step="0.01">`),
    ].join("");
    bar.after(panel);
    editor.sampleBarEl = wrap;
    editor.samplePanelEl = panel;
    editor.sampleCfgBtn = wrap.querySelector('[data-r="sample-cfg"]');

    editor.sampleCfgBtn.addEventListener("click", () => {
        const next = !editor._mmxSamplePanelOpen;
        closePassPanels(editor, next ? "sample" : "");
        editor._mmxSamplePanelOpen = next;
        panel.classList.toggle("hidden", !next);
        editor.sampleCfgBtn.classList.toggle("active", next);
        if (next) syncSamplePanelFromWidgets(editor);
        editor.updateDomWidgetHeight?.();
    });
    panel.addEventListener("change", (e) => {
        const el = e.target?.closest?.("[data-w]");
        if (!el) return;
        const name = el.getAttribute("data-w");
        const value = el.type === "number" ? Number(el.value) : el.value;
        writeRefineWidget(node, name, value);
        if (name === "seed" || name === "steps" || name === "sampler" || name === "scheduler") {
            node._mmxSampleSnap = node._mmxSampleSnap || {};
            node._mmxSampleSnap[name] = value;
        }
    });
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    syncSamplePanelFromWidgets(editor);
}

function syncSamplePanelFromWidgets(editor) {
    const node = editor?.node;
    const panel = editor?.samplePanelEl;
    if (!node || !panel) return;
    hideDirectorRefineComfyWidgets(node);
    for (const el of panel.querySelectorAll("[data-w]")) {
        const name = el.getAttribute("data-w");
        const raw = widgetValue(widgetByName(node, name));
        if (raw != null && raw !== "") el.value = raw;
    }
}

function comboValues(node, name, fallback) {
    const w = widgetByName(node, name);
    const raw = w?.options?.values;
    if (!Array.isArray(raw) || !raw.length) return fallback;
    return raw.map((item) => {
        if (item && typeof item === "object") return String(item.content ?? item.value ?? "");
        return String(item);
    }).filter(Boolean);
}

function optionHtml(values, current) {
    const cur = String(current ?? "");
    return values.map((value) => {
        const safe = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        const sel = String(value) === cur ? " selected" : "";
        return `<option value="${safe}"${sel}>${safe}</option>`;
    }).join("");
}

function writeRefineWidget(node, name, value) {
    const w = widgetByName(node, name);
    if (!w) return;
    w.value = value;
}

function syncDirectorBuiltinRefineWidgets(node) {
    if (!node || !DIRECTOR_CLASSES.has(node.comfyClass || node.type || "")) return;
    hideDirectorRefineComfyWidgets(node);
    const editor = node._minimaxEditor;
    if (editor) syncRefinePanelFromWidgets(editor);
}

function hookDirectorBuiltinRefine(node) {
    hideDirectorRefineComfyWidgets(node);
}

function refinePanelFieldHtml(id, labelKey, fallback, inner) {
    return `<label class="bd-refine-field" data-show="${id}">`
        + `<span data-i18n="${labelKey}">${fallback}</span>${inner}</label>`;
}

export function mountDirectorRefinePanel(editor) {
    const node = editor?.node;
    const bar = editor?.outputBarEl;
    if (!node || !bar || editor._mmxRefinePanelMounted) return;
    editor._mmxRefinePanelMounted = true;
    hideDirectorRefineComfyWidgets(node);

    const wrap = document.createElement("span");
    wrap.className = "bd-out-refine-wrap";
    wrap.innerHTML = `
        <button type="button" class="bd-btn" data-r="refine-cfg" data-i18n="widget.refineConfig">${t("widget.refineConfig")}</button>
        <span class="bd-refine-mp-inline hidden" data-r="refine-mp-inline">
            <span data-i18n="widget.refineUpscaleMegapixels">${t("widget.refineUpscaleMegapixels")}</span>
            <input type="number" data-r="refine-mp-inline-input" min="0" max="16" step="0.1">
        </span>
    `;
    const tools = bar.querySelector(".bd-live-preview-tools");
    if (tools) bar.insertBefore(wrap, tools);
    else bar.appendChild(wrap);

    const modeVals = comboValues(node, "refine_mode", ["refine", "upscale", "latent_upscale"]);
    const samplerVals = comboValues(node, "refine_sampler", ["euler"]);
    const schedulerVals = comboValues(node, "refine_scheduler", ["simple"]);
    const methodVals = comboValues(node, "refine_upscale_method", ["h3_latent", "lanczos", "nvidia_rtx_vsr"]);
    const latentVals = comboValues(node, "refine_latent_upscale_model", []);
    const seedVals = comboValues(node, "refine_seed_mode", ["inherit", "offset"]);
    const spacingVals = comboValues(node, "refine_spacing", ["cosine", "linear", "exponential"]);
    const axisVals = comboValues(node, "refine_tile_axis", ["auto", "H", "W"]);
    const aspectVals = [
        FOLLOW_DIRECTOR_ASPECT,
        ...RESOLUTION_ASPECTS.map(([label]) => label),
        CUSTOM_ASPECT_RATIO,
    ];

    const panel = document.createElement("div");
    panel.className = "bd-refine-panel hidden";
    panel.setAttribute("data-r", "refine-panel");
    panel.innerHTML = [
        `<label class="bd-refine-field row">`
            + `<input type="checkbox" data-r="refine-enable">`
            + `<span data-i18n="widget.refineEnable">${t("widget.refineEnable")}</span></label>`,
        refinePanelFieldHtml("mode", "widget.refineMode", "模式",
            `<select data-w="refine_mode">${optionHtml(modeVals, widgetValue(widgetByName(node, "refine_mode")))}</select>`),
        refinePanelFieldHtml("method", "widget.refineUpscaleMethod", "放大方式",
            `<select data-w="refine_upscale_method">${optionHtml(methodVals, widgetValue(widgetByName(node, "refine_upscale_method")))}</select>`),
        refinePanelFieldHtml("h3model", "widget.refineLatentModel", "H3 latent 放大",
            `<select data-w="refine_latent_upscale_model">${optionHtml(latentVals, widgetValue(widgetByName(node, "refine_latent_upscale_model")))}</select>`),
        refinePanelFieldHtml("sampler", "widget.refineSampler", "二采采样器",
            `<select data-w="refine_sampler">${optionHtml(samplerVals, widgetValue(widgetByName(node, "refine_sampler")))}</select>`),
        refinePanelFieldHtml("passes", "widget.refinePasses", "精修次数",
            `<input type="number" data-w="refine_passes" min="1" max="9999" step="1">`),
        refinePanelFieldHtml("steps", "widget.refineSampleSteps", "二采步数",
            `<input type="number" data-w="refine_sample_steps" min="1" max="200" step="1">`),
        refinePanelFieldHtml("scheduler", "widget.refineScheduler", "二采调度器",
            `<select data-w="refine_scheduler">${optionHtml(schedulerVals, widgetValue(widgetByName(node, "refine_scheduler")))}</select>`),
        refinePanelFieldHtml("denoise", "widget.refineDenoise", "二采 denoise",
            `<input type="number" data-w="refine_denoise" min="0" max="1" step="0.01">`),
        refinePanelFieldHtml("extra", "widget.refineExtraSteps", "低噪加步",
            `<input type="number" data-w="refine_extra_steps" min="0" max="15" step="1">`),
        refinePanelFieldHtml("extra-start", "widget.refineStartAtSigma", "加步起始 sigma",
            `<input type="number" data-w="refine_start_at_sigma" min="0" max="20" step="0.01">`),
        refinePanelFieldHtml("extra-end", "widget.refineEndAtSigma", "加步结束 sigma",
            `<input type="number" data-w="refine_end_at_sigma" min="0" max="5" step="0.01">`),
        refinePanelFieldHtml("extra-curve", "widget.refineSpacing", "加步曲线",
            `<select data-w="refine_spacing">${optionHtml(spacingVals, widgetValue(widgetByName(node, "refine_spacing")))}</select>`),
        refinePanelFieldHtml("seed", "widget.refineSeedMode", "种子模式",
            `<select data-w="refine_seed_mode">${optionHtml(seedVals, widgetValue(widgetByName(node, "refine_seed_mode")))}</select>`),
        refinePanelFieldHtml("aspect", "widget.refineAspectRatio", "比例",
            `<select data-w="refine_aspect_ratio">${optionHtml(aspectVals, widgetValue(widgetByName(node, "refine_aspect_ratio")) || FOLLOW_DIRECTOR_ASPECT)}</select>`),
        refinePanelFieldHtml("mp", "widget.refineMegapixels", "百万像素",
            `<input type="number" data-w="refine_megapixels" min="0" max="16" step="0.1">`),
        refinePanelFieldHtml("width", "widget.refineWidth", "宽",
            `<input type="number" data-w="refine_width" min="0" max="8192" step="32">`),
        refinePanelFieldHtml("height", "widget.refineHeight", "高",
            `<input type="number" data-w="refine_height" min="0" max="8192" step="32">`),
        `<label class="bd-refine-field row" data-show="skip"><input type="checkbox" data-w="refine_skip_fl2v"><span data-i18n="widget.refineSkipFl2v">跳过 fl2v</span></label>`,
        `<label class="bd-refine-field row" data-show="tile"><input type="checkbox" data-w="refine_tile"><span data-i18n="widget.refineTile">分块</span></label>`,
        refinePanelFieldHtml("tiles", "widget.refineNTiles", "分块数",
            `<input type="number" data-w="refine_n_tiles" min="1" max="8" step="1">`),
        refinePanelFieldHtml("axis", "widget.refineTileAxis", "分块轴",
            `<select data-w="refine_tile_axis">${optionHtml(axisVals, widgetValue(widgetByName(node, "refine_tile_axis")))}</select>`),
        refinePanelFieldHtml("overlap", "widget.refineTileOverlap", "重叠",
            `<input type="number" data-w="refine_tile_overlap" min="0" max="32" step="1">`),
        refinePanelFieldHtml("notile", "widget.refineMaxSizeNoTile", "不分块上限",
            `<input type="number" data-w="refine_max_size_for_no_tile" min="8" max="256" step="1">`),
        `<label class="bd-refine-field row" data-show="seams"><input type="checkbox" data-w="refine_seams"><span data-i18n="widget.refineSeams">接缝精修</span></label>`,
        refinePanelFieldHtml("seam-steps", "widget.refineSeamSteps", "接缝步数",
            `<input type="number" data-w="refine_seam_steps" min="1" max="25" step="1">`),
    ].join("");
    bar.after(panel);
    editor.refineBarEl = wrap;
    editor.refinePanelEl = panel;

    const enableCb = panel.querySelector('[data-r="refine-enable"]');
    const cfgBtn = wrap.querySelector('[data-r="refine-cfg"]');
    editor.refineEnableEl = enableCb;
    editor.refineCfgBtn = cfgBtn;
    editor.refineMpInline = wrap.querySelector('[data-r="refine-mp-inline"]');
    editor.refineMpInlineInput = wrap.querySelector('[data-r="refine-mp-inline-input"]');

    enableCb.addEventListener("change", () => {
        writeRefineWidget(node, "refine_enable", !!enableCb.checked);
        applyDirectorRefinePassDefaults(editor, directorRefineActive(node));
        rememberDirectorRefineActive(node);
        updateRefinePanelVisibility(editor);
        editor.updateOutputPreview?.();
        editor.updateDomWidgetHeight?.();
    });
    cfgBtn.addEventListener("click", () => {
        const next = !editor._mmxRefinePanelOpen;
        closePassPanels(editor, next ? "refine" : "");
        editor._mmxRefinePanelOpen = next;
        updateRefinePanelVisibility(editor);
        editor.updateDomWidgetHeight?.();
    });
    panel.addEventListener("change", (e) => {
        const el = e.target?.closest?.("[data-w]");
        if (!el) return;
        const name = el.getAttribute("data-w");
        const value = el.type === "checkbox" ? !!el.checked : (el.type === "number" ? Number(el.value) : el.value);
        writeRefineWidget(node, name, value);
        updateRefinePanelVisibility(editor);
        editor.updateOutputPreview?.();
        editor.updateDomWidgetHeight?.();
    });
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    editor.refineMpInlineInput?.addEventListener("change", () => {
        const value = Number(editor.refineMpInlineInput.value);
        writeRefineWidget(node, "refine_megapixels", value);
        const panelInput = panel.querySelector('[data-w="refine_megapixels"]');
        if (panelInput) panelInput.value = editor.refineMpInlineInput.value;
        editor.updateOutputPreview?.();
    });
    editor.refineMpInlineInput?.addEventListener("keydown", (e) => e.stopPropagation());

    syncRefinePanelFromWidgets(editor);
    updateRefinePanelVisibility(editor);
}

function syncRefinePanelFromWidgets(editor) {
    const node = editor?.node;
    const panel = editor?.refinePanelEl;
    if (!node || !panel) return;
    hideDirectorRefineComfyWidgets(node);
    if (editor.refineEnableEl) {
        editor.refineEnableEl.checked = boolWidgetValue(node, "refine_enable");
        editor.refineEnableEl.disabled = directorHasRefineLink(node);
    }
    if (editor.refineBarEl) {
        editor.refineBarEl.classList.toggle("linked", directorHasRefineLink(node));
    }
    for (const el of panel.querySelectorAll("[data-w]")) {
        const name = el.getAttribute("data-w");
        const raw = widgetValue(widgetByName(node, name));
        if (el.type === "checkbox") el.checked = isTruthyFlag(raw);
        else if (raw != null && raw !== "") el.value = raw;
    }
    updateRefinePanelVisibility(editor);
}

function syncRefineMpInline(editor) {
    const node = editor?.node;
    const wrap = editor?.refineMpInline;
    const input = editor?.refineMpInlineInput;
    if (!node || !wrap || !input) return;
    const mode = String(widgetValue(widgetByName(node, "refine_mode")) ?? "refine").toLowerCase();
    const enabled = directorHasRefineLink(node) || boolWidgetValue(node, "refine_enable");
    const upscale = mode.includes("upscale") && !mode.includes("latent");
    wrap.classList.toggle("hidden", !(enabled && upscale));
    const mp = widgetValue(widgetByName(node, "refine_megapixels"));
    if (mp != null && mp !== "" && document.activeElement !== input) input.value = mp;
}

function updateRefinePanelVisibility(editor) {
    const node = editor?.node;
    const panel = editor?.refinePanelEl;
    if (!panel || !node) return;
    const linked = directorHasRefineLink(node);
    const enabled = linked || boolWidgetValue(node, "refine_enable");
    const open = !!editor._mmxRefinePanelOpen && !linked;
    panel.classList.toggle("hidden", !open);
    editor.refineCfgBtn?.classList.toggle("active", enabled);
    if (editor.refineCfgBtn) editor.refineCfgBtn.disabled = linked;
    syncRefineMpInline(editor);
    const mode = String(widgetValue(widgetByName(node, "refine_mode")) ?? "refine").toLowerCase();
    const upscale = mode.includes("upscale") && !mode.includes("latent");
    const latentOnly = mode.includes("latent");
    const needsCanvas = upscale || latentOnly;
    const method = String(widgetValue(widgetByName(node, "refine_upscale_method")) ?? "").toLowerCase();
    const tileOn = !latentOnly && boolWidgetValue(node, "refine_tile");
    const extraOn = Number(widgetValue(widgetByName(node, "refine_extra_steps")) || 0) > 0;
    const aspect = widgetValue(widgetByName(node, "refine_aspect_ratio"));
    const custom = isCustomAspect(aspect);
    const show = {
        mode: true,
        method: upscale,
        h3model: latentOnly || (upscale && method === "h3_latent"),
        sampler: !latentOnly,
        passes: !latentOnly,
        steps: !latentOnly,
        scheduler: !latentOnly,
        denoise: !latentOnly,
        extra: !latentOnly,
        "extra-start": !latentOnly && extraOn,
        "extra-end": !latentOnly && extraOn,
        "extra-curve": !latentOnly && extraOn,
        seed: !latentOnly,
        aspect: needsCanvas,
        mp: needsCanvas && !custom,
        width: needsCanvas && custom,
        height: needsCanvas && custom,
        skip: true,
        tile: !latentOnly,
        tiles: tileOn,
        axis: tileOn,
        overlap: tileOn,
        notile: tileOn,
        seams: tileOn,
        "seam-steps": tileOn && boolWidgetValue(node, "refine_seams"),
    };
    for (const field of panel.querySelectorAll("[data-show]")) {
        const key = field.getAttribute("data-show");
        field.classList.toggle("hidden", show[key] === false);
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
                hideDirectorRefineComfyWidgets(this);
                rememberDirectorRefineActive(this);
                queueMicrotask(() => hideDirectorRefineComfyWidgets(this));
                return r;
            };
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (...args) {
                const r = onConfigure?.apply(this, args);
                hideDirectorRefineComfyWidgets(this);
                rememberDirectorRefineActive(this);
                queueMicrotask(() => {
                    hideDirectorRefineComfyWidgets(this);
                    syncDirectorBuiltinRefineWidgets(this);
                });
                return r;
            };
            const onWidgetChanged = nodeType.prototype.onWidgetChanged;
            nodeType.prototype.onWidgetChanged = function (...args) {
                const result = onWidgetChanged?.apply(this, args);
                scheduleDirectorPassCacheRefresh(this);
                refreshAllRefineNodes();
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
            hideDirectorRefineComfyWidgets(node);
            rememberDirectorRefineActive(node);
        }
    },
    loadedGraphNode(node) {
        scheduleRefineRefresh(node);
        if (DIRECTOR_CLASSES.has(node?.comfyClass || node?.type || "")) {
            hideDirectorRefineComfyWidgets(node);
            rememberDirectorRefineActive(node);
        }
    },
    afterConfigureGraph() {
        refreshAllRefineNodes();
        setTimeout(refreshAllRefineNodes, 100);
        const graph = app.graph ?? app.canvas?.graph;
        for (const node of graph?._nodes ?? graph?.nodes ?? []) {
            if (DIRECTOR_CLASSES.has(node?.comfyClass || node?.type || "")) {
                hideDirectorRefineComfyWidgets(node);
                syncDirectorBuiltinRefineWidgets(node);
                rememberDirectorRefineActive(node);
            }
        }
    },
});
