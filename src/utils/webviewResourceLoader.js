const fs = require("fs");
const path = require("path");

/**
 * Utility for loading webview resources
 */
class WebviewResourceLoader {
    #extensionUri;

    constructor(extensionUri) {
        this.#extensionUri = extensionUri;
    }

    /**
     * Load a file from the webview directory
     */
    #loadFile(relativePath) {
        try {
            const filePath = path.join(this.#extensionUri.fsPath, relativePath);
            return fs.readFileSync(filePath, "utf8");
        } catch (error) {
            console.error(`Error loading ${relativePath}:`, error);
            throw new Error(`Failed to load webview resource: ${relativePath}`);
        }
    }

    /**
     * Load HTML template
     */
    loadTemplate() {
        return this.#loadFile("src/webview/html/template.html");
    }

    /**
     * Load CSS styles
     */
    loadStyles() {
        return this.#loadFile("src/webview/css/styles.css");
    }

    /**
     * Load JavaScript
     */
    loadScript() {
        return this.#loadFile("src/webview/js/webview.js");
    }

    /**
     * Load and inject all resources into HTML template
     */
    buildHtml(nonce) {
        let html = this.loadTemplate();
        const css = this.loadStyles();
        const js = this.loadScript();

        // Replace placeholders
        html = html.replace(/\{\{NONCE\}\}/g, nonce);
        html = html.replace("{{STYLES}}", css);
        html = html.replace("{{WEBVIEW_SCRIPT}}", js);

        return html;
    }
}

module.exports = { WebviewResourceLoader };
