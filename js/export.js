/**
 * js/export.js — Data Export, Import & Draft Consolidation Engine
 * RFC 4180 CSV export/import, JSON backup/restore, history listing, and Superadmin multi-audit draft consolidation.
 */

import { SCHOOLS, CATEGORIES, AUDITOR_HASHES } from './config.js';
import { state, saveState, calculateScore, updateCalculations, startNewAudit } from './state.js';
import { dbGet, dbGetAll, saveLocalDraftToDB, deleteLocalDraftFromDB } from './storage.js';
import { showToast, renderCategoryNavigation, renderActiveCategoryIndicators, initIndicatorsGrid } from './ui.js';

export function exportToCSV() {
    saveState.flush();
    const headers = [
        "File Name",
        "School",
        "Auditor",
        "Date",
        "Category",
        "Indicator",
        "Risk Multiplier",
        "Score",
        "Notable Features",
        "Gaps Identified",
        "Actions Recommended",
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
            const item = state.auditData[catName]?.[indName] || { score: 3, features: "", gaps: "", actions: "", photoName: "" };
            
            const row = [
                filename,
                school,
                auditor,
                date,
                catName,
                indName,
                `${multiplier}x`,
                item.score,
                item.features || "",
                item.gaps || "",
                item.actions || "",
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
        } else if (c === ',' && !inQuotes) {
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
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    return lines;
}

export function importFromCSV(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const csvText = e.target.result;
                const parsed = parseCSV(csvText);
                
                if (parsed.length < 2) {
                    showToast("Empty CSV file uploaded.", "error");
                    return;
                }
                
                const headers = parsed[0].map(h => h.trim().replace(/^"|"$/g, ''));
                
                const filenameIdx = headers.indexOf("File Name");
                const schoolIdx = headers.indexOf("School");
                const auditorIdx = headers.indexOf("Auditor");
                const dateIdx = headers.indexOf("Date");
                const catIdx = headers.indexOf("Category");
                const indIdx = headers.indexOf("Indicator");
                const scoreIdx = headers.indexOf("Score");
                const featuresIdx = headers.indexOf("Notable Features");
                const gapsIdx = headers.indexOf("Gaps Identified");
                const actionsIdx = headers.indexOf("Actions Recommended");
                const photoNameIdx = headers.indexOf("Photo Attachment");
                
                if (catIdx === -1 || indIdx === -1 || scoreIdx === -1) {
                    showToast("Invalid CSV headers. Must contain Category, Indicator, and Score.", "error");
                    return;
                }
                
                const firstDataRow = parsed[1];
                if (filenameIdx !== -1 && firstDataRow[filenameIdx]) state.filename = firstDataRow[filenameIdx];
                if (schoolIdx !== -1 && firstDataRow[schoolIdx]) {
                    const csvSchool = firstDataRow[schoolIdx];
                    if (SCHOOLS.includes(csvSchool)) {
                        state.school = csvSchool;
                    }
                }
                if (dateIdx !== -1 && firstDataRow[dateIdx]) state.date = firstDataRow[dateIdx];
                
                if (auditorIdx !== -1 && firstDataRow[auditorIdx]) {
                    const csvAuditor = firstDataRow[auditorIdx];
                    if (AUDITOR_HASHES[csvAuditor]) {
                        state.auditor = csvAuditor;
                    }
                }
                
                for (let i = 1; i < parsed.length; i++) {
                    const row = parsed[i];
                    if (row.length < headers.length) continue;
                    
                    const category = row[catIdx];
                    const indicator = row[indIdx];
                    
                    if (CATEGORIES[category] && CATEGORIES[category].indicators.hasOwnProperty(indicator)) {
                        const scoreVal = Math.max(1, Math.min(5, parseInt(row[scoreIdx]) || 3));
                        
                        const existingData = state.auditData[category]?.[indicator] || {};
                        const csvPhotoName = photoNameIdx !== -1 ? row[photoNameIdx] : "";
                        const photoDataVal = (existingData.photoName === csvPhotoName) ? (existingData.photoData || "") : "";
                        
                        state.auditData[category][indicator] = {
                            score: scoreVal,
                            features: featuresIdx !== -1 ? row[featuresIdx] : "",
                            gaps: gapsIdx !== -1 ? row[gapsIdx] : "",
                            actions: actionsIdx !== -1 ? row[actionsIdx] : "",
                            photoName: csvPhotoName,
                            photoData: photoDataVal,
                            reviewed: true
                        };
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
                
                showToast(`Successfully loaded CSV audit draft: "${state.filename}"`);
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
    const headers = ["Category", "Indicator", "Score (1-5)", "Notable Features", "Gaps Identified", "Actions Recommended", "Photo Filename"];
    let csvRows = [headers.join(",")];
    
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
    if (!listEl) return;

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

export const exportJSON = exportToJSON;
export const exportCSV = exportToCSV;
export const importJSON = importFromJSON;
export { generatePDFReport as generatePDF, generateAuditLegend, generatePDFReport as printAudit } from './reports.js';

