/**
 * tests/ai_batch_pipeline.test.mjs
 * Automated unit tests for Category-Level Batch AI Enhancement,
 * Dynamic Risk Batch Assessment, and the Full Audit AI Pipeline.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up mock browser environment
globalThis.window = globalThis;
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.sessionStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

const createMockElement = (id = '') => ({
    id,
    classList: {
        _classes: new Set(['hidden']),
        contains(cls) { return this._classes.has(cls); },
        add(cls) { this._classes.add(cls); },
        remove(cls) { this._classes.delete(cls); },
        toggle(cls) { if (this._classes.has(cls)) this._classes.delete(cls); else this._classes.add(cls); }
    },
    value: '',
    textContent: '',
    innerHTML: '',
    innerText: '',
    style: {},
    disabled: false,
    focus() {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    removeChild() {},
    remove() {},
    replaceWith() {},
    querySelector() { return createMockElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    cloneNode() { return createMockElement(); }
});

const mockElements = {};
globalThis.document = {
    body: createMockElement('body'),
    createElement(tag) {
        return createMockElement(tag);
    },
    getElementById(id) {
        if (!mockElements[id]) {
            mockElements[id] = createMockElement(id);
        }
        return mockElements[id];
    },
    querySelectorAll() { return []; },
    addEventListener() {}
};

import { CATEGORIES } from '../js/config.js';
import { state } from '../js/state.js';
import { 
    parseAIEnhancementBatchResponse, 
    parseAIRiskBatchResponse,
    enhanceCategoryBatch,
    analyzeCategoryDynamicRisksBatch,
    runFullAuditAIPipeline,
    cancelAIPipeline,
    setGeminiApiKey
} from '../js/ai.js';

describe('Batch AI Processing & Full Audit Pipeline', () => {
    const origFetch = globalThis.fetch;

    beforeEach(() => {
        setGeminiApiKey('test-batch-api-key');
        // Reset state auditData
        state.auditData = {};
        Object.keys(CATEGORIES).forEach(cat => {
            state.auditData[cat] = {};
            Object.keys(CATEGORIES[cat].indicators).forEach(ind => {
                state.auditData[cat][ind] = {
                    score: 3,
                    features: '',
                    aiFeatures: '',
                    gaps: '',
                    aiGaps: '',
                    actions: '',
                    aiActions: '',
                    customMultiplier: null,
                    riskSeverity: '',
                    riskRationale: '',
                    riskApplied: false
                };
            });
        });
    });

    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    test('parseAIEnhancementBatchResponse parses structured indicators JSON object', () => {
        const payload = JSON.stringify({
            indicators: {
                "Fire Safety & Evacuation": {
                    aiFeatures: "Compliant fire hydrants and extinguishers stationed at 30m intervals.",
                    aiGaps: "Secondary exit signage obstructed in North Wing.",
                    aiActions: "Clear obstruction and install photoluminescent signage."
                },
                "Structural Safety & Building Integrity": {
                    aiFeatures: "Structural audit certificate valid through 2027.",
                    aiGaps: "",
                    aiActions: ""
                }
            }
        });

        const parsed = parseAIEnhancementBatchResponse(payload);
        assert.ok(parsed["Fire Safety & Evacuation"]);
        assert.equal(parsed["Fire Safety & Evacuation"].aiFeatures, "Compliant fire hydrants and extinguishers stationed at 30m intervals.");
        assert.equal(parsed["Fire Safety & Evacuation"].aiGaps, "Secondary exit signage obstructed in North Wing.");
        assert.equal(parsed["Fire Safety & Evacuation"].aiActions, "Clear obstruction and install photoluminescent signage.");
        assert.ok(parsed["Structural Safety & Building Integrity"]);
    });

    test('parseAIEnhancementBatchResponse strips markdown fences and handles malformed text gracefully', () => {
        const payload = "```json\n" + JSON.stringify({
            indicators: {
                "Electrical Safety": {
                    aiFeatures: "MCBs installed on all distribution panels.",
                    aiGaps: "Unterminated conduit in server room.",
                    aiActions: "Install junction boxes and terminate conduit."
                }
            }
        }) + "\n```";

        const parsed = parseAIEnhancementBatchResponse(payload);
        assert.ok(parsed["Electrical Safety"]);
        assert.equal(parsed["Electrical Safety"].aiFeatures, "MCBs installed on all distribution panels.");

        // Fallback for null/empty
        assert.deepEqual(parseAIEnhancementBatchResponse(""), {});
        assert.deepEqual(parseAIEnhancementBatchResponse(null), {});
    });

    test('parseAIRiskBatchResponse parses risk severity, multiplier, and score calibration', () => {
        const payload = JSON.stringify({
            indicators: {
                "Fire Safety & Evacuation": {
                    severity: "Critical",
                    suggestedMultiplier: 3,
                    suggestedScore: 2,
                    scoreDelta: -1,
                    rationale: "Obstructed emergency egress poses statutory and life-safety liabilities."
                },
                "Perimeter Security & Boundary Wall": {
                    severity: "Low",
                    suggestedMultiplier: 1,
                    suggestedScore: 4,
                    scoreDelta: 1,
                    rationale: "Access control fully automated with zero perimeter vulnerabilities."
                }
            }
        });

        const parsed = parseAIRiskBatchResponse(payload);
        assert.ok(parsed["Fire Safety & Evacuation"]);
        assert.equal(parsed["Fire Safety & Evacuation"].severity, "Critical");
        assert.equal(parsed["Fire Safety & Evacuation"].suggestedMultiplier, 3);
        assert.equal(parsed["Fire Safety & Evacuation"].suggestedScore, 2);

        assert.ok(parsed["Perimeter Security & Boundary Wall"]);
        assert.equal(parsed["Perimeter Security & Boundary Wall"].severity, "Low");
        assert.equal(parsed["Perimeter Security & Boundary Wall"].suggestedMultiplier, 1);
    });

    test('enhanceCategoryBatch enhances populated indicators and stages them without overwriting raw notes', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        // Seed raw notes
        state.auditData[firstCat][firstInd].features = "Good extinguishers.";
        state.auditData[firstCat][firstInd].gaps = "Missing inspection tag.";
        state.auditData[firstCat][firstInd].actions = "Tag them.";

        globalThis.fetch = async (url) => {
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    indicators: {
                                        [firstInd]: {
                                            aiFeatures: "Extinguishers are hydrostatically tested and compliant with NFPA standards.",
                                            aiGaps: "Statutory monthly inspection tags missing on 2 extinguishers.",
                                            aiActions: "Execute monthly inspection audit and affix tamper-evident compliance tags."
                                        }
                                    }
                                })
                            }]
                        },
                        finishReason: 'STOP'
                    }]
                })
            };
        };

        const result = await enhanceCategoryBatch(firstCat);
        assert.equal(result.enhancedCount, 1);

        const indData = state.auditData[firstCat][firstInd];
        // Raw notes must remain intact
        assert.equal(indData.features, "Good extinguishers.");
        assert.equal(indData.gaps, "Missing inspection tag.");
        assert.equal(indData.actions, "Tag them.");

        // Staged AI notes populated
        assert.equal(indData.aiFeatures, "Extinguishers are hydrostatically tested and compliant with NFPA standards.");
        assert.equal(indData.aiGaps, "Statutory monthly inspection tags missing on 2 extinguishers.");
        assert.equal(indData.aiActions, "Execute monthly inspection audit and affix tamper-evident compliance tags.");
    });

    test('analyzeCategoryDynamicRisksBatch stages risk recommendation without altering customMultiplier or riskApplied', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        state.auditData[firstCat][firstInd].score = 2;
        state.auditData[firstCat][firstInd].gaps = "Critical fire alarm failure.";

        globalThis.fetch = async (url) => {
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    indicators: {
                                        [firstInd]: {
                                            severity: "Critical",
                                            suggestedMultiplier: 3,
                                            suggestedScore: 2,
                                            scoreDelta: 0,
                                            rationale: "Fire alarm system outage presents imminent campus life safety risk."
                                        }
                                    }
                                })
                            }]
                        },
                        finishReason: 'STOP'
                    }]
                })
            };
        };

        const result = await analyzeCategoryDynamicRisksBatch(firstCat);
        assert.equal(result.analyzedCount, 1);

        const indData = state.auditData[firstCat][firstInd];
        assert.ok(indData.suggestedRisk);
        assert.equal(indData.suggestedRisk.severity, "Critical");
        assert.equal(indData.suggestedRisk.suggestedMultiplier, 3);
        assert.equal(indData.suggestedRisk.suggestedScore, 2);

        // Verification of user choice: customMultiplier remains unforced and riskApplied is false until manually reviewed
        assert.equal(indData.customMultiplier, null);
        assert.equal(indData.riskApplied, false);
    });

    test('runFullAuditAIPipeline processes all phases and generates Executive Summary', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];
        state.auditData[firstCat][firstInd].features = "Initial notes.";

        let callCount = 0;
        globalThis.fetch = async (url, options) => {
            callCount++;
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => {
                    const reqBody = options && options.body ? JSON.parse(options.body) : {};
                    const prompt = reqBody.prompt || reqBody.contents?.[0]?.parts?.[0]?.text || '';
                    let resultText = '';
                    if (prompt.includes('Chief Campus Safety, Risk')) {
                        resultText = JSON.stringify({
                            indicators: {
                                [firstInd]: {
                                    severity: "Medium",
                                    suggestedMultiplier: 2,
                                    suggestedScore: 3,
                                    scoreDelta: 0,
                                    rationale: "Standard compliance maintained."
                                }
                            }
                        });
                    } else if (prompt.includes('Executive Summary') || prompt.includes('EXECUTIVE') || prompt.includes('Executive-ready briefing') || prompt.includes('Senior Campus Safety')) {
                        resultText = "## 1. Executive Summary\nCampus safety audit completed with satisfactory compliance ratings.";
                    } else {
                        resultText = JSON.stringify({
                            indicators: {
                                [firstInd]: {
                                    aiFeatures: "Enhanced notes.",
                                    aiGaps: "",
                                    aiActions: ""
                                }
                            }
                        });
                    }

                    return {
                        text: resultText,
                        candidates: [{
                            content: {
                                parts: [{ text: resultText }]
                            },
                            finishReason: 'STOP'
                        }]
                    };
                }
            };
        };

        const success = await runFullAuditAIPipeline();
        assert.equal(success, true);
        assert.ok(callCount >= 2);
        assert.ok(state.aiSummary.includes("Executive Summary"));
    });

    test('cancelAIPipeline cancels running pipeline gracefully', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];
        state.auditData[firstCat][firstInd].features = "Initial notes to trigger batch enhancement.";

        globalThis.fetch = async () => {
            cancelAIPipeline();
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    text: "{}",
                    candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: 'STOP' }]
                })
            };
        };

        const success = await runFullAuditAIPipeline();
        assert.equal(success, false);
    });
});
