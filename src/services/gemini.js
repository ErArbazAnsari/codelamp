// Polyfill fetch for Node.js if not available
if (typeof global !== "undefined" && !global.fetch) {
    try {
        // Try using undici (built-in with Node.js 18+)
        const { fetch: undiciFetch } = require("undici");
        global.fetch = undiciFetch;
    } catch {
        try {
            // Fallback to node-fetch if available
            global.fetch = require("node-fetch");
        } catch {
            console.warn("⚠️ No fetch polyfill available. Using default.");
        }
    }
}

const { GoogleGenAI, Type } = require("@google/genai");

const {
    cryptoPrice,
    getCurrentTime,
    listFiles,
    readFile,
    writeFile,
    setWorkspacePath,
    getWorkspacePath,
} = require("./tools.js");

// Tool functions mapping
const toolFunctions = {
    cryptoPrice,
    getCurrentTime,
    listFiles,
    readFile,
    writeFile,
};

// TOOL DECLARATIONS
const toolDeclarations = [
    {
        name: "cryptoPrice",
        description: "Get current price of a cryptocurrency",
        parameters: {
            type: Type.OBJECT,
            properties: {
                coinName: {
                    type: Type.STRING,
                },
            },
            required: ["coinName"],
        },
    },
    {
        name: "getCurrentTime",
        description: "Help to get current time and date in utc format",
    },
    {
        name: "listFiles",
        description: "List all JavaScript/TypeScript files in a directory. If no directory specified, lists files from the current workspace root.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                directory: {
                    type: Type.STRING,
                    description: "Directory path to scan (relative to workspace or absolute). Leave empty to scan workspace root.",
                },
            },
            required: [],
        },
    },
    {
        name: "readFile",
        description: "Read a file's content from the current workspace. Supports both relative and absolute paths.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                file_path: {
                    type: Type.STRING,
                    description: "Path to the file (relative to workspace root or absolute)",
                },
            },
            required: ["file_path"],
        },
    },
    {
        name: "writeFile",
        description: "Write or update file content in the current workspace. Creates directories if needed.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                file_path: {
                    type: Type.STRING,
                    description: "Path to the file to write (relative to workspace root or absolute)",
                },
                content: {
                    type: Type.STRING,
                    description: "The content to write to the file",
                },
            },
            required: ["file_path", "content"],
        },
    },
];

// MAIN LLM FUNCTION
async function llm(input, conversationHistory = [], apiKey, workspacePath = null) {
    try {
        if (!apiKey) {
            throw new Error("API key is required");
        }

        // Set workspace path for tools
        if (workspacePath) {
            setWorkspacePath(workspacePath);
        }

        const ai = new GoogleGenAI({
            apiKey: apiKey,
        });

        // Convert old format (content) to new format (parts) if needed
        const normalizedHistory = (conversationHistory || []).map((msg) => {
            if (msg.parts) {
                // Already in correct format
                return msg;
            } else if (msg.content) {
                // Convert from old format to new format
                return {
                    role: msg.role,
                    parts: [{ text: msg.content }],
                };
            }
            return msg;
        });

        // Initialize conversation history
        const History = [
            ...normalizedHistory,
            {
                role: "user",
                parts: [{ text: input }],
            },
        ];

        while (true) {
            // Send request to Gemini
            const result = await ai.models
                .generateContent({
                    model: "gemini-2.0-flash",
                    contents: History,
                    config: {
                        tools: [
                            {
                                functionDeclarations: toolDeclarations,
                            },
                        ],
                        systemInstruction: `You are CodeLamp - a coding AI assistant built by Arbaz Ansari (@erarbazansari). 
You help with code review, code generation, bug fixing, and coding assistance.
Keep answers concise unless explicitly asked for details.
Use available tools to help users effectively.`,
                    },
                })
                .catch((err) => {
                    console.error("Gemini API Request Error Details:", {
                        message: err.message,
                        code: err.code,
                        apiKeyExists: !!apiKey,
                        apiKeyLength: apiKey?.length,
                        apiKeyFirstChars: apiKey?.substring(0, 5) + "...",
                        fetchAvailable: typeof global.fetch !== "undefined",
                        nodeVersion: process.version,
                    });
                    throw err;
                });

            // Process ALL function calls at once
            if (result.functionCalls?.length > 0) {
                // Execute all function calls
                for (const functionCall of result.functionCalls) {
                    const { name, args } = functionCall;

                    console.log(`📌 Calling: ${name}`);

                    // Check if tool exists
                    if (!toolFunctions[name]) {
                        throw new Error(`Unknown tool: ${name}`);
                    }

                    // Execute the tool
                    const toolResponse = await toolFunctions[name](args);

                    // Add function call to history
                    History.push({
                        role: "model",
                        parts: [{ functionCall }],
                    });

                    // Add function response to history - must be in correct format
                    History.push({
                        role: "user",
                        parts: [
                            {
                                functionResponse: {
                                    name: name,
                                    response: toolResponse,
                                },
                            },
                        ],
                    });
                }
            } else {
                // No more function calls, return the final response
                console.log("\n✅ Response generated");
                return result.text;
            }
        }
    } catch (error) {
        console.error("LLM Error Details:", {
            message: error.message,
            stack: error.stack,
            apiKeyProvided: !!apiKey,
        });
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

// UTILITY FUNCTION FOR CONVERSATION
async function chat(message, conversationHistory = [], apiKey, workspacePath = null) {
    return llm(message, conversationHistory, apiKey, workspacePath);
}

// EXPORTS
module.exports = {
    llm,
    chat,
    toolDeclarations,
    toolFunctions,
};
