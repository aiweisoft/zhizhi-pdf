# 第三方组件与许可

本目录下的代码全部来自公开包，此处记录版本、来源与协议，便于合规审查。
本项目代码本身不含 AGPL 依赖，可商用。

| 目录 / 文件 | 组件 | 版本 | 协议 | 来源 |
|---|---|---|---|---|
| `pdfjs/pdf.min.mjs`、`pdfjs/pdf.worker.min.mjs`、`pdfjs/cmaps/`、`pdfjs/standard_fonts/` | pdfjs-dist | 4.10.38 | Apache-2.0 | npm `pdfjs-dist` |
| `pdf-lib.min.js` | pdf-lib | 1.17.1 | MIT | npm `pdf-lib` |
| `jszip.min.js` | JSZip | 3.10.1 | MIT 或 GPL-3.0（本项目按 MIT 使用） | npm `jszip` |
| `tesseract/tesseract.min.js`、`tesseract/worker.min.js` | tesseract.js | 5.1.1 | Apache-2.0 | npm `tesseract.js` |
| `tesseract/tesseract-core-simd-lstm.wasm.js` | tesseract.js-core | 5.1.1 | Apache-2.0 | npm `tesseract.js-core` |
| `tessdata/chi_sim.traineddata.gz` | tessdata（简体中文） | 4.0.0（best_int） | Apache-2.0 | npm `@tesseract.js-data/chi_sim` |
| `tessdata/eng.traineddata.gz` | tessdata（英文） | 4.0.0（best_int） | Apache-2.0 | npm `@tesseract.js-data/eng` |

## 说明

- 语言包使用的是 `best_int`（int8 量化）与标准模型：中文端最终采用标准版 `4.0.0`，量化版识别错误率明显偏高，故弃用。
- 全部资源自托管，不引用任何 CDN。
- 升级组件时请同步更新本文件，并在 `README.md` 的依赖表中同步版本号。
