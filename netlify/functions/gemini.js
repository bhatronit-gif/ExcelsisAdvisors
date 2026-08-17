/**
 * netlify/functions/gemini.js
 * Serverless backend function for Netlify that accesses process.env.GEMINI_API_KEY.
 * Allows secure server-side execution without exposing the API key on the frontend.
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';
const CANDIDATE_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro'
];

async function discoverAvailableModels(apiKey) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
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

function extractCandidateText(data) {
    if (!data) return "";
    const candidate = data.candidates?.[0];
    if (!candidate) return "";

    const parts = candidate.content?.parts;
    if (Array.isArray(parts)) {
        const textParts = parts
            .filter(p => p && typeof p.text === 'string')
            .map(p => p.text.trim())
            .filter(t => t.length > 0);
        if (textParts.length > 0) {
            return textParts.join('\n\n');
        }
    }

    if (typeof candidate.text === 'string' && candidate.text.trim()) {
        return candidate.text.trim();
    }
    if (typeof candidate.output === 'string' && candidate.output.trim()) {
        return candidate.output.trim();
    }
    return "";
}

exports.handler = async (event, context) => {
    const startTime = Date.now();
    const MAX_EXECUTION_MS = 7500; // Return clean response before Netlify 10s gateway timeout

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

    const rawEnvKey = process.env.GEMINI_API_KEY || 
                      process.env.VITE_GEMINI_API_KEY || 
                      process.env.GOOGLE_API_KEY || 
                      process.env.GOOGLE_GEMINI_API_KEY ||
                      process.env.GEMINI_KEY ||
                      process.env.API_KEY || '';
    const envKey = rawEnvKey.trim();

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
        const { prompt, model: requestedModel, apiKey: clientKey, responseMimeType } = body;

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
            // Guard against approaching Netlify 10s gateway timeout
            if (Date.now() - startTime > MAX_EXECUTION_MS) {
                break;
            }

            const model = modelsToTry[i];
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
                
                const genConfig = {
                    temperature: 0.3,
                    topP: 0.85,
                    maxOutputTokens: 1500
                };
                if (responseMimeType && typeof responseMimeType === 'string') {
                    genConfig.responseMimeType = responseMimeType;
                }

                const remainingMs = Math.max(3000, MAX_EXECUTION_MS - (Date.now() - startTime));
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), remainingMs);

                let response;
                try {
                    response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        signal: controller.signal,
                        body: JSON.stringify({
                            contents: [
                                {
                                    role: 'user',
                                    parts: [{ text: prompt }]
                                }
                            ],
                            generationConfig: genConfig
                        })
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                // If responseMimeType is not supported on this specific model, retry request without it
                if (!response.ok && genConfig.responseMimeType) {
                    const checkErr = await response.clone().json().catch(() => ({}));
                    const checkMsg = (checkErr.error?.message || '').toLowerCase();
                    if (checkMsg.includes('responsemimetype') || checkMsg.includes('unsupported') || checkMsg.includes('invalid argument')) {
                        delete genConfig.responseMimeType;
                        const retryRemaining = Math.max(2500, MAX_EXECUTION_MS - (Date.now() - startTime));
                        const retryCtrl = new AbortController();
                        const retryTimeout = setTimeout(() => retryCtrl.abort(), retryRemaining);
                        try {
                            response = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                signal: retryCtrl.signal,
                                body: JSON.stringify({
                                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                                    generationConfig: genConfig
                                })
                            });
                        } finally {
                            clearTimeout(retryTimeout);
                        }
                    }
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                    const errLower = errMsg.toLowerCase();

                    const isRetryableModelError = 
                        response.status === 404 || 
                        response.status === 429 || 
                        response.status === 503 || 
                        response.status === 500 ||
                        errLower.includes('high demand') ||
                        errLower.includes('overloaded') ||
                        errLower.includes('resource exhausted') ||
                        errLower.includes('quota') ||
                        errLower.includes('rate limit') ||
                        errLower.includes('not found') ||
                        errLower.includes('not supported') ||
                        errLower.includes('temporarily unavailable');

                    if (isRetryableModelError) {
                        lastError = new Error(`Model ${model}: ${errMsg}`);
                        
                        // If we are at the end of static candidates and have time left, discover account models
                        if (i === modelsToTry.length - 1 && (Date.now() - startTime < 5000)) {
                            const discovered = await discoverAvailableModels(effectiveKey);
                            const newModels = discovered.filter(m => !modelsToTry.includes(m));
                            if (newModels.length > 0) {
                                modelsToTry.push(...newModels.slice(0, 3));
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
                const candidateText = extractCandidateText(data);

                if (!candidateText) {
                    lastError = new Error(`Model ${model} returned empty content (finishReason: ${data.candidates?.[0]?.finishReason || 'unknown'})`);
                    continue;
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
            statusCode: 503,
            headers,
            body: JSON.stringify({ error: lastError?.message || 'Google AI model service temporarily busy. Please try again in a few moments.' })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message || 'Internal Server Error' })
        };
    }
};
