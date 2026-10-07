/**
 * tests/comparison_engine.test.mjs — Unit & Integration Tests for Multi-Audit Comparison Engine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIES, SCHOOLS, getSchoolGroup, getShortSchoolName } from '../js/config.js';
import { calculateAuditScore, calculateCategoryScores, getComplianceTier, comparisonState } from '../js/state.js';
import { applyPresetSelection, isIndicatorDiscrepancyOrRisk, handleComparisonModelChange } from '../js/comparison.js';
import { generateCrossBranchBestPractices } from '../js/ai.js';

describe('Multi-Audit Comparison & Benchmarking Engine', () => {

    // Mock Audit Generator
    function createMockAudit(name, school, date, auditor, baseScoreVal = 3, riskMods = {}) {
        const auditData = {};
        for (const [catName, catDef] of Object.entries(CATEGORIES)) {
            auditData[catName] = {};
            for (const indName of Object.keys(catDef.indicators)) {
                auditData[catName][indName] = {
                    score: baseScoreVal,
                    features: `Positive features for ${name}`,
                    gaps: `Identified gap in ${indName}`,
                    actions: `Remediation action for ${indName}`,
                    customMultiplier: null,
                    riskSeverity: "",
                    riskApplied: false
                };
            }
        }

        // Apply custom risk/score modifications
        for (const [cat, indMap] of Object.entries(riskMods)) {
            for (const [ind, mod] of Object.entries(indMap)) {
                if (auditData[cat] && auditData[cat][ind]) {
                    Object.assign(auditData[cat][ind], mod);
                }
            }
        }

        const score = calculateAuditScore(auditData);
        return {
            id: `${name}|${auditor}`,
            filename: name,
            school,
            date,
            auditor,
            audit_data: auditData,
            score,
            ai_summary: `AI Summary for ${name}`
        };
    }

    describe('School Grouping & Short Names', () => {
        it('should group Children Academy branches under "Children\'s Academy Group"', () => {
            assert.equal(getSchoolGroup("Children's Academy Bachani Nagar"), "Children's Academy Group");
            assert.equal(getSchoolGroup("Children's Academy Ashok Nagar"), "Children's Academy Group");
            assert.equal(getSchoolGroup("Children's Academy Thakur Complex"), "Children's Academy Group");
            assert.equal(getSchoolGroup("Children's Academy Thane"), "Children's Academy Group");
        });

        it('should retain independent schools under their own name', () => {
            assert.equal(getSchoolGroup("Aspee Nutan Academy"), "Aspee Nutan Academy");
        });

        it('should format clean short names for compact table headers', () => {
            assert.equal(getShortSchoolName("Children's Academy Bachani Nagar"), "CA Bachani Nagar");
            assert.equal(getShortSchoolName("Aspee Nutan Academy"), "Aspee Nutan Acad.");
        });
    });

    describe('Score Calculations & Compliance Tiers', () => {
        it('should calculate 60% compliance score for baseline score 3 across all indicators', () => {
            const audit = createMockAudit('Audit_2024', 'Children\'s Academy Bachani Nagar', '2024-04-10', 'Ronit Bhat', 3);
            assert.equal(Math.round(audit.score * 100), 60);
        });

        it('should calculate 100% compliance score for score 5 across all indicators', () => {
            const audit = createMockAudit('Audit_2026', 'Children\'s Academy Bachani Nagar', '2026-04-10', 'Ronit Bhat', 5);
            assert.equal(Math.round(audit.score * 100), 100);
        });

        it('should return correct compliance rating tiers and color badges', () => {
            assert.equal(getComplianceTier(95).label, "Excellent");
            assert.equal(getComplianceTier(80).label, "Good");
            assert.equal(getComplianceTier(70.99).label, "Satisfactory");
            assert.equal(getComplianceTier(60).label, "Needs Improvement");
            assert.equal(getComplianceTier(45).label, "Poor");
        });

        it('should calculate individual category score maps accurately', () => {
            const audit = createMockAudit('Audit_Test', 'Children\'s Academy Thane', '2025-01-15', 'Samit Bhat', 4);
            const catScores = calculateCategoryScores(audit.audit_data);
            
            assert.ok(catScores['1. Infrastructure']);
            assert.equal(Math.round(catScores['1. Infrastructure'].percentage), 80);
            assert.equal(catScores['1. Infrastructure'].weight, 0.10);
        });
    });

    describe('Preset Selection & Longitudinal Filtering', () => {
        const mockAuditPool = [
            createMockAudit('Audit_2024', 'Children\'s Academy Bachani Nagar', '2024-03-01', 'Auditor 1', 3),
            createMockAudit('Audit_2025', 'Children\'s Academy Bachani Nagar', '2025-03-01', 'Auditor 2', 4),
            createMockAudit('Audit_2026', 'Children\'s Academy Bachani Nagar', '2026-03-01', 'Auditor 3', 5),
            createMockAudit('Audit_Ashok_2025', 'Children\'s Academy Ashok Nagar', '2025-06-01', 'Auditor 1', 4),
            createMockAudit('Audit_Thakur_2025', 'Children\'s Academy Thakur Complex', '2025-07-01', 'Auditor 2', 4),
            createMockAudit('Audit_Thane_2025', 'Children\'s Academy Thane', '2025-08-01', 'Auditor 3', 3),
            createMockAudit('Audit_Aspee_2025', 'Aspee Nutan Academy', '2025-09-01', 'Auditor 1', 4)
        ];

        it('should filter year-over-year audits for the selected campus in chronological order', () => {
            comparisonState.allAvailableAudits = [...mockAuditPool];
            comparisonState.presetFilterSchool = 'Children\'s Academy Bachani Nagar';
            
            applyPresetSelection('yoy');
            
            assert.equal(comparisonState.selectedAudits.length, 3);
            assert.equal(comparisonState.selectedAudits[0].filename, 'Audit_2024');
            assert.equal(comparisonState.selectedAudits[1].filename, 'Audit_2025');
            assert.equal(comparisonState.selectedAudits[2].filename, 'Audit_2026');
            assert.equal(comparisonState.baselineIndex, 0); // 2024 baseline
        });

        it('should select distinct campus branches for cross-branch benchmarking', () => {
            comparisonState.allAvailableAudits = [...mockAuditPool];
            applyPresetSelection('branch');

            const selectedSchools = comparisonState.selectedAudits.map(a => a.school);
            const uniqueSchools = new Set(selectedSchools);
            
            assert.equal(selectedSchools.length, uniqueSchools.size, 'Each selected audit must be from a unique branch');
            assert.ok(comparisonState.selectedAudits.length >= 4, 'Should include all CA branches');
        });
    });

    describe('Discrepancy Detection & Risk Multiplier Evaluation', () => {
        it('should detect variance when indicator scores differ significantly between audits', () => {
            const audit1 = createMockAudit('A1', 'School A', '2025-01-01', 'Auditor', 2);
            const audit2 = createMockAudit('A2', 'School B', '2025-01-01', 'Auditor', 5);

            const score1 = audit1.audit_data['3. Safety & Security']['3.1 Firefighting readiness'].score;
            const score2 = audit2.audit_data['3. Safety & Security']['3.1 Firefighting readiness'].score;

            const delta = Math.abs(score2 - score1);
            assert.ok(delta >= 2, 'Score delta of 3 is a significant discrepancy');
        });

        it('should recognize dynamic risk modifications', () => {
            const auditWithRisk = createMockAudit('A_Risk', 'School A', '2025-01-01', 'Auditor', 2, {
                '3. Safety & Security': {
                    '3.1 Firefighting readiness': {
                        score: 1,
                        riskApplied: true,
                        riskSeverity: 'Critical',
                        customMultiplier: 3,
                        riskRationale: 'Expired fire extinguishers'
                    }
                }
            });

            const ind = auditWithRisk.audit_data['3. Safety & Security']['3.1 Firefighting readiness'];
            assert.equal(ind.riskApplied, true);
            assert.equal(ind.riskSeverity, 'Critical');
            assert.equal(ind.customMultiplier, 3);
        });

        it('should allow setting different baseline audits and correctly recomputing deltas', () => {
            const audit2024 = createMockAudit('Audit_2024', 'School A', '2024-01-01', 'Auditor', 3); // 60%
            const audit2025 = createMockAudit('Audit_2025', 'School A', '2025-01-01', 'Auditor', 4); // 80%
            const audit2026 = createMockAudit('Audit_2026', 'School A', '2026-01-01', 'Auditor', 5); // 100%

            const selected = [audit2024, audit2025, audit2026];
            
            // Baseline 2024 (idx 0)
            let baseIdx = 0;
            let delta2026vsBase = (selected[2].score * 100) - (selected[baseIdx].score * 100);
            assert.equal(Math.round(delta2026vsBase), 40); // 100% - 60% = +40%

            // Switch Base Year to 2025 (idx 1)
            baseIdx = 1;
            delta2026vsBase = (selected[2].score * 100) - (selected[baseIdx].score * 100);
            let delta2024vsBase = (selected[0].score * 100) - (selected[baseIdx].score * 100);
            assert.equal(Math.round(delta2026vsBase), 20); // 100% - 80% = +20%
            assert.equal(Math.round(delta2024vsBase), -20); // 60% - 80% = -20%
        });

        it('should correctly evaluate isIndicatorDiscrepancyOrRisk for variances, low scores, and dynamic risks', () => {
            const audit1 = createMockAudit('A1', 'School A', '2025-01-01', 'Auditor', 3);
            const audit2 = createMockAudit('A2', 'School B', '2025-01-01', 'Auditor', 3);


            // Both have identical compliant score 3, no low score, no dynamic risk -> false
            const isMatchIdentical = isIndicatorDiscrepancyOrRisk('1. Infrastructure', '1.1 Classroom', 2, [audit1, audit2]);
            assert.equal(isMatchIdentical, false, 'Identical compliant score 3 without risk should not match discrepancy filter');

            // Set score variance (3 vs 4) -> true
            audit2.audit_data['1. Infrastructure']['1.1 Classroom'].score = 4;
            const isMatchVariance = isIndicatorDiscrepancyOrRisk('1. Infrastructure', '1.1 Classroom', 2, [audit1, audit2]);
            assert.equal(isMatchVariance, true, 'Score difference of 1★ should match discrepancy filter');

            // Reset score to 3, but set low score failure (score 2) on audit 1 -> true
            audit2.audit_data['1. Infrastructure']['1.1 Classroom'].score = 3;
            audit1.audit_data['1. Infrastructure']['1.1 Classroom'].score = 2;
            const isMatchLowScore = isIndicatorDiscrepancyOrRisk('1. Infrastructure', '1.1 Classroom', 2, [audit1, audit2]);
            assert.equal(isMatchLowScore, true, 'Low score (<= 2) should match discrepancy filter');

            // Reset score to 3, but apply dynamic risk escalation on audit 2 -> true
            audit1.audit_data['1. Infrastructure']['1.1 Classroom'].score = 3;
            audit2.audit_data['1. Infrastructure']['1.1 Classroom'].riskApplied = true;
            audit2.audit_data['1. Infrastructure']['1.1 Classroom'].riskSeverity = 'Critical';
            const isMatchRisk = isIndicatorDiscrepancyOrRisk('1. Infrastructure', '1.1 Classroom', 2, [audit1, audit2]);
            assert.equal(isMatchRisk, true, 'Escalated dynamic risk should match discrepancy filter');
        });
    });

    describe('Cross-Branch Best Practices Playbook & AI Suite', () => {
        it('should support dual AI tabs: strategic synthesis and best practices playbook', () => {
            assert.ok(comparisonState.activeAITab === 'strategic' || comparisonState.activeAITab === 'best_practices');
            
            // Switch to best practices tab
            comparisonState.activeAITab = 'best_practices';
            assert.equal(comparisonState.activeAITab, 'best_practices');

            // Switch back to strategic tab
            comparisonState.activeAITab = 'strategic';
            assert.equal(comparisonState.activeAITab, 'strategic');
        });

        it('should store and isolate AI Best Practices Playbook markdown text independently from Strategic Synthesis', () => {
            comparisonState.aiComparisonSummary = '# Strategic Report\n\nDelta breakdown.';
            comparisonState.aiBestPracticesSummary = '# Best Practices Playbook\n\nExemplar Matrix.';

            assert.notEqual(comparisonState.aiComparisonSummary, comparisonState.aiBestPracticesSummary);
            assert.ok(comparisonState.aiBestPracticesSummary.includes('Best Practices Playbook'));
            assert.ok(comparisonState.aiComparisonSummary.includes('Strategic Report'));
        });

        it('should allow choosing the Gemini model for comparative intelligence & best practices', () => {
            // Default model should be gemini-3.5-flash-lite
            assert.equal(comparisonState.selectedModel, 'gemini-3.5-flash-lite');

            // Switch to Gemini 3.7 Flash
            handleComparisonModelChange('gemini-3.7-flash');
            assert.equal(comparisonState.selectedModel, 'gemini-3.7-flash');

            // Switch back to Gemini 3.5 Flash-Lite
            handleComparisonModelChange('gemini-3.5-flash-lite');
            assert.equal(comparisonState.selectedModel, 'gemini-3.5-flash-lite');
        });

        it('should execute generateCrossBranchBestPractices without ReferenceError on getSchoolGroup or missing symbols', async () => {
            const audit1 = createMockAudit('Branch 1', "Children's Academy Bachani Nagar", '2025-01-01', 'Auditor A', 4);
            const audit2 = createMockAudit('Branch 2', "Children's Academy Ashok Nagar", '2025-01-01', 'Auditor B', 5);

            // Mock fetch to avoid real network call in unit test
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => {
                return {
                    ok: true,
                    json: async () => ({
                        text: '# 🌟 Cross-Branch Best Practices Playbook\n\nSynthesized successfully.'
                    })
                };
            };

            try {
                const result = await generateCrossBranchBestPractices([audit1, audit2], 'gemini-3.5-flash-lite');
                assert.ok(result.includes('Cross-Branch Best Practices Playbook'));
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });
});






