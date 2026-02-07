# Polyglot UI - Figma Plugin

Automate your workflow directly in Figma with AI-powered translations and real-time layout stress testing.

## Local Development Setup

Follow these steps to get the plugin running locally in your Figma environment:

### 1. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed, then run:
```bash
npm install
```

### 2. Run the Build Watcher
The plugin uses TypeScript, which needs to be compiled to JavaScript. Start the watcher to automatically compile your changes:
```bash
npm run watch
```
*(Alternatively, in VS Code, press `Cmd+Shift+B` and select `npm: watch`)*.

### 3. Load in Figma
1. Open the **Figma Desktop App**.
2. Go to **Plugins > Development > Import plugin from manifest...**.
3. Select the `manifest.json` file in this directory.

## Core Features
- **Scan Design**: Extracts all text nodes from your current selection.
- **AI Translation**: Generates localized copies using the Lingo.dev engine.
- **Live Preview**: Failsafe your layout by previewing translations directly on the canvas.
- **Stress Test**: Pseudo-localize your UI to catch expansion and character support issues.
- **Human-in-the-Loop**: Manually tweak translations and save overrides that AI won't overwrite.

## Built With
- [Lingo.dev API](https://lingo.dev) - The translation engine.
- TypeScript & HTML/CSS.

---
*Happy Designing! 🏗️🚀*
