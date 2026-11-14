# 知智 PDF 工具

官网下的在线 PDF 工具：合并、拆分、删页、调序、旋转、扫描件文字提取。
**全部在浏览器本地完成，文件不上传服务器。** 纯静态，服务器不需要装任何运行时。

## 功能

| 能力 | 实现 | 说明 |
|---|---|---|
| 合并 / 删页 / 拖拽排序 / 左移右移 / 旋转 | pdf.js 预览 + pdf-lib 导出 | 一个页面序列模型，导出即合并 |
| 拆分 | pdf-lib + JSZip | 按范围 / 每 N 页 / 每页一个，打包 zip |
| OCR 提取文字 | tesseract.js + chi_sim | 输出带页分隔的纯文本，可复制或下载 txt |

限制（前端硬卡，防止把浏览器拖死）：

- 单文件 ≤ 10 MB
- 最多 20 个文件 / 200 页
- 单次 OCR ≤ 20 页

## 目录

```
index.html              页面骨架
web.config              仅本目录生效的 MIME + 缓存头（不改根配置）
assets/app.css          样式（沿用官网色板）
assets/app.js           全部逻辑（模块化，pdf.js 用 ESM 引入）
vendor/                 第三方库，全部自托管，不走 CDN
  pdfjs/                pdf.min.mjs + worker + cmaps + standard_fonts
  pdf-lib.min.js
  jszip.min.js
  tesseract/            tesseract.min.js + worker + core(simd-lstm)
  tessdata/             chi_sim.traineddata.gz (20MB) + eng (3MB)
img/                    本地预览用的 logo / favicon（线上用站点的 /img/）
tools/dev-server.py     本地开发服务器（补 .mjs/.wasm MIME）
tools/report-server.py  自测结果收集器
tools/shot/             截图脚本（puppeteer-core，复用本机 Chrome）
tests/                  自测页面
```

## 依赖与协议

| 组件 | 版本 | 协议 |
|---|---|---|
| pdfjs-dist | 4.10.38 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |
| jszip | 3.10.1 | MIT (GPL-3.0 双许可，选 MIT) |
| tesseract.js | 5.1.1 | Apache-2.0 |
| tessdata 语言包 | 4.0.0_best_int / 4.0.0 | Apache-2.0 |

全部可商用，没有 AGPL 依赖。

## 本地运行

```powershell
cd C:\Users\Administrator\zhizhi-pdf
python tools\dev-server.py 8898
# 打开 http://127.0.0.1:8898/
```

必须用 `tools\dev-server.py`，不能直接用 `python -m http.server`：
后者把 `.mjs` 当成 `text/plain`，浏览器会拒绝加载 ES module，页面直接白屏。
IIS 上的对应问题靠 `web.config` 里的 MIME 映射解决。

## 测试

```powershell
# 1. 起服务
python tools\dev-server.py 8898
python tools\report-server.py 8899

# 2. 功能自测（19 项：载入 / 合并 / 旋转 / 删除 / 范围解析 / zip）
& "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --user-data-dir="$env:TEMP\pdf-test" "http://127.0.0.1:8898/tests/harness.html"
# 结果落在 tests\last-result.json

# 3. OCR 全链路（造一张中文扫描件 → 识别 → 校验关键词）
& "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --user-data-dir="$env:TEMP\pdf-test-ocr" "http://127.0.0.1:8898/tests/ocr-test.html"

# 4. 截图（需要先 npm i 一次）
cd tools\shot
npm install puppeteer-core --registry=https://registry.npmmirror.com
node shot.js "http://127.0.0.1:8898/" ..\..\shot-empty.png 1440 900
```

注意：不要用 `--virtual-time-budget` 跑这些页，虚拟时钟会让 pdf.js / tesseract 的 Worker 卡死。
自测页靠 `fetch` 把结果 POST 到 8899 端口，所以需要 `report-server.py` 在跑。

### 最近一次结果

- 功能自测：19 / 19 通过
- OCR：单页中文扫描件 2.0 秒，`知智` / `扫描件` / `发票` / `1280` 全部正确
- 视觉：1440 与 390 两个宽度无横向滚动

## 已知问题 / 后续

- OCR 首次使用要下载约 24 MB（引擎 + 中文模型），之后走浏览器缓存。慢网环境首次体验一般。
- 加密 PDF（需要密码）不支持，会提示。
- 大页数（>100 页）缩略图是懒加载的，滚动很快时会看到一个个加载。
- 未做：水印 / 页码 / 压缩 / 图片转 PDF / 生成可搜索 PDF。

## 部署（已上线 2026-11-14）

线上地址：https://www.zhizhiapp.com/pdf/

部署方式：服务器从 https://codeload.github.com/aiweisoft/zhizhi-pdf/zip/refs/heads/main 直接拉 zip（实测 6.3 MB/s，26 MB 用 4 秒），Expand-Archive 解压后只拷 index.html / web.config / ssets/ / endor/，	ests/ 与 	ools/ 不上线。

目标路径：`C:\inetpub\wwwroot\zhizhi\pdf\`，作为静态子目录，不需要建 IIS 应用。

两个注意点：

1. **必须带上 `web.config`**，否则 `.wasm` / `.mjs` / `.bcmap` 会 404.3，页面直接白屏。
2. **约 31 MB 资源怎么上传**：云助手命令行有 32K 上限，挨个文件传不现实。两条路：
   - 阿里云 OSS 中转（同区域内网下载，最快）
   - 打 zip 发到 GitHub release，服务器走 `ghfast.top` 镜像下载

页面里的 `/img/` 与 `/` 链接指向官网根，部署到 `/pdf/` 后自然生效，本地 `img/` 只是预览占位。
