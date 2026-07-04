// Markdown Parser Module
export class MarkdownParser {
    constructor() {
        this.setupMarked();
    }

    setupMarked() {
        // Create a new instance of Marked with extensions
        const markedInstance = new marked.Marked();
        
        // Configure GFM settings
        markedInstance.use({
            gfm: true,
            breaks: true,
            headerIds: true,
            mangle: false
        });
        
        // Add footnote support if available
        if (window.markedFootnote) {
            markedInstance.use(window.markedFootnote());
        }

        // Configure syntax highlighting
        markedInstance.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (e) {
                        console.error('Highlight error:', e);
                    }
                }
                return hljs.highlightAuto(code).value;
            }
        });
        
        // Store the instance
        this.marked = markedInstance;
    }

    parse(markdown) {
        // Let marked handle the markdown parsing
        let html = this.marked.parse(markdown);
        
        // Only post-process for math rendering (KaTeX)
        html = this.renderMath(html);
        
        return html;
    }

    renderMath(html) {
        // Protect code blocks from math processing
        const codeBlocks = [];
        let codeIndex = 0;
        
        // Store code blocks temporarily
        html = html.replace(/(<pre[\s\S]*?<\/pre>|<code[^>]*>[\s\S]*?<\/code>)/g, (match) => {
            codeBlocks[codeIndex] = match;
            return `<!--CODE_BLOCK_${codeIndex++}-->`;
        });
        
        // Handle block math with $$ delimiters
        html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
            try {
                return katex.renderToString(math.trim(), { 
                    displayMode: true, 
                    throwOnError: false 
                });
            } catch (e) {
                console.error('Math rendering error:', e);
                return `<div class="math-error">Math error: ${e.message}</div>`;
            }
        });
        
        // First, protect currency amounts from being treated as math
        // This handles ranges like $185k-$190k or ~$175k-$185k by temporarily replacing them
        const currencyRanges = [];
        let currencyIndex = 0;
        // Match currency ranges with optional preceding characters like ~, ≈, etc.
        // Allow HTML elements between the amounts (like <br> tags)
        html = html.replace(/[~≈]?\s*\$\d+\.?\d*[KMB]?\s*[-+](?:<[^>]+>)?\s*\$\d+\.?\d*[KMB]?/gi, (match) => {
            currencyRanges[currencyIndex] = match;
            return `<!--CURRENCY_RANGE_${currencyIndex++}-->`;
        });

        // Inline math - be careful to avoid single $
        // Use a more restrictive pattern that doesn't cross HTML tags or line breaks
        html = html.replace(/\$([^\$<]+?)\$/g, (match, math) => {
            const trimmed = math.trim();

            // Skip if it looks like currency (e.g., $5, $10.99, $100M, $500K+)
            if (/^\d+\.?\d*[KMB]?[+\-]?$/i.test(trimmed)) {
                return match;
            }

            // Skip if it starts with a number followed by k/m/b and a hyphen (incomplete range)
            // This catches patterns like "175k-" which are likely currency ranges
            if (/^\d+\.?\d*[KMB]?\s*[-+]/.test(trimmed)) {
                return match;
            }

            // Skip if it starts with a number (likely currency like "$150k from...")
            if (/^\d/.test(trimmed)) {
                return match;
            }

            // Skip if it's simple text without LaTeX commands or math symbols
            if (!/[\\^_{}]|\\[a-zA-Z]+/.test(trimmed)) {
                // Check if it contains math-like operators in a math context
                const hasMathOperators = /[+\-*/=<>]/.test(trimmed);
                const hasLettersOrSpaces = /[a-zA-Z\s]/.test(trimmed);
                // If it has letters/spaces but no LaTeX, probably not math
                if (hasLettersOrSpaces && !hasMathOperators) {
                    return match;
                }
            }
            try {
                return katex.renderToString(math.trim(), {
                    displayMode: false,
                    throwOnError: false
                });
            } catch (e) {
                console.error('Math rendering error:', e);
                return `<code>${match}</code>`;
            }
        });
        
        // Restore code blocks
        html = html.replace(/<!--CODE_BLOCK_(\d+)-->/g, (match, index) => {
            return codeBlocks[index];
        });

        // Restore currency ranges
        html = html.replace(/<!--CURRENCY_RANGE_(\d+)-->/g, (match, index) => {
            return currencyRanges[index];
        });

        return html;
    }
}