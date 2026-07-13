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
import sys

from camoufox.server import launch_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Camoufox Playwright-server launcher")
    parser.add_argument("--profile", required=True, help="persistent profile directory")
    parser.add_argument("--headed", action="store_true", help="visible browser (default headless)")
    parser.add_argument("--locale", default="en-US", help="browser locale")
    args = parser.parse_args()

    # Логируем параметры в stderr (stdout зарезервирован под WSENDPOINT-маркер).
    print(
        f"[*] camoufox server: profile={args.profile} headed={args.headed} locale={args.locale}",
        file=sys.stderr,
        flush=True,
    )

    # launch_server сам печатает wsEndpoint в stdout. Чтобы Node мог его
    # надёжно распарсить, мы НЕ перехватываем stdout (пропускаем как есть),
    # а launcher на стороне Node ищет паттерн ws://... в выводе.
    # Camoufox пишет: "Websocket endpoint: ws://localhost:PORT/HASH"
    launch_server(
        data_dir=args.profile,
        headless=not args.headed,
        humanize=True,
        locale=args.locale,
    )


if __name__ == "__main__":
    main()
