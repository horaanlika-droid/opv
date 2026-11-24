#!/usr/bin/env python3
"""
Собирает шрифты книги из официальных подмножеств @fontsource.

Зачем: Fontsource режет гарнитуры по scripts (latin / cyrillic / latin-ext).
Если взять только один файл, в книге не будет либо кириллицы, либо цифр,
латиницы и типографских знаков — текст начнёт набираться двумя гарнитурами.
Скрипт склеивает latin + cyrillic в один woff2 на начертание.

Что оставляем: кириллица, латиница (латинские названия видов), цифры,
«ёлочки», тире, многоточие, стрелки, знак номера.
Хвост Vietnamese/Greek выброшен: он утяжеляет файлы на 30–40 % без пользы.

Гарнитуры книги (типографская система «печатной машинки»):
    - IBM Plex Mono — машинописный набор: текст, подписи, служебные
      метки, интерфейс. Кириллица, латиница, цифры, «ёлочки», тире.
    - Cormorant Garamond — крупные заголовки: контраст печатного
      издания к машинописному тексту.

Запуск:
    pip install --break-system-packages fonttools brotli
    npm install --no-save --prefix /tmp/fonts @fontsource/cormorant-garamond \
        @fontsource/ibm-plex-mono
    python3 tools/build-fonts.py [--src /tmp/fonts/node_modules/@fontsource]

Лицензии начертаний — SIL OFL, тексты лежат рядом: docs/assets/fonts/OFL-*.txt.
"""

import argparse
import os
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'assets', 'fonts')

# Ровно те символы, которые встречаются в книге и её интерфейсе.
UNICODES = (
    'U+0020-007E,'          # латиница, цифры, базовая пунктуация
    'U+00A0,U+00AB,U+00BB,'  # неразрывный пробел, «ёлочки»
    'U+00B0,'               # градус
    'U+00B7,'               # средняя точка (разделители в навигации)
    'U+00D7,'               # знак умножения
    'U+2013,U+2014,'        # короткое и длинное тире
    'U+2018-201D,'          # одиночные и двойные кавычки
    'U+2026,'               # многоточие
    'U+2116,'               # знак номера
    'U+2190-2193,'          # стрелки в ссылках и навигации
    'U+2212,'               # типографский минус (температуры)
    'U+0410-044F,U+0401,U+0451'  # кириллица
)

JOBS = [
    # Заголовки — контраст печатного издания.
    ('cormorant-garamond', '400', 'normal', 'cormorant-400.woff2'),
    ('cormorant-garamond', '500', 'normal', 'cormorant-500.woff2'),
    ('cormorant-garamond', '500', 'italic', 'cormorant-500-italic.woff2'),
    ('cormorant-garamond', '600', 'normal', 'cormorant-600.woff2'),
    # Машинописный набор: текст, подписи, служебные метки, интерфейс.
    ('ibm-plex-mono', '400', 'normal', 'plex-mono-400.woff2'),
    ('ibm-plex-mono', '400', 'italic', 'plex-mono-400-italic.woff2'),
    ('ibm-plex-mono', '500', 'normal', 'plex-mono-500.woff2'),
    ('ibm-plex-mono', '600', 'normal', 'plex-mono-600.woff2'),
]

MERGE = """
import sys
from fontTools.merge import Merger
Merger().merge(sys.argv[2:]).save(sys.argv[1])
"""


def build(src_root):
    tmp = tempfile.mkdtemp()
    total = 0
    try:
        for pkg, weight, style, outname in JOBS:
            parts = []
            for subset in ('latin', 'cyrillic'):
                name = f'{pkg}-{subset}-{weight}-{style}'
                src = os.path.join(src_root, pkg, 'files', name + '.woff2')
                if not os.path.exists(src):
                    raise SystemExit(f'нет файла: {src}\nСкачайте пакеты @fontsource (см. docstring).')
                dst = os.path.join(tmp, name + '.ttf')
                subprocess.run([
                    'pyftsubset', src, f'--unicodes={UNICODES}', '--flavor=none',
                    '--layout-features=*', '--name-IDs=*', '--glyph-names',
                    f'--output-file={dst}',
                ], check=True)
                parts.append(dst)

            merged = os.path.join(tmp, 'merged.ttf')
            subprocess.run(['python3', '-c', MERGE, merged] + parts, check=True)
            final = os.path.join(OUT, outname)
            subprocess.run(['fonttools', 'ttLib.woff2', 'compress', merged,
                            '--output-file', final], check=True)
            kb = os.path.getsize(final) // 1024
            total += kb
            print(f'  {outname:28} {kb:>4} КБ')
    finally:
        shutil.rmtree(tmp)
    print(f'Готово: {len(JOBS)} начертаний, {total} КБ')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--src', default='/tmp/fonts/node_modules/@fontsource',
                    help='папка с распакованными пакетами @fontsource')
    args = ap.parse_args()
    build(args.src)
