"""
Сериализация BrowserForge Fingerprint ↔ JSON.

Camoufox 0.4.11 при каждом launch_server() генерирует случайный fingerprint
(BrowserForge) → hh.ru инвалидидирует сессию, если отпечаток не совпадает
между login и collect/apply. Этот модуль решает проблему: один fingerprint
генерируется разово (scripts/gen-fingerprint.py), сериализуется в JSON
(data/hh-fingerprint.json) и serve.py передаёт его в
launch_server(fingerprint=...) при каждом запуске.

Почему не fingerprint_preset (бандл пресетов): он есть только в camoufox≥0.5.3,
которая тянет playwright 1.60 — риск WS-handshake fail (см. решение в STATE).
0.4.11 принимает fingerprint=<BrowserForge Fingerprint> напрямую — используем его.

Round-trip доказан: asdict → JSON → from_dict (рекурсивно по вложенным
dataclass'ам ScreenFingerprint/NavigatorFingerprint/VideoCard) восстанавливает
Fingerprint, from_browserforge(fp) его принимает, UA/platform/screen совпадают.
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

from browserforge.fingerprints import Fingerprint, FingerprintGenerator
from browserforge.fingerprints.generator import (
    NavigatorFingerprint,
    ScreenFingerprint,
    VideoCard,
)

# ExtendedScreen — подкласс ScreenFingerprint с полем screenY; создаётся
# camoufox.fingerprints.handle_window_size при передаче window=(w,h). В обычном
# (без window) fingerprint используется ScreenFingerprint. Импортируем если есть.
try:
    from camoufox.fingerprints import ExtendedScreen
except ImportError:  # pragma: no cover — для сред без camoufox (только тесты)
    ExtendedScreen = None  # type: ignore[assignment,misc]

# ОС/браузер под которым фиксируем отпечаток.
# - os=windows: десктоп пользователя (см. решение STATE «WebGL НЕ маскируется» —
#   реальное железо Windows). Чужой OS = несоответствие с экраном/GPU/IP.
# - browser=firefox: Camoufox строится на Firefox; чужой UA = детект.
_DEFAULT_OS = "windows"
_DEFAULT_BROWSER = "firefox"


def generate(window: tuple[int, int] | None = None) -> Fingerprint:
    """Сгенерировать один детерминированный fingerprint.

    window: если задан — скорректировать screen-размеры под окно (через
      camoufox.fingerprints.handle_window_size), чтобы window и screen-fingerprint
      были консистентны (см. фикс --window в cf3cf14).
    """
    gen = FingerprintGenerator(browser=_DEFAULT_BROWSER, os=_DEFAULT_OS)
    fp = gen.generate()
    if window is not None:
        # Импорт здесь — camouflow-зависимость только при необходимости.
        from camoufox.fingerprints import handle_window_size

        handle_window_size(fp, *window)
    return fp


def to_json(fp: Fingerprint, path: str | Path) -> None:
    """Сериализовать Fingerprint в JSON-файл (через dataclasses.asdict).

    Добавляет служебное поле _screen_cls, чтобы from_json знал, в какой класс
    восстанавливать screen (ScreenFingerprint или ExtendedScreen, если
    fingerprint сгенерирован с window=).
    """
    data = dataclasses.asdict(fp)
    data["_screen_cls"] = type(fp.screen).__name__
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False),
        encoding="utf-8",
    )


def from_json(path: str | Path) -> Fingerprint:
    """Десериализовать Fingerprint из JSON-файла.

    Рекурсивный from_dict по вложенным dataclass-полям (ScreenFingerprint /
    ExtendedScreen, NavigatorFingerprint, VideoCard). Прочие поля
    (dict/list/None) — как есть.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    # screen восстанавливаем в правильный подкласс (ExtendedScreen если есть screenY).
    screen_cls_name = data.get("_screen_cls", "ScreenFingerprint")
    data.pop("_screen_cls", None)
    screen_cls = (
        ExtendedScreen
        if (screen_cls_name == "ExtendedScreen" and ExtendedScreen is not None)
        else ScreenFingerprint
    )
    return _from_dict(Fingerprint, data, screen_cls=screen_cls)


def _from_dict(
    cls: type,
    data: dict[str, Any],
    *,
    screen_cls: type = ScreenFingerprint,
) -> Any:
    """Рекурсивно восстановить dataclass из dict по типам полей."""
    field_types = {f.name: f.type for f in dataclasses.fields(cls)}
    kwargs: dict[str, Any] = {}
    for name, val in data.items():
        ft = field_types.get(name)
        # Поле screen — восстанавливаем в выбранный подкласс.
        if name == "screen" and isinstance(val, dict):
            kwargs[name] = _from_dict(screen_cls, val)
        elif (
            isinstance(val, dict)
            and isinstance(ft, type)
            and dataclasses.is_dataclass(ft)
        ):
            kwargs[name] = _from_dict(ft, val)
        else:
            kwargs[name] = val
    return cls(**kwargs)


__all__ = ["generate", "to_json", "from_json"]
