# Contributing to LuxMark

Thanks for your interest in contributing to LuxMark! Here's how to get started.

## Development Setup

1. Clone the repository
2. Serve the `src/` directory with any HTTP server:
   ```bash
   cd src && python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your browser

Or use Docker:
```bash
docker build -t luxmark .
docker run --rm -d -p 8080:8080 --name luxmark luxmark
# Access at http://localhost:8080
```

## Guidelines

### Keep It Simple

LuxMark's core philosophy is zero build tools. Please:

- **No npm dependencies for the app itself** — CDN only for browser libraries
- **No build steps** — vanilla JavaScript, vanilla CSS
- **No frameworks** — ES6 modules and standard DOM APIs
- Test in multiple browsers (Chrome, Firefox, Safari)

### Code Style

- ES6+ JavaScript with modules
- Vanilla CSS with CSS variables for theming
- Consistent with existing code patterns

### Making Changes

1. Fork the repository
2. Create a branch for your change
3. Make your changes in `src/` (app code), `docker/` (nginx config), or `docs/` (documentation)
4. Test locally — both with a local server and with Docker if you changed the Dockerfile or nginx configs
5. Submit a pull request with a clear description of what you changed and why

### What We're Looking For

- Bug fixes
- New markdown features or export options
- Accessibility improvements
- Performance improvements
- Documentation improvements
- Browser compatibility fixes

### What to Avoid

- Adding build tools (webpack, Vite, etc.)
- Adding npm runtime dependencies
- Large framework additions
- Changes that break the "just open it in a browser" experience

## Reporting Bugs

Open a [GitHub issue](https://github.com/luxardolabs/luxmark/issues) with:

- What you expected to happen
- What actually happened
- Browser and OS version
- Steps to reproduce

## Questions?

Open an issue or reach out at [luxardolabs.com](https://www.luxardolabs.com/).
