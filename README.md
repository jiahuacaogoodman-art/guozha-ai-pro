<p align="center">
  <img src="./assets/guozha-ai-pro-logo.svg" alt="Guozha AI Pro" width="220" />
</p>

<h1 align="center">Guozha AI Pro</h1>

<p align="center">
  Flexible AI chat, multimodal creation, image generation, and one-click WebDAV cloud sync for Obsidian.
</p>

<p align="center">
  <a href="https://github.com/jiahuacaogoodman-art/obsidian-guozha-ai-pro/blob/main/LICENSE">
    <img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-C58A2B" />
  </a>
  <img alt="Obsidian plugin" src="https://img.shields.io/badge/Obsidian-plugin-7C3AED" />
  <img alt="AI ready" src="https://img.shields.io/badge/AI-multimodal-2F855A" />
</p>

---

## What It Does

**Guozha AI Pro** brings flexible AI work and lightweight cloud sync into one Obsidian workflow. You can chat with OpenAI-compatible models, send images for multimodal understanding, generate images into your Vault, and keep notes synced across devices through WebDAV powered by Nutstore.

## Features

- **AI chat**
  Open a side-panel chat inside Obsidian and connect any compatible AI provider.

- **Streaming replies**
  Responses appear progressively in the chat view instead of waiting for the full answer.

- **Multimodal input**
  Attach images to a message so supported models can reason over text and visuals together.

- **Image generation**
  Generate images, save them to your Vault, and preview them directly in the conversation.

- **Model controls**
  Adjust provider, model, temperature, max output length, and related generation settings.

- **Vault file assistant**
  Let AI read, create, edit, and organize Vault files after permission checks.

- **WebDAV cloud sync**
  Sync notes with bidirectional sync, incremental updates, conflict handling, filters, large-file skipping, logs, and cache management.

## Installation

1. Download or build `main.js`, `styles.css`, and `manifest.json`.
2. Place them in your Obsidian plugin folder:

```text
<your vault>/.obsidian/plugins/guozha-ai-pro/
```

3. Enable **Guozha AI Pro** from Obsidian community plugin settings.
4. Configure your WebDAV sync account and AI providers in the plugin settings.

## Development

```bash
pnpm install
pnpm build
```

Useful commands:

- `pnpm test`: run tests
- `pnpm build`: build the full plugin
- `pnpm dev`: start development mode

## Notes

- Back up your Vault before enabling sync.
- AI tools can modify local files after approval, so keeping permission confirmation enabled is recommended.
- When using third-party OpenAI-compatible endpoints, make sure the selected model supports the text, vision, or image-generation capability you want to use.

## Privacy And Network Access

Guozha AI Pro only connects to the network when you configure and use features that need it:

- WebDAV sync connects to the remote service you configure.
- AI chat, multimodal understanding, and image generation send your selected text, images, and necessary context to your configured AI provider.
- Vault file tools read, create, edit, or delete local Vault files only after approval.
- The plugin does not include third-party analytics or telemetry.

## License And Credits

This project is licensed under **AGPL-3.0**.

The sync foundation is derived from [nutstore/obsidian-nutstore-sync](https://github.com/nutstore/obsidian-nutstore-sync). Thanks to the original project for its open-source work.

## 中文简介

**果札 AI Pro** 面向 Obsidian，提供自由灵活的 AI 对话、多模态输入、图像生成、Vault 文件助手，以及借助坚果云 WebDAV 的免费一键式云同步能力。