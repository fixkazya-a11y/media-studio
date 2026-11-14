
import json
import os
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(
    title="Media Studio AI",
    version="1.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_AUDIO_SIZE = 30 * 1024 * 1024
MAX_LYRICS_SIZE = 1024 * 1024

WHISPER_MODEL = os.getenv(
    "MEDIA_STUDIO_WHISPER_MODEL",
    "base",
)

# Минимальная длительность строки.
# Это защита от мгновенного переключения.
MIN_LINE_DURATION = 0.65

# Средняя длительность слова используется
# только для восстановления ненайденных фраз.
SECONDS_PER_WORD = 0.32


def normalize(text: str) -> str:
    return re.sub(
        r"[^\w]",
        "",
        text.lower().replace("ё", "е"),
    )


def words_of(text: str) -> list[str]:
    return [
        normalize(word)
        for word in text.split()
        if normalize(word)
    ]


def format_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return f"{minutes}:{remainder:05.2f}"


def get_audio_duration(path: Path) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )

        duration = float(result.stdout.strip())

        if duration <= 0:
            raise ValueError("Нулевая длительность")

        return duration

    except (
        OSError,
        ValueError,
        subprocess.SubprocessError,
    ) as error:
        raise HTTPException(
            status_code=500,
            detail="FFprobe не смог определить длительность аудио.",
        ) from error


def get_recognized_words(data: dict) -> list[dict]:
    result = []

    # Основной формат WhisperX.
    for item in data.get("word_segments", []):
        start = item.get("start")
        token = normalize(str(item.get("word", "")))

        if isinstance(start, (int, float)) and token:
            result.append({
                "token": token,
                "time": float(start),
            })

    if result:
        return sorted(result, key=lambda x: x["time"])

    # Резервный вариант: слова внутри segments.
    for segment in data.get("segments", []):
        for item in segment.get("words", []):
            start = item.get("start")
            token = normalize(str(item.get("word", "")))

            if isinstance(start, (int, float)) and token:
                result.append({
                    "token": token,
                    "time": float(start),
                })

    if result:
        return sorted(result, key=lambda x: x["time"])

    # Если есть только сегменты распознавания,
    # приблизительно распределяем их слова.
    for segment in data.get("segments", []):
        start = segment.get("start")
        end = segment.get("end")

        if not isinstance(start, (int, float)):
            continue

        if not isinstance(end, (int, float)):
            continue

        tokens = words_of(str(segment.get("text", "")))

        if not tokens:
            continue

        interval = max(0.0, float(end) - float(start))

        for i, token in enumerate(tokens):
            result.append({
                "token": token,
                "time": float(start) + interval * i / len(tokens),
            })

    return sorted(result, key=lambda x: x["time"])


def line_weight(line: str) -> float:
    count = len(words_of(line))
    return max(1.0, count * SECONDS_PER_WORD)


def build_word_matches(
    reference: list[str],
    recognized: list[dict],
) -> dict[int, float]:
    """
    Находим совпадения текста и распознанной речи.

    Одиночные совпадения ненадёжны для рэпа:
    повторяющиеся слова могут относиться
    к совершенно другим частям песни.

    Поэтому сначала используем последовательности
    из двух и более совпадающих слов.
    """

    recognized_tokens = [
        item["token"] for item in recognized
    ]

    matcher = SequenceMatcher(
        None,
        reference,
        recognized_tokens,
        autojunk=False,
    )

    matches = {}

    for block in matcher.get_matching_blocks():
        if block.size < 2:
            continue

        for offset in range(block.size):
            text_index = block.a + offset
            audio_index = block.b + offset

            matches[text_index] = recognized[audio_index]["time"]

    # Если длинных совпадений вообще нет,
    # используем одиночные как запасной вариант.
    if not matches:
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                text_index = block.a + offset
                audio_index = block.b + offset
                matches[text_index] = recognized[audio_index]["time"]

    return matches


def build_line_anchors(
    lines: list[str],
    matches: dict[int, float],
    duration: float,
) -> tuple[dict[int, float], list[float]]:
    """
    Создаём опорные точки для строк.

    Не используем строку как надёжный якорь,
    если найдено только одно случайное слово.
    """

    anchors = {}
    confidences = []

    word_offset = 0

    for index, line in enumerate(lines):
        tokens = words_of(line)
        found = []

        for local_index in range(len(tokens)):
            global_index = word_offset + local_index

            if global_index in matches:
                found.append((
                    local_index,
                    matches[global_index],
                ))

        word_offset += len(tokens)

        confidence = len(found) / max(1, len(tokens))
        confidences.append(round(confidence, 2))

        if not found:
            continue

        # В начале строки совпадение надёжнее,
        # чем одно слово в её конце.
        early = [
            item
            for item in found
            if item[0] <= 2
        ]

        if len(found) >= 2 and early:
            first_index, first_time = early[0]

            estimate = first_time - first_index * SECONDS_PER_WORD

            anchors[index] = max(
                0.0,
                min(duration, estimate),
            )

    return anchors, confidences


def distribute_lines(
    lines: list[str],
    anchors: dict[int, float],
    duration: float,
) -> list[float]:
    """
    Распределяем строки между опорными точками.

    Подозрительные якоря, которые заставляют
    несколько строк уместиться в доли секунды,
    отбрасываем.

    Пропущенные строки распределяются
    пропорционально количеству слов.
    """

    count = len(lines)
    weights = [line_weight(line) for line in lines]

    # Добавляем начало и конец временной шкалы.
    candidates = sorted(anchors.items())

    accepted = []

    for index, time in candidates:
        if not accepted:
            accepted.append((index, time))
            continue

        prev_index, prev_time = accepted[-1]
        line_distance = index - prev_index
        time_distance = time - prev_time

        # Якорь не должен заставлять строки
        # переключаться практически мгновенно.
        required = line_distance * MIN_LINE_DURATION

        if time_distance < required:
            continue

        accepted.append((index, time))

    # Если не осталось опорных точек,
    # распределяем весь текст по длительности.
    if not accepted:
        total_weight = sum(weights)
        result = []
        elapsed = 0.0

        for weight in weights:
            result.append(min(duration, elapsed))
            elapsed += duration * weight / total_weight

        return result

    result = [0.0] * count

    # Участок до первой опорной точки.
    first_index, first_time = accepted[0]

    if first_index > 0:
        prefix_weight = sum(weights[:first_index])

        estimated_length = prefix_weight

        start_time = max(
            0.0,
            first_time - estimated_length,
        )

        available = first_time - start_time

        cursor = start_time

        for i in range(first_index):
            result[i] = cursor

            cursor += (
                available * weights[i] /
                max(prefix_weight, 0.001)
            )

    result[first_index] = first_time

    # Участки между опорными точками.
    for (left_index, left_time), (
        right_index,
        right_time,
    ) in zip(accepted, accepted[1:]):

        result[left_index] = left_time

        interval = right_time - left_time
        interval_weights = weights[left_index:right_index]
        total_weight = sum(interval_weights)

        cursor = left_time

        for i in range(left_index + 1, right_index):
            cursor += (
                interval * weights[i - 1] /
                max(total_weight, 0.001)
            )

            result[i] = cursor

        result[right_index] = right_time

    # Участок после последнего якоря.
    last_index, last_time = accepted[-1]
    result[last_index] = last_time

    if last_index < count - 1:
        remaining_weights = weights[last_index:]
        total_weight = sum(remaining_weights)
        available = max(0.0, duration - last_time)

        cursor = last_time

        for i in range(last_index + 1, count):
            cursor += (
                available * weights[i - 1] /
                max(total_weight, 0.001)
            )

            result[i] = cursor

    # Финальная защита от одинаковых таймингов.
    # Если места достаточно, раздвигаем строки.
    for i in range(1, count):
        minimum = result[i - 1] + MIN_LINE_DURATION

        if result[i] < minimum:
            result[i] = minimum

    # Если конец вышел за длительность трека,
    # равномерно сжимаем только при необходимости.
    if result[-1] > duration and count > 1:
        start = result[0]
        span = result[-1] - start
        available = max(0.0, duration - start)

        if span > 0:
            result = [
                start + (value - start) * available / span
                for value in result
            ]

    return [
        round(max(0.0, min(duration, t)), 3)
        for t in result
    ]


def synchronize_lyrics(
    data: dict,
    lyrics: str,
    duration: float,
) -> dict:
    lines = [
        line.strip()
        for line in lyrics.splitlines()
        if line.strip()
    ]

    if not lines:
        raise ValueError("Текст песни пустой.")

    recognized = get_recognized_words(data)

    if not recognized:
        raise ValueError(
            "WhisperX не обнаружил слова в аудио."
        )

    reference = []

    for line in lines:
        reference.extend(words_of(line))

    if not reference:
        raise ValueError(
            "В тексте песни нет распознаваемых слов."
        )

    matches = build_word_matches(
        reference,
        recognized,
    )

    if not matches:
        raise ValueError(
            "Не удалось сопоставить текст с аудио."
        )

    anchors, confidences = build_line_anchors(
        lines,
        matches,
        duration,
    )

    times = distribute_lines(
        lines,
        anchors,
        duration,
    )

    result_lines = []
    formatted = []

    for line, time, confidence in zip(
        lines,
        times,
        confidences,
    ):
        result_lines.append({
            "text": line,
            "time": time,
            "confidence": confidence,
        })

        formatted.append(
            f"{format_time(time)} | {line}"
        )

    print(
        f"Опорных строк: {len(anchors)}",
        flush=True,
    )

    return {
        "success": True,
        "lines": result_lines,
        "formatted_text": "\n".join(formatted),
        "total_lines": len(result_lines),
        "matched_words": len(matches),
        "total_words": len(reference),
        "model": WHISPER_MODEL,
        "anchor_lines": len(anchors),
    }


@app.get("/")
def home():
    return {
        "status": "ok",
        "service": "Media Studio AI",
        "version": "1.3.0",
        "model": WHISPER_MODEL,
    }


@app.post("/api/sync-lyrics")
def sync_lyrics(
    audio: UploadFile = File(...),
    lyrics: str = Form(""),
    lyrics_file: UploadFile | None = File(None),
):
    if lyrics_file is not None:
        filename = lyrics_file.filename or ""

        if Path(filename).suffix.lower() != ".txt":
            raise HTTPException(
                status_code=400,
                detail="Загрузи TXT-файл.",
            )

        raw = lyrics_file.file.read(
            MAX_LYRICS_SIZE + 1
        )

        lyrics_file.file.close()

        if len(raw) > MAX_LYRICS_SIZE:
            raise HTTPException(
                status_code=413,
                detail="TXT-файл слишком большой.",
            )

        try:
            lyrics = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise HTTPException(
                status_code=400,
                detail="Сохрани TXT в кодировке UTF-8.",
            ) from error

    lyrics = lyrics.strip()

    if not lyrics:
        raise HTTPException(
            status_code=400,
            detail="Добавь текст песни.",
        )

    if len(lyrics.encode("utf-8")) > MAX_LYRICS_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Текст песни слишком большой.",
        )

    filename = audio.filename or "audio.mp3"
    extension = Path(filename).suffix.lower()

    allowed = {
        ".mp3",
        ".wav",
        ".m4a",
        ".flac",
        ".ogg",
        ".webm",
        ".aac",
    }

    if extension not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Неподдерживаемый формат аудио.",
        )

    with tempfile.TemporaryDirectory(
        prefix="media_studio_ai_"
    ) as temp_dir:
        folder = Path(temp_dir)
        audio_path = folder / f"song{extension}"

        total_size = 0

        try:
            with audio_path.open("wb") as target:
                while True:
                    chunk = audio.file.read(1024 * 1024)

                    if not chunk:
                        break

                    total_size += len(chunk)

                    if total_size > MAX_AUDIO_SIZE:
                        raise HTTPException(
                            status_code=413,
                            detail="Аудиофайл больше 30 МБ.",
                        )

                    target.write(chunk)

            if total_size == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Аудиофайл пустой.",
                )

            print(
                f"Обрабатываем: {filename}",
                flush=True,
            )

            print(
                f"Строк текста: {len(lyrics.splitlines())}",
                flush=True,
            )

            print(
                f"Модель: {WHISPER_MODEL}",
                flush=True,
            )

            duration = get_audio_duration(audio_path)

            command = [
                sys.executable,
                "-m",
                "whisperx",
                str(audio_path),
                "--model",
                WHISPER_MODEL,
                "--language",
                "ru",
                "--device",
                "cpu",
                "--compute_type",
                "int8",
                "--batch_size",
                "1",
                "--output_dir",
                str(folder),
                "--output_format",
                "json",
            ]

            process = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=1800,
            )

            if process.returncode != 0:
                print(process.stdout, flush=True)
                print(process.stderr, flush=True)

                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Ошибка WhisperX. "
                        "Подробности в терминале."
                    ),
                )

            json_path = folder / "song.json"

            if not json_path.exists():
                raise HTTPException(
                    status_code=500,
                    detail="WhisperX не создал JSON.",
                )

            with json_path.open(
                "r",
                encoding="utf-8-sig",
            ) as file:
                data = json.load(file)

            try:
                result = synchronize_lyrics(
                    data,
                    lyrics,
                    duration,
                )
            except ValueError as error:
                raise HTTPException(
                    status_code=422,
                    detail=str(error),
                ) from error

            print(
                "Синхронизация завершена:",
                result["total_lines"],
                "строк",
                flush=True,
            )

            return result

        except subprocess.TimeoutExpired as error:
            raise HTTPException(
                status_code=504,
                detail="Превышено время обработки аудио.",
            ) from error

        finally:
            audio.file.close()
