# Path: python-core/video_worker.py
import os
import ffmpeg
import shutil
from glob import glob


def ensure_dir(path: str):
    if not os.path.exists(path):
        os.makedirs(path)


def get_video_info(path: str):
    try:
        probe = ffmpeg.probe(path)
        video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
        format_info = probe['format']
        if video_stream:
            return {
                **video_stream,
                'duration': float(format_info.get('duration', 0)),
                'size': int(format_info.get('size', 0))
            }
        return None
    except (ffmpeg.Error, ValueError, TypeError):
        return None


def _build_blur_filter(x, y, w, h, blur_strength):
    """
    Возвращает callable, который примет видео-узел (ffmpeg.nodes.FilterableStream)
    и вернёт видео-узел с наложенным блюром зоны через split/crop/boxblur/overlay.
    Выделение в отдельную функцию упрощает тестирование и повторное использование.
    """

    def _apply(video_node):
        split = video_node.split()
        base = split[0]
        to_blur = split[1]
        blurred = (
            to_blur
            .crop(x=int(x), y=int(y), width=int(w), height=int(h))
            .filter('boxblur', f"{int(blur_strength)}:1")
        )
        return base.overlay(blurred, x=int(x), y=int(y))

    return _apply


def _friendly_ffmpeg_error(stderr_text: str) -> str:
    """
    Преобразует stderr FFmpeg в более понятные сообщения для пользователя.
    """
    if not stderr_text:
        return "Неизвестная ошибка FFmpeg"

    text = stderr_text.lower()
    if 'no such file or directory' in text or 'could not find' in text:
        return 'FFmpeg: входной файл не найден'
    if 'stream specifier' in text and 'matches no streams' in text:
        return 'FFmpeg: неправильно указан -map или отсутствует требуемая дорожка'
    if 'unknown option' in text or 'unrecognized option' in text:
        return 'FFmpeg: неизвестный параметр/опция в команде'
    if 'error opening input files' in text or 'error opening file' in text:
        return 'FFmpeg: ошибка открытия входного файла'
    if 'filtergraph' in text and 'error' in text:
        return 'FFmpeg: ошибка в графе фильтров (-vf)'
    if 'invalid argument' in text:
        return 'FFmpeg: неправильные аргументы (координаты зоны или размеры?)'
    if 'at least one output file must be specified' in text:
        return 'FFmpeg: не указан выходной файл'
    return f'FFmpeg error: {stderr_text.strip()}'


def _qa_output_file(path: str):
    """Проверка результата: файл существует, >0 байт, есть длительность."""
    if not os.path.exists(path):
        return False, 'Файл результата не создан'
    try:
        size = os.path.getsize(path)
    except OSError:
        size = 0
    if size <= 0:
        return False, 'Файл результата имеет нулевой размер'
    info = get_video_info(path)
    if not info:
        return False, 'Не удалось прочитать метаданные видео (ffprobe)'
    if float(info.get('duration', 0)) <= 0:
        return False, 'Длительность видео равна 0'
    return True, None


def apply_watermark_removal(input_path, output_path, mode, x, y, w, h, blur_strength=20, band=4):
    """
    Применяет удаление водяного знака к одному файлу в заданной зоне.
    Поддерживает режимы: blur, delogo, hybrid.
    """
    try:
        # Валидация и приведение типов
        x, y, w, h = int(x), int(y), int(w), int(h)
        blur_strength = int(blur_strength)
        band = int(band)

        stream = ffmpeg.input(input_path)
        audio = stream.audio
        video = stream.video

        final_video = video

        if mode == "blur":
            # Режим 1: Cinematic Blur
            # split [base][tmp]; [tmp] crop, boxblur [blur]; [base][blur] overlay

            # Разделяем поток
            split = video.split()
            base = split[0]
            to_blur = split[1]

            # Обрабатываем зону
            blurred = (
                to_blur
                .crop(x=x, y=y, width=w, height=h)
                .filter('boxblur', f"{blur_strength}:1")
            )

            # Накладываем обратно
            final_video = base.overlay(blurred, x=x, y=y)

        elif mode == "delogo":
            # Режим 2: Delogo (Inpainting)
            final_video = video.filter('delogo', x=x, y=y, w=w, h=h, band=band, show=0)

        elif mode == "hybrid":
            # Режим 3: Hybrid (Delogo + Soft Edge Blur)
            # 1. Сначала применяем delogo
            after_delogo = video.filter('delogo', x=x, y=y, w=w, h=h, band=band, show=0)

            # 2. Затем легкий блюр на расширенной зоне для скрытия артефактов границ
            # Расширяем зону на 10 пикселей (по 5 с каждой стороны)
            # Нужно следить, чтобы координаты не ушли в минус
            pad = 5
            bx = max(0, x - pad)
            by = max(0, y - pad)
            bw = w + (pad * 2)
            bh = h + (pad * 2)

            # Split потока после delogo
            split = after_delogo.split()
            base = split[0]
            to_blur = split[1]

            # Легкий блюр (фиксированный 10, или можно брать blur_strength/2)
            soft_blur = (
                to_blur
                .crop(x=bx, y=by, width=bw, height=bh)
                .filter('boxblur', "10:1")
            )

            final_video = base.overlay(soft_blur, x=bx, y=by)

        else:
            # Если режим не задан или неизвестен — просто копируем входной поток
            # В этом случае мы не будем фильтровать видео и просто сделаем ремап дорожек ниже
            final_video = video

        # Сборка команды вывода
        # Используем пресет fast для скорости, crf 23 для баланса качества
        out = ffmpeg.output(
            final_video,
            audio,
            output_path,
            c_v='libx264',
            preset='fast',
            crf=23,
            c_a='copy',
            movflags='+faststart'
        )

        try:
            out.overwrite_output().run(quiet=True)
        except ffmpeg.Error as e:
            # Преобразуем ошибку в дружелюбный текст
            stderr_text = e.stderr.decode('utf8') if getattr(e, 'stderr', None) else str(e)
            return False, _friendly_ffmpeg_error(stderr_text)

        # QA после обработки
        ok, qa_err = _qa_output_file(output_path)
        if not ok:
            return False, f"QA failed: {qa_err}"
        return True, None

    except ffmpeg.Error as e:
        error_msg = e.stderr.decode('utf8') if e.stderr else str(e)
        return False, _friendly_ffmpeg_error(error_msg)
    except Exception as e:
        return False, f"General Error: {str(e)}"


def process_blur(input_dir: str, output_dir: str, config: dict = None):
    """
    Обрабатывает все видео в папке, применяя зоны водяных знаков.
    Поддерживает несколько зон (последовательное применение).
    """
    if not output_dir:
        raise ValueError("Output dir required")

    ensure_dir(output_dir)
    files = sorted(glob(os.path.join(input_dir, "*.mp4")))

    # Получаем зоны из конфига. Ожидается список словарей.
    # Пример зоны: {"x": 10, "y": 10, "w": 100, "h": 50, "mode": "hybrid", "blur_strength": 20}
    zones = config.get('zones', []) if config else []

    # Также поддерживаем одиночные поля конфигурации (watermark_mode/x/y/w/h/blur_strength/band)
    if not zones and config:
        single_mode = config.get('watermark_mode') or config.get('mode')
        if single_mode and str(single_mode).strip():
            sx = int(config.get('x', 0))
            sy = int(config.get('y', 0))
            sw = int(config.get('w', config.get('width', 0)) or 0)
            sh = int(config.get('h', config.get('height', 0)) or 0)
            sblur = int(config.get('blur_strength', 20))
            sband = int(config.get('band', 4))
            if sw > 0 and sh > 0:
                zones = [{
                    'mode': str(single_mode),
                    'x': sx, 'y': sy, 'w': sw, 'h': sh,
                    'blur_strength': sblur,
                    'band': sband,
                }]

    # Если явно указан пустой режим или зон нет — просто копируем
    
    if not zones:
        processed = 0
        for f in files:
            shutil.copy2(f, os.path.join(output_dir, os.path.basename(f)))
            processed += 1
        return {"processed": processed, "total": len(files), "message": "No zones defined, files copied."}

    processed_count = 0
    errors = []

    for file_path in files:
        filename = os.path.basename(file_path)
        final_output_path = os.path.join(output_dir, filename)

        # Для поддержки нескольких зон применяем их по очереди
        # Вход для первой итерации - исходный файл
        current_input = file_path
        temp_files = []  # Список временных файлов для очистки

        success_chain = True
        last_error = None

        try:
            for i, zone in enumerate(zones):
                # Определяем параметры для текущей зоны
                mode = zone.get('mode', 'blur')
                x = zone.get('x', 0)
                y = zone.get('y', 0)
                w = zone.get('width', 0)  # Поддержка ключей width/w
                if w == 0: w = zone.get('w', 100)
                h = zone.get('height', 0)  # Поддержка ключей height/h
                if h == 0: h = zone.get('h', 100)

                strength = zone.get('blur_strength', 20)
                band = zone.get('band', 4)

                # Определяем выходной путь:
                # Если это последняя зона, пишем в финал. Иначе во временный файл.
                is_last_zone = (i == len(zones) - 1)

                if is_last_zone:
                    current_output = final_output_path
                else:
                    current_output = os.path.join(output_dir, f".tmp_{i}_{filename}")
                    temp_files.append(current_output)

                # Запускаем обработку одной зоны
                ok, err = apply_watermark_removal(
                    current_input,
                    current_output,
                    mode, x, y, w, h, strength, band
                )

                if not ok:
                    success_chain = False
                    last_error = err
                    break

                # Выход текущего шага становится входом для следующего
                current_input = current_output

            if success_chain:
                processed_count += 1
            else:
                errors.append(f"{filename}: {last_error}")

        finally:
            # Удаляем промежуточные временные файлы
            for tmp in temp_files:
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except:
                        pass

    return {
        "processed": processed_count,
        "total": len(files),
        "errors": errors
    }


def process_merge(input_dir: str, output_file: str, mode: str):
    """
    Объединяет все mp4 файлы из папки в один без перекодирования.
    """
    files = sorted(glob(os.path.join(input_dir, "*.mp4")))
    if not files:
        return "No files to merge"

    ensure_dir(os.path.dirname(output_file))
    list_path = os.path.join(input_dir, "merge_list.txt")

    try:
        with open(list_path, 'w', encoding='utf-8') as f:
            for p in files:
                safe_path = p.replace("'", "'\\''")
                f.write(f"file '{safe_path}'\n")

        (
            ffmpeg
            .input(list_path, format='concat', safe=0)
            .output(output_file, c='copy')
            .overwrite_output()
            .run(quiet=True)
        )
        return f"Merged {len(files)} videos"
    except ffmpeg.Error as e:
        error_msg = e.stderr.decode('utf8') if e.stderr else str(e)
        raise RuntimeError(f"Merge failed: {error_msg}")
    finally:
        if os.path.exists(list_path):
            os.remove(list_path)


def process_clean_metadata(input_dir: str):
    """
    Удаляет метаданные из всех видео в папке.
    """
    files = glob(os.path.join(input_dir, "*.mp4"))
    count = 0
    for f in files:
        tmp = f + ".tmp.mp4"
        try:
            (
                ffmpeg
                .input(f)
                .output(tmp, map_metadata=-1, c='copy')
                .overwrite_output()
                .run(quiet=True)
            )
            os.replace(tmp, f)
            count += 1
        except:
            if os.path.exists(tmp): os.remove(tmp)
    return f"Cleaned {count} videos"


def process_qa_check(input_dir: str):
    """
    Базовая проверка качества видео.
    """
    files = glob(os.path.join(input_dir, "*.mp4"))
    report = {"total": len(files), "passed": 0, "failed": [], "details": []}

    for f in files:
        info = get_video_info(f)
        filename = os.path.basename(f)

        if not info:
            report['failed'].append(filename)
            report['details'].append({"file": filename, "reason": "Corrupted"})
            continue

        if info['duration'] < 1.0:
            report['failed'].append(filename)
            report['details'].append({"file": filename, "reason": "Too short"})
            continue

        report['passed'] += 1

    return report