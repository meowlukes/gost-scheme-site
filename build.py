#!/usr/bin/env python3
"""Сборка index.html из исходников в папке src/.

Запуск:  python3 build.py
Результат: index.html рядом с этим файлом (CSS и JS встроены в страницу,
шрифты и библиотеки подключаются из папок fonts/ и vendor/).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
# Порядок важен: каждый следующий файл пользуется функциями предыдущих.
PARTS = ["parser.js", "transform.js", "layout.js", "project.js", "examples.js", "render.js", "app.js"]

def main():
    js = "\n".join((SRC / p).read_text(encoding="utf-8") for p in PARTS)
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    if "/*__APP__*/" not in shell:
        raise SystemExit("В src/shell.html нет метки /*__APP__*/")
    html = shell.replace("/*__APP__*/", js.replace("</script>", "<\\/script>"))
    out = ROOT / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"Готово: {out} ({len(html) // 1024} КБ)")

if __name__ == "__main__":
    main()
