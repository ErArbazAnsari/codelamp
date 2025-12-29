const vscode = require("vscode");
const { getNonce } = require("./getNonce");
const { ApiKeyHandler } = require("../handlers/apiKeyHandler");
const { ConversationHandler } = require("../handlers/conversationHandler");
const { MessageHandler } = require("../handlers/messageHandler");
const { WebviewResourceLoader } = require("./webviewResourceLoader");

/**
 * Sidebar provider for CodeLamp webview
 */
class SidebarProvider {
    #view;
    #extensionUri;
    #context;
    #apiKeyHandler;
    #conversationHandler;
    #messageHandler;

    constructor(extensionUri, context) {
        this.#extensionUri = extensionUri;
        this.#context = context;
    }

    resolveWebviewView(webviewView, _context, _token) {
        console.log("Resolving webview view...");
        this.#view = webviewView;

        // Initialize handlers
        this.#apiKeyHandler = new ApiKeyHandler(this.#context, this.#view);
        this.#conversationHandler = new ConversationHandler(
            this.#context,
            this.#view
        );
        this.#messageHandler = new MessageHandler(
            this.#view,
            this.#conversationHandler
        );

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.#extensionUri],
        };

        const html = this.#getHtmlForWebview(webviewView.webview);
        webviewView.webview.html = html;

        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this.#handleMessage(data);
        });
    }

    /**
     * Handle messages from webview
     */
    async #handleMessage(data) {
        switch (data.command) {
            case "saveApiKey":
                await this.#apiKeyHandler.save(data.apiKey, data.provider);
                break;
            case "getApiKey":
                await this.#apiKeyHandler.sendToWebview();
                break;
            case "deleteApiKey":
                await this.#apiKeyHandler.delete(data.provider);
                break;
            case "sendMessage":
                const apiKey = await this.#apiKeyHandler.get(data.provider);
                await this.#messageHandler.handle(
                    data.message,
                    data.provider,
                    apiKey
                );
                break;
            case "getHistory":
                await this.#conversationHandler.sendHistoryToWebview(
                    data.provider
                );
                break;
            case "loadConversation":
                await this.#conversationHandler.load(
                    data.conversationIndex,
                    data.provider
                );
                break;
            case "newChat":
                await this.#conversationHandler.createNewBlank(data.provider);
                break;
            case "deleteConversation":
                await this.#conversationHandler.delete(
                    data.conversationIndex,
                    data.provider
                );
                break;
            case "alert":
                vscode.window.showErrorMessage(data.text);
                break;
        }
    }

    /**
     * Generate HTML for webview
     */
    #getHtmlForWebview(_webview) {
        const nonce = getNonce();
        const loader = new WebviewResourceLoader(this.#extensionUri);
        return loader.buildHtml(nonce);
    }
}

module.exports = { SidebarProvider };
