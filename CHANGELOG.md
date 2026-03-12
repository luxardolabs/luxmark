# Changelog

## [1.0.5] - 2026-03-12

### Added
- **Preview Width Selector** — toggle between Wide (1200px) and Full width in the toolbar, persisted to localStorage
- **Copy Clean Button** — copies rendered content as lightweight HTML + plain text, ideal for pasting into Slack and chat apps
- **Download TXT** — exports the rendered preview as a plain text file
- **GitHub Publishing** — tooling for publishing source to GitHub via API

### Changed
- **Preview Default Width** — increased from 800px to 1200px with smooth CSS transition
- **Project Structure** — reorganized into `src/`, `docker/`, `docs/` directories
- **Documentation** — consolidated Docker docs, added CONTRIBUTING.md, updated README with current features and project structure
- **Welcome Document** — updated Luxardo Labs and GitHub links

### Fixed
- **Width Selector Styling** — CSS now applies consistent toolbar styling to both width and font selectors

## [1.0.3] - 2025-10-09

### Added
- **Copy Rich Text Button** — copies formatted content with styles intact for pasting into Word/Google Docs
- **Font Selector** — dropdown menu in toolbar to change preview pane font (Poppins, Georgia, Times New Roman, Arial, Courier New, Verdana, Trebuchet MS, Palatino)
- **Font Persistence** — selected font is saved to localStorage and restored on page reload
- **Markdown Syntax Highlighting** — added Highlight.js markdown language module for syntax highlighting in ` ```markdown ` code blocks
- **Google Fonts Integration** — added Poppins font family via Google Fonts CDN

### Fixed
- **Currency Value Rendering** — fixed issue where currency values like `$100M`, `$500K+`, `$2.5B` were incorrectly processed as LaTeX math expressions
  - Updated regex pattern to exclude `<` character, preventing matches across HTML tags
  - Enhanced currency detection to support K/M/B suffixes and +/- symbols
  - Improved text vs. math detection logic to skip non-LaTeX content
- **Docker Network Creation** — added automatic creation of `luxardolabs` network in `make deploy-local` target

### Changed
- **Content Security Policy** — updated CSP headers to allow Google Fonts resources (`fonts.googleapis.com`, `fonts.gstatic.com`)
- **Welcome Document** — enhanced with new examples:
  - Markdown-in-code-blocks example demonstrating syntax highlighting
  - Currency edge cases showing the `$100M`, `$500K+` fix
  - Documentation of Copy Rich feature
  - Font selector usage instructions

## [1.0.2] - 2025-09-15

### Added
- **PDF Export** — export rendered markdown as PDF via jsPDF + html2canvas
- **Dark Mode** — toggle between light and dark themes with Monokai editor theme
- **Auto-Save** — content saves to localStorage every 30 seconds

## [1.0.1] - 2025-08-20

### Added
- **Resizable Panes** — drag divider to adjust editor/preview ratio
- **Keyboard Shortcuts** — `Ctrl/Cmd+B` for bold, `Ctrl/Cmd+I` for italic
- **Document Statistics** — word count, character count, line count

## [1.0.0] - 2025-08-01

### Added
- Initial release
- Live markdown preview with Marked.js
- CodeMirror editor with markdown mode
- GitHub Flavored Markdown support
- KaTeX math rendering
- Footnote support via marked-footnote
- Syntax highlighting via Highlight.js
- Copy as Markdown and HTML
- Download as MD and HTML
- Welcome document for new users
- localStorage persistence
