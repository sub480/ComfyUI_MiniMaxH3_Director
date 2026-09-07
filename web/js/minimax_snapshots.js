/** Server-side Director snapshots, stored as Director-pack zips. */
import { api } from "../../scripts/api.js";
import { t, applyI18nDom, onLocaleChange } from "./minimax_i18n.js";
import { collectPackWidgets } from "./minimax_pack.js";

const MAX_NAME = 80;

async function request(path, body, method = "POST") {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await api.fetchApi(path, options);
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.json();
}

function timestampOf(snapshot) { return snapshot.updatedAt || snapshot.createdAt || 0; }
function sort(items) { return [...items].sort((a, b) => timestampOf(b) - timestampOf(a) || a.name.localeCompare(b.name)); }
function nameOf(value) { return String(value ?? "").trim().slice(0, MAX_NAME); }
function timestampName(prefix = "快照") {
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("")
        + `-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${String(now.getMilliseconds()).padStart(3, "0")}`;
    return nameOf(`${String(prefix).slice(0, 30)}-${stamp}`);
}
function summary(snapshot) {
    const size = Number(snapshot.size || 0);
    const sizeText = size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0, Math.round(size / 1024))} KB`;
    return `${snapshot.name}\n${t("snapshot.created")}: ${new Date(timestampOf(snapshot)).toLocaleString()}\n${t("snapshot.file")}: ${snapshot.filename}\n${t("snapshot.size")}: ${sizeText}`;
}

export function bindSnapshotActions(editor) {
    const modal = document.createElement("div");
    modal.className = "bd-snapshot-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="bd-snapshot-box"><header><strong data-i18n="snapshot.title">快照</strong><button class="bd-icon-btn" data-snap="close" aria-label="×">×</button></header><div class="bd-snapshot-body"><aside><button class="bd-btn bd-btn-primary" data-snap="save" data-i18n="snapshot.save">保存当前配置</button><div class="bd-snapshot-count" data-snap="count"></div><div class="bd-snapshot-list" data-snap="list"></div></aside><section><div class="bd-snapshot-detail" data-snap="detail"></div><div class="bd-snapshot-actions"><button class="bd-btn bd-btn-primary" data-snap="restore" data-i18n="snapshot.restore">还原</button><button class="bd-btn" data-snap="rename" data-i18n="snapshot.rename">重命名</button><button class="bd-btn" data-snap="duplicate" data-i18n="snapshot.duplicate">复制</button><button class="bd-btn bd-btn-danger" data-snap="remove" data-i18n="snapshot.remove">删除</button></div></section></div></div>`;
    document.body.appendChild(modal);
    editor._snapshotModal = modal;
    let items = [];
    let selected = null;
    let busy = false;
    const listEl = modal.querySelector('[data-snap="list"]');
    const detailEl = modal.querySelector('[data-snap="detail"]');
    const buttons = [...modal.querySelectorAll("button[data-snap]")];
    const selectedSnapshot = () => items.find((item) => item.id === selected);
    const alertError = (error) => editor.showBdMessage?.(t("snapshot.errorTitle"), String(error?.message || error));
    const confirmInView = (message) => new Promise((resolve) => {
        const bar = document.createElement("div");
        bar.className = "bd-snapshot-confirm";
        bar.textContent = message;
        const cancel = document.createElement("button");
        cancel.className = "bd-btn"; cancel.textContent = t("dialog.cancel");
        const confirm = document.createElement("button");
        confirm.className = "bd-btn bd-btn-danger"; confirm.textContent = t("dialog.confirm");
        const finish = (value) => { bar.remove(); resolve(value); };
        cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
        bar.append(cancel, confirm);
        modal.querySelector(".bd-snapshot-actions").before(bar);
        confirm.focus();
    });
    const recoverDesktopFocus = (target = null) => {
        // ComfyUI Desktop's WebView can retain the canvas keyboard capture
        // after a native confirm or a graph/layout rebuild.  A real window
        // focus transition normally clears it; reproduce that transition
        // without requiring the user to alt-tab.
        window.focus?.();
        setTimeout(() => {
            window.focus?.();
            target?.focus?.({ preventScroll: true });
        }, 0);
    };
    const setBusy = (value) => { busy = value; buttons.forEach((button) => { if (button.dataset.snap !== "close") button.disabled = value; }); };

    const load = async () => {
        const data = await request("/minimax/director/snapshots", undefined, "GET");
        items = sort(Array.isArray(data.items) ? data.items : []);
        if (!items.some((item) => item.id === selected)) selected = items[0]?.id || null;
        render();
    };
    const render = () => {
        modal.querySelector('[data-snap="count"]').textContent = t("snapshot.count", { n: items.length });
        listEl.textContent = "";
        if (!items.length) listEl.textContent = t("snapshot.empty");
        for (const snapshot of items) {
            const button = document.createElement("div");
            button.dataset.snapshotId = snapshot.id;
            button.className = `bd-snapshot-item${snapshot.id === selected ? " active" : ""}`;
            button.setAttribute("role", "button"); button.tabIndex = 0;
            button.textContent = `${snapshot.name}\n${new Date(timestampOf(snapshot)).toLocaleString()}`;
            button.onclick = () => { selected = snapshot.id; render(); };
            button.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selected = snapshot.id; render(); } };
            listEl.appendChild(button);
        }
        const snapshot = selectedSnapshot();
        detailEl.textContent = snapshot ? summary(snapshot) : t("snapshot.noSelection");
    };
    const operation = async (fn) => {
        if (busy) return;
        setBusy(true);
        try { await fn(); await load(); } catch (error) { console.error("[MiniMax H3 Director] snapshot:", error); await alertError(error); }
        finally { setBusy(false); }
    };
    const beginInlineRename = (snapshot) => {
        if (busy) return;
        const row = [...listEl.querySelectorAll("[data-snapshot-id]")].find((el) => el.dataset.snapshotId === snapshot.id);
        if (!row || row.querySelector("input")) return;
        row.textContent = "";
        const input = document.createElement("input");
        // Do not select the existing value.  ComfyUI/LiteGraph can make an
        // inactive selection look gray after a graph restore.  An empty field
        // with the old name as placeholder avoids that state entirely.
        input.type = "text"; input.value = ""; input.placeholder = snapshot.name; input.maxLength = MAX_NAME;
        input.className = "bd-snapshot-name-input";
        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            if (!save || !nameOf(input.value)) { render(); return; }
            operation(async () => {
                const result = await request("/minimax/director/snapshots/rename", { id: snapshot.id, name: nameOf(input.value) });
                selected = result.id;
            });
        };
        const keepInputFocus = (event) => {
            event.stopPropagation();
            setTimeout(() => { if (!finished && input.isConnected) input.focus(); }, 0);
        };
        input.addEventListener("pointerdown", keepInputFocus, true);
        input.addEventListener("mousedown", keepInputFocus, true);
        input.addEventListener("keydown", (event) => {
            event.stopImmediatePropagation();
            if (event.key === "Enter") { event.preventDefault(); finish(true); }
            if (event.key === "Escape") { event.preventDefault(); finish(false); }
        }, true);
        input.onclick = (event) => event.stopPropagation();
        input.onblur = () => setTimeout(() => {
            if (document.activeElement !== input) finish(true);
        }, 0);
        row.appendChild(input); input.focus();
    };

    modal.querySelector('[data-snap="save"]').onclick = () => operation(async () => {
        const name = timestampName();
        editor.flushTimelineSync?.();
        const result = await request("/minimax/director/snapshots/save", { name, timeline: editor.buildTimelinePayload(), widgets: collectPackWidgets(editor) });
        selected = result.id;
    });
    modal.querySelector('[data-snap="rename"]').onclick = () => {
        const snapshot = selectedSnapshot(); if (!snapshot) return;
        beginInlineRename(snapshot);
    };
    modal.querySelector('[data-snap="duplicate"]').onclick = () => operation(async () => {
        const snapshot = selectedSnapshot(); if (!snapshot) return;
        const name = timestampName(`${snapshot.name}-${t("snapshot.copySuffix")}`);
        const result = await request("/minimax/director/snapshots/duplicate", { id: snapshot.id, name }); selected = result.id;
    });
    modal.querySelector('[data-snap="remove"]').onclick = () => operation(async () => {
        const snapshot = selectedSnapshot(); if (!snapshot || !await confirmInView(t("snapshot.removeConfirm", { name: snapshot.name }))) return;
        await request("/minimax/director/snapshots/delete", { id: snapshot.id }); selected = null;
        recoverDesktopFocus(modal.querySelector('[data-snap="save"]'));
    });
    modal.querySelector('[data-snap="restore"]').onclick = () => operation(async () => {
        const snapshot = selectedSnapshot(); if (!snapshot || !await confirmInView(t("snapshot.restoreConfirm", { name: snapshot.name }))) return;
        const data = await request("/minimax/director/snapshots/restore", { id: snapshot.id });
        if (!data?.timeline) throw new Error(t("snapshot.restoreError"));
        modal.classList.add("hidden");
        editor.applyImportedTimeline(data.timeline, data.widgets || {});
        recoverDesktopFocus(editor.globalPrompt);
    });
    const close = () => modal.classList.add("hidden");
    modal.querySelector('[data-snap="close"]').onclick = close;
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    const keydown = (event) => { if (!modal.classList.contains("hidden") && event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", keydown, true);
    const unsub = onLocaleChange(() => { applyI18nDom(modal); render(); });
    editor._snapshotCleanup = () => { unsub?.(); window.removeEventListener("keydown", keydown, true); modal.remove(); };
    const open = async () => {
        if (busy) return;
        modal.classList.remove("hidden");
        setBusy(true);
        try { await load(); } catch (error) { await alertError(error); }
        finally { setBusy(false); }
        modal.querySelector('[data-snap="save"]').focus();
    };
    applyI18nDom(modal); render();
    return open;
}
