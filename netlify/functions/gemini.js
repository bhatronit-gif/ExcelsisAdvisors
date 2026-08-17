/**
 * netlify/functions/gemini.js
 * Serverless backend function for Netlify that accesses process.env.GEMINI_API_KEY.
 * Allows secure server-side execution without exposing the API key on the frontend.
 */

const DEFAULT_MODEL = 'gemini-3.6-flash';
const CANDIDATE_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.0-flash',
    'gemini-2.5-flash',
    'gemini-3.6-pro',
    'gemini-3.5-pro',
    'gemini-3.0-pro',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
];

/**
 * Discovers text-generation models enabled on the provided Gemini API key.
 * Strictly filters out audio-only, TTS, embedding, and image-only models.
 */
async function discoverAvailableModels(apiKey) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return [];
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
            return data.models
                .filter(m => {
                    const name = (m.name || '').replace(/^models\//, '').toLowerCase();
                    if (!m.supportedGenerationMethods || !m.supportedGenerationMethods.includes('generateContent')) {
                        return false;
                    }
                    // Exclude non-text/audio/TTS/embedding models
                    if (name.includes('-tts') || name.includes('-audio') || name.includes('preview-tts') ||
                        name.includes('-embedding') || name.includes('imagen') || name.includes('whisper') ||
                        name.includes('speech')) {
                        return false;
                    }
                    if (m.outputModalities && Array.isArray(m.outputModalities) && !m.outputModalities.includes('TEXT')) {
                        return false;
                    }
                    return true;
                })
                .map(m => m.name.replace(/^models\//, ''))
                .sort((a, b) => {
                    const getScore = (modelName) => {
                        const n = modelName.toLowerCase();
                        if (n.includes('3.6-flash') || n.includes('3.5-flash')) return 100;
                        if (n.includes('3.0-flash') || n.includes('flash')) return 90;
                        if (n.includes('gemini-3')) return 80;
                        if (n.includes('gemini-2.5')) return 70;
                        if (n.includes('gemini-2')) return 60;
                        if (n.includes('gemini-1.5')) return 40;
                        if (n.includes('gemma')) return 10;
                        return 50;
                    };
                    return getScore(b) - getScore(a);
                });
        }
    } catch (e) {
        return [];
    }
    return [];
}

const SAFETY_BLOCK_REASONS = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'];

function isSafetyBlockReason(reason) {
    if (!reason || typeof reason !== 'string') return false;
    const upper = reason.toUpperCase().replace(/^FINISH_REASON_/, '');
    return SAFETY_BLOCK_REASONS.includes(upper) ||
           upper.includes('SAFETY') ||
           upper.includes('BLOCKLIST') ||
           upper.includes('PROHIBIT') ||
           upper.includes('RECITAT') ||
           upper.includes('HARM') ||
           upper.includes('SPII');
}

/**
 * Robustly inspects Gemini API response structures.
 * Handles empty parts, thinking token blocks, safety/recitation/blocklist finish reasons,
 * multiple candidates, array payloads, and non-standard candidate formats without throwing uncaught exceptions.
 */
function inspectGeminiResponse(data) {
    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        return { text: '', finishReason: 'NO_DATA', blockReason: null, isBlocked: false };
    }

    // Handle array of response objects (aggregated streaming or batch items)
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return { text: '', finishReason: 'NO_DATA', blockReason: null, isBlocked: false };
        }
        const collectedTexts = [];
        let lastFinishReason = 'STOP';
        let blockedReason = null;
        let isBlocked = false;

        for (const item of data) {
            const res = inspectGeminiResponse(item);
            if (res.text) collectedTexts.push(res.text);
            if (res.isBlocked) {
                isBlocked = true;
                blockedReason = res.blockReason;
            }
            if (res.finishReason) lastFinishReason = res.finishReason;
        }

        return {
            text: collectedTexts.join('\n\n').trim(),
            finishReason: lastFinishReason,
            blockReason: blockedReason,
            isBlocked: isBlocked && collectedTexts.length === 0
        };
    }

    // Check prompt-level feedback block
    const promptBlockReason = data.promptFeedback?.blockReason || null;
    if (promptBlockReason) {
        const isSafety = isSafetyBlockReason(promptBlockReason);
        return {
            text: '',
            finishReason: promptBlockReason,
            blockReason: promptBlockReason,
            isBlocked: isSafety
        };
    }

    if (Array.isArray(data.promptFeedback?.safetyRatings)) {
        const blockedRating = data.promptFeedback.safetyRatings.find(r => r.blocked === true || r.blocked === 'true');
        if (blockedRating) {
            const bCategory = blockedRating.category || 'SAFETY';
            return {
                text: '',
                finishReason: bCategory,
                blockReason: bCategory,
                isBlocked: true
            };
        }
    }

    const candidates = Array.isArray(data.candidates) ? data.candidates : (Array.isArray(data.response?.candidates) ? data.response.candidates : []);
    
    let primaryFinishReason = candidates[0]?.finishReason || (typeof candidates[0] === 'string' ? 'STOP' : 'UNKNOWN');
    let safetyBlockedReason = null;

    if (candidates.length > 0) {
        for (const candidate of candidates) {
            if (!candidate) continue;

            // Direct string candidate
            if (typeof candidate === 'string' && candidate.trim()) {
                return {
                    text: candidate.trim(),
                    finishReason: 'STOP',
                    blockReason: null,
                    isBlocked: false
                };
            }

            const cFinishReason = candidate.finishReason || 'UNKNOWN';
            if (isSafetyBlockReason(cFinishReason)) {
                safetyBlockedReason = cFinishReason;
            }

            if (Array.isArray(candidate.safetyRatings)) {
                const candBlocked = candidate.safetyRatings.find(r => r.blocked === true || r.blocked === 'true');
                if (candBlocked) {
                    safetyBlockedReason = candBlocked.category || cFinishReason || 'SAFETY';
                }
            }

            let nonThoughtTextParts = [];
            let thoughtTextParts = [];

            const content = candidate.content || candidate.message;
            const parts = Array.isArray(content?.parts) 
                ? content.parts 
                : (Array.isArray(candidate.parts) 
                    ? candidate.parts 
                    : (Array.isArray(candidate.content) 
                        ? candidate.content 
                        : (Array.isArray(content) 
                            ? content 
                            : (Array.isArray(candidate.message?.content) 
                                ? candidate.message.content 
                                : null))));

            if (Array.isArray(parts)) {
                for (const part of parts) {
                    if (!part) continue;
                    if (typeof part === 'string' && part.trim()) {
                        nonThoughtTextParts.push(part.trim());
                    } else if (typeof part.text === 'string' && part.text.trim()) {
                        if (part.thought === true || part.thought === 'true') {
                            thoughtTextParts.push(part.text.trim());
                        } else {
                            nonThoughtTextParts.push(part.text.trim());
                        }
                    } else if (typeof part.output === 'string' && part.output.trim()) {
                        nonThoughtTextParts.push(part.output.trim());
                    } else if (typeof part.content === 'string' && part.content.trim()) {
                        nonThoughtTextParts.push(part.content.trim());
                    } else if (typeof part.part === 'string' && part.part.trim()) {
                        nonThoughtTextParts.push(part.part.trim());
                    } else if (typeof part.text?.value === 'string' && part.text.value.trim()) {
                        nonThoughtTextParts.push(part.text.value.trim());
                    }
                }
            }

            if (nonThoughtTextParts.length > 0) {
                return {
                    text: nonThoughtTextParts.join('\n\n'),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content === 'string' && content.trim()) {
                return {
                    text: content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content?.parts === 'string' && content.parts.trim()) {
                return {
                    text: content.parts.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content?.text === 'string' && content.text.trim()) {
                return {
                    text: content.text.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.text === 'string' && candidate.text.trim()) {
                return {
                    text: candidate.text.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.output === 'string' && candidate.output.trim()) {
                return {
                    text: candidate.output.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.parts === 'string' && candidate.parts.trim()) {
                return {
                    text: candidate.parts.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.content === 'string' && candidate.content.trim()) {
                return {
                    text: candidate.content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.message?.content === 'string' && candidate.message.content.trim()) {
                return {
                    text: candidate.message.content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            // If only thinking parts were produced, use thinking parts as fallback
            if (thoughtTextParts.length > 0) {
                return {
                    text: thoughtTextParts.join('\n\n'),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }
        }
    }

    // Direct root fields check (when candidates are empty or contain no extractable text)
    if (typeof data.text === 'string' && data.text.trim()) {
        return { text: data.text.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.output === 'string' && data.output.trim()) {
        return { text: data.output.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.content === 'string' && data.content.trim()) {
        return { text: data.content.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.response === 'string' && data.response.trim()) {
        return { text: data.response.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }

    if (candidates.length === 0) {
        return {
            text: '',
            finishReason: 'NO_CANDIDATES',
            blockReason: null,
            isBlocked: false
        };
    }

    return {
        text: '',
        finishReason: primaryFinishReason,
        blockReason: safetyBlockedReason,
        isBlocked: !!safetyBlockedReason
    };
}

/**
 * Extracts candidate text safely from Gemini response.
 */
function extractCandidateText(data) {
    const inspection = inspectGeminiResponse(data);
    return inspection.text;
}

exports.handler = async (event, context) => {
    const startTime = Date.now();
    const MAX_EXECUTION_MS = 24000; // Netlify functions configured with 26s timeout

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
                defaultModel: DEFAULT_MODEL,
                candidateModels: CANDIDATE_MODELS
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
        const { prompt, model: requestedModel, apiKey: clientKey, responseMimeType, maxOutputTokens } = body;

        const effectiveKey = clientKey || envKey;

        if (!effectiveKey) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'No Gemini API Key found. Please add GEMINI_API_KEY in Netlify Environment Variables or configure it in Settings.'
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

        const cleanRequestedModel = (requestedModel || '').trim().replace(/^models\//, '').trim();
        let modelsToTry = [];
        if (cleanRequestedModel) {
            modelsToTry.push(cleanRequestedModel);
        }
        for (const m of CANDIDATE_MODELS) {
            if (!modelsToTry.includes(m)) {
                modelsToTry.push(m);
            }
        }

        let lastError = null;
        let modelFailures = [];

        for (let i = 0; i < modelsToTry.length; i++) {
            // Guard against approaching Netlify gateway timeout
            if (Date.now() - startTime > MAX_EXECUTION_MS) {
                console.warn(`[Gemini Handler] Approaching timeout threshold (${Date.now() - startTime}ms), stopping fallback sequence.`);
                break;
            }

            const model = modelsToTry[i];
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
                
                const genConfig = {
                    temperature: 0.3,
                    topP: 0.85,
                    maxOutputTokens: typeof maxOutputTokens === 'number' && maxOutputTokens > 0 ? maxOutputTokens : 2000
                };
                if (responseMimeType && typeof responseMimeType === 'string') {
                    genConfig.responseMimeType = responseMimeType;
                }

                const maxPerAttempt = (modelsToTry.length - i > 1) ? 9000 : 20000;
                const remainingMs = Math.max(2500, Math.min(maxPerAttempt, MAX_EXECUTION_MS - (Date.now() - startTime)));
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
                    const normMsg = checkMsg.replace(/_/g, '');
                    if (normMsg.includes('responsemimetype') || normMsg.includes('mimetype') || normMsg.includes('generationconfig') || checkMsg.includes('unsupported') || checkMsg.includes('invalid argument') || checkMsg.includes('unknown name') || checkMsg.includes('invalid value') || checkMsg.includes('cannot find field')) {
                        delete genConfig.responseMimeType;
                        const retryRemaining = Math.max(2000, MAX_EXECUTION_MS - (Date.now() - startTime));
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

                    // Check for definitive invalid API key errors
                    const isApiKeyError = response.status === 401 || 
                        (response.status === 400 && (errLower.includes('api key not valid') || errLower.includes('invalid api key') || errLower.includes('api_key_invalid'))) ||
                        (response.status === 403 && (errLower.includes('api key') || errLower.includes('permission_denied') || errLower.includes('forbidden')));

                    if (isApiKeyError) {
                        return {
                            statusCode: 401,
                            headers,
                            body: JSON.stringify({
                                error: `Invalid Gemini API Key: ${errMsg}. Please verify your API key in Settings or Netlify environment variables.`
                            })
                        };
                    }

                    const isRateLimit = response.status === 429 || errLower.includes('quota') || errLower.includes('rate limit') || errLower.includes('resource_exhausted');

                    console.warn(`[Gemini Handler] Model ${model} returned HTTP ${response.status} (${errMsg}). Falling back to next candidate model...`);
                    modelFailures.push({ 
                        model, 
                        reason: `HTTP ${response.status}: ${errMsg}`,
                        isSafety: false,
                        isRateLimit: isRateLimit,
                        isEmpty: false
                    });
                    lastError = new Error(`Model ${model}: ${errMsg}`);

                    // Dynamically parse suggested replacement model from API error message if provided
                    const suggestedMatch = errMsg.match(/(?:use|models\/)\s*(?:models\/)?(gemini-[a-zA-Z0-9_.-]+|gemma-[a-zA-Z0-9_.-]+)/i);
                    if (suggestedMatch && suggestedMatch[1]) {
                        const suggestedModel = suggestedMatch[1].trim().replace(/^models\//, '');
                        const cleanLower = suggestedModel.toLowerCase();
                        if (!cleanLower.includes('tts') && !cleanLower.includes('audio') && !cleanLower.includes('embedding') && !cleanLower.includes('imagen') && !modelsToTry.includes(suggestedModel)) {
                            console.log(`[Gemini Handler] Dynamically queuing suggested model from API: ${suggestedModel}`);
                            modelsToTry.splice(i + 1, 0, suggestedModel);
                        }
                    }

                    // Check if dynamic model discovery should be attempted when static list ends
                    if (i === modelsToTry.length - 1 && (Date.now() - startTime < 4500)) {
                        const discovered = await discoverAvailableModels(effectiveKey);
                        const newModels = discovered.filter(m => !modelsToTry.includes(m));
                        if (newModels.length > 0) {
                            modelsToTry.push(...newModels.slice(0, 3));
                        }
                    }
                    continue;
                }

                const data = await response.json();
                const inspection = inspectGeminiResponse(data);

                if (!inspection.text) {
                    const isSafety = inspection.isBlocked && inspection.blockReason;
                    const reason = isSafety 
                        ? `Safety filter blocked (${inspection.blockReason})`
                        : `Empty content (finishReason: ${inspection.finishReason || 'unknown'})`;
                    console.warn(`[Gemini Handler] Model ${model} returned empty/blocked response: ${reason}. Falling back to next candidate model...`);
                    modelFailures.push({ 
                        model, 
                        reason,
                        isSafety: !!isSafety,
                        isRateLimit: false,
                        isEmpty: !isSafety
                    });
                    lastError = new Error(`Model ${model} returned no text (${reason})`);
                    continue;
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        text: inspection.text,
                        modelUsed: model,
                        source: clientKey ? 'client_key' : 'netlify_env'
                    })
                };
            } catch (err) {
                const isAbort = err.name === 'AbortError';
                const msg = isAbort ? 'Request timed out' : (err.message || 'Connection error');
                console.warn(`[Gemini Handler] Model ${model} encountered exception: ${msg}. Falling back...`);
                modelFailures.push({ 
                    model, 
                    reason: msg,
                    isSafety: false,
                    isRateLimit: false,
                    isEmpty: false,
                    isTimeout: isAbort
                });
                lastError = err;
            }
        }

        const failureSummary = modelFailures.map(f => `${f.model} (${f.reason})`).join(', ');
        const allBlocked = modelFailures.length > 0 && modelFailures.every(f => f.isSafety);
        const allRateLimited = modelFailures.length > 0 && modelFailures.every(f => f.isRateLimit);

        let errorMsg;
        let status = 503;

        if (allBlocked) {
            status = 400;
            errorMsg = `Content could not be generated as the prompt was flagged by Google safety filters across candidate models.`;
        } else if (allRateLimited) {
            status = 429;
            errorMsg = `Google AI rate limits or quotas exceeded across all attempted models (${modelFailures.map(f => f.model).join(', ')}). Please try again in a few moments or provide a custom API key.`;
        } else {
            status = 503;
            errorMsg = `Google AI models temporarily unavailable (${failureSummary || lastError?.message || 'Empty or busy response'}). Please try again in a moment.`;
        }

        return {
            statusCode: status,
            headers,
            body: JSON.stringify({
                error: errorMsg,
                details: failureSummary,
                attemptedModels: modelFailures.map(f => f.model)
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message || 'Internal Server Error' })
        };
    }
};

exports.extractCandidateText = extractCandidateText;
exports.inspectGeminiResponse = inspectGeminiResponse;
exports.DEFAULT_MODEL = DEFAULT_MODEL;
exports.CANDIDATE_MODELS = CANDIDATE_MODELS;
exports.discoverAvailableModels = discoverAvailableModels;

