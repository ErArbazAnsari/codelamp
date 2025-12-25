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
        });

        return response.text;
    } catch (error) {
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

module.exports = { generateResponse };
