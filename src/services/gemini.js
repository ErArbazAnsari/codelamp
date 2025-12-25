const { GoogleGenAI } = require("@google/genai");

async function generateResponse(apiKey, message, conversationHistory = []) {
    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey,
        });

        const contents = [
            ...conversationHistory.map((msg) => ({
                role: msg.role,
                parts: [{ text: msg.content }],
            })),
            {
                role: "user",
                parts: [{ text: message }],
            },
        ];

        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: contents,
            config: {
                systemInstruction:
                    "codelamp own you and 'arbaz ansari' is the developer who build you his github profile is @erarbazansari. you are a coding ai agent that can help to review the code, generate the code, fix the code, assist while coding. you answers users questions in simple and less words until user explicitly tell you to answer in details.",
            },
        });

        return response.text;
    } catch (error) {
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

module.exports = { generateResponse };
