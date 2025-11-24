# Path: python-core/main.py
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import os

# Import workers
from video_worker import process_blur, process_merge, process_clean_metadata, process_qa_check
import analytics_worker
import notify_worker
import files_worker

app = FastAPI(title="Sora Desktop Python Core")

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

class CleanupPayload(BaseModel):
    root_dir: str
    max_age_days: int
    dry_run: bool = False

# --- Health ---
@app.get("/health")
def health_check():
    return {"status": "ok", "core": "python-v2-full"}

# --- Video Routes ---
@app.post("/video/blur")
def run_blur(payload: PathPayload):
    try:
        result = process_blur(payload.input_dir, payload.output_dir, payload.config)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.post("/video/merge")
def run_merge(payload: MergePayload):
    try:
        result = process_merge(payload.input_dir, payload.output_file, payload.mode)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.post("/video/clean-metadata")
def run_clean_metadata(payload: PathPayload):
    try:
        result = process_clean_metadata(payload.input_dir)
        return {"ok": True, "details": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.post("/video/qa")
def run_qa_check(payload: PathPayload):
    try:
        result = process_qa_check(payload.input_dir)
        return {"ok": True, "report": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# --- Analytics Routes ---
@app.post("/analytics/record")
def api_record_event(payload: EventPayload):
    try:
        res = analytics_worker.record_event(payload.event_type, payload.session_id, payload.payload)
        return {"ok": True, "details": res}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/analytics/stats")
def api_get_stats(days: int = 7):
    return {"ok": True, "stats": analytics_worker.get_stats(days)}

@app.get("/analytics/top-sessions")
def api_get_top_sessions(limit: int = 5):
    return {"ok": True, "sessions": analytics_worker.get_top_sessions(limit)}

# --- Notify Routes ---
@app.post("/notify/send")
def api_send_msg(payload: NotifyPayload):
    res = notify_worker.send_telegram_msg(payload.token, payload.chat_id, payload.text)
    return {"ok": True, "details": res}

# --- Files Routes ---
@app.post("/files/cleanup")
def api_cleanup(payload: CleanupPayload):
    try:
        res = files_worker.cleanup_old_videos(payload.root_dir, payload.max_age_days, payload.dry_run)
        return {"ok": True, "details": res}
    except Exception as e:
        return {"ok": False, "error": str(e)}

if __name__ == "__main__":
    port = int(os.getenv("PYTHON_CORE_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)