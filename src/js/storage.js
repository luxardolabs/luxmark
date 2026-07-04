// Storage Module
export class Storage {
    constructor() {
        this.storageKey = 'markdown-editor-content';
        this.settingsKey = 'markdown-editor-settings';
    }

    // Content storage
    saveContent(content) {
        try {
            localStorage.setItem(this.storageKey, content);
            return true;
        } catch (e) {
            console.error('Failed to save content:', e);
            return false;
        }
    }

    loadContent() {
        try {
            return localStorage.getItem(this.storageKey) || null;
        } catch (e) {
            console.error('Failed to load content:', e);
            return null;
        }
    }

    clearContent() {
        try {
            localStorage.removeItem(this.storageKey);
            return true;
        } catch (e) {
            console.error('Failed to clear content:', e);
            return false;
        }
    }

    // Settings storage
    saveSettings(settings) {
        try {
            localStorage.setItem(this.settingsKey, JSON.stringify(settings));
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            return false;
        }
    }

    loadSettings() {
        try {
            const settings = localStorage.getItem(this.settingsKey);
            return settings ? JSON.parse(settings) : null;
        } catch (e) {
            console.error('Failed to load settings:', e);
            return null;
        }
    }

    // Export functions
    exportAsMarkdown(content, filename = 'document.md') {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        this.downloadBlob(blob, filename);
    }

    exportAsHTML(html, styles, filename = 'document.html') {
        const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${filename.replace('.html', '')}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 40px auto;
            padding: 0 20px;
        }
        pre {
            background: #f5f5f5;
            padding: 1em;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f5f5f5;
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        pre code {
            background: none;
            padding: 0;
        }
        blockquote {
            border-left: 4px solid #ddd;
            padding-left: 1em;
            color: #666;
            margin: 1em 0;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 0.5em;
            text-align: left;
        }
        th {
            background: #f5f5f5;
            font-weight: 600;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        a {
            color: #3498db;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .task-list-item {
            list-style: none;
        }
        .footnotes {
            font-size: 0.9em;
            border-top: 1px solid #ddd;
            margin-top: 2em;
            padding-top: 1em;
        }
        ${styles || ''}
    </style>
</head>
<body>
    <article class="markdown-body">
        ${html}
    </article>
</body>
</html>`;
        
        const blob = new Blob([fullHTML], { type: 'text/html;charset=utf-8' });
        this.downloadBlob(blob, filename);
    }

    async exportAsPDF(element, filename = 'document.pdf') {
        try {
            // Use jsPDF with html2canvas
            const { jsPDF } = window.jspdf;
            
            // Clone the element to avoid modifying the original
            const clone = element.cloneNode(true);
            clone.style.width = '800px';
            clone.style.padding = '20px';
            clone.style.background = 'white';
            
            // Temporarily add to body for rendering
            document.body.appendChild(clone);
            
            const canvas = await html2canvas(clone, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff'
            });
            
            // Remove clone
            document.body.removeChild(clone);
            
            // Calculate dimensions
            const imgWidth = 210; // A4 width in mm
            const pageHeight = 297; // A4 height in mm
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;
            
            const pdf = new jsPDF('p', 'mm', 'a4');
            let position = 0;
            
            // Add first page
            pdf.addImage(
                canvas.toDataURL('image/png'),
                'PNG',
                0,
                position,
                imgWidth,
                imgHeight
            );
            
            heightLeft -= pageHeight;
            
            // Add additional pages if needed
            while (heightLeft > 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(
                    canvas.toDataURL('image/png'),
                    'PNG',
                    0,
                    position,
                    imgWidth,
                    imgHeight
                );
                heightLeft -= pageHeight;
            }
            
            pdf.save(filename);
            return true;
        } catch (error) {
            console.error('PDF export failed:', error);
            return false;
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}