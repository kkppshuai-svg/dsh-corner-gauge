# Third-party notices

本项目的**代码**以 MIT 授权（见 [LICENSE](./LICENSE)）。
`assets/` 下的部分素材来自第三方，授权与归属如下。

## 车辆与品牌素材

- `assets/bmw-m.svg` — BMW M 标志，来自 Wikimedia Commons
  (<https://commons.wikimedia.org/wiki/File:BMW_M_logo.svg>)。
  “BMW” 与 BMW M 标志是 Bayerische Motoren Werke AG 的商标。
  此处作为主题素材用于个人非商业用途，本项目与 BMW 无关联。
- `assets/mercedes-mark.webp`、`assets/ferrari-mark.webp`、
  `assets/redbull-mark.webp`、`assets/sauber-mark.webp` — 车队徽标，由仓库所有者提供，
  背景由 `_tools/logo-key.mjs` 去除后重新编码。
  各车队名称与徽标为其各自所有者的商标；本项目与上述车队无关联或背书关系。
- `assets/cars/*.webp` — 车辆图片，由仓库所有者提供（侧视渲染图），
  抠图与轮辋切片由 `scripts/import-car.mjs` 与 `_tools/cut-wheels.mjs` 完成。

## 音频

- `assets/sounds/engine-f1.mp3` — 取自 “McLaren-Mercedes MP4 23 (2008).ogg”
  （作者 Edvvc，Wikimedia Commons，CC BY-SA 3.0，
  <https://commons.wikimedia.org/wiki/File:McLaren-Mercedes_MP4_23_(2008).ogg>）。
  修改方式：截取片段、单声道 32kHz、响度归一化。
  该衍生作品同样以 CC BY-SA 3.0 分发。
- `assets/sounds/bgm-verstappen.mp3` — 由仓库所有者提供的音频片段
  （2.6 秒，取自其持有的 13.9 秒素材，响度归一化）。
  **不在本项目 MIT 授权范围内**，按所有者要求收录。
  删除该文件后，构建会回退到 `_tools/chant.mjs` 生成的合成版本。
- `assets/sounds/engine-m4.mp3`、`engine-f1-v12.mp3`、`engine-f1-high.mp3` —
  由仓库所有者提供的参考录音，经截取与响度归一化处理。

## 字体

- `assets/rajdhani-700.woff2` — Rajdhani，作者 Indian Type Foundry，
  以 SIL Open Font License 1.1 授权。
