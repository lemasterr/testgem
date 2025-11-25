# Path: python-core/video_worker.py
import os
import ffmpeg
import json
from glob import glob


def ensure_dir(path: str):
    if not os.path.exists(path):
        os.makedirs(path)


def get_video_info(path: str):
    try:
        probe = ffmpeg.probe(path)
        video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
        format_info = probe['format']
        # Повертаємо комбіновану інформацію
        if video_stream:
            return {**video_stream, 'duration': format_info.get('duration', 0)}
        return None
    except ffmpeg.Error:
        return None


def process_blur(input_dir: str, output_dir: str, config: dict = None):
    """
    Блюрить відео, застосовуючи зони з config['zones'].
    Використовує фільтр 'delogo' для ефективного видалення водяних знаків.
    Format zones: [{ "x": 10, "y": 10, "width": 100, "height": 50 }, ...]
    """
    if not output_dir:
        raise ValueError("Output dir required for blur")

    ensure_dir(output_dir)
    files = glob(os.path.join(input_dir, "*.mp4"))
    zones = config.get('zones', []) if config else []
    processed_count = 0

    for file_path in files:
        filename = os.path.basename(file_path)
        output_path = os.path.join(output_dir, filename)

        try:
            # Починаємо ланцюжок фільтрів
            stream = ffmpeg.input(file_path)
            video = stream.video
            audio = stream.audio

            has_filters = False
            if zones:
                for zone in zones:
                    x, y = int(zone.get('x', 0)), int(zone.get('y', 0))
                    w, h = int(zone.get('width', 0)), int(zone.get('height', 0))

                    # Перевірка валідності зони
                    if w > 0 and h > 0:
                        # delogo - ефективний фільтр для видалення водяних знаків
                        video = ffmpeg.filter(video, 'delogo', x=x, y=y, w=w, h=h, show=0)
                        has_filters = True

            if has_filters:
                # Перекодування потрібне для застосування фільтрів
                # crf=23 - стандартна якість, preset=fast - баланс швидкості
                out = ffmpeg.output(video, audio, output_path, c_v='libx264', preset='fast', crf=23, c_a='copy')
            else:
                # Якщо зон немає, просто копіюємо потоки (миттєво)
                out = ffmpeg.output(stream, output_path, c='copy')

            out.overwrite_output().run(quiet=True)
            processed_count += 1

        except ffmpeg.Error as e:
            # Логуємо помилку, але не зупиняємо весь процес
            error_msg = e.stderr.decode('utf8') if e.stderr else str(e)
            print(f"Error blurring {filename}: {error_msg}")
            continue

    return f"Blurred {processed_count} videos with {len(zones)} zones"


def process_merge(input_dir: str, output_file: str, mode: str):
    """
    Об'єднує всі mp4 файли з папки в один.
    """
    files = sorted(glob(os.path.join(input_dir, "*.mp4")))
    if not files:
        return "No files to merge"

    ensure_dir(os.path.dirname(output_file))

    list_path = os.path.join(input_dir, "merge_list.txt")
    try:
        with open(list_path, 'w', encoding='utf-8') as f:
            for file_path in files:
                # Екранування для ffmpeg concat demuxer
                safe_path = file_path.replace("'", "'\\''")
                f.write(f"file '{safe_path}'\n")

        (
            ffmpeg
            .input(list_path, format='concat', safe=0)
            .output(output_file, c='copy')
            .overwrite_output()
            .run(quiet=True)
        )
        return f"Merged {len(files)} videos to {os.path.basename(output_file)}"
    except ffmpeg.Error as e:
        error_msg = e.stderr.decode('utf8') if e.stderr else str(e)
        raise RuntimeError(f"Merge failed: {error_msg}")
    finally:
        if os.path.exists(list_path):
            os.remove(list_path)


def process_clean_metadata(input_dir: str):
    files = glob(os.path.join(input_dir, "*.mp4"))
    count = 0
    for file_path in files:
        temp_path = file_path + ".tmp.mp4"
        try:
            (
                ffmpeg
                .input(file_path)
                .output(temp_path, map_metadata=-1, c='copy')
                .overwrite_output()
                .run(quiet=True)
            )
            os.replace(temp_path, file_path)
            count += 1
        except Exception:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    return f"Cleaned metadata for {count} videos"


def process_qa_check(input_dir: str):
    """
    Перевіряє відео на валідність:
    1. Чи читається файл (ffprobe)
    2. Чи є відео потік
    3. Чи тривалість > 1 секунди
    """
    files = glob(os.path.join(input_dir, "*.mp4"))
    report = {"total": len(files), "passed": 0, "failed": [], "details": []}

    for file_path in files:
        filename = os.path.basename(file_path)
        info = get_video_info(file_path)

        if not info:
            report["failed"].append(filename)
            report["details"].append({"file": filename, "reason": "Corrupted or invalid format"})
            continue

        duration = float(info.get('duration', 0))
        if duration < 1.0:
            report["failed"].append(filename)
            report["details"].append({"file": filename, "reason": f"Too short ({duration}s)"})
            continue

        report["passed"] += 1

    return report