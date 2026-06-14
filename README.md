<p align="center">
  <img src="./assets/guozha-ai-pro-logo.svg" alt="Guozha AI Pro" width="220" />
</p>

<h1 align="center">Guozha AI Pro</h1>

<p align="center">
  面向 Obsidian 的 AI 对话、多模态创作、图像生成与 WebDAV 同步插件。
</p>

<p align="center">
  <a href="https://github.com/jiahuacaogoodman-art/obsidian-guozha-ai-pro/blob/main/LICENSE">
    <img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-C58A2B" />
  </a>
  <img alt="Obsidian plugin" src="https://img.shields.io/badge/Obsidian-plugin-7C3AED" />
  <img alt="AI ready" src="https://img.shields.io/badge/AI-multimodal-2F855A" />
</p>

---

## 你可以用它做什么

**Guozha AI Pro（果札）** 把知识库里的同步、对话、文件操作和创作能力放到同一个工作流里。你可以在 Obsidian 里直接和 AI 对话，让它理解图片、生成图片、读取或整理 Vault 文件，也可以继续使用 WebDAV 完成多端同步。

## 主要功能

- **AI 对话**
  在 Obsidian 内打开侧边对话框，接入兼容 OpenAI 接口的模型。

- **流式输出**
  桌面端通过 Node 网络通道处理请求，让回复实时出现在对话框里。

- **多模态输入**
  支持在聊天中附加图片，让模型结合文本和图像一起回答。

- **图像生成**
  支持图像生成模型，生成结果会保存到 Vault，并直接显示在聊天里。

- **输出参数调节**
  可调节 temperature、最大输出长度等生成参数。

- **Vault 文件助手**
  AI 可在授权后读取、编辑和管理 Vault 文件，适合整理笔记、批量修改和内容检索。

- **WebDAV 同步**
  保留双向同步、增量同步、冲突处理、过滤器、大文件跳过、日志和缓存管理能力。

## 安装

1. 下载或构建 `main.js`、`styles.css`、`manifest.json`。
2. 放入 Obsidian 插件目录：

```text
<你的 Vault>/.obsidian/plugins/guozha-ai-pro/
```

3. 在 Obsidian 的社区插件设置中启用 **Guozha AI Pro**。
4. 在插件设置里配置 WebDAV 同步信息和 AI Provider。

## 开发

```bash
pnpm install
pnpm build:plugin
```

常用命令：

- `pnpm test`：运行测试
- `pnpm build`：构建完整插件
- `pnpm dev`：开发模式

## 注意

- 同步前建议备份 Vault。
- AI 工具操作可能修改文件，建议保留权限确认。
- 使用第三方 OpenAI-compatible 端点时，请确认对应模型支持文本、图像或图像生成能力。

## 隐私与联网

Guozha AI Pro 只会在你主动配置并使用相关功能时联网：

- WebDAV 同步会连接你配置的远程同步服务。
- AI 对话、多模态理解和图像生成会把你发送的文本、图片和必要上下文发送到你配置的 AI Provider。
- Vault 文件助手会在你授权后读取、创建、修改或删除本地 Vault 文件；建议保持权限确认开启。
- 插件不会内置第三方统计或遥测服务。

## 许可证与致谢

本项目遵循 **AGPL-3.0** 协议。

同步相关基础能力源自 [nutstore/obsidian-nutstore-sync](https://github.com/nutstore/obsidian-nutstore-sync)，感谢原项目的开源工作。
