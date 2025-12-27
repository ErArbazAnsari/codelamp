const vscode = require("vscode");
const { getNonce } = require("./getNonce");
const { llm } = require("./services/gemini");

class SidebarProvider {
    #view;
    #extensionUri;
    #context;
    #currentSessionMessages = [];

    constructor(extensionUri, context) {
        this.#extensionUri = extensionUri;
        this.#context = context;
    }

    resolveWebviewView(webviewView, _context, _token) {
        console.log("Resolving webview view...");
        this.#view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.#extensionUri],
        };

        const html = this.#getHtmlForWebview(webviewView.webview);
        webviewView.webview.html = html;

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case "saveApiKey":
                    this.#saveApiKey(data.apiKey, data.provider);
                    break;
                case "getApiKey":
                    this.#sendApiKey();
                    break;
                case "deleteApiKey":
                    this.#deleteApiKey(data.provider);
                    break;
                case "sendMessage":
                    this.#handleChatMessage(data.message, data.provider);
                    break;
                case "getHistory":
                    this.#sendConversationHistory(data.provider);
                    break;
                case "loadConversation":
                    this.#loadConversation(
                        data.conversationIndex,
                        data.provider
                    );
                    break;
                case "newChat":
                    this.#resetSession();
                    break;
                case "deleteConversation":
                    this.#deleteConversation(
                        data.conversationIndex,
                        data.provider
                    );
                    break;
                case "alert":
                    vscode.window.showErrorMessage(data.text);
                    break;
            }
        });
    }

    async #saveApiKey(apiKey, provider) {
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

    async #deleteApiKey(provider) {
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

    async #sendApiKey() {
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

    async #handleChatMessage(message, provider) {
        const apiKey = await this.#context.secrets.get(
            `codelamp_${provider}_key`
        );

        if (!apiKey) {
            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: "Please set your API Key in settings first.",
                sender: "system",
            });
            return;
        }

        try {
            // Only send current session messages to AI (not previous sessions)
            const history = this.#currentSessionMessages || [];

            // Get workspace path
            const workspacePath =
                vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;

            let response;
            if (provider === "gemini") {
                response = await llm(message, history, apiKey, workspacePath);
            } else if (provider === "openai") {
                response = "OpenAI integration coming soon...";
            } else {
                response = "Unknown provider";
            }

            // Save to history
            await this.#addToHistory(provider, message, response);

            // Add to current session
            if (!this.#currentSessionMessages)
                this.#currentSessionMessages = [];
            this.#currentSessionMessages.push({
                role: "user",
                parts: [{ text: message }],
            });
            this.#currentSessionMessages.push({
                role: "model",
                parts: [{ text: response }],
            });

            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: response,
                sender: "assistant",
            });
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

    async #getConversationHistory(provider) {
        try {
            const historyJson = await this.#context.globalState.get(
                `codelamp_${provider}_history`
            );
            return historyJson ? JSON.parse(historyJson) : [];
        } catch {
            return [];
        }
    }

    async #addToHistory(provider, userMessage, assistantMessage) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];

            // If this is a new session (no current session messages), create a new conversation
            if (this.#currentSessionMessages.length === 0) {
                conversations.push({
                    messages: [
                        {
                            role: "user",
                            content: userMessage,
                        },
                        {
                            role: "model",
                            content: assistantMessage,
                        },
                    ],
                    timestamp: new Date().toISOString(),
                });
            } else {
                // Add to existing conversation
                const lastConversation =
                    conversations[conversations.length - 1];
                if (lastConversation) {
                    lastConversation.messages.push({
                        role: "user",
                        content: userMessage,
                    });
                    lastConversation.messages.push({
                        role: "model",
                        content: assistantMessage,
                    });
                    lastConversation.timestamp = new Date().toISOString();
                }
            }

            // Keep only last 20 conversations
            const trimmedConversations = conversations.slice(-20);
            await this.#context.globalState.update(
                `codelamp_${provider}_conversations`,
                JSON.stringify(trimmedConversations)
            );
        } catch (error) {
            console.error("Error saving to history:", error);
        }
    }

    async #sendConversationHistory(provider) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const allConversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];

            // Reverse for display (most recent first)
            const reversedConversations = allConversations.slice().reverse();

            // Format conversations for display with correct indices
            const conversations = reversedConversations.map(
                (conv, displayIndex) => {
                    const firstUserMessage = conv.messages.find(
                        (m) => m.role === "user"
                    );
                    // Handle both old (content) and new (parts) formats
                    const messageText =
                        firstUserMessage?.content ||
                        (firstUserMessage?.parts &&
                            firstUserMessage.parts[0]?.text) ||
                        "";
                    const preview =
                        messageText.substring(0, 40) +
                        (messageText.length > 40 ? "..." : "");
                    return {
                        index: displayIndex,
                        preview: preview,
                        timestamp: conv.timestamp,
                        messages: conv.messages,
                        originalIndex:
                            allConversations.length - 1 - displayIndex,
                    };
                }
            );

            this.#view?.webview.postMessage({
                command: "historyResponse",
                conversations: conversations,
                provider: provider,
            });
        } catch (error) {
            console.error("Error sending conversation history:", error);
            this.#view?.webview.postMessage({
                command: "historyResponse",
                conversations: [],
                provider: provider,
            });
        }
    }

    async #loadConversation(index, provider) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];
            const originalIndex = conversations.length - 1 - index; // Convert display index to original array index

            // Load the conversation
            if (conversations[originalIndex]) {
                const conversation = conversations[originalIndex];

                // Normalize messages format (convert old content format to new parts format if needed)
                const normalizedMessages = conversation.messages.map((msg) => {
                    if (msg.parts) {
                        return msg;
                    } else if (msg.content) {
                        return {
                            role: msg.role,
                            parts: [{ text: msg.content }],
                        };
                    }
                    return msg;
                });

                // Set session messages to loaded conversation
                this.#currentSessionMessages = normalizedMessages;

                this.#view?.webview.postMessage({
                    command: "conversationLoaded",
                    messages: normalizedMessages,
                });
            }
        } catch (error) {
            console.error("Error loading conversation:", error);
        }
    }

    async #deleteConversation(index, provider) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];
            const originalIndex = conversations.length - 1 - index; // Convert display index to original array index

            // Remove the conversation
            if (conversations[originalIndex] !== undefined) {
                conversations.splice(originalIndex, 1);

                // Update globalState
                await this.#context.globalState.update(
                    `codelamp_${provider}_conversations`,
                    JSON.stringify(conversations)
                );

                // Clear the current chat session
                this.#currentSessionMessages = [];
                this.#view?.webview.postMessage({
                    command: "clearChat",
                });

                // Send updated history to webview
                this.#sendConversationHistory(provider);
                vscode.window.showInformationMessage(
                    "Conversation deleted successfully."
                );
            }
        } catch (error) {
            console.error("Error deleting conversation:", error);
            vscode.window.showErrorMessage("Error deleting conversation.");
        }
    }

    #resetSession() {
        this.#currentSessionMessages = [];
    }

    #getHtmlForWebview(_webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; script-src 'nonce-${nonce}' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; font-src https: data:;">
    <title>Code Lamp</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/lib/highlight.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/atom-one-dark.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        
        input, select, textarea {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-family: inherit;
            font-size: inherit;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        
        input:focus, select:focus, textarea:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        textarea {
            line-height: 1.5;
            padding: 11px 13px;
            max-height: 120px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
            border-radius: 8px;
            resize: none;
            font-size: inherit;
            border: 1px solid transparent;
            transition: all 0.2s ease;
        }
        
        textarea:hover {
            border-color: var(--vscode-input-border);
        }
        
        textarea:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid transparent;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: inherit;
            font-size: inherit;
            font-weight: 500;
            user-select: none;
        }
        
        button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        #sendBtn {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            padding: 11px 13px;
            min-width: 44px;
            min-height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            border: 1px solid transparent;
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            cursor: pointer;
            font-size: 16px;
            color: var(--vscode-button-foreground);
        }
        
        #sendBtn:hover:not(:disabled) {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            transform: translateY(-1px);
        }
        
        #sendBtn:active:not(:disabled) {
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
            transform: translateY(0);
        }
        
        #sendBtn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        button:active:not(:disabled) {
            transform: translateY(0);
            opacity: 0.9;
        }

        button:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Message Container Styles */
        .message-wrapper {
            display: flex;
            margin-bottom: 6px;
            gap: 6px;
            animation: slideIn 0.3s ease;
            width: 100%;
            min-width: 0;
        }

        .message-wrapper.user {
            flex-direction: row-reverse;
            justify-content: flex-start;
        }

        .message-wrapper.assistant {
            flex-direction: row;
        }

        .message-avatar {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            flex-shrink: 0;
            margin-top: 1px;
        }

        .message-wrapper.user .message-avatar {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .message-wrapper.assistant .message-avatar {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-editor-foreground);
        }

        .message-content {
            display: flex;
            flex-direction: column;
            max-width: 100%;
            width: 100%;
            gap: 0;
            word-break: break-word;
            overflow: hidden;
        }

        .message-wrapper.user .message-content {
            align-items: flex-end;
        }

        .message-wrapper.assistant .message-content {
            align-items: flex-start;
        }
        
        .message-user {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            border-radius: 10px;
            padding: 10px 12px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: pre-wrap;
            line-height: 1.4;
            font-size: 0.93rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
            overflow: hidden;
        }
        

        .message-assistant {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 10px;
            padding: 10px 12px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: normal;
            line-height: 1.5;
            font-size: 0.93rem;
            overflow: hidden;
        }
        
        .message-assistant:hover {
            border-color: var(--vscode-focusBorder);
            background-color: var(--vscode-editor-background);
        }
        
        .message-assistant pre {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px;
            margin: 8px 0;
            overflow-x: hidden;
            overflow-wrap: break-word;
            word-wrap: break-word;
            white-space: pre-wrap;
            max-width: 100%;
        }
        
        .message-assistant code {
            font-family: 'Courier New', 'Monaco', 'Consolas', monospace;
            font-size: 0.85rem;
            line-height: 1.5;
        }
        
        .message-assistant pre code {
            background-color: transparent;
            border: none;
            padding: 0;
            color: inherit;
        }
        
        .message-system {
            font-size: 0.85rem;
            opacity: 0.7;
            padding: 8px 12px;
            margin: 4px 0;
            color: var(--vscode-editor-foreground);
        }

        .message-system.thinking {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .thinking-dots {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .thinking-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: currentColor;
            opacity: 0.6;
            animation: thinking-bounce 1.4s infinite ease-in-out;
        }

        .thinking-dot:nth-child(1) {
            animation-delay: 0s;
        }

        .thinking-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .thinking-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes thinking-bounce {
            0%, 60%, 100% {
                opacity: 0.6;
                transform: translateY(0);
            }
            30% {
                opacity: 1;
                transform: translateY(-6px);
            }
        }

        .message-wrapper.system .message-avatar {
            color: var(--vscode-focusBorder);
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }

        #welcomeTemplate {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 16px;
            opacity: 0.6;
            animation: fadeIn 0.3s ease;
        }

        #welcomeTemplate .welcome-icon {
            font-size: 3rem;
        }

        #welcomeTemplate .welcome-text {
            text-align: center;
            font-size: 0.9rem;
        }

        #welcomeTemplate .welcome-title {
            font-weight: 600;
            margin-bottom: 8px;
        }

        #welcomeTemplate .welcome-subtitle {
            font-size: 0.85rem;
            max-width: 250px;
            line-height: 1.4;
        }

        @keyframes fadeIn {

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        .message-wrapper.system {
            animation: fadeIn 0.3s ease;
        }
        
        .screen-heading {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .screen-subtitle {
            opacity: 0.7;
            margin-bottom: 24px;
            font-size: 0.95rem;
        }
        
        .icon-large {
            font-size: 3rem;
            margin-bottom: 12px;
        }

        #menuSidebar {
            animation: slideInMenu 0.3s ease;
            position: fixed;
            z-index: 50;
        }

        @keyframes slideInMenu {
            from {
                transform: translateX(-100%);
            }
            to {
                transform: translateX(0);
            }
        }
    </style>
</head>
<body class="h-screen overflow-hidden">
    <!-- Loading Screen -->
    <div id="loadingScreen" class="hidden flex flex-col h-full p-6">
        <div class="flex flex-col items-center justify-center flex-1">
            <div class="mb-4">
                <div class="w-12 h-12 border-3 border-[var(--vscode-focusBorder)] border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p class="opacity-70 text-sm">Checking API Key...</p>
        </div>
    </div>

    <!-- Welcome Screen -->
    <div id="welcomeScreen" class="flex flex-col h-full p-6 bg-[var(--vscode-editor-background)]">
        <div class="flex flex-col items-center justify-center flex-1">
            <!-- Icon -->
            <div class="mb-6">
                <div class="text-6xl flex items-center justify-center"><i class="fas fa-lightbulb" style="color: #cacdd3;"></i></div>
            </div>

            <!-- Heading -->
            <div class="text-center mb-4">
                <h1 class="text-3xl font-bold mb-2">CodeLamp</h1>
                <p class="text-sm opacity-70">Your Personal AI Code Assistant</p>
            </div>

            <!-- Privacy Card -->
            <div class="w-full max-w-sm mb-10 rounded-xl border border-[var(--vscode-input-border)] bg-gradient-to-br from-[var(--vscode-input-background)] to-[var(--vscode-editor-background)] backdrop-blur-sm transition-all duration-300 hover:border-[var(--vscode-focusBorder)] hover:shadow-lg hover:shadow-gray-500/20 overflow-hidden">
                <div class="px-6 py-6 flex gap-4 items-start">
                    <!-- Icon Container -->
                    <div class="flex-shrink-0 p-3 rounded-lg bg-gradient-to-br from-gray-500/20 to-gray-600/10 flex items-center justify-center">
                        <svg class="w-7 h-7 text-gray-300" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                            <path fill-rule="evenodd" d="M4 5.78571C4 4.80909 4.78639 4 5.77778 4H18.2222C19.2136 4 20 4.80909 20 5.78571V15H4V5.78571ZM12 12c0-.5523.4477-1 1-1h2c.5523 0 1 .4477 1 1s-.4477 1-1 1h-2c-.5523 0-1-.4477-1-1ZM8.27586 6.31035c.38089-.39993 1.01387-.41537 1.4138-.03449l2.62504 2.5c.1981.18875.3103.45047.3103.72414 0 .27368-.1122.5354-.3103.7241l-2.62504 2.5c-.39993.3809-1.03291.3655-1.4138-.0344-.38088-.4-.36544-1.033.03449-1.4138L10.175 9.5 8.31035 7.72414c-.39993-.38089-.41537-1.01386-.03449-1.41379Z" clip-rule="evenodd"/>
                            <path d="M2 17v1c0 1.1046.89543 2 2 2h16c1.1046 0 2-.8954 2-2v-1H2Z"/>
                        </svg>
                    </div>

                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold mb-1.5 text-white">Privacy First</p>
                        <p class="text-xs leading-relaxed opacity-70">API keys are stored securely in VS Code's secret storage. Your data never leaves your machine.</p>
                    </div>
                </div>
            </div>

            <!-- Get Started Button -->
            <button id="getStartedBtn" class="w-full max-w-sm px-6 py-3 rounded-lg font-semibold text-sm bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] transition-colors shadow-lg hover:shadow-xl flex items-center justify-center gap-2">
                <i class="fas fa-play"></i>
                <span>Get Started</span>
            </button>

            <!-- Footer Text -->
            <p class="text-xs opacity-50 mt-8 text-center">No account needed • 100% private • Bring your on keys </p>
        </div>
    </div>

    <!-- Setup Screen -->
    <div id="setupScreen" style="display: none;" class="flex flex-col h-full p-6 bg-[var(--vscode-editor-background)]">
        <div class="flex flex-col items-center justify-center w-full flex-1">
            <!-- Header -->
            <div class="text-center mb-10 w-full max-w-sm">
                <h1 class="text-2xl font-bold mb-2">Configure API Key</h1>
                <p class="text-xs opacity-60">Enter your AI provider credentials to get started</p>
            </div>

            <!-- Form Container -->
            <div class="w-full max-w-sm">
                <!-- AI Provider Section -->
                <div class="mb-8">
                    <label class="block text-sm font-semibold mb-3 opacity-80">AI Provider</label>
                    <div class="flex items-center">
                        <select id="providerSelect" class="w-full px-4 py-2.5 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-sm focus:outline-none focus:border-[var(--vscode-focusBorder)] transition-colors">
                            <option value="gemini">Google Gemini</option>
                            <option value="openai" disabled>OpenAI (Coming Soon)</option>
                        </select>
                        <div class="ml-3 text-[#CACDD3]">
                            <i class="fas fa-robot text-lg"></i>
                        </div>
                    </div>
                </div>

                <!-- API Key Section -->
                <div class="mb-8">
                    <label class="block text-sm font-semibold mb-3 opacity-80">API Key</label>
                    <div class="relative flex items-center">
                        <input id="apiKeyInput" type="password" class="w-full px-4 py-2.5 pr-10 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-sm placeholder-opacity-40 focus:outline-none focus:border-[var(--vscode-focusBorder)] transition-colors" placeholder="Paste your API key here..." />
                        <button id="togglePasswordBtn" type="button" class="absolute right-3 opacity-50 hover:opacity-100 bg-transparent hover:bg-transparent border-0 text-sm p-0 h-5 w-5 flex items-center justify-center transition-opacity">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                    <p class="text-xs opacity-50 mt-2">Your credentials are stored securely in VS Code</p>
                </div>

                <!-- Action Buttons -->
                <div class="flex gap-3 mt-8">
                    <button id="saveKeyBtn" class="flex-1 px-4 py-2.5 rounded font-semibold text-sm bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] transition-colors flex items-center justify-center gap-2">
                        <i class="fas fa-check"></i>
                        <span>Save Key</span>
                    </button>
                    <button id="cancelSetupBtn" class="flex-1 px-4 py-2.5 rounded font-semibold text-sm bg-[var(--vscode-input-background)] hover:bg-[var(--vscode-input-border)] text-[var(--vscode-foreground)] transition-colors flex items-center justify-center gap-2">
                        <i class="fas fa-times"></i>
                        <span>Cancel</span>
                    </button>
                </div>

                <!-- Loading Spinner -->
                <div id="setupSpinner" style="display: none;" class="flex flex-col items-center justify-center gap-3 mt-8">
                    <div class="w-8 h-8 border-3 border-[var(--vscode-focusBorder)] border-t-transparent rounded-full animate-spin"></div>
                    <p class="text-xs opacity-60">Saving your API key...</p>
                </div>
            </div>
        </div>
    </div>
            </div>
        </div>
    </div>

    <!-- Chat Screen -->
    <div id="chatScreen" style="display: none;" class="flex flex-col h-full">
        <div class="px-4 py-3 border-b border-[var(--vscode-input-border)] flex justify-between items-center">
            <h2 class="text-sm font-bold uppercase tracking-wide">Chat</h2>
            <button id="menuBtn" class="bg-transparent hover:bg-transparent border-0 p-1 h-6 w-6 flex items-center justify-center text-lg" title="Menu">
                <i class="fas fa-bars"></i>
            </button>
        </div>

        <!-- Menu Overlay -->
        <div id="menuOverlay" style="display: none;" class="fixed inset-0 z-40 bg-black/30"></div>

        <!-- Menu Sidebar -->
        <div id="menuSidebar" style="display: none;" class="absolute top-0 left-0 h-full w-full bg-[var(--vscode-editor-background)] border-r border-[var(--vscode-input-border)] flex flex-col z-50 shadow-lg">
            <!-- Header -->
            <div class="px-4 py-3 border-b border-[var(--vscode-input-border)] flex justify-between items-center">
                <h3 class="text-md font-bold flex items-center gap-2">
                    <i class="fas fa-comments text-[#CACDD3]"></i>
                    <span>CONVERSATIONS</span>
                </h3>
                <button id="closeMenuBtn" class="hover:opacity-100 bg-transparent hover:bg-transparent border-0 p-1 h-6 w-6 flex items-center justify-center text-lg">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Conversations List -->
            <div id="historyList" class="flex-1 overflow-y-auto px-3 py-2 w-full"></div>

            <!-- Footer - Settings & New Chat -->
            <div class="px-3 py-3 border-t border-[var(--vscode-input-border)] flex items-center justify-between gap-2">
                <button id="menuSettingsBtn" class="px-4 py-2 text-sm font-semibold hover:opacity-100 hover:bg-opacity-20 hover:bg-white rounded transition-colors flex items-center gap-2">
                    <i class="fas fa-cog"></i>
                    <span>Settings</span>
                </button>
                <button id="newChatBtn" class="px-4 py-2 rounded text-sm font-semibold bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] transition-colors flex items-center justify-center gap-2">
                    <i class="fas fa-plus"></i>
                    New Chat
                </button>
            </div>
        </div>

        <div id="chatMessages" class="flex-1 overflow-y-auto p-3 flex flex-col gap-0">
            <div id="welcomeTemplate">
                <div class="welcome-icon"><i class="fas fa-lightbulb"></i></div>
                <div class="welcome-text">
                    <div class="welcome-title">Welcome to CodeLamp</div>
                    <div class="welcome-subtitle">Ask me anything about code, debugging, or get help with your projects</div>
                </div>
            </div>
        </div>
        <div class="px-4 py-4 border-t border-[var(--vscode-input-border)] bg-[var(--vscode-editor-background)]">
            <div class="flex gap-3 items-flex-end">
                <textarea id="messageInput" class="flex-1 text-sm resize-none px-3 py-2" rows="1" placeholder="Type your message..."></textarea>
                <button id="sendBtn" title="Send (Shift+Enter for new line)">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const loadingScreen = document.getElementById("loadingScreen");
        const welcomeScreen = document.getElementById("welcomeScreen");
        const setupScreen = document.getElementById("setupScreen");
        const chatScreen = document.getElementById("chatScreen");
        const getStartedBtn = document.getElementById("getStartedBtn");
        const cancelSetupBtn = document.getElementById("cancelSetupBtn");
        const apiKeyInput = document.getElementById("apiKeyInput");
        const togglePasswordBtn = document.getElementById("togglePasswordBtn");
        const providerSelect = document.getElementById("providerSelect");
        const saveKeyBtn = document.getElementById("saveKeyBtn");
        const messageInput = document.getElementById("messageInput");
        const sendBtn = document.getElementById("sendBtn");
        const chatMessages = document.getElementById("chatMessages");
        const setupSpinner = document.getElementById("setupSpinner");
        const menuBtn = document.getElementById("menuBtn");
        const menuOverlay = document.getElementById("menuOverlay");
        const menuSidebar = document.getElementById("menuSidebar");
        const closeMenuBtn = document.getElementById("closeMenuBtn");
        const historyList = document.getElementById("historyList");
        const newChatBtn = document.getElementById("newChatBtn");
        const menuSettingsBtn = document.getElementById("menuSettingsBtn");

        let currentProvider = "gemini";
        let passwordVisible = false;
        let isNewChatSession = true;  // Track if current chat is a new session
        let isMenuOpen = false;  // Track menu state to prevent double-click issues
        let isInitialLoad = true;  // Track if extension just started (for auto-loading last conversation)

        showScreen("loading");
        vscode.postMessage({ command: "getApiKey" });

        getStartedBtn.onclick = () => showScreen("setup");
        cancelSetupBtn.onclick = () => {
            if (chatMessages.children.length > 0) showScreen("chat");
            else showScreen("welcome");
        };
        
        // Menu handlers
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            toggleMenu();
        };
        closeMenuBtn.onclick = () => closeMenu();
        menuOverlay.onclick = () => closeMenu();
        newChatBtn.onclick = () => {
            closeMenu();
            chatMessages.innerHTML = '';
            const welcomeTemplate = document.getElementById('welcomeTemplate');
            if (welcomeTemplate) {
                welcomeTemplate.remove();
            }
            const newWelcome = document.createElement('div');
            newWelcome.id = 'welcomeTemplate';
            newWelcome.innerHTML = '<div class="welcome-icon"><i class="fas fa-lightbulb"></i></div><div class="welcome-text"><div class="welcome-title">Welcome to CodeLamp</div><div class="welcome-subtitle">Ask me anything about code, debugging, or get help with your projects</div></div>';
            newWelcome.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px; opacity: 0.6;';
            chatMessages.appendChild(newWelcome);
            isNewChatSession = true;
            vscode.postMessage({ command: "newChat" });
            messageInput.focus();
        };
        menuSettingsBtn.onclick = () => {
            closeMenu();
            showScreen("setup");
            vscode.postMessage({ command: "getApiKey" });
        };

        function toggleMenu() {
            if (isMenuOpen) {
                closeMenu();
            } else {
                menuSidebar.style.display = 'flex';
                menuOverlay.style.display = 'block';
                isMenuOpen = true;
                loadHistoryList();
            }
        }

        function closeMenu() {
            menuSidebar.style.display = 'none';
            menuOverlay.style.display = 'none';
            isMenuOpen = false;
        }

        function loadHistoryList() {
            // Request history from backend
            vscode.postMessage({ command: "getHistory", provider: currentProvider });
        }

        function renderHistoryList(conversations) {
            historyList.innerHTML = '';
            
            if (conversations.length === 0) {
                historyList.innerHTML = '<div class="w-full py-8 text-center text-sm opacity-50 flex flex-col items-center gap-2"><i class="fas fa-comments text-xl opacity-30"></i><span>No conversations yet</span></div>';
                return;
            }

            conversations.forEach((conv, index) => {
                const container = document.createElement('div');
                container.className = 'w-full mb-2 rounded-lg transition-all group relative flex items-center justify-between gap-2 overflow-visible';
                container.style.backgroundColor = 'var(--vscode-input-background)';
                container.style.border = '1px solid transparent';
                container.style.boxShadow = 'none';
                container.style.minHeight = '60px';
                
                container.addEventListener('mouseenter', () => {
                    container.style.border = '1px solid var(--vscode-focusBorder)';
                });
                container.addEventListener('mouseleave', () => {
                    container.style.border = '1px solid transparent';
                });
                
                const btn = document.createElement('button');
                btn.className = 'px-3 py-3 text-left flex-1 rounded-lg transition-all flex flex-col gap-1.5 focus:outline-none min-w-0';
                btn.style.backgroundColor = 'transparent';
                btn.style.border = 'none';
                btn.style.color = 'var(--vscode-editor-foreground)';
                btn.style.textAlign = 'left';
                const dateStr = new Date(conv.timestamp).toLocaleDateString();
                const timeStr = new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                btn.innerHTML = '<div class="truncate font-semibold text-sm leading-tight" style="color: var(--vscode-editor-foreground);">' + conv.preview + '</div><div class="text-xs" style="color: var(--vscode-editor-foreground); opacity: 0.7; display: flex; gap: 0.25rem;"><span>' + dateStr + '</span><span>•</span><span>' + timeStr + '</span></div>';
                btn.onclick = () => {
                    vscode.postMessage({ command: "loadConversation", conversationIndex: conv.index, provider: currentProvider });
                };
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'flex-shrink-0 p-2.5 text-sm transition-all rounded-md';
                deleteBtn.style.backgroundColor = 'transparent';
                deleteBtn.style.border = 'none';
                deleteBtn.style.color = 'var(--vscode-editor-foreground)';
                deleteBtn.style.opacity = '1';
                deleteBtn.style.minWidth = '40px';
                deleteBtn.style.height = '40px';
                deleteBtn.style.display = 'flex';
                deleteBtn.style.alignItems = 'center';
                deleteBtn.style.justifyContent = 'center';
                deleteBtn.style.flexShrink = '0';
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: "deleteConversation", conversationIndex: conv.index, provider: currentProvider });
                };
                
                deleteBtn.addEventListener('mouseenter', () => {
                    deleteBtn.style.color = '#ef4444';
                    deleteBtn.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                });
                deleteBtn.addEventListener('mouseleave', () => {
                    deleteBtn.style.color = 'var(--vscode-editor-foreground)';
                    deleteBtn.style.backgroundColor = 'transparent';
                });
                
                container.appendChild(btn);
                container.appendChild(deleteBtn);
                historyList.appendChild(container);
            });


        }

        function showScreen(name) {
            loadingScreen.style.display = 'none';
            welcomeScreen.style.display = 'none';
            setupScreen.style.display = 'none';
            chatScreen.style.display = 'none';
            if (name === 'loading') loadingScreen.style.display = 'flex';
            if (name === 'welcome') welcomeScreen.style.display = 'flex';
            if (name === 'setup') setupScreen.style.display = 'flex';
            if (name === 'chat') {
                chatScreen.style.display = 'flex';
                messageInput.focus();
            }
        }

        function showWelcomeTemplate() {
            const welcomeTemplate = document.getElementById('welcomeTemplate');
            if (chatMessages.children.length === 1 && welcomeTemplate) {
                welcomeTemplate.style.display = 'flex';
            }
        }

        function hideWelcomeTemplate() {
            const welcomeTemplate = document.getElementById('welcomeTemplate');
            if (welcomeTemplate) {
                welcomeTemplate.style.display = 'none';
            }
        }

        providerSelect.onchange = (e) => {
            currentProvider = e.target.value;
            apiKeyInput.value = '';
            passwordVisible = false;
            apiKeyInput.type = 'password';
            togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
            vscode.postMessage({ command: "getApiKey" });
        };

        togglePasswordBtn.onclick = (e) => {
            e.preventDefault();
            passwordVisible = !passwordVisible;
            apiKeyInput.type = passwordVisible ? 'text' : 'password';
            togglePasswordBtn.innerHTML = passwordVisible ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        };

        saveKeyBtn.onclick = () => {
            const key = apiKeyInput.value.trim();
            setupSpinner.style.display = 'flex';
            saveKeyBtn.disabled = true;
            vscode.postMessage({ command: "saveApiKey", apiKey: key, provider: currentProvider });
        };

        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text) return;
            hideWelcomeTemplate();
            addMessage(text, 'user');
            messageInput.value = "";
            messageInput.style.height = 'auto';
            sendBtn.disabled = true;
            sendBtn.style.opacity = '0.5';
            vscode.postMessage({ command: "sendMessage", message: text, provider: currentProvider });
            addMessage("Thinking...", 'system');
        }

        sendBtn.onclick = sendMessage;
        messageInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        };

        // Auto-grow textarea
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 120);
            this.style.height = newHeight + 'px';
        });

        function addMessage(text, sender) {
            // Create wrapper
            const wrapper = document.createElement("div");
            wrapper.className = 'message-wrapper ' + sender;
            
            // Create avatar
            const avatar = document.createElement("div");
            avatar.className = "message-avatar";
            if (sender === 'user') {
                avatar.innerHTML = '<i class="fas fa-user"></i>';
            } else if (sender === 'system') {
                avatar.style.display = 'none';
            } else {
                avatar.innerHTML = '<i class="fas fa-robot"></i>';
            }
            
            // Create content container
            const content = document.createElement("div");
            content.className = "message-content";
            
            // Create message div
            const div = document.createElement("div");
            if (sender === 'user') {
                div.className = "message-user";
                div.textContent = text;
            } else if (sender === 'system') {
                div.className = "message-system";
                // Check if this is a thinking message
                if (text === "Thinking...") {
                    div.classList.add('thinking');
                    
                    const dotsContainer = document.createElement('span');
                    dotsContainer.className = 'thinking-dots';
                    for (let i = 0; i < 3; i++) {
                        const dot = document.createElement('span');
                        dot.className = 'thinking-dot';
                        dotsContainer.appendChild(dot);
                    }
                    div.appendChild(dotsContainer);
                } else {
                    div.textContent = text;
                }
            } else {
                div.className = "message-assistant";
                try {
                    if (typeof marked !== 'undefined') {
                        // Configure marked for safe rendering
                        marked.setOptions({
                            breaks: true,
                            gfm: true,
                            headerIds: false
                        });
                        div.innerHTML = marked.parse(text);
                        // Highlight code blocks
                        if (typeof hljs !== 'undefined') {
                            div.querySelectorAll('pre code').forEach(block => {
                                hljs.highlightElement(block);
                            });
                        }
                    } else {
                        div.textContent = text;
                    }
                } catch (e) {
                    console.error('Markdown parsing error:', e);
                    div.textContent = text;
                }
            }
            
            content.appendChild(div);
            wrapper.appendChild(avatar);
            wrapper.appendChild(content);
            chatMessages.appendChild(wrapper);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        window.addEventListener("message", (event) => {
            const msg = event.data;
            switch (msg.command) {
                case "apiKeyResponse":
                    const savedKey = currentProvider === "gemini" ? msg.geminiKey : msg.openaiKey;
                    if (savedKey) {
                        apiKeyInput.value = savedKey;
                        apiKeyInput.type = 'password';
                        passwordVisible = false;
                        togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
                        if (setupScreen.style.display !== 'flex') {
                            // Request history to load last conversation
                            vscode.postMessage({ command: "getHistory", provider: currentProvider });
                            showScreen("chat");
                        }
                    } else {
                        if (setupScreen.style.display !== 'flex' && chatScreen.style.display !== 'flex') {
                            showScreen("welcome");
                        }
                        apiKeyInput.value = '';
                        apiKeyInput.type = 'password';
                        passwordVisible = false;
                        togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
                    }
                    break;
                case "apiKeySaved":
                    setupSpinner.style.display = 'none';
                    saveKeyBtn.disabled = false;
                    if (msg.success) {
                        if (msg.isDeleted) {
                            showScreen("welcome");
                        } else {
                            // Request history and show chat screen
                            vscode.postMessage({ command: "getHistory", provider: currentProvider });
                            showScreen("chat");
                        }
                    }
                    break;
                case "apiKeyDeleted":
                    showScreen("welcome");
                    break;
                case "messageReceived":
                    // Remove "Thinking..." message
                    const messages = chatMessages.querySelectorAll('.message-system.thinking');
                    messages.forEach(msg => msg.remove());
                    
                    addMessage(msg.message, msg.sender);
                    sendBtn.disabled = false;
                    sendBtn.style.opacity = '1';
                    messageInput.focus();
                    break;
                case "historyResponse":
                    renderHistoryList(msg.conversations);
                    // Auto-load last conversation only on initial extension load
                    if (msg.conversations && msg.conversations.length > 0 && isInitialLoad) {
                        isInitialLoad = false;  // Set to false after first load
                        const lastConversation = msg.conversations[0]; // First item is most recent (reversed in backend)
                        vscode.postMessage({ command: "loadConversation", conversationIndex: lastConversation.index, provider: currentProvider });
                    }
                    break;
                case "conversationLoaded":
                    hideWelcomeTemplate();
                    chatMessages.innerHTML = '';
                    isNewChatSession = false;
                    msg.messages.forEach(msgItem => {
                        // Handle both old (content) and new (parts) formats
                        const messageText = msgItem.content || (msgItem.parts && msgItem.parts[0]?.text) || '';
                        addMessage(messageText, msgItem.role === 'user' ? 'user' : 'assistant');
                    });
                    closeMenu();
                    messageInput.focus();
                    break;
                case "clearChat":
                    chatMessages.innerHTML = '';
                    isNewChatSession = true;
                    showWelcomeTemplate();
                    break;
                case "historyCleared":
                    if (msg.success) {
                        chatMessages.innerHTML = '';
                        isNewChatSession = true;
                        addMessage("Conversation history cleared. Ready for a new chat!", "system");
                        setTimeout(() => {
                            loadHistoryList();
                            closeMenu();
                        }, 300);
                    } else {
                        addMessage("Error clearing history.", "system");
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}

module.exports = { SidebarProvider };
