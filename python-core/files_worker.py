# Path: python-core/files_worker.py
import os
import time
import shutil


def cleanup_old_videos(root_dir: str, max_age_days: int, dry_run: bool = False):
    if not os.path.exists(root_dir):
        return f"Path not found: {root_dir}"

    now = time.time()
    cutoff = now - (max_age_days * 24 * 60 * 60)
    deleted_count = 0
    reclaimed_bytes = 0

    skipped = []
    deleted = []

    for root, dirs, files in os.walk(root_dir):
        for name in files:
            if not name.endswith(".mp4"):
                continue

            filepath = os.path.join(root, name)
            try:
                stat = os.stat(filepath)
                if stat.st_mtime < cutoff:
                    size = stat.st_size
                    if not dry_run:
                        os.remove(filepath)
                        deleted.append(filepath)
                        deleted_count += 1
                        reclaimed_bytes += size
                    else:
                        skipped.append(filepath)
            except Exception as e:
                print(f"Error checking {filepath}: {e}")

    mb_reclaimed = round(reclaimed_bytes / (1024 * 1024), 2)

    if dry_run:
        return {
            "status": "dry_run",
            "would_delete": len(skipped),
            "files": skipped[:10]  # Показати перші 10
        }

    return {
        "status": "success",
        "deleted_count": deleted_count,
        "reclaimed_mb": mb_reclaimed
    }


def find_empty_files(root_dir: str):
    empty = []
    for root, dirs, files in os.walk(root_dir):
        for name in files:
            filepath = os.path.join(root, name)
            try:
                if os.path.getsize(filepath) == 0:
                    empty.append(filepath)
            except:
                pass
    return empty


def get_folder_stats(root_dir: str):
    """
    Отримує статистику про папку: загальний розмір, кількість файлів.
    """
    if not os.path.exists(root_dir):
        return {"error": "Directory not found"}

    total_size = 0
    file_count = 0
    video_count = 0

    for root, dirs, files in os.walk(root_dir):
        for name in files:
            filepath = os.path.join(root, name)
            try:
                size = os.path.getsize(filepath)
                total_size += size
                file_count += 1
                if name.endswith(('.mp4', '.avi', '.mkv', '.mov')):
                    video_count += 1
            except:
                pass

    return {
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "file_count": file_count,
        "video_count": video_count
    }