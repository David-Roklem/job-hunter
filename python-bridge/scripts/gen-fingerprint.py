"""
Разовая генерация fingerprint для hh и сохранение в data/hh-fingerprint.json.

Запуск: python scripts/gen-fingerprint.py        (из python-bridge/)
        или  npm run gen:fingerprint              (из корня проекта)

serve.py при каждом запуске читает этот файл и передаёт fingerprint в
launch_server(fingerprint=...) → hh видит один и тот же отпечаток между
login и collect/apply → не инвалидирует сессию.

Регенерация нужна редко — например, если hh забанил отпечаток (тогда
придётся заново hh:login под новым fingerprint).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Windows-консоль по умолчанию cp1251 — не умеет в Unicode-маркеры (✓/→).
# Переконфигурируем stdout в utf-8 если умеем (Python 3.7+).
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except (AttributeError, OSError):
    pass

# Скрипт лежит в python-bridge/scripts/ — поднимаемся на уровень выше,
# чтобы импортировать fingerprint.py из python-bridge/.
_HERE = Path(__file__).resolve().parent
_BRIDGE = _HERE.parent if _HERE.name == "scripts" else _HERE
sys.path.insert(0, str(_BRIDGE))

from fingerprint import generate, to_json  # noqa: E402

# data/ на уровне корня проекта (python-bridge/../data).
_PROJECT_ROOT = _BRIDGE.parent
FINGERPRINT_PATH = _PROJECT_ROOT / "data" / "hh-fingerprint.json"

# Размер окна — совпадает с дефолтом launcher.ts (1920x1080) и serve.py --window.
WINDOW: tuple[int, int] = (1920, 1080)


def main() -> None:
    force = "--force" in sys.argv or "-f" in sys.argv
    if FINGERPRINT_PATH.exists() and not force:
        print(
            f"[OK] {FINGERPRINT_PATH} already exists. "
            "Use --force to regenerate (will require re-running hh:login)."
        )
        return

    FINGERPRINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fp = generate(window=WINDOW)
    to_json(fp, FINGERPRINT_PATH)

    print(f"[OK] Fingerprint generated -> {FINGERPRINT_PATH}")
    print(f"  UA:       {fp.navigator.userAgent}")
    print(f"  platform: {fp.navigator.platform}")
    print(f"  screen:   {fp.screen.width}x{fp.screen.height}")
    print()
    print(
        "serve.py will pick it up automatically (via --fingerprint). "
        "Run npm run hh:login to log in under this fingerprint."
    )


if __name__ == "__main__":
    main()
