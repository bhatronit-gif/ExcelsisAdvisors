/**
 * tests/annexures_and_multiphoto.test.mjs
 * Comprehensive automated test suite for:
 * 1. Multi-photo attachments per indicator (with backward compatibility)
 * 2. Macro category-level photographic evidence
 * 3. Statutory PDF Annexures (data modeling, ordering, CRUD, report inclusion)
 * 4. Backup & Export fidelity (JSON, CSV, Drafts)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up mock browser environment
globalThis.window = globalThis;
globalThis.URL = globalThis.URL || {};
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:mock');
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});

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
        toggle(cls, force) {
            if (force !== undefined) {
                if (force) this._classes.add(cls);
                else this._classes.delete(cls);
                return !!force;
            }
            if (this._classes.has(cls)) {
                this._classes.delete(cls);
                return false;
            } else {
                this._classes.add(cls);
                return true;
            }
        }
    },
    value: '',
    textContent: '',
    innerHTML: '',
    innerText: '',
    style: {},
    disabled: false,
    click() {},
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
    createElement(tag) { return createMockElement(tag); },
    getElementById(id) {
        if (!mockElements[id]) {
            mockElements[id] = createMockElement(id);
        }
        return mockElements[id];
    },
    querySelector(sel) { return createMockElement(); },
    querySelectorAll(sel) { return []; }
};

// Import modules
import { INITIAL_STATE_DEFAULTS, CATEGORIES } from '../js/config.js';
import { state, loadState, updateCalculations } from '../js/state.js';
import { reorderAnnexure, updateAnnexureTitle, removeAnnexure, updateAnnexureBadges } from '../js/annexures.js';
import { exportToCSV, exportToJSON, importFromJSON } from '../js/export.js';
import { generatePDFReport } from '../js/reports.js';

function resetState() {
    state.filename = "Untitled_Audit_" + new Date().toISOString().split('T')[0];
    state.school = "Children's Academy Ashok Nagar";
    state.academicYear = "2026-27";
    state.date = "2026-10-07";
    state.auditData = {};
    state.categoryPhotos = {};
    state.annexures = [];
    for (const [catName, catData] of Object.entries(CATEGORIES)) {
        state.auditData[catName] = {};
        for (const indName of Object.keys(catData.indicators)) {
            state.auditData[catName][indName] = {
                score: 3,
                features: "",
                gaps: "",
                actions: "",
                aiFeatures: "",
                aiGaps: "",
                aiActions: "",
                photoName: "",
                photoData: "",
                photos: [],
                reviewed: false,
                customMultiplier: null,
                riskSeverity: "",
                riskRationale: "",
                riskScoreDelta: 0,
                riskApplied: false
            };
        }
    }
}

describe('Multi-Photo & Category Photographic Evidence State Modeling', () => {
    beforeEach(() => {
        globalThis.localStorage.clear();
        resetState();
    });

    it('INITIAL_STATE_DEFAULTS should include categoryPhotos and annexures', () => {
        assert.ok(INITIAL_STATE_DEFAULTS.categoryPhotos !== undefined);
        assert.deepEqual(INITIAL_STATE_DEFAULTS.categoryPhotos, {});
        assert.ok(Array.isArray(INITIAL_STATE_DEFAULTS.annexures));
        assert.equal(INITIAL_STATE_DEFAULTS.annexures.length, 0);
    });

    it('loadState should normalize legacy single photo data into photos array', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        // Simulate legacy saved state in localStorage with single photo
        const legacyAuditData = {};
        legacyAuditData[firstCat] = {};
        legacyAuditData[firstCat][firstInd] = {
            score: 4,
            features: "Good fire extinguisher placement",
            gaps: "",
            actions: "",
            photoName: "extinguisher_tag.jpg",
            photoData: "data:image/jpeg;base64,LEGACYDATA123",
            reviewed: true
        };

        const mockSavedState = {
            version: "2.0",
            filename: "Legacy_Audit",
            school: "Demo School",
            academicYear: "2026-27",
            auditData: legacyAuditData
        };

        globalThis.localStorage.setItem('state', JSON.stringify(mockSavedState));
        await loadState();

        const item = state.auditData[firstCat][firstInd];
        assert.ok(Array.isArray(item.photos), 'item.photos should be an array');
        assert.equal(item.photos.length, 1);
        assert.equal(item.photos[0].name, "extinguisher_tag.jpg");
        assert.equal(item.photos[0].data, "data:image/jpeg;base64,LEGACYDATA123");
        assert.equal(item.photoName, "extinguisher_tag.jpg");
        assert.equal(item.photoData, "data:image/jpeg;base64,LEGACYDATA123");
    });

    it('loadState should preserve existing multiple photos on indicators', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        const mockMultiAuditData = {};
        mockMultiAuditData[firstCat] = {};
        mockMultiAuditData[firstCat][firstInd] = {
            score: 5,
            features: "Multi photo test",
            gaps: "",
            actions: "",
            photoName: "photo1.jpg, photo2.jpg",
            photoData: "data:image/jpeg;base64,DATA1",
            photos: [
                { name: "photo1.jpg", data: "data:image/jpeg;base64,DATA1", timestamp: 1000 },
                { name: "photo2.jpg", data: "data:image/jpeg;base64,DATA2", timestamp: 2000 }
            ],
            reviewed: true
        };

        const mockSavedState = {
            version: "2.0",
            filename: "Multi_Photo_Audit",
            auditData: mockMultiAuditData,
            categoryPhotos: {
                [firstCat]: [
                    { name: "building_facade.jpg", data: "data:image/jpeg;base64,CATDATA1", timestamp: 500 }
                ]
            },
            annexures: []
        };

        globalThis.localStorage.setItem('state', JSON.stringify(mockSavedState));
        await loadState();

        const item = state.auditData[firstCat][firstInd];
        assert.equal(item.photos.length, 2);
        assert.equal(item.photos[0].name, "photo1.jpg");
        assert.equal(item.photos[1].name, "photo2.jpg");
        assert.equal(state.categoryPhotos[firstCat].length, 1);
        assert.equal(state.categoryPhotos[firstCat][0].name, "building_facade.jpg");
    });

    it('updateCalculations should count hasPhotos for indicators with photos array or legacy photoName', () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const indNames = Object.keys(CATEGORIES[firstCat].indicators);

        // First indicator has photos array
        state.auditData[firstCat][indNames[0]].photos = [
            { name: "img1.jpg", data: "data:...", timestamp: 1 }
        ];

        // Second indicator has legacy photoName
        if (indNames[1]) {
            state.auditData[firstCat][indNames[1]].photos = [];
            state.auditData[firstCat][indNames[1]].photoName = "legacy_img.jpg";
        }

        updateCalculations();
        const reviewedText = document.getElementById('reviewed-count').innerHTML;
        assert.ok(reviewedText.startsWith('2 /'), `Expected 2 reviewed indicators, got: ${reviewedText}`);
    });
});

describe('Category-Level Photo Management', () => {
    beforeEach(() => {
        resetState();
    });

    it('should support adding and isolating multiple photos per category', () => {
        const cat1 = Object.keys(CATEGORIES)[0];
        const cat2 = Object.keys(CATEGORIES)[1];

        if (!state.categoryPhotos) state.categoryPhotos = {};
        state.categoryPhotos[cat1] = [
            { name: "entry_gate.jpg", data: "data:gate", timestamp: 1 },
            { name: "corridor.jpg", data: "data:corridor", timestamp: 2 }
        ];
        state.categoryPhotos[cat2] = [
            { name: "lab_bench.jpg", data: "data:lab", timestamp: 3 }
        ];

        assert.equal(state.categoryPhotos[cat1].length, 2);
        assert.equal(state.categoryPhotos[cat2].length, 1);
        assert.equal(state.categoryPhotos[cat1][0].name, "entry_gate.jpg");
        assert.equal(state.categoryPhotos[cat1][1].name, "corridor.jpg");
        assert.equal(state.categoryPhotos[cat2][0].name, "lab_bench.jpg");
    });

    it('should support removing individual category photo or clearing category photos', () => {
        const cat1 = Object.keys(CATEGORIES)[0];
        state.categoryPhotos = {
            [cat1]: [
                { name: "pic1.jpg", data: "d1" },
                { name: "pic2.jpg", data: "d2" },
                { name: "pic3.jpg", data: "d3" }
            ]
        };

        // Remove index 1
        state.categoryPhotos[cat1].splice(1, 1);
        assert.equal(state.categoryPhotos[cat1].length, 2);
        assert.equal(state.categoryPhotos[cat1][0].name, "pic1.jpg");
        assert.equal(state.categoryPhotos[cat1][1].name, "pic3.jpg");

        // Clear all
        state.categoryPhotos[cat1] = [];
        assert.equal(state.categoryPhotos[cat1].length, 0);
    });
});

describe('Statutory PDF Annexures CRUD & Ordering', () => {
    beforeEach(() => {
        resetState();
        state.annexures = [
            {
                id: 'ann-1',
                title: 'Fire Safety NOC',
                fileName: 'Fire_Safety_NOC_2026.pdf',
                fileSize: 204800,
                pageCount: 2,
                pdfData: 'data:application/pdf;base64,PDF1',
                renderedPages: ['data:image/jpeg;base64,P1_1', 'data:image/jpeg;base64,P1_2'],
                timestamp: 1000
            },
            {
                id: 'ann-2',
                title: 'Building Safety Certificate',
                fileName: 'Structural_Stability_Cert.pdf',
                fileSize: 102400,
                pageCount: 1,
                pdfData: 'data:application/pdf;base64,PDF2',
                renderedPages: ['data:image/jpeg;base64,P2_1'],
                timestamp: 2000
            },
            {
                id: 'ann-3',
                title: 'Water Potability Report',
                fileName: 'Lab_Water_Test_2026.pdf',
                fileSize: 307200,
                pageCount: 3,
                pdfData: 'data:application/pdf;base64,PDF3',
                renderedPages: ['data:image/jpeg;base64,P3_1', 'data:image/jpeg;base64,P3_2', 'data:image/jpeg;base64,P3_3'],
                timestamp: 3000
            }
        ];
    });

    it('should update annexure title correctly', () => {
        updateAnnexureTitle('ann-1', 'Updated Fire Dept NOC Approval');
        const ann = state.annexures.find(a => a.id === 'ann-1');
        assert.equal(ann.title, 'Updated Fire Dept NOC Approval');

        // Empty title reverts to fileName
        updateAnnexureTitle('ann-1', '   ');
        assert.equal(ann.title, 'Fire_Safety_NOC_2026.pdf');
    });

    it('should reorder annexures up and down', async () => {
        // Move ann-2 up (index 1 -> index 0)
        await reorderAnnexure('ann-2', 'up');
        assert.equal(state.annexures[0].id, 'ann-2');
        assert.equal(state.annexures[1].id, 'ann-1');
        assert.equal(state.annexures[2].id, 'ann-3');

        // Move ann-2 up at top index should be a no-op
        await reorderAnnexure('ann-2', 'up');
        assert.equal(state.annexures[0].id, 'ann-2');

        // Move ann-2 down (index 0 -> index 1)
        await reorderAnnexure('ann-2', 'down');
        assert.equal(state.annexures[0].id, 'ann-1');
        assert.equal(state.annexures[1].id, 'ann-2');

        // Move ann-3 down at bottom index should be a no-op
        await reorderAnnexure('ann-3', 'down');
        assert.equal(state.annexures[2].id, 'ann-3');
    });

    it('should remove annexure by ID', async () => {
        await removeAnnexure('ann-2');
        assert.equal(state.annexures.length, 2);
        assert.equal(state.annexures.find(a => a.id === 'ann-2'), undefined);
        assert.equal(state.annexures[0].id, 'ann-1');
        assert.equal(state.annexures[1].id, 'ann-3');
    });

    it('updateAnnexureBadges should update sidebar and pdf modal counters', () => {
        const sidebarBadge = document.getElementById('sidebar-annexure-count-badge');
        const modalBadge = document.getElementById('pdf-modal-annexure-badge');

        updateAnnexureBadges();

        assert.equal(sidebarBadge.textContent, 3);
        assert.equal(sidebarBadge.classList.contains('hidden'), false);
        assert.equal(modalBadge.textContent, '3 Attached');

        // When 0 annexures
        state.annexures = [];
        updateAnnexureBadges();
        assert.equal(sidebarBadge.textContent, 0);
        assert.equal(sidebarBadge.classList.contains('hidden'), true);
        assert.equal(modalBadge.textContent, '0 Attached');
    });
});

describe('JSON Backup and CSV Export Fidelity', () => {
    beforeEach(() => {
        resetState();
    });

    it('exportToJSON and importFromJSON should preserve categoryPhotos and annexures', async () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        state.categoryPhotos = {
            [firstCat]: [
                { name: "main_gate.jpg", data: "data:gate", timestamp: 12345 }
            ]
        };

        state.auditData[firstCat][firstInd].photos = [
            { name: "fire_alarm_panel.jpg", data: "data:panel", timestamp: 67890 },
            { name: "panel_battery.jpg", data: "data:battery", timestamp: 67891 }
        ];

        state.annexures = [
            {
                id: 'ann-export-1',
                title: 'Municipal Occupancy Certificate',
                fileName: 'OC_2026.pdf',
                fileSize: 150000,
                pageCount: 2,
                pdfData: 'data:pdf1',
                renderedPages: ['data:p1', 'data:p2'],
                timestamp: 9999
            }
        ];

        // Export to JSON string
        const jsonStr = exportToJSON(false);
        const parsed = JSON.parse(jsonStr);

        assert.ok(parsed.categoryPhotos);
        assert.equal(parsed.categoryPhotos[firstCat].length, 1);
        assert.equal(parsed.categoryPhotos[firstCat][0].name, "main_gate.jpg");

        assert.ok(parsed.annexures);
        assert.equal(parsed.annexures.length, 1);
        assert.equal(parsed.annexures[0].title, "Municipal Occupancy Certificate");

        // Clear state and import back
        resetState();
        assert.deepEqual(state.categoryPhotos, {});
        assert.equal(state.annexures.length, 0);

        await importFromJSON(jsonStr);

        assert.equal(state.categoryPhotos[firstCat].length, 1);
        assert.equal(state.categoryPhotos[firstCat][0].name, "main_gate.jpg");
        assert.equal(state.annexures.length, 1);
        assert.equal(state.annexures[0].id, "ann-export-1");
        assert.equal(state.auditData[firstCat][firstInd].photos.length, 2);
    });

    it('exportToCSV should concatenate multiple photo filenames with semicolons', () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        state.auditData[firstCat][firstInd].photos = [
            { name: "photo_alpha.jpg", data: "d1" },
            { name: "photo_beta.png", data: "d2" }
        ];

        const csvString = exportToCSV(false);
        assert.ok(csvString.includes("photo_alpha.jpg; photo_beta.png"), "CSV should contain semicolon-separated photo names");
    });
});

describe('Report Generation with Multi-Photo Exhibits & PDF Annexures', () => {
    beforeEach(() => {
        resetState();
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        state.auditData[firstCat][firstInd].score = 2; // Gap indicator
        state.auditData[firstCat][firstInd].gaps = "Missing maintenance log";
        state.auditData[firstCat][firstInd].photos = [
            { name: "broken_seal.jpg", data: "data:image/jpeg;base64,SEAL123" },
            { name: "valve_corrosion.jpg", data: "data:image/jpeg;base64,VALVE456" }
        ];

        state.categoryPhotos = {
            [firstCat]: [
                { name: "substation_entrance.jpg", data: "data:image/jpeg;base64,SUBSTATION" }
            ]
        };

        state.annexures = [
            {
                id: 'ann-rep-1',
                title: 'Fire Safety NOC',
                fileName: 'Fire_NOC.pdf',
                fileSize: 102400,
                pageCount: 2,
                pdfData: 'data:application/pdf;base64,PDF_RAW',
                renderedPages: [
                    'data:image/jpeg;base64,PAGE_ONE_IMG',
                    'data:image/jpeg;base64,PAGE_TWO_IMG'
                ],
                timestamp: 1234
            }
        ];
    });

    it('generatePDFReport should render multi-photo exhibits in detailed report', () => {
        const reportHTML = generatePDFReport({
            reportType: 'detailed',
            includePhotos: true,
            includeAnnexures: true,
            returnHtmlOnly: true
        });

        // Indicator photos
        assert.ok(reportHTML.includes("broken_seal.jpg"), "Report should include first photo name");
        assert.ok(reportHTML.includes("valve_corrosion.jpg"), "Report should include second photo name");
        assert.ok(reportHTML.includes("data:image/jpeg;base64,SEAL123"), "Report should embed photo data");

        // Category-level photo
        assert.ok(reportHTML.includes("substation_entrance.jpg"), "Report should include category photo");
        assert.ok(reportHTML.includes("Category Photographic Evidence"), "Report should include category evidence header");

        // Annexures Table
        assert.ok(reportHTML.includes("Table of Statutory Annexures"), "Report should contain Table of Annexures");
        assert.ok(reportHTML.includes("Annexure A"), "Report should include Annexure A letter");
        assert.ok(reportHTML.includes("Fire Safety NOC"), "Report should include Annexure title");

        // Annexures Rendered Pages Exhibits
        assert.ok(reportHTML.includes("PAGE_ONE_IMG"), "Report should render page 1 exhibit image");
        assert.ok(reportHTML.includes("PAGE_TWO_IMG"), "Report should render page 2 exhibit image");
        assert.ok(reportHTML.includes("Page 1 of 2"), "Report should display running page indicator");
    });

    it('generatePDFReport should omit annexures when includeAnnexures is false', () => {
        const reportHTML = generatePDFReport({
            reportType: 'detailed',
            includePhotos: true,
            includeAnnexures: false,
            returnHtmlOnly: true
        });

        assert.equal(reportHTML.includes("Table of Statutory Annexures"), false);
        assert.equal(reportHTML.includes("PAGE_ONE_IMG"), false);
    });

    it('generatePDFReport should render multi-photo exhibits in summary report for gap indicators', () => {
        const summaryHTML = generatePDFReport({
            reportType: 'summary',
            includePhotos: true,
            includeAnnexures: true,
            returnHtmlOnly: true
        });

        assert.ok(summaryHTML.includes("broken_seal.jpg"), "Summary report should render photos for gap indicators");
        assert.ok(summaryHTML.includes("Table of Statutory Annexures"), "Summary report should include Annexures");
    });

    it('generatePDFReport should not display Dynamic Modifier or 1x/2x/3x in Detailed Category & Indicator Assessments', () => {
        const firstCat = Object.keys(CATEGORIES)[0];
        const firstInd = Object.keys(CATEGORIES[firstCat].indicators)[0];

        // Apply a dynamic risk modifier on the first indicator
        state.auditData[firstCat][firstInd].riskApplied = true;
        state.auditData[firstCat][firstInd].customMultiplier = 3;
        state.auditData[firstCat][firstInd].riskSeverity = "Critical";

        const reportHTML = generatePDFReport({
            reportType: 'detailed',
            includePhotos: false,
            includeAnnexures: false,
            returnHtmlOnly: true
        });

        assert.ok(reportHTML.includes("Detailed Category &amp; Indicator Assessments"));
        const detailedSection = reportHTML.split("2. Detailed Category &amp; Indicator Assessments")[1].split("<!-- Sign-off Block -->")[0];

        assert.equal(detailedSection.includes("⚡ Dynamic"), false, "Detailed section should not display ⚡ Dynamic badge");
        assert.equal(detailedSection.includes("Dynamic Modifier"), false, "Detailed section should not display Dynamic Modifier");
        assert.equal(detailedSection.includes("Weight:"), false, "Detailed section should not display Weight: 1x/2x/3x");
    });
});

describe('New 5-Tier Compliance Scale (Poor, Needs Improvement, Satisfactory, Good, Excellent)', () => {
    it('should map scores accurately to the 5 tiers', () => {
        import('../js/state.js').then(({ getComplianceTier }) => {
            // Excellent (86-100%)
            assert.equal(getComplianceTier(100).label, "Excellent");
            assert.equal(getComplianceTier(86.0).label, "Excellent");

            // Good (76-85.99%)
            assert.equal(getComplianceTier(85.5).label, "Good");
            assert.equal(getComplianceTier(76.0).label, "Good");

            // Satisfactory (66-75.99%) - specifically includes user's 70.99%!
            assert.equal(getComplianceTier(75.5).label, "Satisfactory");
            assert.equal(getComplianceTier(70.99).label, "Satisfactory");
            assert.equal(getComplianceTier(66.0).label, "Satisfactory");

            // Needs Improvement (56-65.99%)
            assert.equal(getComplianceTier(65.9).label, "Needs Improvement");
            assert.equal(getComplianceTier(60.0).label, "Needs Improvement");
            assert.equal(getComplianceTier(56.0).label, "Needs Improvement");

            // Poor (0-55.99%)
            assert.equal(getComplianceTier(55.9).label, "Poor");
            assert.equal(getComplianceTier(40.0).label, "Poor");
            assert.equal(getComplianceTier(0).label, "Poor");
        });
    });
});
