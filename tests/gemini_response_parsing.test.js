/**
 * tests/gemini_response_parsing.test.js
 * Comprehensive automated unit tests for Gemini response parsing across netlify/functions/gemini.js and js/ai.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const netlifyGemini = require('../netlify/functions/gemini.js');
const { inspectGeminiResponse, extractCandidateText } = netlifyGemini;

describe('Gemini Response Parsing & Safety Filter Inspection', () => {
    test('handles standard candidate with text parts', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'This is a test response summary.' }],
                        role: 'model'
                    },
                    finishReason: 'STOP'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'This is a test response summary.');
        assert.equal(result.finishReason, 'STOP');
        assert.equal(result.isBlocked, false);
        assert.equal(extractCandidateText(payload), 'This is a test response summary.');
    });

    test('handles multiple parts and trims whitespace', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: '  First paragraph.  ' },
                            { text: 'Second paragraph.' }
                        ]
                    },
                    finishReason: 'STOP'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'First paragraph.\n\nSecond paragraph.');
        assert.equal(extractCandidateText(payload), 'First paragraph.\n\nSecond paragraph.');
    });

    test('handles thinking tokens with final response parts', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [
                            { thought: true, text: 'Let me think about how to synthesize this compliance report...' },
                            { text: '## Executive Overview\nThe school demonstrates high compliance.' }
                        ]
                    },
                    finishReason: 'STOP'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, '## Executive Overview\nThe school demonstrates high compliance.');
        assert.equal(result.isBlocked, false);
    });

    test('falls back to thought text if only thinking parts are generated', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [
                            { thought: true, text: 'Generating preliminary audit notes...' }
                        ]
                    },
                    finishReason: 'MAX_TOKENS'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Generating preliminary audit notes...');
        assert.equal(result.finishReason, 'MAX_TOKENS');
    });

    test('handles safety finish reason (SAFETY)', () => {
        const payload = {
            candidates: [
                {
                    finishReason: 'SAFETY',
                    safetyRatings: [
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' }
                    ]
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, '');
        assert.equal(result.finishReason, 'SAFETY');
        assert.equal(result.blockReason, 'SAFETY');
        assert.equal(result.isBlocked, true);
        assert.equal(extractCandidateText(payload), '');
    });

    test('handles recitation and blocklist finish reasons', () => {
        const payloadRecitation = {
            candidates: [{ finishReason: 'RECITATION' }]
        };
        const resRecitation = inspectGeminiResponse(payloadRecitation);
        assert.equal(resRecitation.text, '');
        assert.equal(resRecitation.blockReason, 'RECITATION');
        assert.equal(resRecitation.isBlocked, true);

        const payloadBlocklist = {
            candidates: [{ finishReason: 'BLOCKLIST' }]
        };
        const resBlocklist = inspectGeminiResponse(payloadBlocklist);
        assert.equal(resBlocklist.text, '');
        assert.equal(resBlocklist.blockReason, 'BLOCKLIST');
        assert.equal(resBlocklist.isBlocked, true);
    });

    test('handles promptFeedback blocking', () => {
        const payload = {
            promptFeedback: {
                blockReason: 'SAFETY',
                safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' }]
            },
            candidates: []
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, '');
        assert.equal(result.blockReason, 'SAFETY');
        assert.equal(result.isBlocked, true);
    });

    test('extracts from second candidate if first candidate was blocked/empty', () => {
        const payload = {
            candidates: [
                {
                    finishReason: 'SAFETY',
                    content: { parts: [{ text: '' }] }
                },
                {
                    content: { parts: [{ text: 'Valid alternative candidate response.' }] },
                    finishReason: 'STOP'
                }
            ]
        };

        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Valid alternative candidate response.');
        assert.equal(result.finishReason, 'STOP');
        assert.equal(result.isBlocked, false);
    });

    test('handles non-standard candidate formats (candidate.text, candidate.output, candidate.content string, raw string, message.content)', () => {
        const formatText = { candidates: [{ text: 'Direct candidate text field' }] };
        assert.equal(extractCandidateText(formatText), 'Direct candidate text field');

        const formatOutput = { candidates: [{ output: 'Direct candidate output field' }] };
        assert.equal(extractCandidateText(formatOutput), 'Direct candidate output field');

        const formatContentString = { candidates: [{ content: 'Direct content string' }] };
        assert.equal(extractCandidateText(formatContentString), 'Direct content string');

        const formatRawStringCandidate = { candidates: ['Direct raw string candidate'] };
        assert.equal(extractCandidateText(formatRawStringCandidate), 'Direct raw string candidate');

        const formatContentPartsString = { candidates: [{ content: { parts: 'Direct content parts string' } }] };
        assert.equal(extractCandidateText(formatContentPartsString), 'Direct content parts string');

        const formatCandidatePartsString = { candidates: [{ parts: 'Direct candidate parts string' }] };
        assert.equal(extractCandidateText(formatCandidatePartsString), 'Direct candidate parts string');

        const formatMessageContent = { candidates: [{ message: { content: 'Direct message content' } }] };
        assert.equal(extractCandidateText(formatMessageContent), 'Direct message content');

        const formatPartContent = { candidates: [{ content: { parts: [{ content: 'Part content string' }] } }] };
        assert.equal(extractCandidateText(formatPartContent), 'Part content string');

        const formatRootText = { text: 'Direct root text' };
        assert.equal(extractCandidateText(formatRootText), 'Direct root text');
    });

    test('handles FINISH_REASON_ prefix and case variations for safety blocks', () => {
        const payload1 = { candidates: [{ finishReason: 'FINISH_REASON_SAFETY' }] };
        const res1 = inspectGeminiResponse(payload1);
        assert.equal(res1.isBlocked, true);
        assert.equal(res1.text, '');

        const payload2 = { candidates: [{ finishReason: 'safety' }] };
        const res2 = inspectGeminiResponse(payload2);
        assert.equal(res2.isBlocked, true);

        const payload3 = { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] };
        const res3 = inspectGeminiResponse(payload3);
        assert.equal(res3.isBlocked, true);
    });

    test('handles thought flag as boolean string or boolean value accurately', () => {
        const payloadThoughtStr = {
            candidates: [{
                content: {
                    parts: [
                        { thought: 'true', text: 'Internal thought' },
                        { thought: 'false', text: 'Actual response' }
                    ]
                },
                finishReason: 'STOP'
            }]
        };
        const res = inspectGeminiResponse(payloadThoughtStr);
        assert.equal(res.text, 'Actual response');
    });

    test('handles finishReason OTHER as non-blocked empty response when no text is present', () => {
        const payload = {
            candidates: [{ finishReason: 'OTHER', content: { parts: [{ text: '' }] } }]
        };
        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, '');
        assert.equal(result.finishReason, 'OTHER');
        assert.equal(result.blockReason, null);
        assert.equal(result.isBlocked, false);
    });

    test('handles response object wrapper (data.response.candidates)', () => {
        const payload = {
            response: {
                candidates: [
                    { content: { parts: [{ text: 'Nested response text.' }] }, finishReason: 'STOP' }
                ]
            }
        };
        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Nested response text.');
        assert.equal(result.isBlocked, false);
    });

    test('handles candidate content directly as an array of parts', () => {
        const payload = {
            candidates: [
                {
                    content: [
                        { text: 'Direct content array part 1.' },
                        { text: 'Direct content array part 2.' }
                    ],
                    finishReason: 'STOP'
                }
            ]
        };
        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Direct content array part 1.\n\nDirect content array part 2.');
        assert.equal(result.isBlocked, false);
    });

    test('handles candidate message content as an array of parts', () => {
        const payload = {
            candidates: [
                {
                    message: {
                        content: [
                            { text: 'Message content array part 1.' }
                        ]
                    },
                    finishReason: 'STOP'
                }
            ]
        };
        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Message content array part 1.');
        assert.equal(result.isBlocked, false);
    });

    test('handles array of response chunks aggregated from streaming or batch', () => {
        const payloadArray = [
            {
                candidates: [
                    { content: { parts: [{ text: 'Chunk 1 response' }] }, finishReason: 'STOP' }
                ]
            },
            {
                candidates: [
                    { content: { parts: [{ text: 'Chunk 2 response' }] }, finishReason: 'STOP' }
                ]
            }
        ];
        const result = inspectGeminiResponse(payloadArray);
        assert.equal(result.text, 'Chunk 1 response\n\nChunk 2 response');
        assert.equal(result.isBlocked, false);
    });

    test('handles promptFeedback and candidate safetyRatings blocked flags', () => {
        const promptBlockPayload = {
            promptFeedback: {
                safetyRatings: [
                    { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'HIGH', blocked: true }
                ]
            },
            candidates: []
        };
        const resPrompt = inspectGeminiResponse(promptBlockPayload);
        assert.equal(resPrompt.isBlocked, true);
        assert.equal(resPrompt.text, '');
        assert.equal(resPrompt.blockReason, 'HARM_CATEGORY_HATE_SPEECH');

        const candBlockPayload = {
            candidates: [
                {
                    safetyRatings: [
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH', blocked: true }
                    ],
                    finishReason: 'STOP'
                }
            ]
        };
        const resCand = inspectGeminiResponse(candBlockPayload);
        assert.equal(resCand.isBlocked, true);
        assert.equal(resCand.text, '');
    });

    test('handles part.part and part.text.value object formats', () => {
        const payload = {
            candidates: [
                {
                    content: {
                        parts: [
                            { part: 'Text in part.part field' },
                            { text: { value: 'Text in part.text.value field' } }
                        ]
                    },
                    finishReason: 'STOP'
                }
            ]
        };
        const result = inspectGeminiResponse(payload);
        assert.equal(result.text, 'Text in part.part field\n\nText in part.text.value field');
    });

    test('handles empty parts, null, undefined, and non-object inputs safely without throwing', () => {
        assert.equal(extractCandidateText(null), '');
        assert.equal(extractCandidateText(undefined), '');
        assert.equal(extractCandidateText({}), '');
        assert.equal(extractCandidateText([]), '');
        assert.equal(extractCandidateText({ candidates: [] }), '');
        assert.equal(extractCandidateText({ candidates: [{ content: { parts: [{ text: '   ' }] } }] }), '');
        assert.equal(extractCandidateText({ candidates: [{ content: { parts: [] } }] }), '');
        assert.equal(extractCandidateText('random string'), '');
        assert.equal(extractCandidateText(12345), '');
    });
});
