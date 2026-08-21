/**
 * js/comparison.js — Superadmin Multi-Audit Comparison & Benchmarking Hub
 * Comprehensive comparative analytics across multiple years (Longitudinal) or campus branches (Cross-Branch).
 */

import { CATEGORIES, SCHOOLS, getSchoolGroup, getShortSchoolName, getDefaultAcademicYear } from './config.js';
import { comparisonState, calculateAuditScore, calculateCategoryScores, getComplianceTier, state } from './state.js';
import { dbGetAll } from './storage.js';
import { showToast, trapFocus, releaseFocus } from './ui.js';
import { generateComparativeExecutiveSummary, renderMarkdown } from './ai.js';
import { generateComparativePDFReport } from './reports.js';
import { exportComparativeCSV } from './export.js';

/**
 * Opens the full-screen comparison modal and initializes candidate audit list from IndexedDB drafts.
 */
export async function openComparisonHub(initialPreset = "all") {
    if (state.loggedInUser !== "Superadmin") {
        showToast("Access restricted: Multi-Audit Comparison is exclusive to Superadmin.", "error");
        return;
    }

    const modal = document.getElementById('comparison-hub-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    trapFocus('comparison-hub-modal');

    // Load candidate drafts from DB
    await refreshCandidateAudits();

    comparisonState.activePreset = initialPreset;
    applyPresetSelection(initialPreset);

    renderComparisonView();
}

/**
 * Closes the comparison modal and releases focus trap.
 */
export function closeComparisonHub() {
    const modal = document.getElementById('comparison-hub-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    releaseFocus();
}

/**
 * Loads and normalizes all saved drafts from IndexedDB.
 */
export async function refreshCandidateAudits() {
    try {
        const rawDrafts = await dbGetAll("drafts");
        const candidates = rawDrafts.map((d, i) => {
            const auditData = d.audit_data || {};
            const scoreVal = d.score !== undefined ? Number(d.score) : calculateAuditScore(auditData);
            return {
                id: `${d.filename}|${d.auditor}`,
                filename: d.filename || `Audit_${i + 1}`,
                school: d.school || SCHOOLS[0],
                academicYear: d.academicYear || d.academic_year || getDefaultAcademicYear(d.date),
                date: d.date || (d.last_updated ? d.last_updated.split('T')[0] : "2026-08-20"),
                auditor: d.auditor || "Auditor",
                audit_data: auditData,
                ai_summary: d.ai_summary || "",
                score: scoreVal,
                last_updated: d.last_updated || new Date().toISOString(),
                isExternal: false
            };
        });

        // Retain any externally uploaded files already in comparisonState
        const externalAudits = comparisonState.allAvailableAudits.filter(a => a.isExternal);
        
        // Combine DB drafts + external uploads, avoiding duplicate IDs
        const existingExternalIds = new Set(externalAudits.map(a => a.id));
        const merged = [
            ...externalAudits,
            ...candidates.filter(c => !existingExternalIds.has(c.id))
        ];

        merged.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        comparisonState.allAvailableAudits = merged;

        // If no audits selected yet, pick the top 2
        if (comparisonState.selectedAudits.length === 0 && merged.length > 0) {
            comparisonState.selectedAudits = merged.slice(0, Math.min(2, merged.length));
            comparisonState.baselineIndex = 0;
        }
    } catch (e) {
        console.error("Failed to load candidate audits:", e);
        showToast("Error loading candidate drafts for comparison.", "error");
    }
}

/**
 * Applies automated audit selection based on chosen preset mode.
 */
export function applyPresetSelection(preset) {
    comparisonState.activePreset = preset;
    const all = comparisonState.allAvailableAudits;
    if (!all || all.length === 0) return;

    if (preset === "yoy") {
        // Find school with the most audits or use current filter
        let targetSchool = comparisonState.presetFilterSchool;
        if (!targetSchool) {
            const counts = {};
            all.forEach(a => { counts[a.school] = (counts[a.school] || 0) + 1; });
            targetSchool = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || SCHOOLS[0];
            comparisonState.presetFilterSchool = targetSchool;
        }

        const schoolAudits = all.filter(a => a.school === targetSchool);
        // Sort chronologically (oldest to newest for YoY trend)
        schoolAudits.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        
        comparisonState.selectedAudits = schoolAudits.slice(0, 5);
        // Set oldest audit as baseline for YoY comparison
        comparisonState.baselineIndex = 0;
    } else if (preset === "branch") {
        // Group by school group (e.g. Children's Academy Group)
        const targetGroup = "Children's Academy Group";
        const groupAudits = all.filter(a => getSchoolGroup(a.school) === targetGroup);

        // Pick latest audit per unique branch
        const branchMap = new Map();
        groupAudits.forEach(a => {
            if (!branchMap.has(a.school) || new Date(a.date) > new Date(branchMap.get(a.school).date)) {
                branchMap.set(a.school, a);
            }
        });

        const branchList = Array.from(branchMap.values());
        if (branchList.length >= 2) {
            comparisonState.selectedAudits = branchList.slice(0, 5);
        } else {
            // Fallback to top available across any distinct schools
            const distinctMap = new Map();
            all.forEach(a => {
                if (!distinctMap.has(a.school)) distinctMap.set(a.school, a);
            });
            comparisonState.selectedAudits = Array.from(distinctMap.values()).slice(0, 5);
        }
        comparisonState.baselineIndex = 0;
    }
}

/**
 * Handles preset tab clicks.
 */
export function handlePresetChange(preset) {
    applyPresetSelection(preset);
    renderComparisonView();
}

/**
 * Handles YoY School filter dropdown changes.
 */
export function handleComparisonSchoolFilterChange(schoolName) {
    comparisonState.presetFilterSchool = schoolName;
    applyPresetSelection("yoy");
    renderComparisonView();
}

/**
 * Adds or removes an audit from the active comparison set (max 5).
 */
export function toggleAuditSelection(auditId) {
    const isSelected = comparisonState.selectedAudits.some(a => a.id === auditId);
    
    if (isSelected) {
        if (comparisonState.selectedAudits.length <= 1) {
            showToast("Comparison requires at least 1 audit selected.", "error");
            return;
        }
        comparisonState.selectedAudits = comparisonState.selectedAudits.filter(a => a.id !== auditId);
        if (comparisonState.baselineIndex >= comparisonState.selectedAudits.length) {
            comparisonState.baselineIndex = 0;
        }
    } else {
        if (comparisonState.selectedAudits.length >= 5) {
            showToast("Maximum of 5 audits can be compared simultaneously.", "error");
            return;
        }
        const targetAudit = comparisonState.allAvailableAudits.find(a => a.id === auditId);
        if (targetAudit) {
            comparisonState.selectedAudits.push(targetAudit);
        }
    }

    renderComparisonView();
}

/**
 * Sets which selected audit acts as the baseline for delta calculations.
 */
export function setBaselineAudit(index) {
    const idx = parseInt(index, 10);
    if (!isNaN(idx) && idx >= 0 && idx < comparisonState.selectedAudits.length) {
        comparisonState.baselineIndex = idx;
        const selectedBase = comparisonState.selectedAudits[idx];
        const isYoy = comparisonState.activePreset === 'yoy';
        const label = isYoy ? `Base year set to ${selectedBase.date ? selectedBase.date.split('-')[0] : selectedBase.date} (${selectedBase.filename})` : `Baseline set to "${selectedBase.filename}"`;
        showToast(label, 'info');
        renderComparisonView();
    }
}

/**
 * Toggles expanding/collapsing a category accordion in the 56-indicator deep-dive.
 */
export function toggleCategoryAccordion(catName) {
    comparisonState.expandedCategories[catName] = !comparisonState.expandedCategories[catName];
    renderComparisonView();
}

/**
 * Toggles expand/collapse for all categories at once.
 */
export function toggleAllCategoryAccordions(expandAll = true) {
    Object.keys(CATEGORIES).forEach(cat => {
        comparisonState.expandedCategories[cat] = expandAll;
    });
    renderComparisonView();
}

/**
 * Toggles discrepancy-only filter for the indicator deep-dive.
 */
export function toggleDiscrepancyFilter() {
    comparisonState.filterDiscrepanciesOnly = !comparisonState.filterDiscrepanciesOnly;
    renderComparisonView();
}

/**
 * Parses external .json backup or .csv audit file and imports into comparison pool.
 */
export async function handleExternalComparisonUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        let newAudit = null;

        if (file.name.endsWith('.json')) {
            const parsed = JSON.parse(text);
            if (!parsed.auditData && !parsed.audit_data) {
                throw new Error("Invalid JSON audit backup schema: missing auditData.");
            }
            const auditData = parsed.auditData || parsed.audit_data;
            const scoreVal = calculateAuditScore(auditData);
            newAudit = {
                id: `external_${Date.now()}_${file.name}`,
                filename: parsed.filename || file.name.replace('.json', ''),
                school: parsed.school || "Uploaded Campus",
                academicYear: parsed.academicYear || parsed.academic_year || getDefaultAcademicYear(parsed.date),
                date: parsed.date || new Date().toISOString().split('T')[0],
                auditor: "External Upload",
                audit_data: auditData,
                ai_summary: parsed.aiSummary || parsed.ai_summary || "",
                score: scoreVal,
                last_updated: new Date().toISOString(),
                isExternal: true
            };
        } else if (file.name.endsWith('.csv')) {
            newAudit = parseCSVToAuditObject(text, file.name);
        } else {
            showToast("Unsupported file format. Please upload a .json or .csv audit file.", "error");
            return;
        }

        if (newAudit) {
            comparisonState.allAvailableAudits.unshift(newAudit);
            if (comparisonState.selectedAudits.length < 5) {
                comparisonState.selectedAudits.push(newAudit);
            }
            showToast(`Loaded external audit "${newAudit.filename}" into comparison workspace!`, "success");
            renderComparisonView();
        }
    } catch (e) {
        console.error("External audit upload error:", e);
        showToast(`Failed to parse file: ${e.message}`, "error");
    } finally {
        event.target.value = "";
    }
}

/**
 * Helper to parse standard Excelsis CSV exports into an audit data object.
 */
function parseCSVToAuditObject(csvText, fileName) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV file is empty or corrupted.");

    // Simple CSV row parser handling quotes
    const parseCSVRow = (row) => {
        const result = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (char === '"') {
                if (inQuotes && row[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    };

    const headers = parseCSVRow(lines[0]);
    const fileIdx = headers.indexOf("File Name");
    const schoolIdx = headers.indexOf("School");
    const academicYearIdx = headers.indexOf("Academic Year");
    const auditorIdx = headers.indexOf("Auditor");
    const dateIdx = headers.indexOf("Date");
    const catIdx = headers.indexOf("Category");
    const indIdx = headers.indexOf("Indicator");
    const scoreIdx = headers.indexOf("Score");
    const featIdx = headers.indexOf("Notable Features");
    const gapsIdx = headers.indexOf("Gaps Identified");
    const actIdx = headers.indexOf("Actions Recommended");
    const riskSevIdx = headers.indexOf("Risk Severity");
    const riskRatIdx = headers.indexOf("Risk Rationale");

    const auditData = {};
    for (const [cName, cData] of Object.entries(CATEGORIES)) {
        auditData[cName] = {};
        for (const iName of Object.keys(cData.indicators)) {
            auditData[cName][iName] = {
                score: 3,
                features: "",
                gaps: "",
                actions: "",
                reviewed: false,
                customMultiplier: null,
                riskSeverity: "",
                riskRationale: "",
                riskApplied: false
            };
        }
    }

    let metaFilename = fileName.replace('.csv', '');
    let metaSchool = SCHOOLS[0];
    let metaAcademicYear = "";
    let metaAuditor = "External CSV";
    let metaDate = new Date().toISOString().split('T')[0];

    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length < 5) continue;

        if (i === 1) {
            if (fileIdx !== -1 && row[fileIdx]) metaFilename = row[fileIdx];
            if (schoolIdx !== -1 && row[schoolIdx]) metaSchool = row[schoolIdx];
            if (academicYearIdx !== -1 && row[academicYearIdx]) metaAcademicYear = row[academicYearIdx];
            if (auditorIdx !== -1 && row[auditorIdx]) metaAuditor = row[auditorIdx];
            if (dateIdx !== -1 && row[dateIdx]) metaDate = row[dateIdx];
        }

        const cat = row[catIdx];
        const ind = row[indIdx];
        if (auditData[cat] && auditData[cat][ind]) {
            const sc = Number(row[scoreIdx]);
            if (!isNaN(sc) && sc >= 1 && sc <= 5) {
                auditData[cat][ind].score = sc;
            }
            if (featIdx !== -1) auditData[cat][ind].features = row[featIdx] || "";
            if (gapsIdx !== -1) auditData[cat][ind].gaps = row[gapsIdx] || "";
            if (actIdx !== -1) auditData[cat][ind].actions = row[actIdx] || "";
            if (riskSevIdx !== -1 && row[riskSevIdx]) {
                auditData[cat][ind].riskSeverity = row[riskSevIdx];
                auditData[cat][ind].riskApplied = true;
            }
            if (riskRatIdx !== -1 && row[riskRatIdx]) {
                auditData[cat][ind].riskRationale = row[riskRatIdx];
            }
            auditData[cat][ind].reviewed = true;
        }
    }

    const scoreVal = calculateAuditScore(auditData);
    return {
        id: `external_csv_${Date.now()}_${metaFilename}`,
        filename: metaFilename,
        school: metaSchool,
        academicYear: metaAcademicYear || getDefaultAcademicYear(metaDate),
        date: metaDate,
        auditor: metaAuditor,
        audit_data: auditData,
        ai_summary: "",
        score: scoreVal,
        last_updated: new Date().toISOString(),
        isExternal: true
    };
}

/**
 * Triggers AI Comparative Synthesis using Gemini API.
 */
export async function triggerAIComparison() {
    if (!comparisonState.selectedAudits || comparisonState.selectedAudits.length < 2) {
        showToast("Please select at least 2 audits to synthesize comparative insights.", "error");
        return;
    }

    comparisonState.isAILoading = true;
    renderComparisonView();

    try {
        const markdown = await generateComparativeExecutiveSummary(
            comparisonState.selectedAudits,
            comparisonState.baselineIndex
        );
        comparisonState.aiComparisonSummary = markdown;
        showToast("AI Comparative Synthesis completed successfully!", "success");
    } catch (e) {
        console.error("AI Comparative synthesis failed:", e);
        showToast(`AI Synthesis Error: ${e.message}`, "error");
    } finally {
        comparisonState.isAILoading = false;
        renderComparisonView();
    }
}

/**
 * Handles manual inline editing of the AI Comparative Summary.
 */
export function handleAIComparisonSummaryEdit(val) {
    comparisonState.aiComparisonSummary = val;
}

/**
 * Copies the AI summary markdown to clipboard.
 */
export function copyAIComparisonMarkdown() {
    if (!comparisonState.aiComparisonSummary) return;
    navigator.clipboard.writeText(comparisonState.aiComparisonSummary).then(() => {
        showToast("Comparative summary markdown copied to clipboard!", "info");
    });
}

/**
 * Helper to compute cohort average score per category.
 */
function computeCohortCategoryAverages(audits) {
    const averages = {};
    Object.keys(CATEGORIES).forEach(catName => {
        let sumPct = 0;
        audits.forEach(a => {
            const catScores = calculateCategoryScores(a.audit_data);
            sumPct += (catScores[catName]?.percentage || 60);
        });
        averages[catName] = audits.length > 0 ? (sumPct / audits.length) : 60;
    });
    return averages;
}

/**
 * Helper to compute cohort overall average score percentage.
 */
function computeCohortOverallAverage(audits) {
    if (!audits || audits.length === 0) return 0;
    const sum = audits.reduce((acc, a) => acc + (a.score * 100), 0);
    return sum / audits.length;
}

/**
 * Main UI Rendering Engine for the Multi-Audit Comparison Hub.
 */
export function renderComparisonView() {
    const container = document.getElementById('comparison-hub-content');
    if (!container) return;

    const audits = comparisonState.selectedAudits;
    const allAudits = comparisonState.allAvailableAudits;
    const baselineIdx = comparisonState.baselineIndex;
    const baselineAudit = audits[baselineIdx] || audits[0];
    const preset = comparisonState.activePreset;

    const cohortOverallAvg = computeCohortOverallAverage(audits);
    const cohortCategoryAvgs = computeCohortCategoryAverages(audits);

    // Pre-calculate Category Scores for all selected audits
    const auditCategoryMaps = audits.map(a => calculateCategoryScores(a.audit_data));

    // Determine unique schools for YoY filter dropdown
    const availableSchools = Array.from(new Set(allAudits.map(a => a.school)));

    container.innerHTML = `
        <!-- Top Toolbar & Preset Selectors -->
        <div class="flex flex-col gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                    <div class="p-2.5 rounded-xl bg-brand-500/10 text-brand-500 border border-brand-500/20">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                    </div>
                    <div>
                        <h2 class="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>Audit Comparison & Benchmarking Hub</span>
                            <span class="text-xs px-2.5 py-0.5 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 font-bold border border-brand-500/30">Superadmin Matrix</span>
                        </h2>
                        <p class="text-xs text-slate-500 dark:text-slate-400">Side-by-side compliance analytics across academic years, campus branches, and institutional cohorts.</p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <!-- External File Upload Button -->
                    <button onclick="document.getElementById('external-comp-file-input').click()" class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer" title="Upload an external JSON or CSV audit file to compare">
                        <svg class="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                        <span>Upload Past Audit</span>
                    </button>
                    <input type="file" id="external-comp-file-input" accept=".json,.csv" class="hidden" onchange="handleExternalComparisonUpload(event)">

                    <!-- Close Modal Button -->
                    <button onclick="closeComparisonHub()" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer" aria-label="Close Comparison Hub">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>

            <!-- Comparison Modes & Preset Pills -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div class="flex flex-wrap items-center gap-2" role="tablist" aria-label="Comparison Presets">
                    <button onclick="handlePresetChange('yoy')" role="tab" aria-selected="${preset === 'yoy'}" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${preset === 'yoy' ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}">
                        <span>📅 Year-over-Year (Same School)</span>
                    </button>
                    <button onclick="handlePresetChange('branch')" role="tab" aria-selected="${preset === 'branch'}" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${preset === 'branch' ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}">
                        <span>🏫 Cross-Branch Benchmarking</span>
                    </button>
                    <button onclick="handlePresetChange('all')" role="tab" aria-selected="${preset === 'all'}" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer ${preset === 'all' ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}">
                        <span>🔀 Custom Multi-Select</span>
                    </button>
                </div>

                <!-- Contextual Filter / Active Selection Pill -->
                <div class="flex flex-wrap items-center gap-3">
                    ${preset === 'yoy' ? `
                        <div class="flex items-center gap-1.5">
                            <label for="yoy-school-select" class="text-xs font-bold text-slate-500 dark:text-slate-400">Campus:</label>
                            <select id="yoy-school-select" onchange="handleComparisonSchoolFilterChange(this.value)" class="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-sm">
                                ${availableSchools.map(sch => `<option value="${sch}" ${sch === comparisonState.presetFilterSchool ? 'selected' : ''}>${sch}</option>`).join('')}
                            </select>
                        </div>
                    ` : ''}

                    ${audits.length >= 2 ? `
                        <div class="flex items-center gap-1.5 bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/20 px-2.5 py-1 rounded-xl">
                            <label for="comparison-base-year-select" class="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                <span>⭐️ ${preset === 'yoy' ? 'Base Year:' : 'Baseline Target:'}</span>
                            </label>
                            <select id="comparison-base-year-select" onchange="setBaselineAudit(this.value)" class="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700/60 rounded-lg px-2 py-0.5 text-xs font-black text-brand-600 dark:text-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-sm cursor-pointer">
                                ${audits.map((a, i) => {
                                    const dateYear = a.date ? a.date.split('-')[0] : '';
                                    const label = preset === 'yoy' ? `${a.academicYear || dateYear || a.date} — ${a.filename}` : `${a.filename} (${getShortSchoolName(a.school)}${a.academicYear ? ' ' + a.academicYear : ''})`;
                                    return `<option value="${i}" ${i === baselineIdx ? 'selected' : ''}>${label}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    ` : ''}

                    <div class="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <span>Comparing <strong>${audits.length}</strong> of 5 Max Audits</span>
                    </div>
                </div>
            </div>

            <!-- Candidate Audit Selection Chips -->
            <div class="flex flex-col gap-1.5 mt-1 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <div class="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <span>Available Audit Pool (Click checkbox to include/exclude):</span>
                    <span>${allAudits.length} Total Drafts in Browser</span>
                </div>
                <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                    ${allAudits.map((cand, i) => {
                        const isSel = audits.some(a => a.id === cand.id);
                        const isBase = isSel && audits.findIndex(a => a.id === cand.id) === baselineIdx;
                        const candPct = (cand.score * 100).toFixed(1);
                        const candTier = getComplianceTier(candPct);

                        return `
                            <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${isSel ? 'bg-brand-50/80 dark:bg-brand-950/30 border-brand-500/40 text-slate-900 dark:text-white shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 opacity-70 hover:opacity-100'}" onclick="toggleAuditSelection('${cand.id}')">
                                <input type="checkbox" ${isSel ? 'checked' : ''} onclick="event.stopPropagation(); toggleAuditSelection('${cand.id}')" class="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5 cursor-pointer">
                                <div class="flex flex-col leading-tight">
                                    <span class="font-bold truncate max-w-[160px]">${cand.filename}</span>
                                    <span class="text-[10px] text-slate-500 dark:text-slate-400">${getShortSchoolName(cand.school)}${cand.academicYear ? ' • ' + cand.academicYear : ''} • ${cand.date}</span>
                                </div>
                                <span class="font-black text-xs ${candTier.bgClass} px-1.5 py-0.5 rounded-md">${candPct}%</span>
                                ${isBase ? `<span class="text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">${preset === 'yoy' ? 'Base Year' : 'Base'}</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>

        ${audits.length < 2 ? `
            <div class="py-12 flex flex-col items-center justify-center text-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                </div>
                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-200">Select At Least 2 Audits to Compare</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md">Please check at least 2 candidate audits from the selection strip above or upload past JSON/CSV backup files.</p>
            </div>
        ` : `
            <!-- ================= SECTION 1: EXECUTIVE KPI SCOREBOARD ================= -->
            <div class="flex flex-col gap-3 pt-6">
                <div class="flex items-center justify-between">
                    <h3 class="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                        <span>1. Executive Performance Scoreboard</span>
                    </h3>
                    <span class="text-xs text-slate-500 dark:text-slate-400">Cohort Average Score: <strong class="text-brand-600 dark:text-brand-400">${cohortOverallAvg.toFixed(2)}%</strong></span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-${Math.min(audits.length, 5)} gap-4">
                    ${audits.map((audit, idx) => {
                        const isBaseline = idx === baselineIdx;
                        const scorePct = audit.score * 100;
                        const tier = getComplianceTier(scorePct);
                        const deltaVsBase = scorePct - (baselineAudit.score * 100);
                        const deltaVsCohort = scorePct - cohortOverallAvg;

                        return `
                            <div class="relative flex flex-col justify-between p-4 rounded-2xl border transition-all ${isBaseline ? 'bg-gradient-to-b from-brand-500/10 to-transparent border-brand-500/50 ring-2 ring-brand-500/20 dark:from-brand-950/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}">
                                ${isBaseline ? `
                                    <div class="absolute -top-2.5 right-3 bg-brand-600 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider shadow-sm flex items-center gap-1">
                                        <span>⭐️ ${preset === 'yoy' ? 'Base Year Reference' : 'Baseline Audit'}</span>
                                    </div>
                                ` : ''}
                                
                                <div class="flex flex-col gap-2">
                                    <div class="flex flex-col">
                                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Audit #${idx + 1}</span>
                                        <h4 class="font-extrabold text-sm text-slate-900 dark:text-white truncate" title="${audit.filename}">${audit.filename}</h4>
                                        <span class="text-xs text-brand-600 dark:text-brand-400 font-semibold truncate">${audit.school}${audit.academicYear ? ' (' + audit.academicYear + ')' : ''}</span>
                                    </div>

                                    <div class="flex items-baseline justify-between pt-1">
                                        <div class="flex flex-col">
                                            <span class="text-3xl font-black text-slate-900 dark:text-white tracking-tight">${scorePct.toFixed(2)}%</span>
                                            <span class="text-[11px] font-bold ${tier.bgClass} px-2 py-0.5 rounded-md w-fit mt-1">${tier.label}</span>
                                        </div>
                                    </div>

                                    <!-- Delta Indicators -->
                                    <div class="flex flex-col gap-1 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                                        ${!isBaseline ? `
                                            <div class="flex items-center justify-between">
                                                <span class="text-slate-500 dark:text-slate-400">${preset === 'yoy' ? 'vs Base Year' : 'vs Baseline'}:</span>
                                                <span class="font-bold ${deltaVsBase >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
                                                    ${deltaVsBase >= 0 ? '+' : ''}${deltaVsBase.toFixed(2)}%
                                                </span>
                                            </div>
                                        ` : `
                                            <div class="flex items-center justify-between text-slate-400 italic">
                                                <span>Active ${preset === 'yoy' ? 'Base Year' : 'Reference'}</span>
                                                <span>±0.00%</span>
                                            </div>
                                        `}
                                        <div class="flex items-center justify-between">
                                            <span class="text-slate-500 dark:text-slate-400">vs Cohort Avg:</span>
                                            <span class="font-semibold ${deltaVsCohort >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
                                                ${deltaVsCohort >= 0 ? '+' : ''}${deltaVsCohort.toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div class="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                                    <span>${audit.date} • ${audit.auditor}</span>
                                    ${!isBaseline ? `
                                        <button onclick="setBaselineAudit(${idx})" class="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-[10px] font-bold px-2 py-0.5 rounded-md cursor-pointer transition-all flex items-center gap-1">
                                            <span>Set as ${preset === 'yoy' ? 'Base Year' : 'Baseline'}</span>
                                        </button>
                                    ` : `
                                        <span class="text-emerald-600 dark:text-emerald-400 font-bold text-[10px] flex items-center gap-0.5">
                                            ✓ Active ${preset === 'yoy' ? 'Base Year' : 'Baseline'}
                                        </span>
                                    `}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- ================= SECTION 2: 10-CATEGORY BENCHMARK MATRIX ================= -->
            <div class="flex flex-col gap-3 pt-8">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                            2. 10-Category Benchmark Matrix
                        </h3>
                        <p class="text-xs text-slate-500 dark:text-slate-400">Cross-pillar comparison with weighted compliance scores and relative variance vs baseline.</p>
                    </div>
                </div>

                <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                    <table class="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr class="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 font-bold uppercase text-[10px] tracking-wider">
                                <th class="py-3 px-4 min-w-[200px]">Audit Category & Weight</th>
                                ${audits.map((a, i) => `
                                    <th class="py-3 px-3 min-w-[130px] ${i === baselineIdx ? 'text-brand-600 dark:text-brand-400 bg-brand-500/5' : ''}">
                                        <div class="flex flex-col">
                                            <span class="truncate max-w-[130px]">${a.filename}</span>
                                            <span class="text-[9px] font-normal opacity-70">${getShortSchoolName(a.school)}${a.academicYear ? ' • ' + a.academicYear : ''} ${i === baselineIdx ? '(Base)' : ''}</span>
                                        </div>
                                    </th>
                                `).join('')}
                                <th class="py-3 px-3 text-center min-w-[100px]">Cohort Avg</th>
                                <th class="py-3 px-3 text-center min-w-[100px]">Max Variance</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                            ${Object.entries(CATEGORIES).map(([catName, catDef]) => {
                                const weightPct = (catDef.weight * 100).toFixed(0);
                                const scores = audits.map((a, idx) => auditCategoryMaps[idx][catName]?.percentage || 60);
                                const baselineScore = scores[baselineIdx];
                                const cohortAvg = cohortCategoryAvgs[catName];
                                const minScore = Math.min(...scores);
                                const maxScore = Math.max(...scores);
                                const varianceDelta = maxScore - minScore;

                                return `
                                    <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        <td class="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                            <div class="flex items-center justify-between gap-2">
                                                <span>${catName}</span>
                                                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">${weightPct}%</span>
                                            </div>
                                        </td>
                                        ${scores.map((sc, i) => {
                                            const delta = sc - baselineScore;
                                            const isBase = i === baselineIdx;
                                            return `
                                                <td class="py-3 px-3 ${isBase ? 'bg-brand-500/5 font-extrabold' : ''}">
                                                    <div class="flex flex-col gap-1">
                                                        <div class="flex items-center justify-between">
                                                            <span class="font-bold">${sc.toFixed(1)}%</span>
                                                            ${!isBase ? `
                                                                <span class="text-[10px] font-bold ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
                                                                    ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%
                                                                </span>
                                                            ` : '<span class="text-[10px] text-slate-400">Ref</span>'}
                                                        </div>
                                                        <div class="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                                            <div class="h-full rounded-full ${sc >= 75 ? 'bg-emerald-500' : sc >= 60 ? 'bg-amber-500' : 'bg-rose-500'}" style="width: ${Math.min(100, Math.max(0, sc))}%"></div>
                                                        </div>
                                                    </div>
                                                </td>
                                            `;
                                        }).join('')}
                                        <td class="py-3 px-3 text-center font-bold text-slate-600 dark:text-slate-300">
                                            ${cohortAvg.toFixed(1)}%
                                        </td>
                                        <td class="py-3 px-3 text-center">
                                            <span class="px-2 py-0.5 rounded-md font-bold text-[11px] ${varianceDelta > 15 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : varianceDelta > 8 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600'}">
                                                ±${varianceDelta.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ================= SECTION 3: 56-INDICATOR GRANULAR DEEP-DIVE ================= -->
            <div class="flex flex-col gap-3 pt-8">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                            3. 56-Indicator Granular Deep-Dive & Write-up Matrix
                        </h3>
                        <p class="text-xs text-slate-500 dark:text-slate-400">Side-by-side indicator score ratings (1-5), risk multipliers, notable strengths, and gap recommendations.</p>
                    </div>

                    <div class="flex items-center gap-3">
                        <!-- Discrepancy Only Filter Toggle -->
                        <label class="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700">
                            <input type="checkbox" ${comparisonState.filterDiscrepanciesOnly ? 'checked' : ''} onchange="toggleDiscrepancyFilter()" class="rounded text-brand-600 focus:ring-brand-500 w-4 h-4 cursor-pointer">
                            <span>High Variance / High Risk Only</span>
                        </label>

                        <!-- Expand / Collapse All -->
                        <div class="flex items-center gap-1">
                            <button onclick="toggleAllCategoryAccordions(true)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer">Expand All</button>
                            <button onclick="toggleAllCategoryAccordions(false)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer">Collapse All</button>
                        </div>
                    </div>
                </div>

                <!-- Category Accordions -->
                <div class="flex flex-col gap-3">
                    ${Object.entries(CATEGORIES).map(([catName, catDef]) => {
                        const isExpanded = comparisonState.expandedCategories[catName] !== false; // default expanded

                        // Filter indicators in category if filterDiscrepanciesOnly is true
                        const indicatorEntries = Object.entries(catDef.indicators).filter(([indName, defaultMult]) => {
                            if (!comparisonState.filterDiscrepanciesOnly) return true;
                            
                            // Check score discrepancy (max - min >= 2) or high risk (any risk applied / multiplier >= 3)
                            const scores = audits.map(a => Number(a.audit_data?.[catName]?.[indName]?.score || 3));
                            const maxSc = Math.max(...scores);
                            const minSc = Math.min(...scores);
                            const hasRisk = audits.some(a => {
                                const item = a.audit_data?.[catName]?.[indName];
                                return item && (item.riskApplied || item.riskSeverity === 'Critical' || item.riskSeverity === 'High' || defaultMult === 3);
                            });

                            return (maxSc - minSc >= 2) || hasRisk;
                        });

                        if (comparisonState.filterDiscrepanciesOnly && indicatorEntries.length === 0) {
                            return ''; // Skip categories with no discrepancies when filter is active
                        }

                        return `
                            <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
                                <!-- Category Accordion Header -->
                                <button onclick="toggleCategoryAccordion('${catName}')" class="w-full flex items-center justify-between p-4 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left cursor-pointer">
                                    <div class="flex items-center gap-2.5">
                                        <svg class="w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                                        <span class="font-extrabold text-sm text-slate-900 dark:text-white">${catName}</span>
                                        <span class="text-xs text-slate-500 font-medium">(${indicatorEntries.length} Indicators)</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        ${audits.map((a, idx) => {
                                            const catScore = auditCategoryMaps[idx][catName]?.percentage || 60;
                                            return `
                                                <span class="text-xs font-bold px-2 py-0.5 rounded ${catScore >= 75 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}">
                                                    ${getShortSchoolName(a.school)}: ${catScore.toFixed(0)}%
                                                </span>
                                            `;
                                        }).join('')}
                                    </div>
                                </button>

                                <!-- Indicators Table -->
                                ${isExpanded ? `
                                    <div class="p-4 flex flex-col gap-4 divide-y divide-slate-100 dark:divide-slate-800">
                                        ${indicatorEntries.map(([indName, defaultMultiplier]) => {
                                            const indScores = audits.map(a => a.audit_data?.[catName]?.[indName] || { score: 3 });

                                            return `
                                                <div class="pt-3 first:pt-0 flex flex-col gap-2.5">
                                                    <!-- Indicator Header & Score Comparison Pills -->
                                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                                        <div class="flex items-center gap-2">
                                                            <span class="font-bold text-xs text-slate-900 dark:text-white">${indName}</span>
                                                            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">${defaultMultiplier}x Risk</span>
                                                        </div>
                                                        <div class="flex items-center gap-2">
                                                            ${indScores.map((item, idx) => {
                                                                const sc = Number(item.score) || 3;
                                                                const isBase = idx === baselineIdx;
                                                                const scoreCol = sc === 5 ? 'bg-emerald-500 text-white' : sc === 4 ? 'bg-blue-500 text-white' : sc === 3 ? 'bg-amber-500 text-white' : sc === 2 ? 'bg-orange-500 text-white' : 'bg-rose-500 text-white';
                                                                return `
                                                                    <div class="flex items-center gap-1 text-xs" title="${audits[idx].filename}: Score ${sc}/5">
                                                                        <span class="text-[10px] text-slate-400 font-semibold">${getShortSchoolName(audits[idx].school)}:</span>
                                                                        <span class="font-black px-2 py-0.5 rounded-md ${scoreCol} ${isBase ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900' : ''}">${sc}★</span>
                                                                    </div>
                                                                `;
                                                            }).join('')}
                                                        </div>
                                                    </div>

                                                    <!-- Side-by-Side Write-Up Cards -->
                                                    <div class="grid grid-cols-1 md:grid-cols-${Math.min(audits.length, 5)} gap-2 text-xs">
                                                        ${indScores.map((item, idx) => {
                                                            const hasFeat = item.features && item.features.trim();
                                                            const hasGaps = item.gaps && item.gaps.trim();
                                                            const hasActs = item.actions && item.actions.trim();
                                                            const hasRisk = item.riskApplied && item.riskSeverity;

                                                            return `
                                                                <div class="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col gap-1.5">
                                                                    <span class="text-[10px] font-bold text-slate-500 uppercase">${audits[idx].filename} (${audits[idx].date})</span>
                                                                    ${hasRisk ? `
                                                                        <div class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                                                            ⚠️ ${item.riskSeverity} (${item.customMultiplier}x): ${item.riskRationale || ''}
                                                                        </div>
                                                                    ` : ''}
                                                                    ${hasFeat ? `
                                                                        <div class="flex flex-col">
                                                                            <span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Strengths:</span>
                                                                            <p class="text-[11px] text-slate-700 dark:text-slate-300 leading-tight">${item.features}</p>
                                                                        </div>
                                                                    ` : ''}
                                                                    ${hasGaps ? `
                                                                        <div class="flex flex-col">
                                                                            <span class="text-[10px] font-bold text-rose-600 dark:text-rose-400">✗ Gaps:</span>
                                                                            <p class="text-[11px] text-slate-700 dark:text-slate-300 leading-tight">${item.gaps}</p>
                                                                        </div>
                                                                    ` : ''}
                                                                    ${hasActs ? `
                                                                        <div class="flex flex-col">
                                                                            <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400">→ Actions:</span>
                                                                            <p class="text-[11px] text-slate-700 dark:text-slate-300 leading-tight">${item.actions}</p>
                                                                        </div>
                                                                    ` : ''}
                                                                    ${!hasFeat && !hasGaps && !hasActs ? `
                                                                        <span class="text-[10px] text-slate-400 italic">No narrative notes recorded.</span>
                                                                    ` : ''}
                                                                </div>
                                                            `;
                                                        }).join('')}
                                                    </div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- ================= SECTION 4: AI COMPARATIVE SYNTHESIS ================= -->
            <div class="flex flex-col gap-3 pt-8 pb-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                            <span>4. AI Comparative Strategic Synthesis</span>
                            <span class="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 font-bold">Gemini Intelligence</span>
                        </h3>
                        <p class="text-xs text-slate-500 dark:text-slate-400">AI-generated longitudinal trend analysis, campus strengths & gaps synthesis, and board strategic recommendations.</p>
                    </div>

                    <div class="flex items-center gap-2">
                        <button onclick="triggerAIComparison()" ${comparisonState.isAILoading ? 'disabled' : ''} class="bg-gradient-to-r from-purple-600 via-indigo-600 to-brand-600 hover:from-purple-700 hover:via-indigo-700 hover:to-brand-700 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-purple-600/15 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                            ${comparisonState.isAILoading ? `
                                <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span>Synthesizing Audits...</span>
                            ` : `
                                <svg class="w-4 h-4 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                <span>${comparisonState.aiComparisonSummary ? 'Regenerate AI Synthesis' : 'Generate AI Synthesis'}</span>
                            `}
                        </button>
                    </div>
                </div>

                <!-- AI Output Display Box -->
                <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
                    ${comparisonState.isAILoading ? `
                        <div class="py-12 flex flex-col items-center justify-center text-center gap-3">
                            <div class="w-10 h-10 rounded-full border-4 border-purple-500 border-t-transparent animate-spin"></div>
                            <span class="text-sm font-bold text-slate-700 dark:text-slate-300">Gemini is analyzing ${audits.length} audit datasets across 56 indicators...</span>
                            <span class="text-xs text-slate-500">Cross-referencing category deltas, safety risk weights, and write-up observations.</span>
                        </div>
                    ` : comparisonState.aiComparisonSummary ? `
                        <div class="flex flex-col gap-4">
                            <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                                <span class="font-bold text-slate-500">Strategic Intelligence Briefing</span>
                                <button onclick="copyAIComparisonMarkdown()" class="text-brand-600 dark:text-brand-400 hover:underline font-bold flex items-center gap-1 cursor-pointer">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                    <span>Copy Markdown</span>
                                </button>
                            </div>
                            <div class="prose dark:prose-invert max-w-none text-xs leading-relaxed overflow-x-auto">
                                ${renderMarkdown(comparisonState.aiComparisonSummary)}
                            </div>
                        </div>
                    ` : `
                        <div class="py-8 flex flex-col items-center justify-center text-center gap-2">
                            <svg class="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-7.072 0z"/></svg>
                            <span class="text-sm font-bold text-slate-700 dark:text-slate-300">No AI Comparative Synthesis Generated Yet</span>
                            <p class="text-xs text-slate-500 max-w-md">Click "Generate AI Synthesis" above to produce a comprehensive cross-audit intelligence report with strategic board recommendations.</p>
                        </div>
                    `}
                </div>
            </div>

            <!-- ================= SECTION 5: EXPORT ACTION BAR ================= -->
            <div class="sticky bottom-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-xl z-20 mt-6">
                <div class="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                    <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span>${audits.length} Audits Ready for Board Reporting & CSV Export</span>
                </div>

                <div class="flex items-center gap-2">
                    <!-- Export Comparative CSV -->
                    <button onclick="exportComparativeCSV()" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer">
                        <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>Export Comparative CSV</span>
                    </button>

                    <!-- Generate Comparative PDF Board Report -->
                    <button onclick="generateComparativePDFReport()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-indigo-600/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <span>Generate Comparative Board PDF</span>
                    </button>
                </div>
            </div>
        `}
    `;
}
