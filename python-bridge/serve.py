"""
Camoufox Playwright-server launcher for job_hunter.

Запускает Camoufox (модифицированный Firefox) как Playwright-server через
camoufox.server.launch_server(). Сервер печатает WebSocket endpoint, по
которому Node (JS-playwright firefox.connect) подключается и управляет
браузером. Сбор/парсинг/фильтр остаются в TS.

ПРОТОКОЛ ВЫВОДА (для парсинга из Node):
  - stderr: всё логирование (человеческие сообщения)
  - stdout: ОДНА строка-маркер с wsEndpoint:
      WSENDPOINT: ws://localhost:PORT/HASH
  Node-launcher ждёт эту строку в stdout, парсит wsEndpoint, подключается.

АРГУМЕНТЫ:
  --profile PATH    (обязательный) директория персистентного профиля Camoufox
  --headed          видимый браузер (для ручного логина). Дефолт: headless.
  --locale LOCALE   locale браузера. Дефолт: en-US.

Запуск:
  uv run python serve.py --profile /path/to/profile --headed --locale en-US
"""
import argparse
import os
import sys

from browserforge.fingerprints import Screen
from camoufox.server import launch_server

# fingerprint-модуль рядом (python-bridge/fingerprint.py). Импорт с fallback —
# serve.py должен работать и без него (тогда --fingerprint недоступен).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from fingerprint import from_json as load_fingerprint
except ImportError:  # pragma: no cover
    load_fingerprint = None  # type: ignore[assignment]


def parse_window(value: str) -> tuple[int, int]:
    """Разобрать 'W,H' (напр. '1920,1080') в (width, height) tuple."""
    parts = value.replace("x", ",").split(",")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(
            f"--window ожидает 'WxH' или 'W,H' (напр. 1920x1080), получено '{value}'"
        )
    try:
        w, h = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"--window: нечисловые размеры '{value}'") from exc
    if w < 320 or h < 240:
        raise argparse.ArgumentTypeError(f"--window: слишком маленький размер {w}x{h}")
    return (w, h)


def main() -> None:
    parser = argparse.ArgumentParser(description="Camoufox Playwright-server launcher")
    parser.add_argument("--profile", required=True, help="persistent profile directory")
    parser.add_argument("--headed", action="store_true", help="visible browser (default headless)")
    parser.add_argument("--locale", default="en-US", help="browser locale")
    parser.add_argument(
        "--window",
        type=parse_window,
        default=(1920, 1080),
        help="fixed window size 'WxH' (default 1920x1080). Constrains the "
        "generated fingerprint's screen to these dimensions too.",
    )
    parser.add_argument(
        "--fingerprint",
        default=None,
        help="path to a serialized BrowserForge fingerprint JSON. If the file "
        "exists, the same fingerprint is reused on every launch — required for "
        "hh.ru session persistence (hh invalidates sessions whose fingerprint "
        "changed between runs). See scripts/gen-fingerprint.py.",
    )
    args = parser.parse_args()

    # Загрузить fingerprint, если задан и файл существует.
    fingerprint = None
    if args.fingerprint:
        if load_fingerprint is None:
            print(
                "[!] --fingerprint передан, но модуль fingerprint недоступен; "
                "игнорирую (будет случайный fingerprint).",
                file=sys.stderr,
                flush=True,
            )
        elif os.path.exists(args.fingerprint):
            fingerprint = load_fingerprint(args.fingerprint)
            print(
                f"[*] fingerprint loaded from {args.fingerprint} "
                f"(UA={fingerprint.navigator.userAgent[:50]}...)",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                f"[!] --fingerprint {args.fingerprint} не найден; "
                "используется случайный fingerprint.",
                file=sys.stderr,
                flush=True,
            )

    # Логируем параметры в stderr (stdout зарезервирован под WSENDPOINT-маркер).
    print(
        f"[*] camoufox server: profile={args.profile} headed={args.headed} "
        f"locale={args.locale} window={args.window[0]}x{args.window[1]} "
        f"fingerprint={'yes' if fingerprint else 'random'}",
        file=sys.stderr,
        flush=True,
    )

    # launch_server сам печатает wsEndpoint в stdout. Чтобы Node мог его
    # надёжно распарсить, мы НЕ перехватываем stdout (пропускаем как есть),
    # а launcher на стороне Node ищет паттерн ws://... в выводе.
    # Camoufox пишет: "Websocket endpoint: ws://localhost:PORT/HASH"
    #
    # window + screen: Camoufox иначе генерирует случайный размер окна (по
    # fingerprint), который в headed-режиме часто меньше монитора и неудобен
    # для ручного логина. Фиксируем window и ограничиваем screen теми же
    # лимитами — CSS media queries и screen.width/height будут консистентны.
    #
    # fingerprint (если задан): явный BrowserForge Fingerprint → hh видит тот
    # же отпечаток между запусками → не инвалидирует сессию.
    launch_kwargs = dict(
        data_dir=args.profile,
        headless=not args.headed,
        humanize=True,
        locale=args.locale,
        window=args.window,
        screen=Screen(max_width=args.window[0], max_height=args.window[1]),
    )
    if fingerprint is not None:
        launch_kwargs["fingerprint"] = fingerprint
    launch_server(**launch_kwargs)


if __name__ == "__main__":
    main()
