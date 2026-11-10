# Сторонние компоненты

Библиотеки экспорта и шрифты лежат в проекте и раздаются с того же сервера.
Версии библиотек задаются в `package.json`; в `vendor/` их копирует сборка (`npm run build`).

| Компонент | Где лежит | Лицензия |
|---|---|---|
| jsPDF 4.2.1 (экспорт в PDF) | `vendor/jspdf.umd.min.js` | MIT, https://github.com/parallax/jsPDF |
| JSZip 3.10.2 (архив всех схем) | `vendor/jszip.min.js` | MIT или GPLv3, https://github.com/Stuk/jszip |
| Шрифт PT Sans (интерфейс) | `fonts/PTSans-*.woff2` | SIL Open Font License 1.1, ParaType |
| Шрифт PT Mono (редактор кода) | `fonts/PTMono-*.woff2` | SIL Open Font License 1.1, ParaType |
| Шрифт Tinos (текст на схеме, метрически совместим с Times New Roman) | `fonts/Tinos-Regular.woff2` | Apache License 2.0, Google |

Шрифт Tinos урезан до латиницы, кириллицы, греческих букв и математических знаков (≤ ≥ ≠ √ π и т. п.).

Инструменты разработки (в сайт не попадают): esbuild, ESLint.

Единственное внешнее обращение страницы — счётчик Яндекс.Метрики; он включается и
отключается в `site.config.json`.
