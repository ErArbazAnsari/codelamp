const vscode = acquireVsCodeApi();

// DOM Elements
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
const newChatHeaderBtn = document.getElementById("newChatHeaderBtn");
const newChatMenuBtn = document.getElementById("newChatMenuBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");

// State
let currentProvider = "gemini";
let passwordVisible = false;
let _isNewChatSession = true;
let isMenuOpen = false;
let isInitialLoad = true;
let streamingMessageDiv = null;
let streamingContent = "";

// Initialize
showScreen("loading");
vscode.postMessage({ command: "getApiKey" });

// Event Listeners
getStartedBtn.onclick = () => showScreen("setup");
cancelSetupBtn.onclick = () => {
    if (chatMessages.children.length > 0) showScreen("chat");
    else showScreen("welcome");
};

menuBtn.onclick = (e) => {
    e.stopPropagation();
    toggleMenu();
};
closeMenuBtn.onclick = () => closeMenu();
menuOverlay.onclick = () => closeMenu();

const handleNewChat = () => {
    closeMenu();
    showScreen("chat");
    chatMessages.innerHTML = "";
    showWelcomeTemplate();
    _isNewChatSession = true;
    vscode.postMessage({ command: "newChat", provider: currentProvider });
    messageInput.focus();
};

newChatHeaderBtn.onclick = handleNewChat;
newChatMenuBtn.onclick = handleNewChat;

menuSettingsBtn.onclick = () => {
    closeMenu();
    showScreen("setup");
    vscode.postMessage({ command: "getApiKey" });
};

providerSelect.onchange = (e) => {
    currentProvider = e.target.value;
    apiKeyInput.value = "";
    passwordVisible = false;
    apiKeyInput.type = "password";
    togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
    vscode.postMessage({ command: "getApiKey" });
};

togglePasswordBtn.onclick = (e) => {
    e.preventDefault();
    passwordVisible = !passwordVisible;
    apiKeyInput.type = passwordVisible ? "text" : "password";
    togglePasswordBtn.innerHTML = passwordVisible
        ? '<i class="fas fa-eye-slash"></i>'
        : '<i class="fas fa-eye"></i>';
};

saveKeyBtn.onclick = () => {
    const key = apiKeyInput.value.trim();
    setupSpinner.style.display = "flex";
    saveKeyBtn.disabled = true;
    vscode.postMessage({
        command: "saveApiKey",
        apiKey: key,
        provider: currentProvider,
    });
};

sendBtn.onclick = sendMessage;
messageInput.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

// Auto-grow textarea
messageInput.addEventListener("input", function () {
    this.style.height = "auto";
    const newHeight = Math.min(this.scrollHeight, 120);
    this.style.height = newHeight + "px";
});

// Helper function to add copy buttons to code blocks
function addCopyButtonsToCodeBlocks(container) {
    const preElements = container.querySelectorAll("pre");
    preElements.forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement.classList.contains("code-block-wrapper")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "code-block-wrapper";
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const copyBtn = document.createElement("button");
        copyBtn.className = "code-copy-btn";
        copyBtn.innerHTML = '<i class="fas fa-copy"></i><span>Copy</span>';

        copyBtn.onclick = async (e) => {
            e.preventDefault();
            const codeElement = pre.querySelector("code") || pre;
            const code = codeElement.textContent;

            try {
                await navigator.clipboard.writeText(code);
                copyBtn.innerHTML =
                    '<i class="fas fa-check"></i><span>Copied!</span>';
                copyBtn.classList.add("copied");

                setTimeout(() => {
                    copyBtn.innerHTML =
                        '<i class="fas fa-copy"></i><span>Copy</span>';
                    copyBtn.classList.remove("copied");
                }, 2000);
            } catch (err) {
                console.error("Failed to copy:", err);
                copyBtn.innerHTML =
                    '<i class="fas fa-times"></i><span>Failed</span>';
                setTimeout(() => {
                    copyBtn.innerHTML =
                        '<i class="fas fa-copy"></i><span>Copy</span>';
                }, 2000);
            }
        };

        wrapper.appendChild(copyBtn);
    });
}

// Functions
function toggleMenu() {
    if (isMenuOpen) {
        closeMenu();
    } else {
        menuSidebar.style.display = "flex";
        menuOverlay.style.display = "block";
        isMenuOpen = true;
        loadHistoryList();
    }
}

function closeMenu() {
    menuSidebar.style.display = "none";
    menuOverlay.style.display = "none";
    isMenuOpen = false;
}

function loadHistoryList() {
    vscode.postMessage({ command: "getHistory", provider: currentProvider });
}

function renderHistoryList(conversations) {
    historyList.innerHTML = "";

    if (conversations.length === 0) {
        historyList.innerHTML =
            '<div class="w-full py-8 text-center text-sm opacity-50 flex flex-col items-center gap-2"><i class="fas fa-comments text-xl opacity-30"></i><span>No conversations yet</span></div>';
        return;
    }

    conversations.forEach((conv, _index) => {
        const container = document.createElement("div");
        container.className =
            "w-full mb-2 rounded-lg transition-all group relative flex items-center justify-between gap-2 overflow-visible";
        container.style.backgroundColor = "var(--vscode-input-background)";
        container.style.border = "1px solid transparent";
        container.style.boxShadow = "none";
        container.style.minHeight = "60px";

        container.addEventListener("mouseenter", () => {
            container.style.border = "1px solid var(--vscode-focusBorder)";
        });
        container.addEventListener("mouseleave", () => {
            container.style.border = "1px solid transparent";
        });

        const btn = document.createElement("button");
        btn.className =
            "px-3 py-3 text-left flex-1 rounded-lg transition-all flex flex-col gap-1.5 focus:outline-none min-w-0";
        btn.style.backgroundColor = "transparent";
        btn.style.border = "none";
        btn.style.color = "var(--vscode-editor-foreground)";
        btn.style.textAlign = "left";
        const dateStr = new Date(conv.timestamp).toLocaleDateString();
        const timeStr = new Date(conv.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
        // Show "New Chat" for empty conversations
        const displayText = conv.preview || "New Chat";
        btn.innerHTML =
            '<div class="truncate font-semibold text-sm leading-tight" style="color: var(--vscode-editor-foreground);">' +
            displayText +
            '</div><div class="text-xs" style="color: var(--vscode-editor-foreground); opacity: 0.7; display: flex; gap: 0.25rem;"><span>' +
            dateStr +
            "</span><span>•</span><span>" +
            timeStr +
            "</span></div>";
        btn.onclick = () => {
            vscode.postMessage({
                command: "loadConversation",
                conversationIndex: conv.index,
                provider: currentProvider,
            });
        };

        const deleteBtn = document.createElement("button");
        deleteBtn.className =
            "flex-shrink-0 p-2 text-sm transition-all rounded-md mr-2";
        deleteBtn.style.backgroundColor = "transparent";
        deleteBtn.style.border = "none";
        deleteBtn.style.color = "var(--vscode-editor-foreground)";
        deleteBtn.style.opacity = "1";
        deleteBtn.style.minWidth = "40px";
        deleteBtn.style.height = "40px";
        deleteBtn.style.display = "flex";
        deleteBtn.style.alignItems = "center";
        deleteBtn.style.justifyContent = "center";
        deleteBtn.style.flexShrink = "0";
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
                command: "deleteConversation",
                conversationIndex: conv.index,
                provider: currentProvider,
            });
        };

        deleteBtn.addEventListener("mouseenter", () => {
            deleteBtn.style.color = "#ef4444";
            deleteBtn.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
        });
        deleteBtn.addEventListener("mouseleave", () => {
            deleteBtn.style.color = "var(--vscode-editor-foreground)";
            deleteBtn.style.backgroundColor = "transparent";
        });

        container.appendChild(btn);
        container.appendChild(deleteBtn);
        historyList.appendChild(container);
    });
}

function showScreen(name) {
    loadingScreen.style.display = "none";
    welcomeScreen.style.display = "none";
    setupScreen.style.display = "none";
    chatScreen.style.display = "none";
    if (name === "loading") loadingScreen.style.display = "flex";
    if (name === "welcome") welcomeScreen.style.display = "flex";
    if (name === "setup") setupScreen.style.display = "flex";
    if (name === "chat") {
        chatScreen.style.display = "flex";
        messageInput.focus();
    }
}

function showWelcomeTemplate() {
    let welcomeTemplate = document.getElementById("welcomeTemplate");
    if (!welcomeTemplate) {
        welcomeTemplate = document.createElement("div");
        welcomeTemplate.id = "welcomeTemplate";
        welcomeTemplate.innerHTML =
            '<div class="welcome-icon"><i class="fas fa-lightbulb"></i></div><div class="welcome-text"><div class="welcome-title">Welcome to CodeLamp</div><div class="welcome-subtitle">Ask me anything about code, debugging, or get help with your projects</div></div>';
        chatMessages.appendChild(welcomeTemplate);
    }
    welcomeTemplate.style.display = "flex";
}

function hideWelcomeTemplate() {
    const welcomeTemplate = document.getElementById("welcomeTemplate");
    if (welcomeTemplate) {
        welcomeTemplate.remove();
    }
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    hideWelcomeTemplate();
    addMessage(text, "user");
    messageInput.value = "";
    messageInput.style.height = "auto";
    sendBtn.disabled = true;
    sendBtn.style.opacity = "0.5";
    vscode.postMessage({
        command: "sendMessage",
        message: text,
        provider: currentProvider,
    });
    addMessage("Thinking...", "system");
}

function addMessage(text, sender) {
    // Hide welcome template when adding actual messages (not system messages)
    if (sender === "user" || sender === "assistant") {
        hideWelcomeTemplate();
    }

    const wrapper = document.createElement("div");
    wrapper.className = "message-wrapper " + sender;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    if (sender === "user") {
        avatar.innerHTML = '<i class="fas fa-user"></i>';
    } else if (sender === "system") {
        avatar.style.display = "none";
    } else {
        avatar.innerHTML = '<i class="fas fa-robot"></i>';
    }

    const content = document.createElement("div");
    content.className = "message-content";

    const div = document.createElement("div");
    if (sender === "user") {
        div.className = "message-user";
        div.textContent = text;
    } else if (sender === "system") {
        div.className = "message-system";
        if (text === "Thinking...") {
            div.classList.add("thinking");
            const dotsContainer = document.createElement("span");
            dotsContainer.className = "thinking-dots";
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement("span");
                dot.className = "thinking-dot";
                dotsContainer.appendChild(dot);
            }
            div.appendChild(dotsContainer);
        } else {
            div.textContent = text;
        }
    } else {
        div.className = "message-assistant";
        try {
            if (typeof marked !== "undefined") {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                });
                div.innerHTML = marked.parse(text);
                if (typeof hljs !== "undefined") {
                    div.querySelectorAll("pre code").forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
                addCopyButtonsToCodeBlocks(div);
            } else {
                div.textContent = text;
            }
        } catch (e) {
            console.error("Markdown parsing error:", e);
            div.textContent = text;
        }
    }

    content.appendChild(div);
    wrapper.appendChild(avatar);
    wrapper.appendChild(content);
    chatMessages.appendChild(wrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Message Handler
window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.command) {
        case "streamStart":
            // Remove thinking indicator
            const thinkingMessages = chatMessages.querySelectorAll(
                ".message-system.thinking"
            );
            thinkingMessages.forEach((msg) => msg.remove());

            streamingContent = "";
            const wrapper = document.createElement("div");
            wrapper.className = "message-wrapper assistant";

            const avatar = document.createElement("div");
            avatar.className = "message-avatar";
            avatar.innerHTML = '<i class="fas fa-robot"></i>';

            const content = document.createElement("div");
            content.className = "message-content";

            streamingMessageDiv = document.createElement("div");
            streamingMessageDiv.className = "message-assistant";
            streamingMessageDiv.innerHTML = "";

            content.appendChild(streamingMessageDiv);
            wrapper.appendChild(avatar);
            wrapper.appendChild(content);
            chatMessages.appendChild(wrapper);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            break;

        case "streamChunk":
            if (streamingMessageDiv) {
                streamingContent += msg.chunk;
                try {
                    if (typeof marked !== "undefined") {
                        marked.setOptions({
                            breaks: true,
                            gfm: true,
                            headerIds: false,
                        });
                        streamingMessageDiv.innerHTML =
                            marked.parse(streamingContent);
                        if (typeof hljs !== "undefined") {
                            streamingMessageDiv
                                .querySelectorAll("pre code")
                                .forEach((block) => {
                                    hljs.highlightElement(block);
                                });
                        }
                        addCopyButtonsToCodeBlocks(streamingMessageDiv);
                    } else {
                        streamingMessageDiv.textContent = streamingContent;
                    }
                } catch {
                    streamingMessageDiv.textContent = streamingContent;
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            break;

        case "streamComplete":
            streamingMessageDiv = null;
            streamingContent = "";
            sendBtn.disabled = false;
            sendBtn.style.opacity = "1";
            messageInput.focus();
            break;

        case "apiKeyResponse":
            const savedKey =
                currentProvider === "gemini" ? msg.geminiKey : msg.openaiKey;
            if (savedKey) {
                apiKeyInput.value = savedKey;
                apiKeyInput.type = "password";
                passwordVisible = false;
                togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
                if (setupScreen.style.display !== "flex") {
                    vscode.postMessage({
                        command: "getHistory",
                        provider: currentProvider,
                    });
                    showScreen("chat");
                }
            } else {
                if (
                    setupScreen.style.display !== "flex" &&
                    chatScreen.style.display !== "flex"
                ) {
                    showScreen("welcome");
                }
                apiKeyInput.value = "";
                apiKeyInput.type = "password";
                passwordVisible = false;
                togglePasswordBtn.innerHTML = '<i class="fas fa-eye"></i>';
            }
            break;

        case "apiKeySaved":
            setupSpinner.style.display = "none";
            saveKeyBtn.disabled = false;
            if (msg.success) {
                if (msg.isDeleted) {
                    showScreen("welcome");
                } else {
                    vscode.postMessage({
                        command: "getHistory",
                        provider: currentProvider,
                    });
                    showScreen("chat");
                }
            }
            break;

        case "apiKeyDeleted":
            showScreen("welcome");
            break;

        case "messageReceived":
            const messages = chatMessages.querySelectorAll(
                ".message-system.thinking"
            );
            messages.forEach((msg) => msg.remove());
            addMessage(msg.message, msg.sender);
            sendBtn.disabled = false;
            sendBtn.style.opacity = "1";
            messageInput.focus();
            break;

        case "historyResponse":
            renderHistoryList(msg.conversations);
            if (
                msg.conversations &&
                msg.conversations.length > 0 &&
                isInitialLoad
            ) {
                isInitialLoad = false;
                const lastConversation = msg.conversations[0];
                vscode.postMessage({
                    command: "loadConversation",
                    conversationIndex: lastConversation.index,
                    provider: currentProvider,
                });
            }
            break;

        case "conversationLoaded":
            chatMessages.innerHTML = "";

            // Check if conversation has messages
            if (!msg.messages || msg.messages.length === 0) {
                // Show welcome template for empty conversations
                showWelcomeTemplate();
                _isNewChatSession = true;
            } else {
                // Hide welcome template and show messages
                hideWelcomeTemplate();
                _isNewChatSession = false;
                msg.messages.forEach((msgItem) => {
                    const messageText =
                        msgItem.content ||
                        (msgItem.parts && msgItem.parts[0]?.text) ||
                        "";
                    addMessage(
                        messageText,
                        msgItem.role === "user" ? "user" : "assistant"
                    );
                });
            }
            // Add copy buttons to all code blocks in loaded conversation
            setTimeout(() => {
                addCopyButtonsToCodeBlocks(chatMessages);
            }, 100);
            closeMenu();
            messageInput.focus();
            break;

        case "clearChat":
            chatMessages.innerHTML = "";
            _isNewChatSession = true;
            showWelcomeTemplate();
            break;

        case "historyCleared":
            if (msg.success) {
                chatMessages.innerHTML = "";
                _isNewChatSession = true;
                addMessage(
                    "Conversation history cleared. Ready for a new chat!",
                    "system"
                );
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
