/**
 * js/state.js — Reactive Application State & Calculation Engine
 * Core state management, debounced persistence pipeline (AUD-JS-H1), and weighted audit score calculations.
 */

import { SCHOOLS, CATEGORIES, STORAGE_KEY } from './config.js';
import { dbGet, dbSet, dbDelete, debounce } from './storage.js';

export let state = {
    filename: "Untitled_Audit_" + new Date().toISOString().split('T')[0],
    school: SCHOOLS[0],
    auditor: "",
    date: new Date().toISOString().split('T')[0],
    activeCategory: Object.keys(CATEGORIES)[0],
    searchQuery: "",
    loggedInUser: null,
    aiSummary: "",
    auditData: {},
    useLocalStorageFallback: false
};

export async function loadState() {
    const stored = await dbGet("active_state", "state");
    if (stored) {
        try {
            state = { ...state, ...stored };
        } catch(e) {
            console.error("Failed to load active state.");
        }
    }
    
    for (const [catName, catData] of Object.entries(CATEGORIES)) {
        if (!state.auditData[catName]) {
            state.auditData[catName] = {};
        }
        for (const indName of Object.keys(catData.indicators)) {
            if (!state.auditData[catName][indName]) {
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
                    reviewed: false,
                    customMultiplier: null,
                    riskSeverity: "",
                    riskRationale: "",
                    riskScoreDelta: 0,
                    riskApplied: false
                };
            } else {
                // Ensure dynamic risk fields exist on loaded legacy records
                const ind = state.auditData[catName][indName];
                if (ind.customMultiplier === undefined) ind.customMultiplier = null;
                if (ind.riskSeverity === undefined) ind.riskSeverity = "";
                if (ind.riskRationale === undefined) ind.riskRationale = "";
                if (ind.riskScoreDelta === undefined) ind.riskScoreDelta = 0;
                if (ind.riskApplied === undefined) ind.riskApplied = false;
            }
        }
    }
}

/**
 * Immediate, un-debounced disk write to active_state store.
 */
export async function saveStateNow() {
    await dbSet("active_state", "state", state);
}

/**
 * 400ms Debounced saveState wrapper to prevent storage overhead & UI latency on keypress (AUD-JS-H1).
 * Includes .flush() method to force immediate execution before page unloads or category switches.
 */
export const saveState = debounce(saveStateNow, 400);

/**
 * Helper to determine an indicator's active risk multiplier.
 */
export function getEffectiveMultiplier(catName, indName) {
    const defaultMult = CATEGORIES[catName]?.indicators?.[indName] || 2;
    const item = state.auditData[catName]?.[indName];
    if (item && item.riskApplied && item.customMultiplier != null && Number(item.customMultiplier) > 0) {
        return Number(item.customMultiplier);
    }
    return defaultMult;
}

/**
 * Calculates final weighted compliance score (0.00 to 1.00 ratio).
 */
export function calculateScore() {
    let finalWeightedScore = 0;
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        let catEarned = 0;
        let catMax = 0;
        
        Object.entries(catData.indicators).forEach(([indName, defaultMultiplier]) => {
            const item = state.auditData[catName]?.[indName] || { score: 3 };
            const effectiveMultiplier = (item.riskApplied && item.customMultiplier != null && Number(item.customMultiplier) > 0)
                ? Number(item.customMultiplier)
                : defaultMultiplier;
            const score = Number(item.score) || 3;
            catEarned += (score * effectiveMultiplier);
            catMax += (5 * effectiveMultiplier);
        });
        
        if (catMax > 0) {
            const catPercentage = catEarned / catMax;
            finalWeightedScore += (catPercentage * catData.weight);
        }
    });
    return finalWeightedScore;
}

/**
 * Updates DOM score displays, progress bars, SVG score ring, and rating labels in real-time.
 */
export function updateCalculations() {
    let finalWeightedScore = 0;
    let totalIndicators = 0;
    let reviewedIndicators = 0;
    
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        let catEarned = 0;
        let catMax = 0;
        
        Object.entries(catData.indicators).forEach(([indName, defaultMultiplier]) => {
            const item = state.auditData[catName]?.[indName] || { score: 3, reviewed: false, features: "", gaps: "", actions: "", photoName: "" };
            
            totalIndicators++;
            if (item.reviewed || item.features || item.gaps || item.actions || item.score !== 3 || item.photoName || item.riskApplied) {
                reviewedIndicators++;
            }
            
            const effectiveMultiplier = (item.riskApplied && item.customMultiplier != null && Number(item.customMultiplier) > 0)
                ? Number(item.customMultiplier)
                : defaultMultiplier;
            const score = Number(item.score) || 3;
            catEarned += (score * effectiveMultiplier);
            catMax += (5 * effectiveMultiplier);
        });
        
        if (catMax > 0) {
            const catPercentage = catEarned / catMax;
            finalWeightedScore += (catPercentage * catData.weight);
        }
    });
    
    const finalPercent = finalWeightedScore * 100;
    
    const scoreDisplay = document.getElementById('score-display');
    if (scoreDisplay) scoreDisplay.innerHTML = `${finalPercent.toFixed(2)}%`;
    
    const reviewedCount = document.getElementById('reviewed-count');
    if (reviewedCount) reviewedCount.innerHTML = `${reviewedIndicators} / ${totalIndicators} Indicators`;
    
    const progressBar = document.getElementById('overall-progress-bar');
    if (progressBar) {
        const progressPercent = Math.round((reviewedIndicators / totalIndicators) * 100);
        progressBar.style.width = `${progressPercent}%`;
    }

    const ringEl = document.getElementById('sidebar-score-ring');
    if (ringEl) {
        ringEl.setAttribute('stroke-dasharray', `${finalPercent.toFixed(1)}, 100`);
        if (finalPercent >= 90) {
            ringEl.setAttribute('stroke', '#10B981');
        } else if (finalPercent >= 75) {
            ringEl.setAttribute('stroke', '#3B82F6');
        } else if (finalPercent >= 60) {
            ringEl.setAttribute('stroke', '#F59E0B');
        } else {
            ringEl.setAttribute('stroke', '#EF4444');
        }
    }
    
    const ringValEl = document.getElementById('sidebar-score-ring-val');
    if (ringValEl) {
        ringValEl.innerText = `${Math.round(finalPercent)}%`;
    }

    const ratingLabelEl = document.getElementById('sidebar-score-rating');
    if (ratingLabelEl) {
        if (finalPercent >= 90) {
            ratingLabelEl.innerText = "Outstanding";
        } else if (finalPercent >= 75) {
            ratingLabelEl.innerText = "Compliant";
        } else if (finalPercent >= 60) {
            ratingLabelEl.innerText = "Needs Improvement";
        } else {
            ratingLabelEl.innerText = "Critical Risk";
        }
    }

    const mobileScorePill = document.getElementById('mobile-score-pill');
    if (mobileScorePill && ratingLabelEl) {
        mobileScorePill.innerText = `${finalPercent.toFixed(2)}% ${ratingLabelEl.innerText}`;
    }
}

/**
 * Resets active state to fresh blank audit session.
 */
export async function startNewAudit(force = false) {
    if (!force && !confirm("Discard current view and open a new blank audit? Ensure you have saved your draft first.")) return;
    
    // Flush any pending debounced writes before resetting
    saveState.flush();

    await dbDelete("active_state", "state");
    localStorage.removeItem(STORAGE_KEY);
    
    state.filename = "Untitled_Audit_" + new Date().toISOString().split('T')[0];
    state.school = SCHOOLS[0];
    state.date = new Date().toISOString().split('T')[0];
    state.aiSummary = "";
    state.auditData = {};
    
    await loadState();
    await saveStateNow();
}

export const debouncedSaveState = saveState;

