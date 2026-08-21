/**
 * js/export.js — Data Export, Import & Draft Consolidation Engine
 * RFC 4180 CSV export/import, JSON backup/restore, history listing, and Superadmin multi-audit draft consolidation.
 */

import { SCHOOLS, CATEGORIES, AUDITOR_HASHES } from './config.js';
import { state, saveState, calculateScore, updateCalculations, startNewAudit } from './state.js';
import { dbGet, dbGetAll, saveLocalDraftToDB, deleteLocalDraftFromDB } from './storage.js';
import { showToast, renderCategoryNavigation, renderActiveCategoryIndicators, initIndicatorsGrid } from './ui.js';
import { runFullAuditAIPipeline } from './ai.js';

export function exportToCSV() {
    saveState.flush();
    const headers = [
        "File Name",
        "School",
        "Auditor",
        "Date",
        "Category",
        "Indicator",
        "Base Multiplier",
        "Effective Multiplier",
        "Risk Modified",
        "Risk Severity",
        "Risk Rationale",
        "Score",
        "Notable Features",
        "AI Notable Features",
        "Gaps Identified",
        "AI Gaps Identified",
        "Actions Recommended",
        "AI Actions Recommended",
        "Photo Attachment"
    ];
    
    const escapeCSV = (val) => {
        const str = String(val === undefined || val === null ? "" : val);
        return `"${str.replace(/"/g, '""')}"`;
    };
    
    let csvRows = [headers.map(h => escapeCSV(h)).join(",")];
    
    const filename = state.filename || "Untitled_Audit";
    const school = state.school || "";
    const auditor = state.loggedInUser || "";
    const date = state.date || "";
    
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        Object.entries(catData.indicators).forEach(([indName, multiplier]) => {
            const item = state.auditData[catName]?.[indName] || { score: 3, features: "", gaps: "", actions: "", aiFeatures: "", aiGaps: "", aiActions: "", photoName: "" };
            const isModified = !!(item.riskApplied && item.customMultiplier != null);
            const effectiveMult = isModified ? item.customMultiplier : multiplier;
            
            const row = [
                filename,
                school,
                auditor,
                date,
                catName,
                indName,
                `${multiplier}x`,
                `${effectiveMult}x`,
                isModified ? "Yes" : "No",
                item.riskSeverity || "",
                item.riskRationale || "",
                item.score,
                item.features || "",
                item.aiFeatures || "",
                item.gaps || "",
                item.aiGaps || "",
                item.actions || "",
                item.aiActions || "",
                item.photoName || ""
            ];
            
            csvRows.push(row.map(escapeCSV).join(","));
        });
    });
    
    const csvContent = "\ufeff" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const formattedName = filename.replace(/\s+/g, '_');
    const fileName = `Excelsis_Audit_${formattedName}_${date}.csv`;
    
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function exportToJSON() {
    saveState.flush();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        version: "2.0",
        filename: state.filename,
        school: state.school,
        date: state.date,
        aiSummary: state.aiSummary || "",
        auditData: state.auditData
    }, null, 2));
    
    const link = document.createElement('a');
    link.setAttribute("href", dataStr);
    const cleanName = state.filename.replace(/\s+/g, '_');
    link.setAttribute("download", `Excelsis_Backup_${cleanName}_${state.date}.json`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("JSON Backup downloaded successfully!");
}

export function importFromJSON(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                
                if (!imported.filename || !imported.school || !imported.auditData) {
                    showToast("Invalid JSON backup structure.", "error");
                    return;
                }
                
                state.filename = imported.filename;
                state.school = imported.school;
                if (imported.date) state.date = imported.date;
                state.aiSummary = imported.aiSummary || "";
                state.auditData = imported.auditData;
                
                // Sync UI inputs
                const fileInput = document.getElementById('meta-filename');
                if (fileInput) fileInput.value = state.filename;
                const schoolSelect = document.getElementById('meta-school');
                if (schoolSelect) schoolSelect.value = state.school;
                const dateInput = document.getElementById('meta-date');
                if (dateInput) dateInput.value = state.date;
                
                saveState.flush();
                await saveState();
                await fetchHistory();
                
                initIndicatorsGrid();
                renderCategoryNavigation();
                renderActiveCategoryIndicators();
                updateCalculations();
                
                showToast(`Successfully loaded draft file: "${state.filename}"`);
            } catch (err) {
                showToast("Failed to parse JSON file.", "error");
            }
        };
        
        reader.readAsText(file);
        input.value = "";
    }
}

export function parseCSV(text) {
    if (!text) return [];
    text = text.replace(/^\uFEFF/, '');
    
    // Auto-detect delimiter if not comma: check first non-empty line
    let delimiter = ',';
    const firstLine = text.split(/\r\n|\r|\n/)[0] || '';
    if (firstLine) {
        const commaCount = (firstLine.match(/,/g) || []).length;
        const semiCount = (firstLine.match(/;/g) || []).length;
        const tabCount = (firstLine.match(/\t/g) || []).length;
        if (semiCount > commaCount && semiCount >= tabCount) {
            delimiter = ';';
        } else if (tabCount > commaCount && tabCount > semiCount) {
            delimiter = '\t';
        }
    }

    const lines = [];
    let row = [""];
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i+1];
        
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === delimiter && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
        lines.push(row);
    }
    return lines;
}

function findHeaderIndex(headers, candidates, excludePatterns = []) {
    const clean = (s) => (s || '').toString().toLowerCase().replace(/[\uFEFF\x00-\x1F\x7F-\x9F]/g, '').replace(/[^a-z0-9]/g, '');
    const cleanHeaders = headers.map(clean);
    const cleanExcludes = excludePatterns.map(clean);
    
    // 1. Exact match
    for (const cand of candidates) {
        const cleanCand = clean(cand);
        for (let i = 0; i < cleanHeaders.length; i++) {
            const h = cleanHeaders[i];
            const isExcluded = cleanExcludes.some(ex => h.includes(ex));
            if (!isExcluded && h === cleanCand) return i;
        }
    }
    
    // 2. Starts-with or prefix match
    for (const cand of candidates) {
        const cleanCand = clean(cand);
        for (let i = 0; i < cleanHeaders.length; i++) {
            const h = cleanHeaders[i];
            const isExcluded = cleanExcludes.some(ex => h.includes(ex));
            if (!isExcluded && (h.startsWith(cleanCand) || (cleanCand.length >= 4 && cleanCand.startsWith(h)))) {
                return i;
            }
        }
    }
    
    // 3. Substring match
    for (const cand of candidates) {
        const cleanCand = clean(cand);
        if (cleanCand.length >= 4) {
            for (let i = 0; i < cleanHeaders.length; i++) {
                const h = cleanHeaders[i];
                const isExcluded = cleanExcludes.some(ex => h.includes(ex));
                if (!isExcluded && h.includes(cleanCand)) return i;
            }
        }
    }
    
    return -1;
}

export function importFromCSV(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const csvText = e.target.result;
                const parsed = parseCSV(csvText);
                
                if (!parsed || parsed.length < 2) {
                    showToast("Empty CSV file uploaded.", "error");
                    return;
                }
                
                const headers = parsed[0].map(h => (h || '').trim().replace(/^"|"$/g, '').trim());
                
                const filenameIdx = findHeaderIndex(headers, ["File Name", "Filename", "Audit Name", "File", "Title"]);
                const schoolIdx = findHeaderIndex(headers, ["School", "School Name", "Institution", "Campus"]);
                const auditorIdx = findHeaderIndex(headers, ["Auditor", "Auditor Name", "Inspector", "Evaluator", "Assessor", "User"]);
                const dateIdx = findHeaderIndex(headers, ["Date", "Audit Date", "Inspection Date"]);
                const catIdx = findHeaderIndex(headers, ["Category", "Category Name", "Domain", "Section", "Cat"]);
                const indIdx = findHeaderIndex(headers, ["Indicator", "Indicator Name", "Subcategory", "Item", "Parameter", "Ind"]);
                const scoreIdx = findHeaderIndex(headers, ["Score", "Score (1-5)", "Score 1-5", "Score(1-5)", "Rating", "Mark", "Points", "Value"]);
                
                const aiFeaturesIdx = findHeaderIndex(headers, ["AI Notable Features", "AI Features", "AI Strengths"]);
                const featuresIdx = findHeaderIndex(headers, ["Notable Features", "Features", "Strengths", "Positive Findings", "Notable"], ["AI"]);
                
                const aiGapsIdx = findHeaderIndex(headers, ["AI Gaps Identified", "AI Gaps", "AI Weaknesses"]);
                const gapsIdx = findHeaderIndex(headers, ["Gaps Identified", "Gaps", "Weaknesses", "Deficiencies", "Areas of Concern"], ["AI"]);
                
                const aiActionsIdx = findHeaderIndex(headers, ["AI Actions Recommended", "AI Actions", "AI Recommendations"]);
                const actionsIdx = findHeaderIndex(headers, ["Actions Recommended", "Actions", "Recommendations", "Corrective Actions"], ["AI"]);
                
                const photoNameIdx = findHeaderIndex(headers, ["Photo Attachment", "Photo Filename", "Photo Name", "Photo", "Attachment", "Image"]);
                const riskModifiedIdx = findHeaderIndex(headers, ["Risk Modified", "Risk Mod", "Risk Adjusted"]);
                const effMultIdx = findHeaderIndex(headers, ["Effective Multiplier", "Multiplier", "Weight"]);
                const riskSeverityIdx = findHeaderIndex(headers, ["Risk Severity", "Severity", "Risk Level"]);
                const riskRationaleIdx = findHeaderIndex(headers, ["Risk Rationale", "Rationale", "Risk Notes", "Risk Reason"]);
                
                if (catIdx === -1 || indIdx === -1 || scoreIdx === -1) {
                    const missing = [];
                    if (catIdx === -1) missing.push("Category");
                    if (indIdx === -1) missing.push("Indicator");
                    if (scoreIdx === -1) missing.push("Score");
                    showToast(`Invalid CSV headers. Missing: ${missing.join(", ")}.`, "error");
                    return;
                }
                
                const firstDataRow = parsed[1];
                if (filenameIdx !== -1 && firstDataRow[filenameIdx]) {
                    const fnVal = firstDataRow[filenameIdx].trim();
                    if (fnVal) state.filename = fnVal;
                }
                if (schoolIdx !== -1 && firstDataRow[schoolIdx]) {
                    const csvSchool = firstDataRow[schoolIdx].trim();
                    const matchedSchool = SCHOOLS.find(s => s.toLowerCase() === csvSchool.toLowerCase());
                    if (matchedSchool) {
                        state.school = matchedSchool;
                    }
                }
                if (dateIdx !== -1 && firstDataRow[dateIdx]) {
                    const dateVal = firstDataRow[dateIdx].trim();
                    if (dateVal) state.date = dateVal;
                }
                
                if (auditorIdx !== -1 && firstDataRow[auditorIdx]) {
                    const csvAuditor = firstDataRow[auditorIdx].trim();
                    const matchedAuditor = Object.keys(AUDITOR_HASHES).find(a => a.toLowerCase() === csvAuditor.toLowerCase());
                    if (matchedAuditor) {
                        state.auditor = matchedAuditor;
                    }
                }
                
                // Build normalized lookup for categories and indicators (case/whitespace insensitive)
                const normalizedCategories = {};
                Object.entries(CATEGORIES).forEach(([cName, cObj]) => {
                    const cNorm = cName.trim().toLowerCase();
                    const indNormMap = {};
                    Object.entries(cObj.indicators).forEach(([iName]) => {
                        indNormMap[iName.trim().toLowerCase()] = iName;
                    });
                    normalizedCategories[cNorm] = {
                        exactName: cName,
                        indicatorsMap: indNormMap
                    };
                });
                
                const minCols = Math.max(catIdx, indIdx, scoreIdx);
                let importedRowsCount = 0;
                
                for (let i = 1; i < parsed.length; i++) {
                    const row = parsed[i];
                    if (!row || row.length <= minCols) continue;
                    
                    const rawCat = (row[catIdx] || '').trim();
                    const rawInd = (row[indIdx] || '').trim();
                    if (!rawCat && !rawInd) continue;
                    
                    let targetCatName = null;
                    let targetIndName = null;
                    
                    if (CATEGORIES[rawCat] && CATEGORIES[rawCat].indicators.hasOwnProperty(rawInd)) {
                        targetCatName = rawCat;
                        targetIndName = rawInd;
                    } else {
                        const catEntry = normalizedCategories[rawCat.toLowerCase()];
                        if (catEntry) {
                            targetCatName = catEntry.exactName;
                            targetIndName = catEntry.indicatorsMap[rawInd.toLowerCase()];
                        }
                    }
                    
                    if (targetCatName && targetIndName) {
                        const rawScoreStr = (row[scoreIdx] || '').toString();
                        const parsedScore = parseInt(rawScoreStr.replace(/[^0-9]/g, ''), 10) || 3;
                        const scoreVal = Math.max(1, Math.min(5, parsedScore));
                        
                        const existingData = state.auditData[targetCatName]?.[targetIndName] || {};
                        const csvPhotoName = photoNameIdx !== -1 && row[photoNameIdx] ? row[photoNameIdx].trim() : "";
                        const photoDataVal = (existingData.photoName === csvPhotoName) ? (existingData.photoData || "") : "";
                        
                        const isRiskMod = riskModifiedIdx !== -1 && row[riskModifiedIdx]?.trim().toLowerCase() === "yes";
                        let customMultVal = null;
                        if (isRiskMod && effMultIdx !== -1 && row[effMultIdx]) {
                            const parsedM = parseInt(row[effMultIdx].toString().replace(/[^0-9]/g, ''), 10);
                            if (parsedM >= 1 && parsedM <= 5) customMultVal = parsedM;
                        }
                        
                        if (!state.auditData[targetCatName]) {
                            state.auditData[targetCatName] = {};
                        }

                        state.auditData[targetCatName][targetIndName] = {
                            score: scoreVal,
                            features: (featuresIdx !== -1 && row[featuresIdx]) ? row[featuresIdx] : "",
                            aiFeatures: (aiFeaturesIdx !== -1 && row[aiFeaturesIdx]) ? row[aiFeaturesIdx] : "",
                            gaps: (gapsIdx !== -1 && row[gapsIdx]) ? row[gapsIdx] : "",
                            aiGaps: (aiGapsIdx !== -1 && row[aiGapsIdx]) ? row[aiGapsIdx] : "",
                            actions: (actionsIdx !== -1 && row[actionsIdx]) ? row[actionsIdx] : "",
                            aiActions: (aiActionsIdx !== -1 && row[aiActionsIdx]) ? row[aiActionsIdx] : "",
                            photoName: csvPhotoName,
                            photoData: photoDataVal,
                            reviewed: true,
                            customMultiplier: customMultVal,
                            riskSeverity: (riskSeverityIdx !== -1 && row[riskSeverityIdx]) ? row[riskSeverityIdx] : "",
                            riskRationale: (riskRationaleIdx !== -1 && row[riskRationaleIdx]) ? row[riskRationaleIdx] : "",
                            riskScoreDelta: 0,
                            riskApplied: isRiskMod
                        };
                        importedRowsCount++;
                    }
                }
                
                const fileInput = document.getElementById('meta-filename');
                if (fileInput) fileInput.value = state.filename;
                const schoolSelect = document.getElementById('meta-school');
                if (schoolSelect) schoolSelect.value = state.school;
                const dateInput = document.getElementById('meta-date');
                if (dateInput) dateInput.value = state.date;
                const activeAuditorLabel = document.getElementById('active-auditor-label');
                if (activeAuditorLabel) activeAuditorLabel.innerHTML = state.auditor || state.loggedInUser;
                
                saveState.flush();
                await saveState();
                await fetchHistory();
                
                initIndicatorsGrid();
                renderCategoryNavigation();
                renderActiveCategoryIndicators();
                updateCalculations();
                
                if (importedRowsCount > 0) {
                    showToast(`Successfully loaded CSV audit draft: "${state.filename}" (${importedRowsCount} indicators)`);
                    // Automatically trigger full-audit AI pipeline across all categories
                    runFullAuditAIPipeline().catch(err => {
                        console.error("Auto AI pipeline error on CSV import:", err);
                    });
                } else {
                    showToast("CSV loaded, but no matching indicators were found. Please check category/indicator names.", "warning");
                }
            } catch(err) {
                console.error(err);
                showToast("Failed to parse CSV file content.", "error");
            }
        };
        
        reader.readAsText(file);
        input.value = "";
    }
}

export function downloadCSVTemplate() {
    const headers = [
        "Category",
        "Indicator",
        "Score",
        "Notable Features",
        "Gaps Identified",
        "Actions Recommended",
        "Photo Attachment"
    ];
    let csvRows = [headers.map(h => `"${h}"`).join(",")];
    
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        Object.keys(catData.indicators).forEach(indName => {
            const row = [
                `"${catName.replace(/"/g, '""')}"`,
                `"${indName.replace(/"/g, '""')}"`,
                "3",
                "",
                "",
                "",
                ""
            ];
            csvRows.push(row.join(","));
        });
    });
    
    const csvContent = "\ufeff" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "Excelsis_Audit_Template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

export async function fetchHistory() {
    if (!state.loggedInUser) return;
    const drafts = await dbGetAll("drafts");
    
    const history = drafts.filter(item => {
        if (state.loggedInUser === "Superadmin") return true;
        return item.auditor === state.loggedInUser;
    });
    
    history.sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));
    renderHistoryList(history);
}

export function renderHistoryList(history) {
    const listEl = document.getElementById('saved-audits-list');
    const consolidateBtn = document.getElementById('consolidate-btn');
    const compareBtn = document.getElementById('compare-audits-btn');
    if (!listEl) return;

    if (state.loggedInUser === "Superadmin") {
        if (compareBtn) compareBtn.classList.remove('hidden');
    } else {
        if (compareBtn) compareBtn.classList.add('hidden');
    }

    if (!history || history.length === 0) {
        listEl.innerHTML = `<span class="text-slate-600 dark:text-slate-300 italic">No saved drafts in browser cache</span>`;
        if (consolidateBtn) consolidateBtn.classList.add('hidden');
        return;
    }
    
    if (state.loggedInUser === "Superadmin") {
        if (consolidateBtn) consolidateBtn.classList.remove('hidden');
        
        listEl.innerHTML = history.map(item => {
            const roundedScore = (item.score * 100).toFixed(1);
            return `
                <div onclick="loadAuditFromDatabaseForSuperadmin('${item.filename}', '${item.auditor}')" class="p-2.5 rounded-xl border border-slate-100 dark:border-[#1F2937] hover:border-brand-500/50 dark:hover:border-brand-500/50 hover:bg-slate-50 dark:hover:bg-[#1c273d]/50 cursor-pointer flex items-center justify-between gap-2 group transition-all-custom">
                    <div class="flex items-center gap-2 max-w-[75%] min-w-0">
                        <input type="checkbox" 
                               class="consolidate-checkbox rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer w-4 h-4 shrink-0" 
                               value="${item.filename}|${item.auditor}" 
                               onclick="handleConsolidateCheckboxClick(event)"
                        />
                        <div class="flex flex-col gap-0.5 min-w-0">
                            <span class="font-bold text-slate-700 dark:text-slate-300 truncate">${item.filename}</span>
                            <span class="text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate">${item.auditor} | ${item.school}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="font-black text-brand-600 dark:text-brand-300 text-xs">${roundedScore}%</span>
                        <button onclick="deleteAuditFromDatabaseForSuperadmin('${item.filename}', '${item.auditor}', event)" aria-label="Delete draft audit ${item.filename} by ${item.auditor}" class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity" title="Delete Draft">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        if (consolidateBtn) consolidateBtn.classList.add('hidden');
        
        listEl.innerHTML = history.map(item => {
            const roundedScore = (item.score * 100).toFixed(1);
            return `
                <div onclick="loadAuditFromDatabase('${item.filename}')" class="p-2.5 rounded-xl border border-slate-100 dark:border-[#1F2937] hover:border-brand-500/50 dark:hover:border-brand-500/50 hover:bg-slate-50 dark:hover:bg-[#1c273d]/50 cursor-pointer flex items-center justify-between gap-2 group transition-all-custom">
                    <div class="flex flex-col gap-0.5 max-w-[70%]">
                        <span class="font-bold text-slate-700 dark:text-slate-300 truncate">${item.filename}</span>
                        <span class="text-[11px] text-slate-600 dark:text-slate-300 font-medium">${item.school} | ${item.date}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="font-black text-brand-600 dark:text-brand-300 text-xs">${roundedScore}%</span>
                        <button onclick="deleteAuditFromDatabase('${item.filename}', event)" aria-label="Delete draft audit ${item.filename}" class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity" title="Delete Draft">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

export async function loadAuditFromDatabase(filename) {
    await loadAuditFromDatabaseForAuditor(filename, state.loggedInUser);
}

export async function loadAuditFromDatabaseForSuperadmin(filename, auditor) {
    await loadAuditFromDatabaseForAuditor(filename, auditor);
}

export async function loadAuditFromDatabaseForAuditor(filename, auditor) {
    saveState.flush();
    const key = `${filename}|${auditor}`;
    const data = await dbGet("drafts", key);
    
    if (!data) {
        showToast("Draft file not found in browser database.", "error");
        return;
    }
    
    state.filename = filename;
    state.school = data.school;
    state.date = data.date;
    state.auditor = auditor;
    state.aiSummary = data.ai_summary || "";
    state.auditData = data.audit_data;
    
    // Sync UI inputs
    const fileInput = document.getElementById('meta-filename');
    if (fileInput) fileInput.value = filename;
    const schoolSelect = document.getElementById('meta-school');
    if (schoolSelect) schoolSelect.value = data.school;
    const dateInput = document.getElementById('meta-date');
    if (dateInput) dateInput.value = data.date;
    const activeAuditorLabel = document.getElementById('active-auditor-label');
    if (activeAuditorLabel) activeAuditorLabel.innerHTML = auditor;
    
    await saveState();
    initIndicatorsGrid();
    renderCategoryNavigation();
    renderActiveCategoryIndicators();
    updateCalculations();
    showToast(`Draft file "${filename}" loaded successfully!`, 'info');
}

export async function deleteAuditFromDatabase(filename, event) {
    await deleteAuditFromDatabaseForAuditor(filename, state.loggedInUser, event);
}

export async function deleteAuditFromDatabaseForSuperadmin(filename, auditor, event) {
    await deleteAuditFromDatabaseForAuditor(filename, auditor, event);
}

export async function deleteAuditFromDatabaseForAuditor(filename, auditor, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${filename}" from your local browser database?`)) return;
    
    await deleteLocalDraftFromDB(filename, auditor);
    await fetchHistory();
    showToast(`File "${filename}" deleted.`);
    
    if (state.filename === filename && state.auditor === auditor) {
        await startNewAudit(true);
    }
}

export async function saveDraftAction() {
    if (!state.loggedInUser) return;
    saveState.flush();
    const currentScore = calculateScore();
    await saveLocalDraftToDB(state.filename, state.loggedInUser, state, currentScore);
    await saveState();
    await fetchHistory();
    showToast(`File "${state.filename}" saved securely to local browser drafts!`);
}

export async function saveAsAction() {
    if (!state.loggedInUser) return;
    saveState.flush();
    const newName = prompt("Save As (Enter new Audit File Name):", state.filename + "_copy");
    if (newName === null) return;
    
    const cleanName = newName.trim();
    if (!cleanName) {
        showToast("Invalid filename.", "error");
        return;
    }
    
    state.filename = cleanName;
    const fileInput = document.getElementById('meta-filename');
    if (fileInput) fileInput.value = cleanName;
    
    await saveState();
    await saveDraftAction();
}

export function handleConsolidateCheckboxClick(event) {
    event.stopPropagation();
    
    const checkedBoxes = document.querySelectorAll('.consolidate-checkbox:checked');
    const btn = document.getElementById('consolidate-btn');
    if (btn) {
        btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg> <span>Consolidate Selected (${checkedBoxes.length})</span>`;
    }
}

export async function consolidateSelectedAudits() {
    const checkedBoxes = document.querySelectorAll('.consolidate-checkbox:checked');
    if (checkedBoxes.length < 2) {
        showToast("Please select at least 2 audits to consolidate.", "error");
        return;
    }
    
    if (!confirm(`Are you sure you want to consolidate these ${checkedBoxes.length} audits?`)) return;
    
    const selectedKeys = Array.from(checkedBoxes).map(box => box.value);
    
    try {
        const loadedAudits = [];
        for (const key of selectedKeys) {
            const data = await dbGet("drafts", key);
            if (data) {
                loadedAudits.push(data);
            } else {
                throw new Error(`Failed to load ${key}`);
            }
        }
        
        const consolidatedData = {};
        for (const [catName, catData] of Object.entries(CATEGORIES)) {
            consolidatedData[catName] = {};
            for (const indName of Object.keys(catData.indicators)) {
                consolidatedData[catName][indName] = {
                    score: 3,
                    features: [],
                    gaps: [],
                    actions: [],
                    photos: [],
                    photoRaw: ""
                };
            }
        }
        
        loadedAudits.forEach(audit => {
            const auditorName = audit.auditor || "Unknown";
            
            Object.entries(audit.audit_data).forEach(([catName, indicators]) => {
                Object.entries(indicators).forEach(([indName, item]) => {
                    const target = consolidatedData[catName]?.[indName];
                    if (target) {
                        const scoreVal = Number(item.score);
                        if (!isNaN(scoreVal)) {
                            if (!target.rawScores) target.rawScores = [];
                            target.rawScores.push(scoreVal);
                        }
                        
                        if (item.features && item.features.trim()) {
                            target.features.push(`[${auditorName}]: ${item.features.trim()}`);
                        }
                        if (item.gaps && item.gaps.trim()) {
                            target.gaps.push(`[${auditorName}]: ${item.gaps.trim()}`);
                        }
                        if (item.actions && item.actions.trim()) {
                            target.actions.push(`[${auditorName}]: ${item.actions.trim()}`);
                        }
                        if (item.photoName && item.photoName.trim()) {
                            target.photos.push(`${auditorName}: ${item.photoName.trim()}`);
                            if (!target.photoRaw && item.photoData) {
                                target.photoRaw = item.photoData;
                            }
                        }
                    }
                });
            });
        });
        
        const finalAuditData = {};
        for (const [catName, indicators] of Object.entries(consolidatedData)) {
            finalAuditData[catName] = {};
            for (const [indName, merged] of Object.entries(indicators)) {
                let avgScore = 3;
                if (merged.rawScores && merged.rawScores.length > 0) {
                    const sum = merged.rawScores.reduce((a, b) => a + b, 0);
                    avgScore = Math.round(sum / merged.rawScores.length);
                }
                
                finalAuditData[catName][indName] = {
                    score: avgScore,
                    features: merged.features.join("\n"),
                    gaps: merged.gaps.join("\n"),
                    actions: merged.actions.join("\n"),
                    photoName: merged.photos.join(", "),
                    photoData: merged.photoRaw || "",
                    reviewed: merged.features.length > 0 || merged.gaps.length > 0 || merged.actions.length > 0 || merged.photos.length > 0 || avgScore !== 3
                };
            }
        }
        
        state.filename = "Consolidated_" + new Date().toISOString().split('T')[0];
        state.school = loadedAudits[0].school;
        state.date = new Date().toISOString().split('T')[0];
        state.auditor = "Superadmin";
        state.auditData = finalAuditData;
        
        const fileInput = document.getElementById('meta-filename');
        if (fileInput) fileInput.value = state.filename;
        const schoolSelect = document.getElementById('meta-school');
        if (schoolSelect) schoolSelect.value = state.school;
        const dateInput = document.getElementById('meta-date');
        if (dateInput) dateInput.value = state.date;
        const activeAuditorLabel = document.getElementById('active-auditor-label');
        if (activeAuditorLabel) activeAuditorLabel.innerHTML = "Superadmin";
        
        await saveState();
        
        initIndicatorsGrid();
        renderCategoryNavigation();
        renderActiveCategoryIndicators();
        updateCalculations();
        
        showToast(`Consolidated draft loaded: "${state.filename}"`, "success");
    } catch(e) {
        console.error("Consolidation error:", e);
        showToast("Failed to consolidate selected files.", "error");
    }
}

/**
 * Exports comparative multi-audit benchmark matrix to RFC 4180 CSV spreadsheet.
 */
export function exportComparativeCSV(audits = null, baselineIdx = null) {
    const targetAudits = audits || window.comparisonState?.selectedAudits || [];
    if (!targetAudits || targetAudits.length < 2) {
        showToast("At least 2 audits are required for comparative CSV export.", "error");
        return;
    }

    const baselineIndex = baselineIdx !== null ? baselineIdx : (window.comparisonState?.baselineIndex || 0);
    const baselineAudit = targetAudits[baselineIndex] || targetAudits[0];

    const escapeCSV = (val) => {
        const str = String(val === undefined || val === null ? "" : val);
        return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
        "Category",
        "Indicator",
        "Base Multiplier"
    ];

    targetAudits.forEach((a, i) => {
        const label = `${a.filename} (${a.school})`;
        headers.push(`${label} - Score`);
        headers.push(`${label} - Effective Mult`);
        if (i !== baselineIndex) {
            headers.push(`${label} - Delta vs Base`);
        }
        headers.push(`${label} - Strengths`);
        headers.push(`${label} - Gaps`);
        headers.push(`${label} - Actions`);
    });

    const csvRows = [headers.map(h => escapeCSV(h)).join(",")];

    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        Object.entries(catData.indicators).forEach(([indName, defaultMult]) => {
            const row = [catName, indName, `${defaultMult}x`];

            const baseItem = baselineAudit.audit_data?.[catName]?.[indName] || { score: 3 };
            const baseScore = Number(baseItem.score) || 3;

            targetAudits.forEach((a, i) => {
                const item = a.audit_data?.[catName]?.[indName] || { score: 3 };
                const sc = Number(item.score) || 3;
                const effMult = (item.riskApplied && item.customMultiplier) ? Number(item.customMultiplier) : defaultMult;
                const delta = sc - baseScore;

                row.push(sc);
                row.push(`${effMult}x`);
                if (i !== baselineIndex) {
                    row.push(delta >= 0 ? `+${delta}` : `${delta}`);
                }
                row.push(item.features || "");
                row.push(item.gaps || "");
                row.push(item.actions || "");
            });

            csvRows.push(row.map(escapeCSV).join(","));
        });
    });

    const csvContent = "\ufeff" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const fileName = `Excelsis_Comparative_Matrix_${new Date().toISOString().split('T')[0]}.csv`;
    
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast("Comparative CSV downloaded successfully!", "success");
}

export const exportJSON = exportToJSON;
export const exportCSV = exportToCSV;
export const importJSON = importFromJSON;
export { generatePDFReport as generatePDF, generateAuditLegend, generatePDFReport as printAudit, generateComparativePDFReport } from './reports.js';


