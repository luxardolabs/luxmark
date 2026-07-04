// Editor Module
export class Editor {
    constructor(container, onChange) {
        this.container = container;
        this.onChange = onChange;
        this.editor = null;
        this.initialize();
    }

    initialize() {
        // Get textarea
        const textarea = document.getElementById('editor-textarea');
        
        // Initialize CodeMirror
        this.editor = CodeMirror.fromTextArea(textarea, {
            mode: 'markdown',
            theme: 'default',
            lineNumbers: true,
            lineWrapping: true,
            styleActiveLine: true,
            matchBrackets: true,
            autoCloseBrackets: true,
            extraKeys: {
                'Enter': 'newlineAndIndentContinueMarkdownList',
                'Tab': (cm) => {
                    if (cm.somethingSelected()) {
                        cm.indentSelection('add');
                    } else {
                        cm.replaceSelection('    ', 'end');
                    }
                },
                'Shift-Tab': (cm) => {
                    cm.indentSelection('subtract');
                },
                'Ctrl-B': (cm) => this.toggleBold(cm),
                'Cmd-B': (cm) => this.toggleBold(cm),
                'Ctrl-I': (cm) => this.toggleItalic(cm),
                'Cmd-I': (cm) => this.toggleItalic(cm),
                'Ctrl-K': (cm) => this.insertLink(cm),
                'Cmd-K': (cm) => this.insertLink(cm),
            }
        });

        // Set up change handler after editor is initialized
        this.editor.on('change', () => {
            if (this.onChange && this.editor) {
                this.onChange(this.getValue());
            }
        });

        // Don't load default content - let app.js handle it
    }

    getValue() {
        return this.editor.getValue();
    }

    setValue(value) {
        this.editor.setValue(value);
    }

    focus() {
        this.editor.focus();
    }

    setTheme(theme) {
        this.editor.setOption('theme', theme);
    }

    // Formatting helpers
    toggleBold(cm) {
        const selection = cm.getSelection();
        if (selection) {
            cm.replaceSelection(`**${selection}**`);
        } else {
            const cursor = cm.getCursor();
            cm.replaceRange('****', cursor);
            cm.setCursor({ line: cursor.line, ch: cursor.ch + 2 });
        }
    }

    toggleItalic(cm) {
        const selection = cm.getSelection();
        if (selection) {
            cm.replaceSelection(`*${selection}*`);
        } else {
            const cursor = cm.getCursor();
            cm.replaceRange('**', cursor);
            cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
        }
    }

    insertLink(cm) {
        const selection = cm.getSelection() || 'link text';
        const url = prompt('Enter URL:', 'https://');
        if (url) {
            cm.replaceSelection(`[${selection}](${url})`);
        }
    }

    getStats() {
        const text = this.getValue();
        const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;
        const chars = text.length;
        const lines = text.split('\n').length;
        
        return { words, chars, lines };
    }
}