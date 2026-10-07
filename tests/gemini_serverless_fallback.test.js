/**
 * tests/gemini_serverless_fallback.test.js
 * Automated tests verifying multi-tier model fallback cascading on empty response, 503, 429, safety blocks.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const netlifyGemini = require('../netlify/functions/gemini.js');

describe('Netlify Serverless Function & Multi-tier Fallback', () => {
    const originalFetch = global.fetch;
    const originalEnv = process.env.GEMINI_API_KEY;

    beforeEach(() => {
        process.env.GEMINI_API_KEY = 'test_server_key_12345';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env.GEMINI_API_KEY = originalEnv;
    });

    test('GET healthcheck returns server key status and candidate models', async () => {
        const event = { httpMethod: 'GET' };
        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.ok, true);
        assert.equal(body.hasServerKey, true);
        assert.equal(body.defaultModel, 'gemini-3.5-flash-lite');
        assert.ok(Array.isArray(body.candidateModels));
        assert.ok(body.candidateModels.includes('gemini-3.5-flash-lite'));
        assert.ok(body.candidateModels.includes('gemini-3.7-flash'));
        assert.ok(body.candidateModels.includes('gemini-3.6-flash'));
    });

    test('OPTIONS returns CORS headers with 200', async () => {
        const event = { httpMethod: 'OPTIONS' };
        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
    });

    test('rejects missing prompt with 400', async () => {
        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: '' })
        };
        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('Missing prompt text'));
    });

    test('rejects missing API key when no env or client key exists', async () => {
        delete process.env.GEMINI_API_KEY;
        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Hello' })
        };
        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('No Gemini API Key found'));
    });

    test('primary model returning empty response cleanly cascades to fallback model and succeeds', async () => {
        const attemptedModels = [];

        global.fetch = async (url, options) => {
            const urlStr = String(url);
            if (urlStr.includes('/models?key=')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ models: [] })
                };
            }
            const modelMatch = urlStr.match(/\/models\/([^:]+):generateContent/);
            const model = modelMatch ? modelMatch[1] : 'unknown';
            attemptedModels.push(model);

            if (model === 'gemini-3.5-flash-lite') {
                // Primary model returns empty content (empty parts)
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [
                            {
                                content: { parts: [{ text: '' }] },
                                finishReason: 'STOP'
                            }
                        ]
                    })
                };
            } else if (model === 'gemini-3.7-flash') {
                // Fallback model returns valid content
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [
                            {
                                content: { parts: [{ text: 'Executive summary generated successfully via fallback.' }] },
                                finishReason: 'STOP'
                            }
                        ]
                    })
                };
            }

            return {
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: async () => ({ error: { message: 'Service Unavailable' } })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                prompt: 'Generate compliance summary',
                model: 'gemini-3.5-flash-lite'
            })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Executive summary generated successfully via fallback.');
        assert.equal(body.modelUsed, 'gemini-3.7-flash');
        assert.equal(body.source, 'netlify_env');

        assert.deepEqual(attemptedModels.slice(0, 2), ['gemini-3.5-flash-lite', 'gemini-3.7-flash']);
    });

    test('primary model returning 503 Service Unavailable cleanly cascades to fallback model and succeeds', async () => {
        const attemptedModels = [];

        global.fetch = async (url) => {
            const urlStr = String(url);
            const modelMatch = urlStr.match(/\/models\/([^:]+):generateContent/);
            const model = modelMatch ? modelMatch[1] : 'unknown';
            attemptedModels.push(model);

            if (model === 'gemini-3.5-flash-lite') {
                return {
                    ok: false,
                    status: 503,
                    statusText: 'Service Unavailable',
                    json: async () => ({
                        error: { message: 'The model is overloaded. Please try again later.' }
                    })
                };
            } else if (model === 'gemini-3.7-flash') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [
                            {
                                content: { parts: [{ text: 'Summary generated after 503 cascade.' }] },
                                finishReason: 'STOP'
                            }
                        ]
                    })
                };
            }

            return {
                ok: false,
                status: 500,
                json: async () => ({ error: { message: 'Internal Server Error' } })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Generate summary', model: 'gemini-3.5-flash-lite' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Summary generated after 503 cascade.');
        assert.equal(body.modelUsed, 'gemini-3.7-flash');
    });

    test('primary model returning safety filter block cascades to fallback model and succeeds', async () => {
        global.fetch = async (url) => {
            const urlStr = String(url);
            const modelMatch = urlStr.match(/\/models\/([^:]+):generateContent/);
            const model = modelMatch ? modelMatch[1] : 'unknown';

            if (model === 'gemini-3.5-flash-lite') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [{ finishReason: 'SAFETY' }]
                    })
                };
            } else if (model === 'gemini-3.7-flash') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [
                            {
                                content: { parts: [{ text: 'Safe synthesis generated from fallback model.' }] },
                                finishReason: 'STOP'
                            }
                        ]
                    })
                };
            }
            return {
                ok: false,
                status: 500,
                json: async () => ({ error: { message: 'Server Error' } })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Risk analysis', model: 'gemini-3.5-flash-lite' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Safe synthesis generated from fallback model.');
        assert.equal(body.modelUsed, 'gemini-3.7-flash');
    });

    test('invalid API key (401) stops immediately without useless cascading', async () => {
        let fetchCalls = 0;
        global.fetch = async () => {
            fetchCalls++;
            return {
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({
                    error: { message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.' }
                })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Test prompt' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 401);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('Invalid Gemini API Key'));
        assert.equal(fetchCalls, 1); // Immediate stop on invalid credentials
    });

    test('when all candidate models return rate limit (429), returns 429 with rate limit message', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({
                error: { message: 'Resource has been exhausted (e.g. check quota).' }
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Test prompt' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 429);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('rate limits or quotas exceeded'));
        assert.ok(Array.isArray(body.attemptedModels));
    });

    test('when all candidate models return empty responses, returns 503 with diagnostic details', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'OTHER' }]
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Test prompt' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 503);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('temporarily unavailable'));
        assert.ok(body.details.includes('Empty content'));
    });

    test('when all candidate models are blocked by safety filters, returns 400 with safety filter diagnostic', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [{ finishReason: 'SAFETY' }]
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Blocked prompt content' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.ok(body.error.includes('safety filters'));
    });

    test('primary model timeout exception cascades to fallback model and succeeds', async () => {
        let attempts = 0;
        global.fetch = async (url) => {
            attempts++;
            const urlStr = String(url);
            if (urlStr.includes('gemini-3.5-flash-lite')) {
                const abortErr = new Error('The operation was aborted');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Response after primary timeout.' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Test prompt', model: 'gemini-3.5-flash-lite' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Response after primary timeout.');
        assert.equal(body.modelUsed, 'gemini-3.7-flash');
    });

    test('retries without responseMimeType if model returns unsupported responseMimeType error', async () => {
        let calls = [];
        global.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            calls.push(body.generationConfig);

            if (body.generationConfig?.responseMimeType) {
                return {
                    ok: false,
                    status: 400,
                    statusText: 'Bad Request',
                    clone: () => ({
                        json: async () => ({ error: { message: 'response_mime_type is unsupported for this model' } })
                    }),
                    json: async () => ({ error: { message: 'response_mime_type is unsupported for this model' } })
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: '{"aiFeatures":"Valid JSON"}' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Enhance', responseMimeType: 'application/json' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, '{"aiFeatures":"Valid JSON"}');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].responseMimeType, 'application/json');
        assert.equal(calls[1].responseMimeType, undefined);
    });

    test('handles requested model with models/ prefix and surrounding whitespace', async () => {
        let calledUrl = '';
        global.fetch = async (url) => {
            calledUrl = String(url);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: 'Handled with clean model URL.' }] }, finishReason: 'STOP' }]
                })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                prompt: 'Test prompt',
                model: '  models/gemini-1.5-pro  '
            })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.modelUsed, 'gemini-1.5-pro');
        assert.ok(calledUrl.includes('/models/gemini-1.5-pro:generateContent'));
    });

    test('handles candidate content formatted as direct array of parts in handler', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [
                    {
                        content: [{ text: 'Direct array content output.' }],
                        finishReason: 'STOP'
                    }
                ]
            })
        });

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ prompt: 'Test prompt' })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Direct array content output.');
    });

    test('dynamically cascades to suggested replacement model when API returns 404 deprecation guidance', async () => {
        const attemptedModels = [];
        global.fetch = async (url) => {
            if (url.includes('models/old-deprecated-model')) {
                attemptedModels.push('old-deprecated-model');
                return {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    json: async () => ({
                        error: {
                            message: 'This model models/old-deprecated-model is no longer available. Please update your code to use models/gemini-3.6-flash for the latest features.'
                        }
                    })
                };
            }
            if (url.includes('models/gemini-3.6-flash')) {
                attemptedModels.push('gemini-3.6-flash');
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [
                            {
                                content: {
                                    parts: [{ text: 'Output from suggested replacement model!' }]
                                },
                                finishReason: 'STOP'
                            }
                        ]
                    })
                };
            }
            return {
                ok: false,
                status: 404,
                json: async () => ({ error: { message: 'Not found' } })
            };
        };

        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({
                prompt: 'Test prompt',
                model: 'old-deprecated-model'
            })
        };

        const response = await netlifyGemini.handler(event, {});
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.text, 'Output from suggested replacement model!');
        assert.equal(body.modelUsed, 'gemini-3.6-flash');
        assert.ok(attemptedModels.includes('old-deprecated-model'));
        assert.ok(attemptedModels.includes('gemini-3.6-flash'));
    });
});
