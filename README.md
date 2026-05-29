# MiniMax Studio

基于 MiniMax Token Plan 的全模态 AI 创作桌面应用。

## 功能

| 标签 | 能力 | 模型 |
|------|------|------|
| 文本 | 多轮对话，支持系统提示词 | MiniMax-M2.7 |
| 图片 | 文生图 / 图生图，多比例多数量 | image-01 |
| 理解 | 图片智能分析，一键转图片生成 | MiniMax-M2.7 |
| 语音 | TTS 合成，15 个内置音色 + 语调/音量/语速调节 | speech-2.8-hd |
| 音乐 | 文本作曲 / 录音翻唱 / 录音创作 | music-2.6 / music-cover |

### 更多功能
- 🎙️ **录音** — 浏览器内录音，支持翻唱和作曲模式
- 🔧 **设置** — 自定义 API Key 和接口地址
- 📋 **任务队列** — 异步生成，实时状态跟踪
- 📁 **画廊** — 图片/音频分类浏览
- 🎛️ **语音调节** — 语速、音量、语调独立控制

## 安装

从 [Releases](../../releases) 下载 `MiniMax Studio_0.3.0_x64.dmg`，双击安装。

### 系统要求
- macOS 10.15+
- Apple Silicon 机型通过 Rosetta 2 兼容

### 首次使用
1. 打开应用
2. 点击右上角 ⚙ 设置
3. 填入你的 [MiniMax API Key](https://platform.minimaxi.com)
4. 开始创作

## 开发

```bash
# 安装依赖
npm install

# 开发模式（热更新 + Web Inspector）
npx tauri dev

# 生产构建
npx tauri build
```

### 技术栈

| 层 | 技术 |
|------|------|
| 前端 | HTML / CSS / JS |
| 桌面框架 | Tauri v2 (Rust) |
| CLI 工具 | mmx-cli |
| 音频处理 | ffmpeg (静态) |
| 运行时 | Node.js v22 |

### 包内自包含

| 组件 | 大小 |
|------|------|
| Node.js | 108 MB |
| mmx CLI + node_modules | 40 MB |
| ffmpeg | 9.7 MB |
| Rust 主程序 | 13 MB |
| **总计** | **~171 MB** |

## 协议

MIT
