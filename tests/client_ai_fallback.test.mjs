/**
 * tests/client_ai_fallback.test.mjs
 * Automated tests verifying client-side AI functions and direct client fallback in js/ai.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up browser-like globals for ES module import of js/ai.js
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

global.document = {
    getElementById() { return null; }
};

const {
    DEFAULT_MODEL,
    CANDIDATE_MODELS,
    getGeminiModel,
    setGeminiModel,
    getGeminiApiKey,
    setGeminiApiKey,
    inspectGeminiResponse,
    extractCandidateText,
    renderMarkdown,
    parseAIEnhancementResponse,
    parseAIRiskResponse,
    callGeminiAPI
} = await import('../js/ai.js');

describe('Client-side AI Module (js/ai.js)', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.localStorage.clear();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('model settings and candidates list are properly configured', () => {
        assert.equal(DEFAULT_MODEL, 'gemini-3.5-flash-lite');
        assert.ok(CANDIDATE_MODELS.includes('gemini-3.5-flash-lite'));
        assert.ok(CANDIDATE_MODELS.includes('gemini-3.7-flash'));
        assert.ok(CANDIDATE_MODELS.includes('gemini-3.6-flash'));

        assert.equal(getGeminiModel(), 'gemini-3.5-flash-lite');
        setGeminiModel('gemini-3.7-flash');
        assert.equal(getGeminiModel(), 'gemini-3.7-flash');
        // Obsolete models auto-migrate to DEFAULT_MODEL
        setGeminiModel('gemini-2.0-flash');
        assert.equal(getGeminiModel(), 'gemini-3.5-flash-lite');
    });

    test('API key getter and setter manage localStorage', () => {
        assert.equal(getGeminiApiKey(), '');
        setGeminiApiKey('AIzaSyTestKey123');
        assert.equal(getGeminiApiKey(), 'AIzaSyTestKey123');
        setGeminiApiKey('');
        assert.equal(getGeminiApiKey(), '');
    });

    test('inspectGeminiResponse matches server parsing behavior', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [
                            { thought: true, text: 'Thinking token stream...' },
                            { text: 'Final client summary content.' }
                        ]
                    },
                    finishReason: 'STOP'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Final client summary content.');
        assert.equal(result.isBlocked, false);
    });

    test('callGeminiAPI cascades from empty Netlify response to direct client fallback', async () => {
        const attemptedEndpoints = [];

        global.fetch = async (url, options) => {
            const urlStr = String(url);
            attemptedEndpoints.push(urlStr);

            if (urlStr.includes('/.netlify/functions/gemini')) {
                // Netlify returns 503 error (simulating serverless function failure)
                return {
                    ok: false,
                    status: 503,
                    statusText: 'Service Unavailable',
                    json: async () => ({ error: 'Netlify backend temporarily busy' })
                };
            }

            if (urlStr.includes('generativelanguage.googleapis.com')) {
                const modelMatch = urlStr.match(/\/models\/([^:]+):generateContent/);
                const model = modelMatch ? modelMatch[1] : '';

                if (model === 'gemini-3.5-flash-lite') {
                    // Primary model direct call returns empty response
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }]
                        })
                    };
                } else if (model === 'gemini-3.7-flash') {
                    // Fallback model direct call succeeds
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            candidates: [{ content: { parts: [{ text: 'Direct client fallback succeeded.' }] }, finishReason: 'STOP' }]
                        })
                    };
                }
            }

            return {
                ok: false,
                status: 500,
                json: async () => ({ error: { message: 'Server error' } })
            };
        };

        const result = await callGeminiAPI('test_client_key_456', 'Generate audit report', 'gemini-3.5-flash-lite');
        assert.equal(result.text, 'Direct client fallback succeeded.');
        assert.equal(result.modelUsed, 'gemini-3.7-flash');
    });

    test('callGeminiAPI with missing key and failing Netlify throws clear error', async () => {
        global.fetch = async (url) => {
            if (String(url).includes('/.netlify/functions/gemini')) {
                return {
                    ok: false,
                    status: 400,
                    json: async () => ({ error: 'No Gemini API Key found. Please configure GEMINI_API_KEY.' })
                };
            }
            return { ok: false, status: 404 };
        };

        await assert.rejects(
            async () => {
                await callGeminiAPI('', 'Test prompt');
            },
            (err) => {
                assert.ok(err.message.includes('No Gemini API key found'));
                return true;
            }
        );
    });

    test('callGeminiAPI with rate limit 429 across all models throws informative rate limit error', async () => {
        global.fetch = async (url) => {
            if (String(url).includes('/.netlify/functions/gemini')) {
                return { ok: false, status: 404 };
            }
            return {
                ok: false,
                status: 429,
                json: async () => ({ error: { message: 'Quota exceeded for model' } })
            };
        };

        await assert.rejects(
            async () => {
                await callGeminiAPI('test_client_key', 'Test prompt');
            },
            (err) => {
                assert.ok(err.message.includes('rate limits') || err.message.includes('Quota'));
                return true;
            }
        );
    });

    test('callGeminiAPI with invalid API key throws immediate actionable error', async () => {
        global.fetch = async (url) => {
            if (String(url).includes('/.netlify/functions/gemini')) {
                return { ok: false, status: 404 };
            }
            return {
                ok: false,
                status: 400,
                json: async () => ({ error: { message: 'API_KEY_INVALID: API key not valid.' } })
            };
        };

        await assert.rejects(
            async () => {
                await callGeminiAPI('bad_key', 'Test prompt');
            },
            (err) => {
                assert.ok(err.message.includes('Invalid Gemini API Key'));
                return true;
            }
        );
    });

    test('parseAIEnhancementResponse handles JSON, markdown fences, and text sections', () => {
        const jsonWithFences = '```json\n{"aiFeatures": "Security camera coverage", "aiGaps": "Missing fire drills", "aiActions": "Schedule quarterly drills"}\n```';
        const parsed1 = parseAIEnhancementResponse(jsonWithFences);
        assert.equal(parsed1.aiFeatures, 'Security camera coverage');
        assert.equal(parsed1.aiGaps, 'Missing fire drills');
        assert.equal(parsed1.aiActions, 'Schedule quarterly drills');

        const fallbackParsed = parseAIEnhancementResponse(null);
        assert.equal(fallbackParsed.aiFeatures, '');
        assert.equal(fallbackParsed.aiGaps, '');
        assert.equal(fallbackParsed.aiActions, '');
    });

    test('callGeminiAPI when all direct models are blocked by safety filters throws safety error', async () => {
        global.fetch = async (url) => {
            if (String(url).includes('/.netlify/functions/gemini')) {
                return { ok: false, status: 404 };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ finishReason: 'SAFETY' }]
                })
            };
        };

        await assert.rejects(
            async () => {
                await callGeminiAPI('test_client_key', 'Blocked content');
            },
            (err) => {
                assert.ok(err.message.includes('safety filters'));
                return true;
            }
        );
    });

    test('callGeminiAPI direct client cascades on network timeout abort to next model and succeeds', async () => {
        global.fetch = async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/.netlify/functions/gemini')) {
                return { ok: false, status: 404 };
            }
            if (urlStr.includes('gemini-3.5-flash-lite')) {
                const abortErr = new Error('The operation was aborted');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Cascaded past timeout successfully.' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const res = await callGeminiAPI('test_client_key', 'Prompt', 'gemini-3.5-flash-lite');
        assert.equal(res.text, 'Cascaded past timeout successfully.');
        assert.equal(res.modelUsed, 'gemini-3.7-flash');
    });

    test('callGeminiAPI cascades when Netlify returns 200 with empty text without stream lock errors', async () => {
        global.fetch = async (url) => {
            const urlStr = String(url);
            if (urlStr.includes('/.netlify/functions/gemini')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ text: '' })
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Recovered via direct client fallback.' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const res = await callGeminiAPI('test_client_key', 'Prompt');
        assert.equal(res.text, 'Recovered via direct client fallback.');
    });

    test('inspectGeminiResponse handles non-standard candidate formats and root fields', () => {
        assert.equal(extractCandidateText({ text: 'Root text direct' }), 'Root text direct');
        assert.equal(extractCandidateText({ candidates: [{ output: 'Output direct' }] }), 'Output direct');
        assert.equal(extractCandidateText({ candidates: [{ content: 'Content string direct' }] }), 'Content string direct');
        assert.equal(extractCandidateText({ candidates: ['Raw candidate string'] }), 'Raw candidate string');
        assert.equal(extractCandidateText({ candidates: [{ message: { content: 'Candidate message' } }] }), 'Candidate message');
        assert.equal(extractCandidateText({ candidates: [{ parts: 'Direct candidate parts string' }] }), 'Direct candidate parts string');
    });

    test('parseAIRiskResponse extracts severity and multiplier adjustments', () => {
        const jsonRisk = '{"severity": "Critical", "suggestedMultiplier": 3, "suggestedScore": 1, "rationale": "High voltage wiring exposed."}';
        const parsedRisk = parseAIRiskResponse(jsonRisk, 2, 3);
        assert.equal(parsedRisk.severity, 'Critical');
        assert.equal(parsedRisk.suggestedMultiplier, 3);
        assert.equal(parsedRisk.suggestedScore, 1);
        assert.equal(parsedRisk.scoreDelta, -2);
    });

    test('parseAIEnhancementResponse and parseAIRiskResponse handle pre-parsed objects safely', () => {
        const objEnhance = {
            aiFeatures: 'Features from object',
            aiGaps: 'Gaps from object',
            aiActions: 'Actions from object'
        };
        const parsedEnhance = parseAIEnhancementResponse(objEnhance);
        assert.equal(parsedEnhance.aiFeatures, 'Features from object');
        assert.equal(parsedEnhance.aiGaps, 'Gaps from object');
        assert.equal(parsedEnhance.aiActions, 'Actions from object');

        const objRisk = {
            severity: 'High',
            suggestedMultiplier: 3,
            suggestedScore: 2,
            rationale: 'Risk rationale from object'
        };
        const parsedRisk = parseAIRiskResponse(objRisk, 2, 3);
        assert.equal(parsedRisk.severity, 'High');
        assert.equal(parsedRisk.suggestedMultiplier, 3);
        assert.equal(parsedRisk.suggestedScore, 2);
        assert.equal(parsedRisk.scoreDelta, -1);
    });

    test('callGeminiAPI when network fails and no client key exists gives clear actionable prompt', async () => {
        global.fetch = async () => {
            const netErr = new TypeError('Failed to fetch');
            throw netErr;
        };

        await assert.rejects(
            async () => {
                await callGeminiAPI('', 'Prompt text');
            },
            (err) => {
                assert.ok(err.message.includes('No Gemini API key found'));
                assert.ok(err.message.includes('Settings'));
                return true;
            }
        );
    });

    test('callGeminiAPI direct client retries without responseMimeType when model rejects response_mime_type', async () => {
        const attempts = [];
        global.fetch = async (url, options) => {
            const urlStr = String(url);
            if (urlStr.includes('/.netlify/functions/gemini')) {
                return { ok: false, status: 404 };
            }

            const body = JSON.parse(options.body);
            attempts.push(body.generationConfig?.responseMimeType);

            if (body.generationConfig?.responseMimeType) {
                return {
                    ok: false,
                    status: 400,
                    clone: () => ({
                        json: async () => ({ error: { message: 'Invalid JSON payload received. Unknown name "response_mime_type" at generation_config' } })
                    }),
                    json: async () => ({ error: { message: 'Invalid JSON payload received. Unknown name "response_mime_type" at generation_config' } })
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: '{"aiFeatures": "Success after retry"}' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const res = await callGeminiAPI('client_key_123', 'Prompt', 'gemini-2.0-flash', { responseMimeType: 'application/json' });
        assert.equal(res.text, '{"aiFeatures": "Success after retry"}');
        assert.equal(attempts.length, 2);
        assert.equal(attempts[0], 'application/json');
        assert.equal(attempts[1], undefined);
    });
});
