import { api } from "../../scripts/api.js";
import { t } from "./minimax_i18n.js";
import { setImageBatchPreview } from "./minimax_image_batch.js";

export const FL2V_STYLES = `
.bd-fl2v-slots{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bd-fl2v-slot-wrap{position:relative;min-width:0}
.bd-fl2v-slot{position:relative;aspect-ratio:var(--fl2v-slot-ar,16/9);border:1px dashed #555;border-radius:4px;background:#111;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer}
.bd-fl2v-slot.has-img{border-style:solid;border-color:#444;cursor:grab}
.bd-fl2v-slot.has-img:active{cursor:grabbing}
.bd-fl2v-slot.drag-over{border-color:#4fff8f;border-style:solid;background:#152018}
.bd-fl2v-slot.dragging{opacity:.45}
.bd-fl2v-slot img{height:100%;width:auto;max-height:100%;display:block;pointer-events:none;flex-shrink:0}
.bd-fl2v-slot .tag{position:absolute;top:4px;padding:1px 5px;border-radius:2px;font-size:9px;font-weight:700;line-height:1.4;pointer-events:none;z-index:2}
.bd-fl2v-slot .tag.start{left:4px;background:rgba(79,255,143,.92);color:#111}
.bd-fl2v-slot .tag.end{right:4px;background:rgba(240,160,48,.92);color:#111}
.bd-fl2v-slot .ph{color:#666;font-size:10px;text-align:center;padding:4px;line-height:1.35;pointer-events:none}
.bd-fl2v-slot-wrap .x{position:absolute;right:1px;top:1px;width:24px;height:24px;padding:0;margin:0;border:0;box-sizing:border-box;display:none;align-items:center;justify-content:center;border-radius:4px;background:rgba(0,0,0,.78);color:#ff8a8a;font-size:18px;font-weight:700;line-height:1;cursor:pointer;z-index:6}
.bd-fl2v-slot-wrap:has([data-slot="end"]) .x{left:1px;right:auto}
.bd-fl2v-slot-wrap.has-img:hover .x,.bd-fl2v-slot-wrap:focus-within .x{display:flex}
@media (hover:none){.bd-fl2v-slot-wrap.has-img .x{display:flex}}
.bd-fl2v-slot-wrap .x:hover{background:rgba(160,30,30,.95);color:#fff}
`;

export const DEFAULT_FL2V_NEGATIVE = "bad video";

export function fl2vViewUrl(imageFile) {
    if (!imageFile) return "";
    const normalized = String(imageFile).replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const filename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const subfolder = slash >= 0 ? normalized.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

export function stripFl2vPromptBody(text) {
    let result = String(text || "").trim();
    const wraps = [
        "完全保持首尾帧。",
        "完全保持首帧。",
        "完全保持尾帧。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1的画面。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的构图，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的画面，不修改。",
        "视频开始完全按照image0的构图，不修改。",
        "视频结束完全保持image1的画面。",
        "视频结束完全保持image1。",
        "完全保持首尾帧：开头必须是image0，结尾必须是image1。",
        "完全保持首帧：开头必须是image0。",
        "完全保持尾帧：结尾锁定尾帧。",
        "完全保持首尾帧：开头锁定首帧，结尾锁定尾帧。",
        "再次强调：开头锁定image0，结尾锁定image1。",
        "再次强调：开头锁定image0。",
        "再次强调：结尾锁定尾帧。",
        "中间过程：",
    ];
    let changed = true;
    while (changed && result) {
        changed = false;
        for (const wrap of wraps) {
            if (result.startsWith(wrap)) {
                result = result.slice(wrap.length).trim();
                changed = true;
            }
            if (result.endsWith(wrap)) {
                result = result.slice(0, -wrap.length).trim();
                changed = true;
            }
        }
    }
    return result
        .replace(/image0的构图/g, "image0的画面")
        .replace(/image1的构图/g, "image1的画面")
        .trim();
}

export function setFl2vShotPreview(editor, index, imageB64, extra = {}) {
    // FL2V uses the same segment/card preview state and renderer as every
    // other video batch mode. Its start/end-frame editor remains FL2V-specific.
    setImageBatchPreview(editor, index, imageB64, extra);
}

export function drawFl2vSegmentThumbnails(editor, ctx, segment, startX, width, y, height) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, y + 1, width, height - 2);
    ctx.clip();
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(startX, y + 1, width, height - 2);

    const startFile = segment.startImage?.imageFile || segment.genImage?.imageFile || segment.imageFile || "";
    const endFile = segment.endImage?.imageFile || "";
    if (!startFile && !endFile) {
        ctx.fillStyle = "#666";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t("canvas.fl2vT2v"), startX + width / 2, y + height / 2);
        ctx.restore();
        return;
    }

    const ensureThumb = (file) => {
        const key = `fl2v:${file}`;
        const cached = editor._thumbCache.get(key);
        if (cached?.naturalWidth) return cached;
        if (!editor._thumbPending.has(key)) {
            editor._thumbPending.add(key);
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                editor._thumbCache.set(key, image);
                editor._thumbPending.delete(key);
                editor.scheduleRender();
            };
            image.onerror = () => editor._thumbPending.delete(key);
            image.src = fl2vViewUrl(file);
        }
        return null;
    };
    const drawImageTiles = (image, x, tileWidth) => {
        if (!image?.naturalWidth || tileWidth <= 0.5) return;
        const drawHeight = Math.max(1, height - 2);
        const fullTileWidth = drawHeight * image.naturalWidth / Math.max(1, image.naturalHeight);
        for (let offset = 0; offset < tileWidth - 0.5; offset += fullTileWidth) {
            const remaining = Math.min(fullTileWidth, tileWidth - offset);
            const sourceWidth = Math.max(1, remaining / fullTileWidth * image.naturalWidth);
            ctx.drawImage(image, 0, 0, sourceWidth, image.naturalHeight, x + offset, y + 1, remaining, drawHeight);
        }
    };

    const startImage = startFile ? ensureThumb(startFile) : null;
    const endImage = endFile ? ensureThumb(endFile) : null;
    const split = !!(startFile && endFile && width > 24);
    const startWidth = split ? width / 2 : width;
    if (startFile && startImage) drawImageTiles(startImage, startX, startWidth);
    else if (endFile && endImage) drawImageTiles(endImage, startX, width);
    if (split && endImage) drawImageTiles(endImage, startX + startWidth, width - startWidth);

    ctx.font = "bold 9px sans-serif";
    ctx.textBaseline = "middle";
    if (startFile) {
        ctx.fillStyle = "rgba(79,255,143,0.92)";
        ctx.fillRect(startX + 4, y + 6, 38, 14);
        ctx.fillStyle = "#111";
        ctx.fillText(t("fl2v.tag.start"), startX + 8, y + 13);
    }
    if (endFile) {
        ctx.fillStyle = "rgba(240,160,48,0.92)";
        ctx.fillRect(startX + width - 34, y + 6, 30, 14);
        ctx.fillStyle = "#111";
        ctx.fillText(t("fl2v.tag.end"), startX + width - 29, y + 13);
    }
    ctx.restore();
}
