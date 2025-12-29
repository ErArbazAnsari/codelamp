const vscode = require("vscode");
const { llm } = require("../services/gemini");

/**
 * Handler for chat message processing
 */
class MessageHandler {
    #view;
    #conversationHandler;

    constructor(view, conversationHandler) {
        this.#view = view;
        this.#conversationHandler = conversationHandler;
    }

    /**
     * Handle incoming chat message
     */
    async handle(message, provider, apiKey) {
        if (!apiKey) {
            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: "Please set your API Key in settings first.",
                sender: "system",
            });
            return;
        }

        try {
            // Get current session messages
            const history = this.#conversationHandler.getCurrentSession();

            // Get workspace path
            const workspacePath =
                vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;

            let response;
            if (provider === "gemini") {
                let isFirstChunk = true;

                // Use streaming callback
                response = await llm(
                    message,
                    history,
                    apiKey,
                    workspacePath,
                    (chunk) => {
                        // Send streamStart only once before first chunk
                        if (isFirstChunk) {
                            this.#view?.webview.postMessage({
                                command: "streamStart",
                            });
                            isFirstChunk = false;
                        }

                        // Send each chunk to webview
                        this.#view?.webview.postMessage({
                            command: "streamChunk",
                            chunk: chunk,
                        });
                    }
                );

                // Send stream complete signal
                this.#view?.webview.postMessage({
                    command: "streamComplete",
                });
            } else if (provider === "openai") {
                response = "OpenAI integration coming soon...";
            } else {
                response = "Unknown provider";
            }

            // Add to current session FIRST
            this.#conversationHandler.addToCurrentSession(message, response);

            // Then save to history
            await this.#conversationHandler.addToHistory(
                provider,
                message,
                response
            );
        } catch (error) {
            console.error("Chat message error:", {
                message: error.message,
                stack: error.stack,
                provider: provider,
            });

            let errorMessage = error.message;
            if (error.message.includes("fetch failed")) {
                errorMessage =
                    "Network error: Failed to connect to Gemini API. Please check your internet connection.";
            } else if (error.message.includes("API key")) {
                errorMessage =
                    "API Key error: Please verify your API key is valid.";
            }

            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: `Error: ${errorMessage}`,
                sender: "system",
            });
        }
    }
}

module.exports = { MessageHandler };
