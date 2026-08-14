/**
 * js/ai.js — AI Executive Summary Engine
 * Powered by Google Gemini API. Synthesizes quantitative compliance scores, 
 * indicator ratings, positive features, identified gaps, and recommended actions into 
 * a formal, multi-section executive briefing.
 */

import { CATEGORIES } from './config.js';
import { state, saveState, calculateScore } from './state.js';
import { showToast } from './ui.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * Retrieves the stored Gemini API Key from localStorage.
 */
export function getGeminiApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
}

/**
 * Saves the Gemini API Key to localStorage.
 */
export function setGeminiApiKey(key) {
    if (key && typeof key === 'string') {
        localStorage.setItem('gemini_api_key', key.trim());
    } else {
        localStorage.removeItem('gemini_api_key');
    }
}

/**
 * Retrieves the stored Gemini model name from localStorage or defaults to DEFAULT_MODEL.
 */
export function getGeminiModel() {
    return localStorage.getItem('gemini_selected_model') || DEFAULT_MODEL;
}

/**
 * Saves the chosen Gemini model name to localStorage.
 */
export function setGeminiModel(modelName) {
    if (modelName && typeof modelName === 'string') {
        localStorage.setItem('gemini_selected_model', modelName.trim());
    } else {
        localStorage.removeItem('gemini_selected_model');
    }
}

/**
 * Lightweight, safe Markdown to HTML converter tailored for AI Executive Summaries.
 */
export function renderMarkdown(markdownText) {
    if (!markdownText) return '';

    let html = markdownText
        // Escape raw HTML tags for security
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold text-slate-800 dark:text-slate-100 mt-4 mb-2">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-lg font-extrabold text-slate-900 dark:text-white mt-5 mb-2 pb-1 border-b border-slate-200 dark:border-slate-700">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-xl font-black text-brand-600 dark:text-brand-400 mt-6 mb-3">$1</h1>');

    // Bold and Italics
    html = html.replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-slate-900 dark:text-slate-100">$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em class="italic text-slate-700 dark:text-slate-300">$1</em>');

    // Blockquotes / Alerts
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="border-l-4 border-brand-500 bg-brand-500/5 dark:bg-brand-500/10 px-3.5 py-2 my-3 rounded-r-lg text-xs italic text-slate-700 dark:text-slate-300">$1</blockquote>');

    // Bullet Lists
    html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li class="ml-4 list-disc text-xs text-slate-700 dark:text-slate-300 my-1 leading-relaxed">$1</li>');

    // Numbered Lists
    html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="ml-4 list-decimal text-xs text-slate-700 dark:text-slate-300 my-1 leading-relaxed">$1</li>');

    // Group adjacent <li> tags into <ul> or <ol>
    html = html.replace(/((?:<li class="ml-4 list-disc[^>]*>.*?<\/li>\s*)+)/gims, '<ul class="my-2 space-y-1">$1</ul>');
    html = html.replace(/((?:<li class="ml-4 list-decimal[^>]*>.*?<\/li>\s*)+)/gims, '<ol class="my-2 space-y-1">$1</ol>');

    // Paragraphs (split by double newlines)
    const blocks = html.split(/\n{2,}/);
    html = blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<div')) {
            return trimmed;
        }
        return `<p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mb-3">${trimmed.replace(/\n/g, '<br/>')}</p>`;
    }).join('\n');

    return html;
}

/**
 * Builds structured context prompt from active audit state.
 */
export function buildAuditContextPrompt() {
    const finalScore = (calculateScore() * 100).toFixed(2);
    const school = state.school || "Campus Safety Audit";
    const auditor = state.loggedInUser || state.auditor || "Safety & Compliance Officer";
    const date = state.date || new Date().toISOString().split('T')[0];

    // Compute category level performance
    const categoryBreakdown = [];
    const criticalGaps = [];
    const notableStrengths = [];
    const recommendedActions = [];

    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        let catEarned = 0;
        let catMax = 0;

        Object.entries(catData.indicators).forEach(([indName, multiplier]) => {
            const item = state.auditData[catName]?.[indName] || { score: 3 };
            const score = Number(item.score) || 3;
            catEarned += (score * multiplier);
            catMax += (5 * multiplier);

            if (score <= 2) {
                criticalGaps.push({
                    category: catName,
                    indicator: indName,
                    score: score,
                    weight: catData.weight,
                    gaps: item.gaps || "Below standard compliance observed.",
                    actions: item.actions || ""
                });
            }

            if (score >= 4 || (item.features && item.features.trim().length > 0)) {
                notableStrengths.push({
                    category: catName,
                    indicator: indName,
                    score: score,
                    features: item.features || "Exceeds standard compliance benchmarks."
                });
            }

            if (item.actions && item.actions.trim().length > 0) {
                recommendedActions.push({
                    category: catName,
                    indicator: indName,
                    action: item.actions
                });
            }
        });

        const percentage = catMax > 0 ? ((catEarned / catMax) * 100).toFixed(1) : "0.0";
        categoryBreakdown.push(`- **${catName}** (Risk Weight: ${(catData.weight * 100).toFixed(0)}%): Score ${percentage}%`);
    });

    const prompt = `You are a Senior Campus Safety and Regulatory Compliance Auditor drafting a formal Executive Summary for an institutional safety audit.

AUDIT METADATA:
- Institution / School: ${school}
- Auditor: ${auditor}
- Audit Date: ${date}
- Overall Risk-Adjusted Compliance Score: ${finalScore}%

MACRO CATEGORY PERFORMANCE:
${categoryBreakdown.join('\n')}

NOTABLE STRENGTHS & OBSERVED POSITIVE FEATURES:
${notableStrengths.length > 0 ? notableStrengths.map(s => `- [${s.category} - ${s.indicator}] (Score: ${s.score}/5): ${s.features}`).join('\n') : '- Standard baseline compliance across operational areas.'}

CRITICAL VULNERABILITIES & IDENTIFIED GAPS:
${criticalGaps.length > 0 ? criticalGaps.map(g => `- [${g.category} - ${g.indicator}] (Score: ${g.score}/5): ${g.gaps}${g.actions ? ' | Auditor Proposed Action: ' + g.actions : ''}`).join('\n') : '- No critical non-compliance gaps flagged.'}

AUDITOR RECOMMENDED REMEDIAL ACTIONS:
${recommendedActions.length > 0 ? recommendedActions.map(a => `- [${a.category} - ${a.indicator}]: ${a.action}`).join('\n') : '- Standard ongoing maintenance.'}

INSTRUCTIONS:
Write a comprehensive, professional, well-structured Executive Summary in Markdown format tailored for the Board of Trustees, School Leadership, and Regulatory Authorities.

You MUST structure the response with the following 4 sections exactly:

## 1. Executive Overview & Overall Risk Rating
Synthesize the high-level compliance posture of ${school}. Mention the final score (${finalScore}%) and contextualize whether this reflects robust safety management, moderate operational vulnerabilities, or urgent compliance risks requiring immediate oversight.

## 2. Key Strengths & Notable Features
Highlight the top 3-5 strongest areas where the campus demonstrates exemplary safety standards, regulatory adherence, and proactive management practices based on the audit data.

## 3. Critical Vulnerabilities & Priority Gaps
Detail the primary safety risks, regulatory non-compliances, and hazardous areas identified during the audit (specifically referencing the low-scoring indicators). Prioritize these by severity and potential institutional liability.

## 4. Prioritized Remedial Roadmap
Provide an actionable, phased implementation roadmap based on the findings:
- **Immediate Priority (0–30 Days)**: Critical life safety, regulatory violations, or acute security items.
- **Medium-Term (30–90 Days)**: Infrastructure upgrades, protocol revisions, or staff training.
- **Long-Term Strategic (90+ Days)**: Ongoing preventative maintenance, technology integrations, and scheduled reassessments.

Keep the tone authoritative, objective, executive-level, and constructive. Format cleanly using Markdown headings, bold text, and bullet points.`;

    return prompt;
}

/**
 * Invokes Google Gemini REST API with fallback support across model versions.
 */
export async function callGeminiAPI(apiKey, promptText, modelOverride = null) {
    if (!apiKey) {
        throw new Error("Missing Gemini API Key. Please provide your API key in Settings.");
    }

    const preferredModel = modelOverride || getGeminiModel() || DEFAULT_MODEL;
    const modelsToTry = [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];

    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: promptText }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.3,
                        topP: 0.85,
                        maxOutputTokens: 2500
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                
                // If model not found (404), try next model in fallback list
                if (response.status === 404) {
                    console.warn(`Model ${model} returned 404, attempting fallback...`);
                    lastError = new Error(`Model ${model} not available: ${errMsg}`);
                    continue;
                }
                
                throw new Error(errMsg);
            }

            const data = await response.json();
            const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!candidateText) {
                throw new Error("Gemini returned an empty response. Please try again.");
            }

            return {
                text: candidateText,
                modelUsed: model
            };
        } catch (err) {
            lastError = err;
            if (err.message && (err.message.includes("API Key") || err.message.includes("quota") || err.message.includes("403") || err.message.includes("401"))) {
                // Auth/Quota error, no need to fallback models
                throw err;
            }
        }
    }

    throw lastError || new Error("Failed to connect to Google Gemini API.");
}

/**
 * Opens the AI Summary Modal and initializes UI states.
 */
export function openAISummaryModal() {
    const modal = document.getElementById('ai-summary-modal-overlay');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Populate API key input
    const keyInput = document.getElementById('gemini-api-key-input');
    if (keyInput) {
        keyInput.value = getGeminiApiKey();
    }

    // Populate Model Selector
    const modelSelect = document.getElementById('gemini-model-select');
    if (modelSelect) {
        const savedModel = getGeminiModel();
        modelSelect.value = savedModel;
    }

    // Update API Key Status indicator
    updateApiKeyStatusUI();

    // Populate existing summary if available
    const existingSummary = state.aiSummary || "";
    const textarea = document.getElementById('ai-summary-editor');
    const preview = document.getElementById('ai-summary-preview');

    if (textarea) textarea.value = existingSummary;
    if (preview) {
        if (existingSummary.trim().length > 0) {
            preview.innerHTML = renderMarkdown(existingSummary);
        } else {
            preview.innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-center text-slate-400 dark:text-slate-500">
                    <div class="w-16 h-16 rounded-2xl bg-brand-500/10 text-brand-500 flex items-center justify-center mb-4">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </div>
                    <h3 class="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">No AI Summary Generated Yet</h3>
                    <p class="text-xs max-w-sm">Click <strong>"Generate AI Summary"</strong> below to synthesize the current audit scores, gaps, and recommendations into an executive briefing.</p>
                </div>
            `;
        }
    }

    // Default to Preview Tab
    setAIActiveTab('preview');
}

/**
 * Closes the AI Summary Modal.
 */
export function closeAISummaryModal() {
    const modal = document.getElementById('ai-summary-modal-overlay');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

/**
 * Switches between 'preview' and 'edit' tabs in the AI Modal.
 */
export function setAIActiveTab(tabName) {
    const previewTabBtn = document.getElementById('ai-tab-btn-preview');
    const editTabBtn = document.getElementById('ai-tab-btn-edit');
    const previewContainer = document.getElementById('ai-preview-container');
    const editContainer = document.getElementById('ai-edit-container');
    const textarea = document.getElementById('ai-summary-editor');
    const preview = document.getElementById('ai-summary-preview');

    if (tabName === 'edit') {
        if (previewTabBtn) {
            previewTabBtn.classList.remove('bg-white', 'dark:bg-[#1F2937]', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
            previewTabBtn.classList.add('text-slate-500', 'dark:text-slate-400');
        }
        if (editTabBtn) {
            editTabBtn.classList.add('bg-white', 'dark:bg-[#1F2937]', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
            editTabBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (previewContainer) previewContainer.classList.add('hidden');
        if (editContainer) editContainer.classList.remove('hidden');
    } else {
        // Sync preview with current editor value
        if (textarea && preview) {
            const val = textarea.value;
            if (val.trim().length > 0) {
                preview.innerHTML = renderMarkdown(val);
            }
        }
        if (editTabBtn) {
            editTabBtn.classList.remove('bg-white', 'dark:bg-[#1F2937]', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
            editTabBtn.classList.add('text-slate-500', 'dark:text-slate-400');
        }
        if (previewTabBtn) {
            previewTabBtn.classList.add('bg-white', 'dark:bg-[#1F2937]', 'text-brand-600', 'dark:text-brand-400', 'shadow-sm');
            previewTabBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
        }
        if (editContainer) editContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.remove('hidden');
    }
}

/**
 * Updates the API Key Status UI indicator in the modal header.
 */
export function updateApiKeyStatusUI() {
    const key = getGeminiApiKey();
    const badge = document.getElementById('ai-api-key-badge');
    if (!badge) return;

    if (key && key.length > 5) {
        badge.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">API Key Ready</span>
        `;
    } else {
        badge.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
            <span class="text-[11px] font-bold text-amber-600 dark:text-amber-400">API Key Required</span>
        `;
    }
}

/**
 * Toggles the API Key & Settings Drawer inside the AI Modal.
 */
export function toggleAISettingsDrawer() {
    const drawer = document.getElementById('ai-settings-drawer');
    const chevron = document.getElementById('ai-settings-chevron');
    if (!drawer) return;

    drawer.classList.toggle('hidden');
    if (chevron) {
        chevron.classList.toggle('rotate-180');
    }
}

/**
 * Saves Gemini API Key entered from the UI input.
 */
export function saveGeminiApiKeyFromUI() {
    const keyInput = document.getElementById('gemini-api-key-input');
    const modelSelect = document.getElementById('gemini-model-select');
    
    if (keyInput) {
        const val = keyInput.value.trim();
        setGeminiApiKey(val);
    }

    if (modelSelect) {
        setGeminiModel(modelSelect.value);
    }

    updateApiKeyStatusUI();
    showToast("AI Settings & API Key saved.", "success");
    
    // Auto-close settings drawer if key was saved
    const drawer = document.getElementById('ai-settings-drawer');
    if (drawer && !drawer.classList.contains('hidden')) {
        toggleAISettingsDrawer();
    }
}

/**
 * Validates connection with the Gemini API using a quick test prompt.
 */
export async function testGeminiApiKey() {
    const keyInput = document.getElementById('gemini-api-key-input');
    const key = keyInput ? keyInput.value.trim() : getGeminiApiKey();

    if (!key) {
        showToast("Please enter an API key first.", "warning");
        return;
    }

    const testBtn = document.getElementById('ai-test-key-btn');
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = `<span>Testing...</span>`;
    }

    try {
        const res = await callGeminiAPI(key, "Respond with 'OK' if you can read this message.");
        showToast(`Connection successful! Connected to ${res.modelUsed}.`, "success");
        setGeminiApiKey(key);
        updateApiKeyStatusUI();
    } catch (err) {
        showToast(`API Test Failed: ${err.message}`, "error");
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = `<span>Test Connection</span>`;
        }
    }
}

/**
 * Triggers the AI Executive Summary generation pipeline.
 */
export async function triggerAISummaryGeneration() {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        showToast("Please configure your Google Gemini API Key first.", "warning");
        const drawer = document.getElementById('ai-settings-drawer');
        if (drawer && drawer.classList.contains('hidden')) {
            toggleAISettingsDrawer();
        }
        const keyInput = document.getElementById('gemini-api-key-input');
        if (keyInput) keyInput.focus();
        return;
    }

    const generateBtn = document.getElementById('ai-generate-btn');
    const loadingOverlay = document.getElementById('ai-loading-overlay');
    const preview = document.getElementById('ai-summary-preview');
    const textarea = document.getElementById('ai-summary-editor');

    if (generateBtn) generateBtn.disabled = true;
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        const prompt = buildAuditContextPrompt();
        const result = await callGeminiAPI(apiKey, prompt);
        
        state.aiSummary = result.text;
        saveState();

        if (textarea) textarea.value = result.text;
        if (preview) preview.innerHTML = renderMarkdown(result.text);

        setAIActiveTab('preview');
        showToast(`AI Summary successfully generated using ${result.modelUsed}!`, "success");
    } catch (err) {
        console.error("AI Generation Error:", err);
        showToast(`AI Generation Error: ${err.message}`, "error");
    } finally {
        if (generateBtn) generateBtn.disabled = false;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
}

/**
 * Handler for text changes in the AI Editor textarea.
 */
export function handleAISummaryEditorChange(val) {
    state.aiSummary = val;
    saveState();
}

/**
 * Copies the AI Summary markdown or plain text to the user's clipboard.
 */
export async function copyAISummaryToClipboard() {
    const summaryText = state.aiSummary || "";
    if (!summaryText.trim()) {
        showToast("No summary content to copy.", "warning");
        return;
    }

    try {
        await navigator.clipboard.writeText(summaryText);
        showToast("Summary copied to clipboard!", "success");
    } catch (e) {
        // Fallback copy
        const tempTextArea = document.createElement("textarea");
        tempTextArea.value = summaryText;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand("copy");
        document.body.removeChild(tempTextArea);
        showToast("Summary copied to clipboard!", "success");
    }
}

/**
 * Clears the AI Summary with confirmation.
 */
export function clearAISummary() {
    if (!state.aiSummary) return;
    if (!confirm("Are you sure you want to clear the AI Executive Summary?")) return;

    state.aiSummary = "";
    saveState();

    const textarea = document.getElementById('ai-summary-editor');
    const preview = document.getElementById('ai-summary-preview');
    if (textarea) textarea.value = "";
    if (preview) {
        preview.innerHTML = `
            <div class="flex flex-col items-center justify-center py-16 text-center text-slate-400 dark:text-slate-500">
                <div class="w-16 h-16 rounded-2xl bg-brand-500/10 text-brand-500 flex items-center justify-center mb-4">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <h3 class="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">AI Summary Cleared</h3>
                <p class="text-xs max-w-sm">Click <strong>"Generate AI Summary"</strong> below to synthesize the current audit details.</p>
            </div>
        `;
    }
    showToast("AI Summary cleared.", "info");
}
