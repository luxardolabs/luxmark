// Main Application Module
import { Editor } from './editor.js';
import { MarkdownParser } from './markdown-parser.js';
import { Storage } from './storage.js';

class MarkdownEditorApp {
    constructor() {
        this.editor = null;
        this.parser = new MarkdownParser();
        this.storage = new Storage();
        this.previewElement = document.getElementById('preview');
        this.settings = {
            theme: 'light',
            editorTheme: 'default',
            autoSave: true,
            autoSaveInterval: 30000, // 30 seconds
            paneRatio: 0.5,
            previewFont: 'system-ui, -apple-system, sans-serif',
            previewWidth: '1200px'
        };
        
        this.initialize();
    }

    initialize() {
        // Load settings
        const savedSettings = this.storage.loadSettings();
        if (savedSettings) {
            this.settings = { ...this.settings, ...savedSettings };
        }

        // Initialize editor
        this.editor = new Editor(
            document.querySelector('.editor-pane'),
            (content) => this.handleContentChange(content)
        );

        // Setup UI
        this.setupEventListeners();
        this.setupResizer();
        this.applyTheme();
        this.applyFont();
        this.applyPreviewWidth();
        
        // Load saved content or welcome file after a brief delay
        setTimeout(() => {
            const savedContent = this.storage.loadContent();
            // Check for null or empty string
            if (savedContent && savedContent.trim() !== '') {
                this.editor.setValue(savedContent);
            } else {
                // Load welcome file for first-time users
                this.loadWelcomeFile();
            }
            
            // Initial preview update
            this.updatePreview();
            
            // Focus editor
            this.editor.focus();
        }, 100);
        
        // Start auto-save
        if (this.settings.autoSave) {
            this.startAutoSave();
        }
    }

    setupEventListeners() {
        // Toolbar buttons
        document.getElementById('btn-clear').addEventListener('click', () => this.clearContent());
        document.getElementById('btn-copy-md').addEventListener('click', () => this.copyMarkdown());
        document.getElementById('btn-copy-html').addEventListener('click', () => this.copyHTML());
        document.getElementById('btn-copy-rich').addEventListener('click', () => this.copyRichText());
        document.getElementById('btn-copy-clean').addEventListener('click', () => this.copyClean());
        document.getElementById('btn-download-md').addEventListener('click', () => this.downloadMarkdown());
        document.getElementById('btn-download-txt').addEventListener('click', () => this.downloadText());
        document.getElementById('btn-download-html').addEventListener('click', () => this.downloadHTML());
        document.getElementById('btn-download-pdf').addEventListener('click', () => this.downloadPDF());
        document.getElementById('btn-toggle-theme').addEventListener('click', () => this.toggleTheme());

        // Font selector
        document.getElementById('font-selector').addEventListener('change', (e) => this.changeFont(e.target.value));

        // Width selector
        document.getElementById('width-selector').addEventListener('change', (e) => this.changePreviewWidth(e.target.value));

        // Save before unload
        window.addEventListener('beforeunload', () => {
            this.storage.saveContent(this.editor.getValue());
            this.storage.saveSettings(this.settings);
        });
    }

    setupResizer() {
        const resizer = document.getElementById('resizer');
        const container = document.querySelector('.container');
        const editorPane = document.querySelector('.editor-pane');
        const previewPane = document.querySelector('.preview-pane');
        
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = editorPane.offsetWidth;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const width = startWidth + (e.clientX - startX);
            const containerWidth = container.offsetWidth;
            const ratio = width / containerWidth;
            
            // Limit between 20% and 80%
            if (ratio >= 0.2 && ratio <= 0.8) {
                editorPane.style.flex = `0 0 ${width}px`;
                previewPane.style.flex = '1';
                this.settings.paneRatio = ratio;
            }
        });
        
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
        });
        
        // Apply saved ratio
        if (this.settings.paneRatio !== 0.5) {
            const containerWidth = container.offsetWidth;
            const width = containerWidth * this.settings.paneRatio;
            editorPane.style.flex = `0 0 ${width}px`;
            previewPane.style.flex = '1';
        }
    }

    handleContentChange(content) {
        this.updatePreview();
        this.updateStats();
        
        // Save to localStorage
        if (this.settings.autoSave) {
            this.storage.saveContent(content);
        }
    }

    updatePreview() {
        if (!this.editor || !this.editor.editor) {
            return; // Editor not ready yet
        }
        
        const markdown = this.editor.getValue();
        const html = this.parser.parse(markdown);
        this.previewElement.innerHTML = html;
        
        // Re-run syntax highlighting for dynamically added code blocks
        this.previewElement.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    updateStats() {
        if (!this.editor || !this.editor.editor) {
            return; // Editor not ready yet
        }
        
        const stats = this.editor.getStats();
        document.getElementById('word-count').textContent = `${stats.words} words`;
        document.getElementById('char-count').textContent = `${stats.chars} characters`;
        document.getElementById('line-count').textContent = `${stats.lines} line${stats.lines !== 1 ? 's' : ''}`;
    }

    clearContent() {
        if (confirm('Clear all content? This cannot be undone.')) {
            this.editor.setValue('');
            this.storage.clearContent();
            this.showNotification('Content cleared');
        }
    }

    async copyMarkdown() {
        const content = this.editor.getValue();
        try {
            await navigator.clipboard.writeText(content);
            this.showNotification('Markdown copied to clipboard!');
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = content;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                this.showNotification('Markdown copied to clipboard!');
            } catch (err) {
                this.showNotification('Failed to copy', 'error');
            }
            
            document.body.removeChild(textarea);
        }
    }

    async copyHTML() {
        const html = this.previewElement.innerHTML;
        try {
            await navigator.clipboard.writeText(html);
            this.showNotification('HTML copied to clipboard!');
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = html;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();

            try {
                document.execCommand('copy');
                this.showNotification('HTML copied to clipboard!');
            } catch (err) {
                this.showNotification('Failed to copy', 'error');
            }

            document.body.removeChild(textarea);
        }
    }

    async copyRichText() {
        try {
            const html = this.previewElement.innerHTML;
            const blob = new Blob([html], { type: 'text/html' });
            const clipboardItem = new ClipboardItem({
                'text/html': blob
            });
            await navigator.clipboard.write([clipboardItem]);
            this.showNotification('Rich text copied! Paste into Word/Google Docs.');
        } catch (err) {
            // Fallback: select and copy the preview content
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(this.previewElement);
            selection.removeAllRanges();
            selection.addRange(range);

            try {
                document.execCommand('copy');
                selection.removeAllRanges();
                this.showNotification('Rich text copied! Paste into Word/Google Docs.');
            } catch (err) {
                selection.removeAllRanges();
                this.showNotification('Failed to copy', 'error');
            }
        }
    }

    async copyClean() {
        try {
            const html = this.previewElement.innerHTML;
            const plainText = this.previewElement.innerText;
            const htmlBlob = new Blob([html], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            const clipboardItem = new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob
            });
            await navigator.clipboard.write([clipboardItem]);
            this.showNotification('Clean copy! Paste into Slack, chat apps, etc.');
        } catch (err) {
            // Fallback: use the browser's native selection copy
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(this.previewElement);
            selection.removeAllRanges();
            selection.addRange(range);
            try {
                document.execCommand('copy');
                selection.removeAllRanges();
                this.showNotification('Clean copy! Paste into Slack, chat apps, etc.');
            } catch (err) {
                selection.removeAllRanges();
                this.showNotification('Failed to copy', 'error');
            }
        }
    }

    downloadMarkdown() {
        const content = this.editor.getValue();
        const filename = prompt('Enter filename:', 'document.md');
        if (filename) {
            this.storage.exportAsMarkdown(content, filename.endsWith('.md') ? filename : filename + '.md');
            this.showNotification('Markdown downloaded');
        }
    }

    downloadText() {
        const text = this.previewElement.innerText;
        const filename = prompt('Enter filename:', 'document.txt');
        if (filename) {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            this.storage.downloadBlob(blob, filename.endsWith('.txt') ? filename : filename + '.txt');
            this.showNotification('Text downloaded');
        }
    }

    downloadHTML() {
        const html = this.previewElement.innerHTML;
        const filename = prompt('Enter filename:', 'document.html');
        if (filename) {
            this.storage.exportAsHTML(html, null, filename.endsWith('.html') ? filename : filename + '.html');
            this.showNotification('HTML downloaded');
        }
    }

    async downloadPDF() {
        this.showNotification('Generating PDF...');
        const filename = prompt('Enter filename:', 'document.pdf');
        if (filename) {
            const success = await this.storage.exportAsPDF(
                this.previewElement,
                filename.endsWith('.pdf') ? filename : filename + '.pdf'
            );
            if (success) {
                this.showNotification('PDF downloaded');
            } else {
                this.showNotification('PDF export failed', 'error');
            }
        }
    }

    toggleTheme() {
        const isDark = document.body.classList.toggle('dark-theme');
        this.settings.theme = isDark ? 'dark' : 'light';
        this.settings.editorTheme = isDark ? 'monokai' : 'default';
        this.editor.setTheme(this.settings.editorTheme);
        this.storage.saveSettings(this.settings);
    }

    applyTheme() {
        if (this.settings.theme === 'dark') {
            document.body.classList.add('dark-theme');
            this.editor.setTheme(this.settings.editorTheme);
        }
    }

    applyPreviewWidth() {
        this.previewElement.style.maxWidth = this.settings.previewWidth;
        const widthSelector = document.getElementById('width-selector');
        widthSelector.value = this.settings.previewWidth;
    }

    changePreviewWidth(width) {
        this.settings.previewWidth = width;
        this.previewElement.style.maxWidth = width;
        this.storage.saveSettings(this.settings);
        this.showNotification('Preview width changed!');
    }

    applyFont() {
        this.previewElement.style.fontFamily = this.settings.previewFont;
        // Update the font selector to match saved setting
        const fontSelector = document.getElementById('font-selector');
        fontSelector.value = this.settings.previewFont;
    }

    changeFont(fontFamily) {
        this.settings.previewFont = fontFamily;
        this.previewElement.style.fontFamily = fontFamily;
        this.storage.saveSettings(this.settings);
        this.showNotification('Font changed!');
    }

    startAutoSave() {
        setInterval(() => {
            this.storage.saveContent(this.editor.getValue());
        }, this.settings.autoSaveInterval);
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
    
    async loadWelcomeFile() {
        try {
            const response = await fetch(`welcome-to-luxmark.md?t=${Date.now()}`);
            if (response.ok) {
                const welcomeContent = await response.text();
                this.editor.setValue(welcomeContent);
            } else {
                // Fallback welcome message if file can't be loaded
                this.editor.setValue(`# Welcome to LuxMark! 🚀

Start typing your markdown here...

**Tip:** Try the buttons in the toolbar to export your work!`);
            }
        } catch (error) {
            console.error('Failed to load welcome file:', error);
            this.editor.setValue(`# Welcome to LuxMark! 🚀

Start typing your markdown here...`);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MarkdownEditorApp();
});