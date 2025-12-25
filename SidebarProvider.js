const vscode = require("vscode");
const { getNonce } = require("./getNonce");
const { generateResponse } = require("./services/gemini");

class SidebarProvider {
    #view;
    #extensionUri;
    #context;

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
            let response;
            if (provider === "gemini") {
                response = await generateResponse(apiKey, message);
            } else if (provider === "openai") {
                response = "OpenAI integration coming soon...";
            } else {
                response = "Unknown provider";
            }

            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: response,
                sender: "assistant",
            });
        } catch (error) {
            console.error("Chat message error:", error);
            this.#view?.webview.postMessage({
                command: "messageReceived",
                message: `Error: ${error.message}`,
                sender: "system",
            });
        }
    }

    #getHtmlForWebview(_webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; script-src 'nonce-${nonce}' https://cdn.tailwindcss.com;">
    <title>Code Lamp</title>
    <script src="https://cdn.tailwindcss.com"></script>
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
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
        }
        
        input:focus, select:focus, textarea:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid transparent;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: inherit;
            font-size: inherit;
            font-weight: 500;
        }
        
        button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button:active:not(:disabled) {
            opacity: 0.8;
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover:not(:disabled) {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .message-user {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 8px;
            padding: 10px 12px;
            max-width: 85%;
            margin-left: auto;
            word-wrap: break-word;
            animation: slideIn 0.2s ease;
        }
        
        .message-assistant {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 10px 12px;
            max-width: 85%;
            word-wrap: break-word;
            animation: slideIn 0.2s ease;
        }
        
        .message-system {
            font-size: 0.8rem;
            opacity: 0.6;
            text-align: center;
            padding: 8px;
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
    <div id="welcomeScreen" class="flex flex-col h-full p-6">
        <div class="flex flex-col items-center justify-center flex-1">
            <div class="icon-large">💡</div>
            <h1 class="screen-heading">CodeLamp</h1>
            <p class="screen-subtitle">Your Personal AI Code Assistant</p>
            <div class="w-full max-w-sm p-4 mb-8 rounded-lg border border-[var(--vscode-input-border)]">
                <div class="flex gap-3 items-start">
                    <div class="text-lg flex-shrink-0 mt-0.5">🔒</div>
                    <div>
                        <p class="text-sm font-semibold mb-1">Privacy First</p>
                        <p class="text-xs opacity-70">API keys are stored securely in VS Code's secret storage</p>
                    </div>
                </div>
            </div>
            <button id="getStartedBtn" class="w-full max-w-sm px-4 py-2.5">Get Started</button>
        </div>
    </div>

    <!-- Setup Screen -->
    <div id="setupScreen" style="display: none;" class="flex flex-col h-full p-6">
        <div class="flex flex-col items-center justify-center w-full flex-1">
            <h1 class="screen-heading mb-6">Configure API Key</h1>
            <div class="w-full max-w-sm flex flex-col gap-5">
                <div>
                    <label class="block text-xs font-semibold mb-2 opacity-70">AI Provider</label>
                    <select id="providerSelect" class="w-full px-3 py-2">
                        <option value="gemini">Google Gemini</option>
                        <option value="openai" disabled>OpenAI (Coming Soon)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold mb-2 opacity-70">API Key</label>
                    <div class="relative">
                        <input id="apiKeyInput" type="password" class="w-full px-3 py-2 pr-10" placeholder="Enter your API key..." />
                        <button id="togglePasswordBtn" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 bg-transparent hover:bg-transparent border-0 text-sm p-0 h-6 w-6 flex items-center justify-center">👁️</button>
                    </div>
                </div>
                <div class="flex gap-2 mt-2">
                    <button id="saveKeyBtn" class="flex-1 px-4 py-2">Save Key</button>
                    <button id="cancelSetupBtn" class="flex-1 px-4 py-2 btn-secondary">Cancel</button>
                </div>
                <div id="setupSpinner" style="display: none;" class="flex flex-col items-center justify-center gap-2 mt-4">
                    <div class="w-8 h-8 border-3 border-[var(--vscode-focusBorder)] border-t-transparent rounded-full animate-spin"></div>
                    <p class="text-xs opacity-60">Saving...</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Chat Screen -->
    <div id="chatScreen" style="display: none;" class="flex flex-col h-full">
        <div class="px-4 py-3 border-b border-[var(--vscode-input-border)] flex justify-between items-center">
            <h2 class="text-xs font-bold uppercase tracking-wide opacity-70">Chat</h2>
            <button id="settingsBtn" class="opacity-70 hover:opacity-100 bg-transparent hover:bg-transparent border-0 p-1 h-6 w-6 flex items-center justify-center" title="Settings">
                <svg class="w-5 h-5" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                     <path fill-rule="evenodd" d="M17 10v1.126c.367.095.714.24 1.032.428l.796-.797 1.415 1.415-.797.796c.188.318.333.665.428 1.032H21v2h-1.126c-.095.367-.24.714-.428 1.032l.797.796-1.415 1.415-.796-.797a3.979 3.979 0 0 1-1.032.428V20h-2v-1.126a3.977 3.977 0 0 1-1.032-.428l-.796.797-1.415-1.415.797-.796A3.975 3.975 0 0 1 12.126 16H11v-2h1.126c.095-.367.24-.714.428-1.032l-.797-.796 1.415-1.415.796.797A3.977 3.977 0 0 1 15 11.126V10h2Zm.406 3.578.016.016c.354.358.574.85.578 1.392v.028a2 2 0 0 1-3.409 1.406l-.01-.012a2 2 0 0 1 2.826-2.83ZM5 8a4 4 0 1 1 7.938.703 7.029 7.029 0 0 0-3.235 3.235A4 4 0 0 1 5 8Zm4.29 5H7a4 4 0 0 0-4 4v1a2 2 0 0 0 2 2h6.101A6.979 6.979 0 0 1 9 15c0-.695.101-1.366.29-2Z" clip-rule="evenodd"/>
                </svg>
            </button>
        </div>
        <div id="chatMessages" class="flex-1 overflow-y-auto p-4 flex flex-col gap-3"></div>
        <div class="px-4 py-3 border-t border-[var(--vscode-input-border)]">
            <div class="flex gap-2">
                <textarea id="messageInput" class="flex-1 px-3 py-2 text-sm resize-none" rows="1" placeholder="Type your query here..."></textarea>
                <button id="sendBtn" class="px-3 py-2 flex items-center justify-center flex-shrink-0" title="Send">
                    <svg class="w-5 h-5" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.16798184 C3.34915502,0.9108844 2.40734225,1.01698301 1.77946707,1.4882751 C0.994623095,2.11700993 0.837654326,3.20638099 1.15159189,3.99186788 L3.03521743,10.4328608 C3.03521743,10.5899582 3.19218622,10.7470556 3.50612381,10.7470556 L16.6915026,11.5325425 C16.6915026,11.5325425 17.1624089,11.5325425 17.1624089,12.0038346 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z"/>
                    </svg>
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
        const settingsBtn = document.getElementById("settingsBtn");
        const messageInput = document.getElementById("messageInput");
        const sendBtn = document.getElementById("sendBtn");
        const chatMessages = document.getElementById("chatMessages");
        const setupSpinner = document.getElementById("setupSpinner");

        let currentProvider = "gemini";
        let passwordVisible = false;

        showScreen("loading");
        vscode.postMessage({ command: "getApiKey" });

        getStartedBtn.onclick = () => showScreen("setup");
        cancelSetupBtn.onclick = () => {
            if (chatMessages.children.length > 0) showScreen("chat");
            else showScreen("welcome");
        };
        settingsBtn.onclick = () => {
            showScreen("setup");
            vscode.postMessage({ command: "getApiKey" });
        };

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

        providerSelect.onchange = (e) => {
            currentProvider = e.target.value;
            apiKeyInput.value = '';
            passwordVisible = false;
            apiKeyInput.type = 'password';
            togglePasswordBtn.textContent = '👁️';
            vscode.postMessage({ command: "getApiKey" });
        };

        togglePasswordBtn.onclick = (e) => {
            e.preventDefault();
            passwordVisible = !passwordVisible;
            apiKeyInput.type = passwordVisible ? 'text' : 'password';
            togglePasswordBtn.textContent = passwordVisible ? '🙈' : '👁️';
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
            addMessage(text, 'user');
            messageInput.value = "";
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

        function addMessage(text, sender) {
            const div = document.createElement("div");
            if (sender === 'user') {
                div.className = "message-user";
            } else if (sender === 'system') {
                div.className = "message-system";
            } else {
                div.className = "message-assistant";
            }
            div.textContent = text;
            chatMessages.appendChild(div);
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
                        togglePasswordBtn.textContent = '👁️';
                        if (setupScreen.style.display !== 'flex') {
                            showScreen("chat");
                            addMessage("Welcome back! Ready to code.", "assistant");
                        }
                    } else {
                        if (setupScreen.style.display !== 'flex' && chatScreen.style.display !== 'flex') {
                            showScreen("welcome");
                        }
                        apiKeyInput.value = '';
                        apiKeyInput.type = 'password';
                        passwordVisible = false;
                        togglePasswordBtn.textContent = '👁️';
                    }
                    break;
                case "apiKeySaved":
                    setupSpinner.style.display = 'none';
                    saveKeyBtn.disabled = false;
                    if (msg.success) {
                        if (msg.isDeleted) {
                            showScreen("welcome");
                        } else {
                            showScreen("chat");
                            addMessage("Welcome! Ready to code.", "assistant");
                        }
                    }
                    break;
                case "apiKeyDeleted":
                    showScreen("welcome");
                    break;
                case "messageReceived":
                    const lastMessage = chatMessages.lastElementChild;
                    if (lastMessage && lastMessage.textContent === "Thinking...") {
                        lastMessage.remove();
                    }
                    addMessage(msg.message, msg.sender);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}

module.exports = { SidebarProvider };
