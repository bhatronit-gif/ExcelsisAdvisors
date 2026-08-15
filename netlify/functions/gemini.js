/**
 * netlify/functions/gemini.js
 * Serverless backend function for Netlify that accesses process.env.GEMINI_API_KEY.
 * Allows secure server-side execution without exposing the API key on the frontend.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const CANDIDATE_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-pro'
];

async function discoverAvailableModels(apiKey) {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!res.ok) return [];
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
            return data.models
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                .map(m => m.name.replace(/^models\//, ''));
        }
    } catch (e) {
        return [];
    }
    return [];
}

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

    // GET request: Healthcheck & check if server has key configured
    if (event.httpMethod === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                hasServerKey: !!envKey && envKey.length > 5,
                defaultModel: DEFAULT_MODEL
            })
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { prompt, model: requestedModel, apiKey: clientKey } = body;

        const effectiveKey = clientKey || envKey;

        if (!effectiveKey) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'No Gemini API Key found. Please add GEMINI_API_KEY in Netlify Environment Variables or configure it in the UI.'
                })
            };
        }

        if (!prompt || typeof prompt !== 'string') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing prompt text in request body.' })
            };
        }

        const cleanRequestedModel = (requestedModel || '').replace(/^models\//, '');
        let modelsToTry = [
            ...(cleanRequestedModel ? [cleanRequestedModel] : []),
            ...CANDIDATE_MODELS.filter(m => m !== cleanRequestedModel)
        ];

        let lastError = null;

        for (let i = 0; i < modelsToTry.length; i++) {
            const model = modelsToTry[i];
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                role: 'user',
                                parts: [{ text: prompt }]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.3,
                            topP: 0.85,
                            maxOutputTokens: 2500
                        }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || `HTTP ${response.status}: ${response.statusText}`;

                    if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('not supported')) {
                        lastError = new Error(`Model ${model} unavailable: ${errMsg}`);
                        
                        // If we are at the end of static candidates, dynamically discover account models
                        if (i === modelsToTry.length - 1) {
                            const discovered = await discoverAvailableModels(effectiveKey);
                            const newModels = discovered.filter(m => !modelsToTry.includes(m));
                            if (newModels.length > 0) {
                                modelsToTry.push(...newModels);
                            }
                        }
                        continue;
                    }
                    return {
                        statusCode: response.status,
                        headers,
                        body: JSON.stringify({ error: errMsg })
                    };
                }

                const data = await response.json();
                const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!candidateText) {
                    return {
                        statusCode: 502,
                        headers,
                        body: JSON.stringify({ error: 'Gemini returned an empty response. Please try again.' })
                    };
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        text: candidateText,
                        modelUsed: model,
                        source: clientKey ? 'client_key' : 'netlify_env'
                    })
                };
            } catch (err) {
                lastError = err;
            }
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: lastError?.message || 'Failed to generate content with Gemini API.' })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message || 'Internal Server Error' })
        };
    }
};
