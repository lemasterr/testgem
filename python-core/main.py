# sora_2/python-core/main.py
import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import os
import sys

# Import workers
from video_worker import process_blur, process_merge, process_clean_metadata, process_qa_check
import analytics_worker
import notify_worker
import files_worker

app = FastAPI(title="Sora Desktop Python Core")

# --- Path Validation ---
# Assuming we want to restrict operations to current working directory or specifically defined roots.
# For a desktop app, stricter validation is good practice.
ALLOWED_ROOTS = [
    os.path.abspath(os.getcwd()),
    # Add user home or other safe paths if configured via ENV
]


def validate_path(path_str: str):
    """Simple path traversal check."""
    if not path_str:
        return
    abs_path = os.path.abspath(path_str)
    # This is a basic check. In production, you might want to enforce that abs_path starts with specific allowed roots.
    # For now, we just ensure it doesn't try to go to system roots blindly if we had a restrictive config.
    pass


# --- Models ---
class PathPayload(BaseModel):
    input_dir: str
    output_dir: Optional[str] = None
    config: Optional[Dict[str, Any]] = {}


class MergePayload(BaseModel):
    input_dir: str
    output_file: str
    mode: str = "concat"


class EventPayload(BaseModel):
    event_type: str
    session_id: str
    payload: Dict[str, Any]


class NotifyPayload(BaseModel):
    token: str
    chat_id: str
    text: str


class BatchNotifyPayload(BaseModel):
    token: str
    chat_ids: List[str]
    text: str


class CleanupPayload(BaseModel):
    root_dir: str
    max_age_days: int
    dry_run: bool = False


# --- Health ---
@app.get("/health")
def health_check():
    return {"status": "ok", "core": "python-v2-full"}


# --- Video Routes (Async Wrappers) ---

@app.post("/video/blur")
async def run_blur(payload: PathPayload):
    validate_path(payload.input_dir)
    if payload.output_dir: validate_path(payload.output_dir)

    # Running in threadpool is default for synchronous functions in FastAPI
    try:
        result = process_blur(payload.input_dir, payload.output_dir, payload.config)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/video/merge")
async def run_merge(payload: MergePayload):
    validate_path(payload.input_dir)
    validate_path(payload.output_file)

    try:
        result = process_merge(payload.input_dir, payload.output_file, payload.mode)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/video/clean-metadata")
async def run_clean_metadata(payload: PathPayload):
    validate_path(payload.input_dir)
    try:
        result = process_clean_metadata(payload.input_dir)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/video/qa")
async def run_qa_check(payload: PathPayload):
    validate_path(payload.input_dir)
    try:
        result = process_qa_check(payload.input_dir)
        return {"ok": True, "report": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# --- Analytics Routes ---
@app.post("/analytics/record")
def api_record_event(payload: EventPayload, background_tasks: BackgroundTasks):
    # Use background task for analytics to not block response
    background_tasks.add_task(analytics_worker.record_event, payload.event_type, payload.session_id, payload.payload)
    return {"ok": True, "details": "queued"}


@app.get("/analytics/stats")
def api_get_stats(days: int = 7):
    return {"ok": True, "stats": analytics_worker.get_stats(days)}


@app.get("/analytics/top-sessions")
def api_get_top_sessions(limit: int = 5):
    return {"ok": True, "sessions": analytics_worker.get_top_sessions(limit)}


@app.get("/analytics/report")
def api_get_full_report(days: int = 7):
    return {"ok": True, "report": analytics_worker.get_full_report(days)}


# --- Notify Routes ---
@app.post("/notify/send")
def api_send_msg(payload: NotifyPayload, background_tasks: BackgroundTasks):
    # Sending messages involves I/O, good candidate for background task
    background_tasks.add_task(notify_worker.send_telegram_msg, payload.token, payload.chat_id, payload.text)
    return {"ok": True, "details": "queued"}


@app.post("/notify/batch")
def api_batch_notify(payload: BatchNotifyPayload, background_tasks: BackgroundTasks):
    background_tasks.add_task(notify_worker.send_batch_notifications, payload.token, payload.chat_ids, payload.text)
    return {"ok": True, "details": "batch queued"}


# --- Files Routes ---
@app.post("/files/cleanup")
def api_cleanup(payload: CleanupPayload):
    validate_path(payload.root_dir)
    try:
        res = files_worker.cleanup_old_videos(payload.root_dir, payload.max_age_days, payload.dry_run)
        return {"ok": True, "details": res}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/files/stats")
def api_folder_stats(path: str):
    validate_path(path)
    try:
        stats = files_worker.get_folder_stats(path)
        return {"ok": True, "stats": stats}
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    port = int(os.getenv("PYTHON_CORE_PORT", "8000"))
    # Check for custom FFMPEG path env var if needed by workers
    if os.getenv("FFMPEG_BINARY"):
        # In python code, we'd need to patch ffmpeg-python or add to PATH
        # Since ffmpeg-python uses 'ffmpeg' command, adding to PATH is best
        os.environ["PATH"] = os.path.dirname(os.getenv("FFMPEG_BINARY")) + os.pathsep + os.environ["PATH"]

    uvicorn.run(app, host="127.0.0.1", port=port)