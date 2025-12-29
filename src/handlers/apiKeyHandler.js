const vscode = require("vscode");

/**
 * Handler for API Key operations
 */
class ApiKeyHandler {
    #context;
    #view;

    constructor(context, view) {
        this.#context = context;
        this.#view = view;
    }

    /**
     * Save API key to secure storage
     */
    async save(apiKey, provider) {
        try {
            await this.#context.secrets.store(
                `codelamp_${provider}_key`,
                apiKey
            );
            const isDeleted = apiKey === "";
            this.#view?.webview.postMessage({
                command: "apiKeySaved",
                success: true,
                isDeleted: isDeleted,
                provider: provider,
            });
            if (isDeleted) {
                vscode.window.showInformationMessage(
                    `CodeLamp: ${provider} API Key deleted successfully!`
                );
            } else {
                vscode.window.showInformationMessage(
                    `CodeLamp: ${provider} API Key saved.`
                );
            }
        } catch {
            vscode.window.showErrorMessage("Error saving API key.");
        }
    }

    /**
     * Delete API key from secure storage
     */
    async delete(provider) {
        try {
            await this.#context.secrets.delete(`codelamp_${provider}_key`);
            this.#view?.webview.postMessage({
                command: "apiKeyDeleted",
                success: true,
                provider: provider,
            });
            vscode.window.showInformationMessage(
                `CodeLamp: ${provider} API Key deleted.`
            );
        } catch {
            vscode.window.showErrorMessage("Error deleting API key.");
        }
    }

    /**
     * Retrieve and send API keys to webview
     */
    async sendToWebview() {
        const geminiKey = await this.#context.secrets.get(
            "codelamp_gemini_key"
        );
        const openaiKey = await this.#context.secrets.get(
            "codelamp_openai_key"
        );
        this.#view?.webview.postMessage({
            command: "apiKeyResponse",
            geminiKey: geminiKey,
            openaiKey: openaiKey,
        });
    }

    /**
     * Get API key for a specific provider
     */
    async get(provider) {
        return await this.#context.secrets.get(`codelamp_${provider}_key`);
    }
}

module.exports = { ApiKeyHandler };
