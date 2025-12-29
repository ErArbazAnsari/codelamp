const vscode = require("vscode");

/**
 * Handler for conversation history and management
 */
class ConversationHandler {
    #context;
    #view;
    #currentSessionMessages = [];
    #isNewConversation = true;
    #currentConversationIndex = null;

    constructor(context, view) {
        this.#context = context;
        this.#view = view;
    }

    /**
     * Get current session messages
     */
    getCurrentSession() {
        return this.#currentSessionMessages || [];
    }

    /**
     * Reset current session
     */
    resetSession() {
        this.#currentSessionMessages = [];
    }

    /**
     * Add message pair to current session
     */
    addToCurrentSession(userMessage, assistantMessage) {
        if (!this.#currentSessionMessages) {
            this.#currentSessionMessages = [];
        }
        this.#currentSessionMessages.push({
            role: "user",
            parts: [{ text: userMessage }],
        });
        this.#currentSessionMessages.push({
            role: "model",
            parts: [{ text: assistantMessage }],
        });
    }

    /**
     * Set current session messages (for loading conversations)
     */
    setCurrentSession(messages) {
        this.#currentSessionMessages = messages;
    }

    /**
     * Get conversation history from storage
     */
    async getHistory(provider) {
        try {
            const historyJson = await this.#context.globalState.get(
                `codelamp_${provider}_history`
            );
            return historyJson ? JSON.parse(historyJson) : [];
        } catch {
            return [];
        }
    }

    /**
     * Add message pair to history
     */
    async addToHistory(provider, userMessage, assistantMessage) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];

            // If this is a new conversation session, create a new conversation
            if (this.#isNewConversation) {
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
                // Mark that we're no longer in a new conversation
                this.#isNewConversation = false;
                // Set current conversation index to the newly created one
                this.#currentConversationIndex = conversations.length - 1;
            } else {
                // Add to the currently active conversation
                const targetIndex =
                    this.#currentConversationIndex !== null
                        ? this.#currentConversationIndex
                        : conversations.length - 1;

                if (conversations[targetIndex]) {
                    conversations[targetIndex].messages.push({
                        role: "user",
                        content: userMessage,
                    });
                    conversations[targetIndex].messages.push({
                        role: "model",
                        content: assistantMessage,
                    });
                    conversations[targetIndex].timestamp =
                        new Date().toISOString();
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

    /**
     * Send conversation history to webview
     */
    async sendHistoryToWebview(provider) {
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

    /**
     * Load a specific conversation
     */
    async load(index, provider) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];
            const originalIndex = conversations.length - 1 - index;

            if (conversations[originalIndex]) {
                const conversation = conversations[originalIndex];

                // Normalize messages format
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
                // Mark that we're continuing an existing conversation
                this.#isNewConversation = false;
                // Track which conversation is currently loaded
                this.#currentConversationIndex = originalIndex;

                this.#view?.webview.postMessage({
                    command: "conversationLoaded",
                    messages: normalizedMessages,
                });
            }
        } catch (error) {
            console.error("Error loading conversation:", error);
        }
    }

    /**
     * Delete a specific conversation
     */
    async delete(index, provider) {
        try {
            const conversationsJson = await this.#context.globalState.get(
                `codelamp_${provider}_conversations`
            );
            const conversations = conversationsJson
                ? JSON.parse(conversationsJson)
                : [];
            const originalIndex = conversations.length - 1 - index;

            if (conversations[originalIndex] !== undefined) {
                conversations.splice(originalIndex, 1);

                await this.#context.globalState.update(
                    `codelamp_${provider}_conversations`,
                    JSON.stringify(conversations)
                );

                // Clear the current chat session
                this.#currentSessionMessages = [];
                // Mark as new conversation
                this.#isNewConversation = true;
                // Reset conversation index
                this.#currentConversationIndex = null;
                this.#view?.webview.postMessage({
                    command: "clearChat",
                });

                // Send updated history to webview
                await this.sendHistoryToWebview(provider);
                vscode.window.showInformationMessage(
                    "Conversation deleted successfully."
                );
            }
        } catch (error) {
            console.error("Error deleting conversation:", error);
            vscode.window.showErrorMessage("Error deleting conversation.");
        }
    }

    /**
     * Create a new blank conversation
     */
    async createNewBlank(provider) {
        try {
            // Simply reset the current session
            // Don't create an empty conversation in storage
            // Let the first message create the conversation
            this.#currentSessionMessages = [];
            // Mark as new conversation
            this.#isNewConversation = true;
            // Reset conversation index
            this.#currentConversationIndex = null;

            // Clear chat UI
            this.#view?.webview.postMessage({
                command: "clearChat",
            });

            // Send updated history
            await this.sendHistoryToWebview(provider);
        } catch (error) {
            console.error("Error creating new conversation:", error);
        }
    }
}

module.exports = { ConversationHandler };
