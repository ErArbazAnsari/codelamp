const { GoogleGenAI } = require("@google/genai");

async function generateResponse(apiKey, message) {
    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey,
        });

        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: message,
        });

        return response.text;
    } catch (error) {
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

module.exports = { generateResponse };
