"""Persistent server-side Director snapshots.

Snapshots deliberately use the Director pack format.  The only difference from
an exported pack is where the zip is kept and how it is addressed by the UI.
"""

from __future__ import annotations

import ctypes
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any

import folder_paths
from aiohttp import web

from .pack import PACK_FORMAT, _read_json, _send_zip_file, build_export_pack, extract_pack_zip, import_extracted_pack
from .output_layout import SNAPSHOTS_DIR_NAME, h3_output_path

SNAPSHOT_EXT = ".mmxsnapshot.zip"
_SNAPSHOT_NAME_RE = re.compile(r"^[^<>:\"/\\|?*\x00-\x1f]+$")
_SNAPSHOT_ID_RE = re.compile(r"^[^<>:\"/\\|?*\x00-\x1f]+\.mmxsnapshot\.zip$", re.I)
_RESERVED_RE = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
_LOCK = threading.RLock()


def _snapshot_root() -> Path:
    root = h3_output_path(SNAPSHOTS_DIR_NAME)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _snapshot_name(value: Any) -> str:
    name = str(value or "").strip()
    if name.lower().endswith(SNAPSHOT_EXT):
        name = name[: -len(SNAPSHOT_EXT)]
    if not name or len(name) > 80 or not _SNAPSHOT_NAME_RE.fullmatch(name):
        raise ValueError("Invalid snapshot name.")
    if name.endswith((".", " ")) or _RESERVED_RE.fullmatch(name):
        raise ValueError("Invalid snapshot name.")
    return name


def _snapshot_filename(value: Any) -> str:
    filename = str(value or "").strip()
    if not _SNAPSHOT_ID_RE.fullmatch(filename):
        raise ValueError("Invalid snapshot id.")
    return filename


def _path_for(name_or_id: Any) -> Path:
    filename = _snapshot_filename(name_or_id)
    root = _snapshot_root()
    path = root / filename
    if path.parent != root or path.is_symlink():
        raise ValueError("Invalid snapshot path.")
    return path


def _metadata(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "id": path.name,
        "filename": path.name,
        "name": path.name[: -len(SNAPSHOT_EXT)],
        "createdAt": stat.st_ctime * 1000,
        "updatedAt": stat.st_mtime * 1000,
        "size": stat.st_size,
    }


def list_snapshots() -> list[dict[str, Any]]:
    root = _snapshot_root()
    items = []
    for path in root.iterdir():
        if path.is_symlink() or not path.is_file() or not _SNAPSHOT_ID_RE.fullmatch(path.name):
            continue
        try:
            items.append(_metadata(path))
        except OSError:
            continue
    return sorted(items, key=lambda x: (-x["updatedAt"], x["name"].casefold()))


def _same_name_exists(root: Path, filename: str, except_path: Path | None = None) -> bool:
    wanted = filename.casefold()
    for candidate in root.iterdir():
        if except_path is not None and candidate.name.casefold() == except_path.name.casefold():
            continue
        if candidate.name.casefold() == wanted:
            return True
    return False


def _save_zip(path: Path, timeline: dict, widgets: dict) -> None:
    result = build_export_pack(timeline, widgets)
    source = Path(folder_paths.get_temp_directory()) / "minimax_director_pack_export" / str(result["filename"])
    if not source.is_file():
        raise ValueError("Snapshot export produced no zip.")
    path.parent.mkdir(parents=True, exist_ok=True)
    # link() gives us no-overwrite semantics while retaining the pack writer's
    # already-complete temporary file. Fall back to an exclusive copy where
    # hard links are unavailable.
    try:
        os.link(source, path)
        source.unlink(missing_ok=True)
    except FileExistsError:
        raise ValueError("A snapshot with this name already exists.")
    except OSError:
        fd = -1
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
            with source.open("rb") as src, os.fdopen(fd, "wb") as dst:
                fd = -1
                shutil.copyfileobj(src, dst)
            source.unlink(missing_ok=True)
        except FileExistsError:
            raise ValueError("A snapshot with this name already exists.")
        finally:
            if fd >= 0:
                os.close(fd)
                path.unlink(missing_ok=True)


def _move_to_recycle_bin(path: Path) -> None:
    if os.name == "nt":
        class SHFILEOPSTRUCT(ctypes.Structure):
            _fields_ = [("hwnd", ctypes.c_void_p), ("wFunc", ctypes.c_uint),
                        ("pFrom", ctypes.c_wchar_p), ("pTo", ctypes.c_wchar_p),
                        ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", ctypes.c_int),
                        ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", ctypes.c_wchar_p)]
        op = SHFILEOPSTRUCT(None, 3, str(path) + "\0", None, 0x0040 | 0x0010, False, None, None)
        result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        if result or op.fAnyOperationsAborted:
            raise OSError(f"Recycle bin operation failed ({result}).")
        return
    raise OSError("Moving snapshots to the recycle bin is unsupported on this platform.")


async def minimax_list_snapshots(request):
    try:
        return web.json_response({"items": list_snapshots()})
    except Exception as exc:
        return web.Response(status=500, text=str(exc))


async def minimax_save_snapshot(request):
    try:
        body = await request.json()
        name = _snapshot_name(body.get("name"))
        timeline = body.get("timeline")
        widgets = body.get("widgets") if isinstance(body.get("widgets"), dict) else {}
        if not isinstance(timeline, dict):
            raise ValueError("Missing timeline object.")
        with _LOCK:
            path = _snapshot_root() / f"{name}{SNAPSHOT_EXT}"
            if _same_name_exists(path.parent, path.name):
                raise ValueError("A snapshot with this name already exists.")
            _save_zip(path, timeline, widgets)
        return web.json_response(_metadata(path))
    except Exception as exc:
        return web.Response(status=400, text=str(exc))


async def minimax_restore_snapshot(request):
    extracted = None
    try:
        body = await request.json()
        path = _path_for(body.get("id") or body.get("filename"))
        if not path.is_file():
            return web.Response(status=404, text="Snapshot not found.")
        extracted = Path(tempfile.mkdtemp(prefix="mmx_snapshot_ex_"))
        extract_pack_zip(path, extracted)
        return web.json_response(import_extracted_pack(extracted))
    except Exception as exc:
        return web.Response(status=400, text=str(exc))
    finally:
        if extracted:
            shutil.rmtree(extracted, ignore_errors=True)


async def minimax_export_snapshot(request):
    """Download one persisted snapshot without exposing arbitrary output paths."""
    try:
        path = _path_for(request.query.get("id") or request.query.get("filename"))
    except ValueError as exc:
        return web.Response(status=400, text=str(exc))
    if not path.is_file():
        return web.Response(status=404, text="Snapshot not found.")
    return await _send_zip_file(request, path, "MiniMaxH3Snapshot.mmxsnapshot.zip")


async def minimax_import_snapshot(request):
    """Validate and store an exported snapshot zip in the snapshot directory."""
    upload_path: Path | None = None
    extracted: Path | None = None
    try:
        if "multipart" not in (request.content_type or ""):
            return web.Response(status=400, text="Missing snapshot file.")
        post = await request.post()
        upload = post.get("snapshot")
        if upload is None or not hasattr(upload, "file"):
            return web.Response(status=400, text="Missing snapshot file.")
        original_name = str(getattr(upload, "filename", "") or "").strip()
        if not original_name.lower().endswith(".zip"):
            raise ValueError("Snapshot must be a ZIP file.")
        base_name = original_name[:-4]
        if base_name.lower().endswith(".mmxsnapshot"):
            base_name = base_name[:-len(".mmxsnapshot")]
        name = _snapshot_name(base_name)
        upload_fd, upload_name = tempfile.mkstemp(prefix="mmx_snapshot_up_", suffix=SNAPSHOT_EXT)
        os.close(upload_fd)
        upload_path = Path(upload_name)
        with upload_path.open("wb") as out:
            shutil.copyfileobj(upload.file, out)
        extracted = Path(tempfile.mkdtemp(prefix="mmx_snapshot_check_"))
        extract_pack_zip(upload_path, extracted)
        pack_meta_path = extracted / "pack.json"
        pack_meta = _read_json(pack_meta_path) if pack_meta_path.is_file() else {}
        if not isinstance(pack_meta, dict) or pack_meta.get("format") != PACK_FORMAT:
            raise ValueError("Invalid snapshot format.")
        target = _snapshot_root() / f"{name}{SNAPSHOT_EXT}"
        with _LOCK:
            if _same_name_exists(target.parent, target.name):
                raise ValueError("A snapshot with this name already exists.")
            try:
                os.link(upload_path, target)
                upload_path.unlink(missing_ok=True)
                upload_path = None
            except FileExistsError:
                raise ValueError("A snapshot with this name already exists.")
            except OSError:
                with target.open("xb") as out:
                    with upload_path.open("rb") as src:
                        shutil.copyfileobj(src, out)
                upload_path.unlink(missing_ok=True)
                upload_path = None
        return web.json_response(_metadata(target))
    except Exception as exc:
        return web.Response(status=400, text=str(exc))
    finally:
        if extracted:
            shutil.rmtree(extracted, ignore_errors=True)
        if upload_path:
            upload_path.unlink(missing_ok=True)


async def minimax_rename_snapshot(request):
    try:
        body = await request.json()
        old = _path_for(body.get("id") or body.get("filename"))
        name = _snapshot_name(body.get("name"))
        new = _snapshot_root() / f"{name}{SNAPSHOT_EXT}"
        with _LOCK:
            if not old.is_file():
                return web.Response(status=404, text="Snapshot not found.")
            if _same_name_exists(new.parent, new.name, old):
                raise ValueError("A snapshot with this name already exists.")
            os.replace(old, new)
        return web.json_response(_metadata(new))
    except Exception as exc:
        return web.Response(status=400, text=str(exc))


async def minimax_duplicate_snapshot(request):
    try:
        body = await request.json()
        source = _path_for(body.get("id") or body.get("filename"))
        name = _snapshot_name(body.get("name"))
        target = _snapshot_root() / f"{name}{SNAPSHOT_EXT}"
        with _LOCK:
            if not source.is_file():
                return web.Response(status=404, text="Snapshot not found.")
            if _same_name_exists(target.parent, target.name):
                raise ValueError("A snapshot with this name already exists.")
            shutil.copy2(source, target)
        return web.json_response(_metadata(target))
    except Exception as exc:
        return web.Response(status=400, text=str(exc))


async def minimax_delete_snapshot(request):
    try:
        body = await request.json()
        path = _path_for(body.get("id") or body.get("filename"))
        with _LOCK:
            if not path.is_file():
                return web.Response(status=404, text="Snapshot not found.")
            _move_to_recycle_bin(path)
        return web.json_response({"deleted": path.name, "recycled": True})
    except Exception as exc:
        return web.Response(status=400, text=str(exc))
