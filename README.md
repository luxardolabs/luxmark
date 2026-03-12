# LuxMark

<div align="center">
  <img src="https://img.shields.io/badge/version-1.0.5-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/built%20with-JavaScript-yellow.svg" alt="Built with JavaScript">
  <img src="https://img.shields.io/badge/no%20build%20tools-required-brightgreen.svg" alt="No Build Tools Required">
</div>

<div align="center">
  <p><strong>A premium browser-based markdown editor with live preview</strong></p>
  <p>Built by <a href="https://www.luxardolabs.com/">Luxardo Labs</a></p>
</div>

---

## Overview

LuxMark is a markdown editor that runs entirely in your browser. No server, no build process, no npm install — just vanilla JavaScript, ES6 modules, and CDN dependencies. Everything stays private in your browser's localStorage.

---

## Features

### Editor
- **Live Preview** — real-time rendering as you type
- **Syntax Highlighting** — CodeMirror with markdown mode
- **Keyboard Shortcuts** — `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic
- **Auto-Save** — saves to localStorage every 30 seconds
- **Resizable Panes** — drag the divider to adjust editor/preview ratio
- **Word/Character/Line Count** — document statistics in the status bar
- **Font Selector** — choose preview font (System Sans, Poppins, Georgia, Courier New, and more)
- **Width Selector** — toggle between Wide and Full preview width

### Markdown Support
- **GitHub Flavored Markdown (GFM)** — tables, strikethrough, task lists
- **Math Equations** — LaTeX via KaTeX (`$E=mc^2$` and `$$...$$` blocks)
- **Footnotes** — academic-style references with `[^1]` syntax
- **Syntax Highlighting** — code blocks with language detection via Highlight.js
- **HTML Support** — embed custom HTML directly
- **Emoji Support** — full emoji rendering in content and headers

### Copy Options
- **Copy MD** — raw markdown source
- **Copy HTML** — rendered HTML markup
- **Copy Rich** — styled content for Word/Google Docs
- **Copy Clean** — lightweight HTML + plain text for Slack and chat apps

### Download & Export
- **MD** — markdown source file
- **HTML** — standalone HTML document
- **PDF** — professional PDF via jsPDF + html2canvas
- **TXT** — plain text extracted from rendered preview

### Themes
- **Light Mode** — clean default theme
- **Dark Mode** — Monokai editor theme, easy on the eyes

---

## Getting Started

LuxMark uses ES6 modules, so it needs to be served over HTTP (not `file://`).

### Option 1: Local Server

```bash
# Python 3
cd src && python -m http.server 8000

# Node.js
cd src && npx http-server

# Then open http://localhost:8000
```

### Option 2: Docker

```bash
# Build and run
docker build -t luxmark .
docker run -d -p 8080:8080 --name luxmark luxmark

# Or with Docker Compose
docker compose up -d

# Access at http://localhost:8080
```

See [docs/DOCKER.md](docs/DOCKER.md) for full deployment guide including reverse proxy, multi-arch builds, and security details.

### Option 3: GitHub Pages

1. Fork this repository
2. Enable GitHub Pages in settings, set source to `main` branch, `/src` directory
3. Access at `https://[username].github.io/luxmark`

---

## Project Structure

```
luxmark/
├── src/                          # Web application
│   ├── index.html                # Main application entry
│   ├── css/styles.css            # All styling (vanilla CSS)
│   ├── js/
│   │   ├── app.js                # Main controller
│   │   ├── editor.js             # CodeMirror wrapper
│   │   ├── markdown-parser.js    # Marked.js configuration
│   │   └── storage.js            # localStorage manager
│   ├── images/                   # App images
│   ├── favicon.ico
│   └── welcome-to-luxmark.md     # Welcome document for new users
├── docker/                       # Nginx configurations
│   ├── nginx.conf                # Server block config
│   └── nginx-main.conf           # Main nginx config
├── docs/                         # Documentation
│   └── DOCKER.md                 # Docker deployment guide
├── Dockerfile
├── compose.yml
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Tech Stack

| Component | Library |
|-----------|---------|
| Editor | CodeMirror 5 |
| Markdown Parser | Marked.js + marked-footnote |
| Syntax Highlighting | Highlight.js |
| Math Rendering | KaTeX |
| PDF Export | jsPDF + html2canvas |
| Framework | Vanilla JavaScript (ES6 modules) |
| Styling | Custom CSS with CSS variables |

All dependencies are loaded via CDN — no npm, no node_modules, no build step.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Credits

LuxMark was inspired by [Dillinger](https://github.com/joemccann/dillinger) by Joe McCann. The codebase has been completely rewritten from scratch using modern JavaScript modules and simplified architecture.

Thanks to the teams behind [Marked.js](https://github.com/markedjs/marked), [CodeMirror](https://codemirror.net/), [KaTeX](https://katex.org/), and [Highlight.js](https://highlightjs.org/).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <p><strong>Built by <a href="https://www.luxardolabs.com/">Luxardo Labs</a></strong></p>
  <p><a href="https://github.com/luxardolabs/luxmark">GitHub</a></p>
</div>
