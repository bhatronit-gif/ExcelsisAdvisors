/**
 * js/ai.js — AI Executive Summary Engine
 * Powered by Google Gemini API. Synthesizes quantitative compliance scores, 
 * indicator ratings, positive features, identified gaps, and recommended actions into 
 * a formal, multi-section executive briefing.
 */

import { CATEGORIES } from './config.js';
import { state, saveState, saveStateNow, calculateScore, updateCalculations } from './state.js';
import { showToast, refreshCardDOM, renderCategoryNavigation, renderActiveCategoryIndicators } from './ui.js';

export const DEFAULT_SUMMARY_MODEL = 'gemini-3.7-flash';
export const DEFAULT_ENHANCE_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_RISK_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_MODEL = 'gemini-3.7-flash';

export const CANDIDATE_MODELS = [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
];

let clientModelCache = {
    apiKey: '',
    models: [],
    timestamp: 0
};

/**
 * Discovers text-generation models enabled on the client's Gemini API key.
 * Strictly filters out audio-only, TTS, embedding, and image-only models.
 */
async function discoverClientModels(apiKey) {
    if (!apiKey) return [];
    const now = Date.now();
    if (clientModelCache.apiKey === apiKey && (now - clientModelCache.timestamp < 300000) && clientModelCache.models.length > 0) {
        return clientModelCache.models;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return clientModelCache.models || [];
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
            const filtered = data.models
                .filter(m => {
                    const name = (m.name || '').replace(/^models\//, '').toLowerCase();
                    if (!m.supportedGenerationMethods || !m.supportedGenerationMethods.includes('generateContent')) {
                        return false;
                    }
                    // Exclude non-text/audio/TTS/embedding/image models
                    if (name.includes('-tts') || name.includes('-audio') || name.includes('preview-tts') ||
                        name.includes('-embedding') || name.includes('imagen') || name.includes('image') ||
                        name.includes('whisper') || name.includes('speech')) {
                        return false;
                    }
                    if (m.outputModalities && Array.isArray(m.outputModalities) && !m.outputModalities.includes('TEXT')) {
                        return false;
                    }
                    return true;
                })
                .map(m => m.name.replace(/^models\//, ''))
                .sort((a, b) => {
                    const getScore = (modelName) => {
                        const n = modelName.toLowerCase();
                        if (n === 'gemini-3.7-flash') return 100;
                        if (n === 'gemini-3.6-flash') return 90;
                        if (n === 'gemini-3.5-flash') return 80;
                        if (n === 'gemini-3.5-flash-lite') return 70;
                        if (n === 'gemini-3.1-flash-lite') return 60;
                        if (n.includes('3.7')) return 55;
                        if (n.includes('3.6')) return 50;
                        if (n.includes('3.5')) return 45;
                        if (n.includes('3.1')) return 40;
                        return 10;
                    };
                    return getScore(b) - getScore(a);
                });
            if (filtered.length > 0) {
                clientModelCache = {
                    apiKey,
                    models: filtered,
                    timestamp: now
                };
                return filtered;
            }
        }
    } catch (e) {
        return clientModelCache.models || [];
    }
    return clientModelCache.models || [];
}

const SAFETY_BLOCK_REASONS = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'];

function isSafetyBlockReason(reason) {
    if (!reason || typeof reason !== 'string') return false;
    const upper = reason.toUpperCase().replace(/^FINISH_REASON_/, '');
    return SAFETY_BLOCK_REASONS.includes(upper) ||
           upper.includes('SAFETY') ||
           upper.includes('BLOCKLIST') ||
           upper.includes('PROHIBIT') ||
           upper.includes('RECITAT') ||
           upper.includes('HARM') ||
           upper.includes('SPII');
}

/**
 * Robustly inspects Gemini API response structures.
 * Handles empty parts, thinking token blocks, safety/recitation/blocklist finish reasons,
 * multiple candidates, array payloads, and non-standard candidate formats without throwing uncaught exceptions.
 */
export function inspectGeminiResponse(data) {
    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        return { text: '', finishReason: 'NO_DATA', blockReason: null, isBlocked: false };
    }

    // Handle array of response objects (aggregated streaming or batch items)
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return { text: '', finishReason: 'NO_DATA', blockReason: null, isBlocked: false };
        }
        const collectedTexts = [];
        let lastFinishReason = 'STOP';
        let blockedReason = null;
        let isBlocked = false;

        for (const item of data) {
            const res = inspectGeminiResponse(item);
            if (res.text) collectedTexts.push(res.text);
            if (res.isBlocked) {
                isBlocked = true;
                blockedReason = res.blockReason;
            }
            if (res.finishReason) lastFinishReason = res.finishReason;
        }

        return {
            text: collectedTexts.join('\n\n').trim(),
            finishReason: lastFinishReason,
            blockReason: blockedReason,
            isBlocked: isBlocked && collectedTexts.length === 0
        };
    }

    // Check prompt-level feedback block
    const promptBlockReason = data.promptFeedback?.blockReason || null;
    if (promptBlockReason) {
        const isSafety = isSafetyBlockReason(promptBlockReason);
        return {
            text: '',
            finishReason: promptBlockReason,
            blockReason: promptBlockReason,
            isBlocked: isSafety
        };
    }

    if (Array.isArray(data.promptFeedback?.safetyRatings)) {
        const blockedRating = data.promptFeedback.safetyRatings.find(r => r.blocked === true || r.blocked === 'true');
        if (blockedRating) {
            const bCategory = blockedRating.category || 'SAFETY';
            return {
                text: '',
                finishReason: bCategory,
                blockReason: bCategory,
                isBlocked: true
            };
        }
    }

    const candidates = Array.isArray(data.candidates) ? data.candidates : (Array.isArray(data.response?.candidates) ? data.response.candidates : []);
    
    let primaryFinishReason = candidates[0]?.finishReason || (typeof candidates[0] === 'string' ? 'STOP' : 'UNKNOWN');
    let safetyBlockedReason = null;

    if (candidates.length > 0) {
        for (const candidate of candidates) {
            if (!candidate) continue;

            // Direct string candidate
            if (typeof candidate === 'string' && candidate.trim()) {
                return {
                    text: candidate.trim(),
                    finishReason: 'STOP',
                    blockReason: null,
                    isBlocked: false
                };
            }

            const cFinishReason = candidate.finishReason || 'UNKNOWN';
            if (isSafetyBlockReason(cFinishReason)) {
                safetyBlockedReason = cFinishReason;
            }

            if (Array.isArray(candidate.safetyRatings)) {
                const candBlocked = candidate.safetyRatings.find(r => r.blocked === true || r.blocked === 'true');
                if (candBlocked) {
                    safetyBlockedReason = candBlocked.category || cFinishReason || 'SAFETY';
                }
            }

            let nonThoughtTextParts = [];
            let thoughtTextParts = [];

            const content = candidate.content || candidate.message;
            const parts = Array.isArray(content?.parts) 
                ? content.parts 
                : (Array.isArray(candidate.parts) 
                    ? candidate.parts 
                    : (Array.isArray(candidate.content) 
                        ? candidate.content 
                        : (Array.isArray(content) 
                            ? content 
                            : (Array.isArray(candidate.message?.content) 
                                ? candidate.message.content 
                                : null))));

            if (Array.isArray(parts)) {
                for (const part of parts) {
                    if (!part) continue;
                    if (typeof part === 'string' && part.trim()) {
                        nonThoughtTextParts.push(part.trim());
                    } else if (typeof part.text === 'string' && part.text.trim()) {
                        if (part.thought === true || part.thought === 'true') {
                            thoughtTextParts.push(part.text.trim());
                        } else {
                            nonThoughtTextParts.push(part.text.trim());
                        }
                    } else if (typeof part.output === 'string' && part.output.trim()) {
                        nonThoughtTextParts.push(part.output.trim());
                    } else if (typeof part.content === 'string' && part.content.trim()) {
                        nonThoughtTextParts.push(part.content.trim());
                    } else if (typeof part.part === 'string' && part.part.trim()) {
                        nonThoughtTextParts.push(part.part.trim());
                    } else if (typeof part.text?.value === 'string' && part.text.value.trim()) {
                        nonThoughtTextParts.push(part.text.value.trim());
                    }
                }
            }

            if (nonThoughtTextParts.length > 0) {
                return {
                    text: nonThoughtTextParts.join('\n\n'),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content === 'string' && content.trim()) {
                return {
                    text: content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content?.parts === 'string' && content.parts.trim()) {
                return {
                    text: content.parts.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof content?.text === 'string' && content.text.trim()) {
                return {
                    text: content.text.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.text === 'string' && candidate.text.trim()) {
                return {
                    text: candidate.text.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.output === 'string' && candidate.output.trim()) {
                return {
                    text: candidate.output.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.parts === 'string' && candidate.parts.trim()) {
                return {
                    text: candidate.parts.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.content === 'string' && candidate.content.trim()) {
                return {
                    text: candidate.content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            if (typeof candidate.message?.content === 'string' && candidate.message.content.trim()) {
                return {
                    text: candidate.message.content.trim(),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }

            // If only thinking parts were produced, use thinking parts as fallback
            if (thoughtTextParts.length > 0) {
                return {
                    text: thoughtTextParts.join('\n\n'),
                    finishReason: cFinishReason,
                    blockReason: null,
                    isBlocked: false
                };
            }
        }
    }

    // Direct root fields check (when candidates are empty or contain no extractable text)
    if (typeof data.text === 'string' && data.text.trim()) {
        return { text: data.text.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.output === 'string' && data.output.trim()) {
        return { text: data.output.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.content === 'string' && data.content.trim()) {
        return { text: data.content.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }
    if (typeof data.response === 'string' && data.response.trim()) {
        return { text: data.response.trim(), finishReason: primaryFinishReason !== 'UNKNOWN' ? primaryFinishReason : 'STOP', blockReason: null, isBlocked: false };
    }

    if (candidates.length === 0) {
        return {
            text: '',
            finishReason: 'NO_CANDIDATES',
            blockReason: null,
            isBlocked: false
        };
    }

    return {
        text: '',
        finishReason: primaryFinishReason,
        blockReason: safetyBlockedReason,
        isBlocked: !!safetyBlockedReason
    };
}

/**
 * Extracts candidate text safely from Gemini response.
 */
export function extractCandidateText(data) {
    const inspection = inspectGeminiResponse(data);
    return inspection.text;
}

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
    const stored = localStorage.getItem('gemini_selected_model');
    const validModels = [
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite'
    ];
    if (!stored || !validModels.includes(stored.trim())) {
        return DEFAULT_MODEL; // gemini-3.7-flash
    }
    return stored.trim();
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

Keep the tone authoritative, objective, executive-level, and constructive. Be concise, punchy, and structured (~400-600 words total across the 4 sections) for immediate executive review. Format cleanly using Markdown headings, bold text, and bullet points.`;

    return prompt;
}

let hasNetlifyServerKey = false;

/**
 * Checks if the Netlify Serverless Backend has process.env.GEMINI_API_KEY configured.
 */
export async function checkNetlifyServerKey() {
    try {
        const response = await fetch('/.netlify/functions/gemini', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (response.ok) {
            const data = await response.json();
            hasNetlifyServerKey = !!data.hasServerKey;
            updateApiKeyStatusUI();
            return hasNetlifyServerKey;
        }
    } catch (e) {
        // Not running on Netlify or functions unavailable
        hasNetlifyServerKey = false;
    }
    return false;
}

/**
 * Invokes Google Gemini API via Netlify Serverless Function or direct client REST fallback.
 */
export async function callGeminiAPI(apiKey, promptText, modelOverride = null, options = {}) {
    const preferredModel = modelOverride || getGeminiModel() || DEFAULT_MODEL;
    const responseMimeType = options.responseMimeType || null;

    let serverErrorDetail = null;

    // 1. Try Netlify Serverless Function first
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        let netlifyResponse;
        try {
            netlifyResponse = await fetch('/.netlify/functions/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    prompt: promptText,
                    model: preferredModel,
                    apiKey: apiKey || '',
                    responseMimeType: responseMimeType,
                    maxOutputTokens: options.maxOutputTokens || null
                })
            });
        } finally {
            clearTimeout(timeoutId);
        }

        let resData = null;
        try {
            resData = await netlifyResponse.json();
        } catch (e) {
            resData = null;
        }

        if (netlifyResponse.ok) {
            if (resData && typeof resData.text === 'string' && resData.text.trim()) {
                hasNetlifyServerKey = true;
                updateApiKeyStatusUI();
                return {
                    text: resData.text.trim(),
                    modelUsed: resData.modelUsed || preferredModel
                };
            }
        }

        const errMsg = resData?.error || (netlifyResponse.status === 404 ? 'Netlify backend not found' : `HTTP ${netlifyResponse.status}`);
        serverErrorDetail = errMsg;

        // If client API key is NOT provided, map Netlify error to user-friendly actionable message
        if (!apiKey) {
            const errLower = errMsg.toLowerCase();
            if (netlifyResponse.status === 401 || errLower.includes('invalid gemini api key') || errLower.includes('api key not valid')) {
                throw new Error("Invalid Gemini API key configured in Netlify. Please check your environment variables or enter an API key in Settings (⚙️).");
            }
            if (netlifyResponse.status === 429 || errLower.includes('quota') || errLower.includes('rate limit')) {
                throw new Error("Google AI servers are experiencing high demand (rate limit reached). Please try again in a few moments or enter your Gemini API key in Settings (⚙️).");
            }
            if (netlifyResponse.status === 400 && (errLower.includes('safety') || errLower.includes('flagged'))) {
                throw new Error("The request was blocked by Google Gemini safety filters. Please adjust the prompt or audit write-ups.");
            }
            if (netlifyResponse.status === 504 || errLower.includes('504') || errLower.includes('gateway timeout') || errLower.includes('timeout')) {
                throw new Error("AI request timed out while waiting for Google servers. Please try again in a moment, or enter your Gemini API key in Settings (⚙️) for a direct connection.");
            }
            if (errLower.includes('no gemini api key found') || errLower.includes('no api key')) {
                throw new Error("No Gemini API key found. Please enter an API key in Settings (⚙️) or configure GEMINI_API_KEY in Netlify.");
            }
            if (netlifyResponse.status === 404) {
                throw new Error("No Gemini API key found. Please enter an API key in Settings (⚙️) to enable AI features.");
            }
            const cleanDetail = resData?.details || errMsg;
            throw new Error(`AI service temporarily unavailable (${cleanDetail}). Please try again in a moment or enter an API key in Settings (⚙️).`);
        }
    } catch (netlifyErr) {
        if (!apiKey) {
            if (netlifyErr.name === 'AbortError' || netlifyErr.name === 'TimeoutError') {
                throw new Error("AI request timed out while connecting to the server. Please check your connection or enter a Gemini API key in Settings (⚙️).");
            }
            if (netlifyErr.message && (netlifyErr.message.includes('fetch') || netlifyErr.message.includes('Failed to fetch') || netlifyErr.message.includes('NetworkError'))) {
                throw new Error("No Gemini API key found and Netlify backend unavailable. Please enter a Gemini API key in Settings (⚙️) to enable AI features.");
            }
            throw netlifyErr;
        }
        console.warn("[AI Client] Netlify serverless function unavailable, proceeding with direct client API...", netlifyErr.message);
        serverErrorDetail = (netlifyErr.name === 'TimeoutError' || netlifyErr.name === 'AbortError') ? 'Request timed out' : (netlifyErr.message || 'Connection failed');
    }

    // 2. Direct Client-Side Fallback (when apiKey is provided)
    if (!apiKey) {
        throw new Error("No Gemini API key found. Please enter an API key in Settings (⚙️) or configure GEMINI_API_KEY in Netlify.");
    }

    const cleanPreferredModel = (preferredModel || '').trim().replace(/^models\//, '').trim();
    let modelsToTry = [];
    if (cleanPreferredModel) {
        modelsToTry.push(cleanPreferredModel);
    }

    // Perform fast upfront discovery of live supported models on client key
    const discovered = await discoverClientModels(apiKey);
    if (discovered && Array.isArray(discovered) && discovered.length > 0) {
        for (const m of discovered) {
            if (!modelsToTry.includes(m)) {
                modelsToTry.push(m);
            }
        }
    }
    for (const m of CANDIDATE_MODELS) {
        if (!modelsToTry.includes(m)) {
            modelsToTry.push(m);
        }
    }

    let lastError = null;
    let modelFailures = [];

    for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            
            const genConfig = {
                temperature: 0.3,
                topP: 0.85,
                maxOutputTokens: typeof options.maxOutputTokens === 'number' && options.maxOutputTokens > 0 ? options.maxOutputTokens : 2500
            };
            if (responseMimeType) {
                genConfig.responseMimeType = responseMimeType;
            }

            const perAttemptMs = (modelsToTry.length - i > 1) ? 6000 : 15000;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), perAttemptMs);

            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [
                            {
                                role: 'user',
                                parts: [{ text: promptText }]
                            }
                        ],
                        generationConfig: genConfig
                    })
                });
            } finally {
                clearTimeout(timeoutId);
            }

            // If responseMimeType is not supported on this specific model, retry request without it
            if (!response.ok && genConfig.responseMimeType) {
                const checkErr = await response.clone().json().catch(() => ({}));
                const checkMsg = (checkErr.error?.message || '').toLowerCase();
                const normMsg = checkMsg.replace(/_/g, '');
                if (normMsg.includes('responsemimetype') || normMsg.includes('mimetype') || normMsg.includes('generationconfig') || checkMsg.includes('unsupported') || checkMsg.includes('invalid argument') || checkMsg.includes('unknown name') || checkMsg.includes('invalid value') || checkMsg.includes('cannot find field')) {
                    delete genConfig.responseMimeType;
                    const retryCtrl = new AbortController();
                    const retryTimeout = setTimeout(() => retryCtrl.abort(), 10000);
                    try {
                        response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: retryCtrl.signal,
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: promptText }] }],
                                generationConfig: genConfig
                            })
                        });
                    } finally {
                        clearTimeout(retryTimeout);
                    }
                }
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                const errLower = errMsg.toLowerCase();
                
                // Immediate fail for invalid API key
                const isApiKeyError = response.status === 401 || 
                    (response.status === 400 && (errLower.includes('api key not valid') || errLower.includes('invalid api key') || errLower.includes('api_key_invalid'))) ||
                    (response.status === 403 && (errLower.includes('api key') || errLower.includes('permission_denied') || errLower.includes('forbidden')));

                if (isApiKeyError) {
                    throw new Error(`Invalid Gemini API Key: ${errMsg}. Please verify your key in Settings.`);
                }

                const isRateLimit = response.status === 429 || errLower.includes('quota') || errLower.includes('rate limit') || errLower.includes('resource_exhausted');

                console.warn(`[AI Client] Model ${model} returned HTTP ${response.status} (${errMsg}). Trying fallback model...`);
                modelFailures.push({ 
                    model, 
                    reason: `HTTP ${response.status}: ${errMsg}`,
                    isSafety: false,
                    isRateLimit: isRateLimit,
                    isEmpty: false
                });
                lastError = new Error(`Model ${model}: ${errMsg}`);

                // Dynamically parse suggested replacement model from API error message if provided
                const suggestedMatches = Array.from(errMsg.matchAll(/models\/([a-zA-Z0-9_.-]+)/gi));
                for (const match of suggestedMatches) {
                    const candidateName = match[1].trim();
                    const cleanLower = candidateName.toLowerCase();
                    if (candidateName !== model && 
                        !cleanLower.includes('tts') && 
                        !cleanLower.includes('audio') && 
                        !cleanLower.includes('embedding') && 
                        !cleanLower.includes('image') && 
                        !cleanLower.includes('imagen') && 
                        !modelsToTry.includes(candidateName)) {
                        console.log(`[AI Client] Dynamically queuing suggested model from API: ${candidateName}`);
                        modelsToTry.splice(i + 1, 0, candidateName);
                        break;
                    }
                }

                if (i === modelsToTry.length - 1) {
                    const discovered = await discoverClientModels(apiKey);
                    const newModels = discovered.filter(m => !modelsToTry.includes(m));
                    if (newModels.length > 0) {
                        modelsToTry.push(...newModels.slice(0, 3));
                    }
                }
                await new Promise(r => setTimeout(r, 200));
                continue;
            }

            const data = await response.json();
            const inspection = inspectGeminiResponse(data);

            if (!inspection.text) {
                const isSafety = inspection.isBlocked && inspection.blockReason;
                const reason = isSafety 
                    ? `Safety filter blocked (${inspection.blockReason})`
                    : `Empty content (finishReason: ${inspection.finishReason || 'unknown'})`;
                console.warn(`[AI Client] Model ${model} returned empty/blocked response: ${reason}. Trying fallback model...`);
                modelFailures.push({ 
                    model, 
                    reason,
                    isSafety: !!isSafety,
                    isRateLimit: false,
                    isEmpty: !isSafety
                });
                lastError = new Error(`Model ${model} returned no text (${reason})`);
                continue;
            }

            console.log(`[AI Client] Successfully generated response using fallback model ${model}`);
            return {
                text: inspection.text,
                modelUsed: model
            };
        } catch (err) {
            if (err.message && err.message.includes("Invalid Gemini API Key")) {
                throw err;
            }
            const isAbort = err.name === 'AbortError';
            const msg = isAbort ? 'Request timed out' : (err.message || 'Connection error');
            console.warn(`[AI Client] Model ${model} failed with exception: ${msg}. Trying next fallback...`);
            modelFailures.push({ 
                model, 
                reason: msg,
                isSafety: false,
                isRateLimit: false,
                isEmpty: false,
                isTimeout: isAbort
            });
            lastError = err;
        }
    }

    const failureSummary = modelFailures.map(f => `${f.model} (${f.reason})`).join(', ');
    const allBlocked = modelFailures.length > 0 && modelFailures.every(f => f.isSafety);
    const allRateLimited = modelFailures.length > 0 && modelFailures.every(f => f.isRateLimit);

    if (allBlocked) {
        throw new Error("Content could not be generated as the prompt was flagged by Google safety filters across candidate models.");
    }
    if (allRateLimited) {
        throw new Error("Google AI rate limits exceeded across all attempted models. Please wait a few moments or try again later.");
    }

    throw new Error(`AI service temporarily unavailable (${failureSummary || lastError?.message || 'Failed to connect to Google AI models'}). Please try again in a moment.`);
}

/**
 * Opens the AI Summary Modal and initializes UI states.
 */
export async function openAISummaryModal() {
    const modal = document.getElementById('ai-summary-modal-overlay');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Check if Netlify environment variable key is active
    checkNetlifyServerKey();

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
            <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Custom Key Ready</span>
        `;
    } else if (hasNetlifyServerKey) {
        badge.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Netlify Key Active</span>
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

    const testBtn = document.getElementById('ai-test-key-btn');
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = `<span>Testing...</span>`;
    }

    try {
        const res = await callGeminiAPI(key, "Respond with 'OK' if you can read this message.");
        showToast(`Connection successful! Connected to ${res.modelUsed}.`, "success");
        if (key) setGeminiApiKey(key);
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
    if (!apiKey && !hasNetlifyServerKey) {
        const serverKeyAvailable = await checkNetlifyServerKey();
        if (!serverKeyAvailable) {
            showToast("Please configure your Google Gemini API Key or add GEMINI_API_KEY in Netlify.", "warning");
            const drawer = document.getElementById('ai-settings-drawer');
            if (drawer && drawer.classList.contains('hidden')) {
                toggleAISettingsDrawer();
            }
            const keyInput = document.getElementById('gemini-api-key-input');
            if (keyInput) keyInput.focus();
            return;
        }
    }

    const generateBtn = document.getElementById('ai-generate-btn');
    const loadingOverlay = document.getElementById('ai-loading-overlay');
    const preview = document.getElementById('ai-summary-preview');
    const textarea = document.getElementById('ai-summary-editor');

    if (generateBtn) generateBtn.disabled = true;
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    try {
        const prompt = buildAuditContextPrompt();
        const modelToUse = getGeminiModel() || DEFAULT_SUMMARY_MODEL;
        const result = await callGeminiAPI(apiKey, prompt, modelToUse, { maxOutputTokens: 1500 });
        
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

/**
 * Multi-stage bulletproof parser for AI indicator enhancement responses.
 * Handles valid JSON, code fences, unescaped multiline strings, regex-extracted keys, and markdown sections.
 */
export function parseAIEnhancementResponse(rawText) {
    if (!rawText) {
        return { aiFeatures: "", aiGaps: "", aiActions: "" };
    }

    if (typeof rawText === 'object') {
        return {
            aiFeatures: String(rawText.aiFeatures || rawText.features || rawText["Notable Features"] || rawText.notable_features || "").trim(),
            aiGaps: String(rawText.aiGaps || rawText.gaps || rawText["Gaps Identified"] || rawText.gaps_identified || "").trim(),
            aiActions: String(rawText.aiActions || rawText.actions || rawText["Actions Recommended"] || rawText.actions_recommended || "").trim()
        };
    }

    if (typeof rawText !== 'string') {
        return { aiFeatures: "", aiGaps: "", aiActions: "" };
    }

    let text = rawText.trim();

    // 1. Strip markdown code fences if present
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    // 2. Direct JSON parse
    try {
        const direct = JSON.parse(text);
        if (direct && typeof direct === 'object') {
            return {
                aiFeatures: String(direct.aiFeatures || direct.features || direct["Notable Features"] || direct.notable_features || "").trim(),
                aiGaps: String(direct.aiGaps || direct.gaps || direct["Gaps Identified"] || direct.gaps_identified || "").trim(),
                aiActions: String(direct.aiActions || direct.actions || direct["Actions Recommended"] || direct.actions_recommended || "").trim()
            };
        }
    } catch (e) {}

    // 3. Substring between outermost { and } with unescaped newline normalization
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const sub = text.substring(firstBrace, lastBrace + 1);
        try {
            const parsedSub = JSON.parse(sub);
            if (parsedSub && typeof parsedSub === 'object') {
                return {
                    aiFeatures: String(parsedSub.aiFeatures || parsedSub.features || parsedSub["Notable Features"] || parsedSub.notable_features || "").trim(),
                    aiGaps: String(parsedSub.aiGaps || parsedSub.gaps || parsedSub["Gaps Identified"] || parsedSub.gaps_identified || "").trim(),
                    aiActions: String(parsedSub.aiActions || parsedSub.actions || parsedSub["Actions Recommended"] || parsedSub.actions_recommended || "").trim()
                };
            }
        } catch (e) {
            try {
                // Fix unescaped newlines/tabs inside string literals
                const sanitized = sub.replace(/(?<=:\s*"(?:[^"\\]|\\.)*)\n(?=(?:[^"\\]|\\.)*")/g, '\\n');
                const parsedSanitized = JSON.parse(sanitized);
                if (parsedSanitized && typeof parsedSanitized === 'object') {
                    return {
                        aiFeatures: String(parsedSanitized.aiFeatures || parsedSanitized.features || "").trim(),
                        aiGaps: String(parsedSanitized.aiGaps || parsedSanitized.gaps || "").trim(),
                        aiActions: String(parsedSanitized.aiActions || parsedSanitized.actions || "").trim()
                    };
                }
            } catch (e2) {}
        }
    }

    // 4. Regex extraction for JSON key-value pairs
    const result = { aiFeatures: "", aiGaps: "", aiActions: "" };
    
    const featMatch = text.match(/"?(?:aiFeatures|features|Notable\s*Features|notable_features)"?\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
                      text.match(/"?(?:aiFeatures|features|Notable\s*Features|notable_features)"?\s*:\s*`([\s\S]*?)`/i);
    if (featMatch) {
        result.aiFeatures = featMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    }

    const gapsMatch = text.match(/"?(?:aiGaps|gaps|Gaps\s*Identified|gaps_identified)"?\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
                      text.match(/"?(?:aiGaps|gaps|Gaps\s*Identified|gaps_identified)"?\s*:\s*`([\s\S]*?)`/i);
    if (gapsMatch) {
        result.aiGaps = gapsMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    }

    const actionsMatch = text.match(/"?(?:aiActions|actions|Actions\s*Recommended|actions_recommended)"?\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
                         text.match(/"?(?:aiActions|actions|Actions\s*Recommended|actions_recommended)"?\s*:\s*`([\s\S]*?)`/i);
    if (actionsMatch) {
        result.aiActions = actionsMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    }

    if (result.aiFeatures || result.aiGaps || result.aiActions) {
        return result;
    }

    // 5. Plaintext / Markdown section fallback (if model responded with headers)
    const sections = text.split(/(?:^|\n)(?:#{1,4}\s*|\*\*|)(Notable Features|Gaps Identified|Actions Recommended)(?:\*\*|:|\n)/i);
    if (sections.length > 1) {
        for (let i = 1; i < sections.length; i += 2) {
            const header = sections[i].toLowerCase();
            const content = (sections[i + 1] || '').trim().replace(/^[:\s-]+/, '').trim();
            if (header.includes('notable') || header.includes('feature')) {
                result.aiFeatures = content;
            } else if (header.includes('gap') || header.includes('vulnerabilit')) {
                result.aiGaps = content;
            } else if (header.includes('action') || header.includes('remediat')) {
                result.aiActions = content;
            }
        }
    }

    // 6. If completely unstructured but text exists, assign to aiActions or aiFeatures
    if (!result.aiFeatures && !result.aiGaps && !result.aiActions && text.length > 0) {
        result.aiActions = text;
    }

    return result;
}

/**
 * Enhances raw auditor notes for a specific indicator card.
 */
export async function enhanceIndicatorCard(catName, indName, showFeedback = true) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return false;

    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    const btn = document.getElementById(`ai-btn-${catEscaped}-${indEscaped}`);

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block text-[10px]">⌛</span><span class="text-[10px]">Enhancing...</span>`;
    }

    try {
        const apiKey = getGeminiApiKey();

        const prompt = `You are a Senior Campus Safety and Regulatory Compliance Auditor.
Enhance and formalize the auditor's raw write-ups for this specific campus audit indicator.

INDICATOR CONTEXT:
- Macro Compliance Category: ${catName}
- Specific Indicator: ${indName}
- Current Compliance Score: ${data.score}/5

RAW AUDITOR WRITE-UPS:
- Notable Features: ${data.features || "(None recorded)"}
- Gaps Identified: ${data.gaps || "(None recorded)"}
- Actions Recommended: ${data.actions || "(None recorded)"}

INSTRUCTIONS:
1. Polish the raw notes into formal, executive-ready, regulatory audit language.
2. Preserve 100% of the auditor's specific facts, measurements, equipment names, locations, and ratings.
3. If Notable Features has notes, enhance them into concise, professional compliance observations. If it was empty, return empty string "".
4. If Gaps Identified has notes, enhance them into clear, prioritized regulatory vulnerability statements. If it was empty, return empty string "".
5. If Actions Recommended has notes, enhance them into structured, actionable remediation tasks with clear scope. If Actions Recommended was empty BUT a gap was identified or score is <= 2, intelligently generate the appropriate standard remedial action.
6. You MUST return ONLY a valid, raw JSON object (with no markdown code blocks, backticks, or commentary) strictly matching this schema:
{
  "aiFeatures": "Enhanced notable features text (or empty string)",
  "aiGaps": "Enhanced gaps identified text (or empty string)",
  "aiActions": "Enhanced actions recommended text (or empty string)"
}`;

        const res = await callGeminiAPI(apiKey, prompt, DEFAULT_ENHANCE_MODEL, { responseMimeType: 'application/json', maxOutputTokens: 1000 });
        const parsed = parseAIEnhancementResponse(res.text);

        data.aiFeatures = parsed.aiFeatures || "";
        data.aiGaps = parsed.aiGaps || "";
        data.aiActions = parsed.aiActions || "";

        saveState();
        refreshCardDOM(catName, indName);

        if (showFeedback) {
            showToast(`Enhanced write-ups for "${indName}"!`, "success");
        }
        return true;
    } catch (err) {
        console.error("Card enhancement error:", err);
        if (showFeedback) {
            showToast(`Enhancement failed: ${err.message}`, "error");
        }
        refreshCardDOM(catName, indName);
        return false;
    }
}

/**
 * Bulk enhances all indicators in the active category that have notes or modified scores.
 */
export async function enhanceActiveCategoryWriteups() {
    const catName = state.activeCategory;
    const catData = CATEGORIES[catName];
    if (!catData) return;

    const indicatorsToEnhance = [];
    Object.keys(catData.indicators).forEach(indName => {
        const item = state.auditData[catName]?.[indName];
        if (item && (item.features || item.gaps || item.actions || item.score !== 3 || item.photoName)) {
            indicatorsToEnhance.push(indName);
        }
    });

    if (indicatorsToEnhance.length === 0) {
        showToast(`No write-ups or active ratings found in "${catName}" to enhance.`, "info");
        return;
    }

    const catBtn = document.getElementById('category-ai-enhance-btn');
    if (catBtn) {
        catBtn.disabled = true;
        catBtn.innerHTML = `<span class="animate-spin inline-block mr-1">⌛</span><span>Enhancing Category...</span>`;
    }

    showToast(`Starting AI enhancement for ${indicatorsToEnhance.length} indicators in "${catName}"...`, "info");

    let successCount = 0;
    for (let i = 0; i < indicatorsToEnhance.length; i++) {
        const indName = indicatorsToEnhance[i];
        showToast(`Enhancing ${i + 1} of ${indicatorsToEnhance.length}: "${indName}"...`, "info");
        const ok = await enhanceIndicatorCard(catName, indName, false);
        if (ok) successCount++;
    }

    if (catBtn) {
        catBtn.disabled = false;
        catBtn.innerHTML = `
            <svg class="w-3.5 h-3.5 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            <span>AI Enhance Category</span>
        `;
    }

    showToast(`Successfully enhanced ${successCount} indicators in "${catName}"!`, "success");
}

/**
 * Applies, appends, or discards an AI enhanced write-up field.
 */
export function applyAIEnhancement(catName, indName, field, mode) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    const aiField = field === 'features' ? 'aiFeatures' : field === 'gaps' ? 'aiGaps' : 'aiActions';
    const enhancedText = data[aiField] || '';

    if (mode === 'replace') {
        data[field] = enhancedText;
        data[aiField] = '';
        data.reviewed = true;
        showToast(`Applied enhanced ${field === 'features' ? 'Features' : field === 'gaps' ? 'Gaps' : 'Actions'}.`, "success");
    } else if (mode === 'append') {
        data[field] = data[field] ? (data[field].trim() + '\n\n' + enhancedText) : enhancedText;
        data[aiField] = '';
        data.reviewed = true;
        showToast(`Appended enhanced ${field === 'features' ? 'Features' : field === 'gaps' ? 'Gaps' : 'Actions'}.`, "success");
    } else if (mode === 'discard') {
        data[aiField] = '';
        showToast("Suggestion discarded.", "info");
    }

    saveState();
    refreshCardDOM(catName, indName);
}

/**
 * Handles text input inside the secondary AI suggestion textarea.
 */
export function handleAITextChange(catName, indName, field, value) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    const aiField = field === 'features' ? 'aiFeatures' : field === 'gaps' ? 'aiGaps' : 'aiActions';
    data[aiField] = value;
    saveState();
}

/**
 * Multi-stage bulletproof parser for AI dynamic risk assessment responses.
 * Extracts severity, suggestedMultiplier (1-3), suggestedScore (1-5), scoreDelta, and rationale.
 */
export function parseAIRiskResponse(rawText, baseMultiplier = 2, currentScore = 3) {
    const fallback = {
        severity: "Medium",
        suggestedMultiplier: baseMultiplier,
        suggestedScore: currentScore,
        scoreDelta: 0,
        rationale: "Evaluated based on qualitative observations and systemic risk potential."
    };

    if (!rawText) {
        return fallback;
    }

    // Helper to validate and normalize parsed object
    const normalizeObj = (obj) => {
        if (!obj || typeof obj !== 'object') return null;

        let sev = (obj.severity || obj.riskSeverity || obj.riskLevel || obj.severityLevel || "").toString().trim();
        if (/critical/i.test(sev)) sev = "Critical";
        else if (/high/i.test(sev)) sev = "High";
        else if (/low/i.test(sev)) sev = "Low";
        else sev = "Medium";

        let mult = parseInt(obj.suggestedMultiplier || obj.multiplier || obj.weight || obj.effectiveMultiplier, 10);
        if (isNaN(mult) || mult < 1 || mult > 3) {
            mult = (sev === "Critical" || sev === "High") ? 3 : (sev === "Low" ? 1 : 2);
        }

        let score = parseInt(obj.suggestedScore || obj.score || obj.rating || obj.suggestedRating, 10);
        if (isNaN(score) || score < 1 || score > 5) {
            score = currentScore;
        }

        let delta = parseInt(obj.scoreDelta || obj.delta, 10);
        if (isNaN(delta)) {
            delta = score - currentScore;
        }

        let rat = (obj.rationale || obj.justification || obj.reason || obj.riskRationale || obj.notes || obj.explanation || "").toString().trim();
        if (!rat) {
            rat = `Assessed as ${sev} Risk based on on-site findings.`;
        }

        return {
            severity: sev,
            suggestedMultiplier: mult,
            suggestedScore: score,
            scoreDelta: delta,
            rationale: rat
        };
    };

    if (typeof rawText === 'object') {
        const norm = normalizeObj(rawText);
        if (norm) return norm;
    }

    if (typeof rawText !== 'string') {
        return fallback;
    }

    let text = rawText.trim();

    // 1. Strip markdown code fences if present
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    // 2. Direct JSON parse
    try {
        const direct = JSON.parse(text);
        const norm = normalizeObj(direct);
        if (norm) return norm;
    } catch (e) {}

    // 3. Substring between first { and last } with unescaped newline normalization
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const sub = text.substring(firstBrace, lastBrace + 1);
        try {
            const parsedSub = JSON.parse(sub);
            const norm = normalizeObj(parsedSub);
            if (norm) return norm;
        } catch (e) {
            try {
                const sanitized = sub.replace(/(?<=:\s*"(?:[^"\\]|\\.)*)\n(?=(?:[^"\\]|\\.)*")/g, '\\n');
                const parsedSanitized = JSON.parse(sanitized);
                const norm = normalizeObj(parsedSanitized);
                if (norm) return norm;
            } catch (e2) {}
        }
    }

    // 4. Regex extraction for JSON key-value pairs
    const sevMatch = text.match(/"?(?:severity|riskSeverity|riskLevel|severityLevel)"?\s*:\s*"?(Critical|High|Medium|Moderate|Low)"?/i);
    const multMatch = text.match(/"?(?:suggestedMultiplier|multiplier|weight)"?\s*:\s*"?([1-3])"?/i);
    const scoreMatch = text.match(/"?(?:suggestedScore|score|rating)"?\s*:\s*"?([1-5])"?/i);
    const deltaMatch = text.match(/"?(?:scoreDelta|delta)"?\s*:\s*"?([+-]?\d+)"?/i);
    const ratMatch = text.match(/"?(?:rationale|justification|reason|riskRationale|notes|explanation)"?\s*:\s*"((?:[^"\\]|\\.)*)"/i) ||
                     text.match(/"?(?:rationale|justification|reason|riskRationale|notes|explanation)"?\s*:\s*`([\s\S]*?)`/i);

    if (sevMatch || multMatch || scoreMatch || ratMatch) {
        let rawSev = sevMatch ? sevMatch[1] : (text.toLowerCase().includes('critical') ? 'Critical' : (text.toLowerCase().includes('high') ? 'High' : (text.toLowerCase().includes('low') ? 'Low' : 'Medium')));
        let sev = /critical/i.test(rawSev) ? "Critical" : (/high/i.test(rawSev) ? "High" : (/low/i.test(rawSev) ? "Low" : "Medium"));
        let mult = multMatch ? parseInt(multMatch[1], 10) : ((sev === "Critical" || sev === "High") ? 3 : (sev === "Low" ? 1 : 2));
        let score = scoreMatch ? parseInt(scoreMatch[1], 10) : currentScore;
        let delta = deltaMatch ? parseInt(deltaMatch[1], 10) : (score - currentScore);
        let rat = ratMatch ? ratMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : "Evaluated based on qualitative findings.";

        return {
            severity: sev,
            suggestedMultiplier: mult,
            suggestedScore: score,
            scoreDelta: delta,
            rationale: rat
        };
    }

    // 5. Plaintext keyword heuristic fallback
    let detectedSev = "Medium";
    if (/\b(critical|life-safety|emergency|statutory violation|hazard|danger)\b/i.test(text)) {
        detectedSev = "Critical";
    } else if (/\b(high risk|severe|urgent|deficiency|non-compliant)\b/i.test(text)) {
        detectedSev = "High";
    } else if (/\b(low risk|compliant|exemplary|good|minor|exceptional|world-class|best-in-class|international standard|flawless|industry-leading)\b/i.test(text)) {
        detectedSev = "Low";
    }

    const suggestedMultiplier = (detectedSev === "Critical" || detectedSev === "High") ? 3 : (detectedSev === "Low" ? 1 : 2);
    // Only suggest 5 if explicit exceptional excellence keywords are matched, otherwise 4 for compliant/low risk
    const isTrulyExceptional = /\b(exceptional|world-class|best-in-class|international standard|flawless|industry-leading)\b/i.test(text);
    const suggestedScore = detectedSev === "Critical" ? 1 : (detectedSev === "High" ? 2 : (detectedSev === "Low" ? (isTrulyExceptional ? 5 : 4) : 3));

    return {
        severity: detectedSev,
        suggestedMultiplier,
        suggestedScore,
        scoreDelta: suggestedScore - currentScore,
        rationale: text.replace(/[{}"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || "Evaluated based on qualitative observations."
    };
}

/**
 * Analyzes written qualitative findings (Notable Features, Gaps, Actions) with Gemini AI
 * to dynamically evaluate Risk Severity and propose multiplier (1x-3x) and score adjustments.
 */
export async function analyzeDynamicRisk(catName, indName, showFeedback = true) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return false;

    const baseMultiplier = CATEGORIES[catName]?.indicators?.[indName] || 2;
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    const riskBtn = document.getElementById(`risk-btn-${catEscaped}-${indEscaped}`);

    if (riskBtn) {
        riskBtn.disabled = true;
        riskBtn.innerHTML = `<span class="animate-spin inline-block text-[10px]">⚡</span><span class="text-[10px]">Analyzing Risk...</span>`;
    }

    try {
        const apiKey = getGeminiApiKey();
        const currentScore = Number(data.score) || 3;
        const featuresText = [data.features, data.aiFeatures].filter(Boolean).join("\n");
        const gapsText = [data.gaps, data.aiGaps].filter(Boolean).join("\n");
        const actionsText = [data.actions, data.aiActions].filter(Boolean).join("\n");

        if (!featuresText && !gapsText && !actionsText && currentScore === 3) {
            if (showFeedback) showToast("Enter notes in Notable Features, Gaps, or Actions to analyze risk.", "warning");
            if (riskBtn) {
                riskBtn.disabled = false;
                riskBtn.innerHTML = `<span class="text-amber-500 font-bold">⚡</span><span>Dynamic Risk</span>`;
            }
            return false;
        }

        const prompt = `You are a Chief Campus Safety, Risk & Regulatory Compliance Assessor.
Evaluate the systemic liability and operational risk for this specific audit indicator based on the qualitative findings and write-ups.

INDICATOR CONTEXT:
- Macro Category: ${catName}
- Indicator: ${indName}
- Baseline Multiplier: ${baseMultiplier}x
- Current Auditor Score: ${currentScore}/5 (1=Critical Failure, 2=Major Deficiencies, 3=Baseline/Moderate, 4=Compliant, 5=Exemplary)

QUALITATIVE WRITE-UPS:
- Notable Features / Strengths: ${featuresText || "(None recorded)"}
- Gaps Identified / Hazards: ${gapsText || "(None recorded)"}
- Actions Recommended / Remediation: ${actionsText || "(None recorded)"}

EVALUATION RUBRIC:
1. Risk Severity & Suggested Score Calibration:
   - "Critical": Direct life-safety threats, active fire/electrical hazards, child transit hazards, missing mandatory statutory certifications, unvetted staff. Suggested Multiplier = 3. Suggested Score = 1 or 2.
   - "High": Significant operational, hygiene, structural, or documentation non-compliance that compromises campus safety if unaddressed within 30 days. Suggested Multiplier = 3 or 2. Suggested Score = 2 or 3.
   - "Medium": Routine operational deficiencies, minor equipment wear, maintenance backlogs, standard non-critical procedural gaps. Suggested Multiplier = 2. Suggested Score = 3 or 4.
   - "Low": Robust compliance, proactive maintenance, exemplary safety practices, or negligible administrative issues. Suggested Multiplier = 1. Suggested Score = 4 (Compliant/Good).

2. CRITICAL CALIBRATION FOR SCORE 5 (EXEMPLARY):
   - Only suggest an increase to Score 5 in truly EXCEPTIONAL and rare circumstances where:
     (a) There are zero recorded gaps or vulnerabilities,
     (b) Notable Features explicitly demonstrate industry-leading innovations, state-of-the-art systems, or international best practices, AND
     (c) The school's measures vastly exceed standard regulatory requirements.
   - For all standard compliant, well-maintained, or satisfactory operations without extraordinary institutional innovation, default to Score 4.

3. Instructions:
   - Formulate a precise, authoritative 1-2 sentence risk rationale explaining why this multiplier and score are recommended.
   - Calculate scoreDelta = suggestedScore - currentScore.
   - Return ONLY a raw JSON object strictly adhering to this schema:
{
  "severity": "Critical" | "High" | "Medium" | "Low",
  "suggestedMultiplier": 1 | 2 | 3,
  "suggestedScore": 1 | 2 | 3 | 4 | 5,
  "scoreDelta": 0,
  "rationale": "1-2 sentence risk justification"
}`;

        const res = await callGeminiAPI(apiKey, prompt, DEFAULT_RISK_MODEL, { responseMimeType: 'application/json', maxOutputTokens: 500 });
        const parsed = parseAIRiskResponse(res.text, baseMultiplier, currentScore);

        data.suggestedRisk = {
            severity: parsed.severity,
            suggestedMultiplier: parsed.suggestedMultiplier,
            suggestedScore: parsed.suggestedScore,
            scoreDelta: parsed.scoreDelta,
            rationale: parsed.rationale
        };

        saveState();
        refreshCardDOM(catName, indName);

        if (showFeedback) {
            showToast(`Dynamic risk evaluated: ${data.suggestedRisk.severity} (${data.suggestedRisk.suggestedMultiplier}x Multiplier)`, "success");
        }
        return true;
    } catch (err) {
        console.error("Dynamic risk analysis error:", err);
        if (showFeedback) showToast(`Risk analysis failed: ${err.message}`, "error");
        refreshCardDOM(catName, indName);
        return false;
    }
}

/**
 * Applies proposed or customized Dynamic Risk Modifier to the indicator.
 */
export function applyDynamicRiskModifier(catName, indName, customMultiplierOverride = null, applyScore = true) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    const risk = data.suggestedRisk || {};
    const baseMultiplier = CATEGORIES[catName]?.indicators?.[indName] || 2;
    
    const chosenMultiplier = customMultiplierOverride !== null 
        ? Number(customMultiplierOverride) 
        : (Number(risk.suggestedMultiplier) || baseMultiplier);

    data.customMultiplier = chosenMultiplier;
    data.riskSeverity = risk.severity || "Medium";
    data.riskRationale = risk.rationale || "Applied dynamic risk modifier based on qualitative findings.";
    data.riskScoreDelta = risk.scoreDelta || 0;
    data.riskApplied = true;
    data.reviewed = true;

    if (applyScore && risk.suggestedScore && Number(risk.suggestedScore) >= 1 && Number(risk.suggestedScore) <= 5) {
        data.score = Number(risk.suggestedScore);
    }

    // Clear pending suggestion
    delete data.suggestedRisk;

    saveState();
    refreshCardDOM(catName, indName);
    showToast(`Applied ${data.riskSeverity} (${data.customMultiplier}x Multiplier) to ${indName}.`, "success");
}

/**
 * Dismisses pending dynamic risk suggestion without applying changes.
 */
export function dismissDynamicRiskModifier(catName, indName) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    delete data.suggestedRisk;
    saveState();
    refreshCardDOM(catName, indName);
    showToast("Risk proposal dismissed.", "info");
}

/**
 * Resets an active dynamic risk modifier back to system baseline multiplier and ratings.
 */
export function resetDynamicRiskModifier(catName, indName) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    data.customMultiplier = null;
    data.riskSeverity = "";
    data.riskRationale = "";
    data.riskScoreDelta = 0;
    data.riskApplied = false;
    delete data.suggestedRisk;

    saveState();
    refreshCardDOM(catName, indName);
    showToast(`Reset ${indName} to standard baseline multiplier.`, "info");
}

/**
 * Evaluates dynamic risk across all filled indicators in a category.
 */
export async function analyzeCategoryDynamicRisks(catName = null) {
    const targetCat = catName || state.activeCategory || Object.keys(CATEGORIES)[0];
    const catData = CATEGORIES[targetCat];
    if (!catData) {
        showToast("Invalid category selected.", "error");
        return;
    }

    const catRiskBtn = document.getElementById('category-ai-risk-btn');
    if (catRiskBtn) {
        catRiskBtn.disabled = true;
        catRiskBtn.innerHTML = `<span class="animate-spin inline-block mr-1">⌛</span><span>Assessing Risk...</span>`;
    }

    try {
        const indicatorsToAnalyze = [];
        Object.keys(catData.indicators).forEach(indName => {
            const item = state.auditData[targetCat]?.[indName];
            if (item && (item.features || item.gaps || item.actions || item.aiFeatures || item.aiGaps || item.aiActions || item.score !== 3 || item.photoName)) {
                indicatorsToAnalyze.push(indName);
            }
        });

        if (indicatorsToAnalyze.length === 0) {
            showToast(`No write-ups or active ratings recorded in "${targetCat}" to evaluate risk.`, "info");
            return;
        }

        showToast(`Assessing dynamic risk across ${indicatorsToAnalyze.length} indicators in "${targetCat}"...`, "info");

        let successCount = 0;
        for (let i = 0; i < indicatorsToAnalyze.length; i++) {
            const indName = indicatorsToAnalyze[i];
            showToast(`Analyzing risk ${i + 1} of ${indicatorsToAnalyze.length}: "${indName}"...`, "info");
            const ok = await analyzeDynamicRisk(targetCat, indName, false);
            if (ok) successCount++;
        }

        showToast(`Evaluated Dynamic Risk for ${successCount} indicators in "${targetCat}"!`, "success");
    } catch (err) {
        console.error("Error in category risk assessment:", err);
        showToast(`Category risk assessment error: ${err.message}`, "error");
    } finally {
        if (catRiskBtn) {
            catRiskBtn.disabled = false;
            catRiskBtn.innerHTML = `
                <span class="text-amber-200 font-black">⚡</span>
                <span>Assess Category Risk</span>
            `;
        }
    }
}

/**
 * Parses batch AI enhancement JSON response safely.
 */
export function parseAIEnhancementBatchResponse(rawText) {
    if (!rawText) return {};
    if (typeof rawText === 'object' && !Array.isArray(rawText)) {
        if (rawText.indicators && typeof rawText.indicators === 'object') {
            return rawText.indicators;
        }
        return rawText;
    }
    let text = typeof rawText === 'string' ? rawText.trim() : '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
        const parsed = JSON.parse(text);
        if (parsed.indicators && typeof parsed.indicators === 'object') {
            return parsed.indicators;
        }
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                const subParsed = JSON.parse(text.slice(start, end + 1));
                if (subParsed.indicators && typeof subParsed.indicators === 'object') {
                    return subParsed.indicators;
                }
                if (typeof subParsed === 'object' && !Array.isArray(subParsed)) {
                    return subParsed;
                }
            } catch (err2) {
                console.warn("Batch enhancement JSON parse failed:", err2);
            }
        }
    }
    return {};
}

/**
 * Enhances all filled indicators in a category via a single batched Gemini API call.
 */
export async function enhanceCategoryBatch(catName) {
    const catData = CATEGORIES[catName];
    if (!catData) return { enhancedCount: 0 };

    const indicatorsToEnhance = [];
    Object.keys(catData.indicators).forEach(indName => {
        const item = state.auditData[catName]?.[indName];
        if (item && (item.features || item.gaps || item.actions || item.score !== 3 || item.photoName)) {
            indicatorsToEnhance.push({
                name: indName,
                score: item.score || 3,
                features: item.features || '',
                gaps: item.gaps || '',
                actions: item.actions || ''
            });
        }
    });

    if (indicatorsToEnhance.length === 0) {
        return { enhancedCount: 0 };
    }

    const apiKey = getGeminiApiKey();

    const indicatorsContext = indicatorsToEnhance.map(ind => {
        return `### Indicator: "${ind.name}"
- Score: ${ind.score}/5
- Notable Features: ${ind.features || "(None recorded)"}
- Gaps Identified: ${ind.gaps || "(None recorded)"}
- Actions Recommended: ${ind.actions || "(None recorded)"}`;
    }).join("\n\n");

    const prompt = `You are a Senior Campus Safety and Regulatory Compliance Auditor.
Enhance and formalize the auditor's raw write-ups for the indicators in this macro compliance category: "${catName}".

INDICATORS:
${indicatorsContext}

INSTRUCTIONS:
1. Polish the raw notes into formal, executive-ready, regulatory audit language.
2. Preserve 100% of the auditor's specific facts, measurements, equipment names, locations, and ratings.
3. If Notable Features has notes, enhance them into concise, professional compliance observations. If it was empty, return empty string "".
4. If Gaps Identified has notes, enhance them into clear, prioritized regulatory vulnerability statements. If it was empty, return empty string "".
5. If Actions Recommended has notes, enhance them into structured, actionable remediation tasks with clear scope. If Actions Recommended was empty BUT a gap was identified or score is <= 2, intelligently generate the appropriate standard remedial action.
6. You MUST return ONLY a valid, raw JSON object (with no markdown code blocks, backticks, or commentary) strictly matching this schema:
{
  "indicators": {
    "<Exact Indicator Name>": {
      "aiFeatures": "Enhanced notable features text (or empty string)",
      "aiGaps": "Enhanced gaps identified text (or empty string)",
      "aiActions": "Enhanced actions recommended text (or empty string)"
    }
  }
}`;

    const res = await callGeminiAPI(apiKey, prompt, DEFAULT_ENHANCE_MODEL, { responseMimeType: 'application/json', maxOutputTokens: 2500 });
    const parsed = parseAIEnhancementBatchResponse(res.text);

    let enhancedCount = 0;
    Object.entries(parsed).forEach(([indName, val]) => {
        if (!val || typeof val !== 'object') return;
        const targetIndName = Object.keys(catData.indicators).find(k => k.toLowerCase() === indName.toLowerCase()) || indName;
        if (state.auditData[catName]?.[targetIndName]) {
            const data = state.auditData[catName][targetIndName];
            data.aiFeatures = val.aiFeatures || '';
            data.aiGaps = val.aiGaps || '';
            data.aiActions = val.aiActions || '';
            enhancedCount++;
            refreshCardDOM(catName, targetIndName);
        }
    });

    saveState();
    return { enhancedCount };
}

/**
 * Parses batch Dynamic Risk JSON response safely.
 */
export function parseAIRiskBatchResponse(rawText) {
    if (!rawText) return {};
    if (typeof rawText === 'object' && !Array.isArray(rawText)) {
        if (rawText.indicators && typeof rawText.indicators === 'object') {
            return rawText.indicators;
        }
        return rawText;
    }
    let text = typeof rawText === 'string' ? rawText.trim() : '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
        const parsed = JSON.parse(text);
        if (parsed.indicators && typeof parsed.indicators === 'object') {
            return parsed.indicators;
        }
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                const subParsed = JSON.parse(text.slice(start, end + 1));
                if (subParsed.indicators && typeof subParsed.indicators === 'object') {
                    return subParsed.indicators;
                }
                if (typeof subParsed === 'object' && !Array.isArray(subParsed)) {
                    return subParsed;
                }
            } catch (err2) {
                console.warn("Batch risk JSON parse failed:", err2);
            }
        }
    }
    return {};
}

/**
 * Evaluates dynamic risk across all filled indicators in a category via a single batched Gemini API call.
 */
export async function analyzeCategoryDynamicRisksBatch(catName) {
    const catData = CATEGORIES[catName];
    if (!catData) return { analyzedCount: 0 };

    const indicatorsToAnalyze = [];
    Object.keys(catData.indicators).forEach(indName => {
        const item = state.auditData[catName]?.[indName];
        if (item && (item.features || item.gaps || item.actions || item.aiFeatures || item.aiGaps || item.aiActions || item.score !== 3 || item.photoName)) {
            const baseMultiplier = catData.indicators[indName] || 2;
            indicatorsToAnalyze.push({
                name: indName,
                baseMultiplier,
                score: item.score || 3,
                features: [item.features, item.aiFeatures].filter(Boolean).join("\n"),
                gaps: [item.gaps, item.aiGaps].filter(Boolean).join("\n"),
                actions: [item.actions, item.aiActions].filter(Boolean).join("\n")
            });
        }
    });

    if (indicatorsToAnalyze.length === 0) {
        return { analyzedCount: 0 };
    }

    const apiKey = getGeminiApiKey();

    const indicatorsContext = indicatorsToAnalyze.map(ind => {
        return `### Indicator: "${ind.name}"
- Baseline Multiplier: ${ind.baseMultiplier}x
- Auditor Score: ${ind.score}/5
- Notable Features: ${ind.features || "(None recorded)"}
- Gaps Identified: ${ind.gaps || "(None recorded)"}
- Actions Recommended: ${ind.actions || "(None recorded)"}`;
    }).join("\n\n");

    const prompt = `You are a Chief Campus Safety, Risk & Regulatory Compliance Assessor.
Evaluate the systemic liability and operational risk for each indicator in Macro Compliance Category: "${catName}".

INDICATORS:
${indicatorsContext}

EVALUATION RUBRIC:
1. Risk Severity & Suggested Score Calibration:
   - "Critical": Direct life-safety threats, active fire/electrical hazards, child transit hazards, missing mandatory statutory certifications, unvetted staff. Suggested Multiplier = 3. Suggested Score = 1 or 2.
   - "High": Significant operational, hygiene, structural, or documentation non-compliance that compromises campus safety if unaddressed within 30 days. Suggested Multiplier = 3 or 2. Suggested Score = 2 or 3.
   - "Medium": Routine operational deficiencies, minor equipment wear, maintenance backlogs, standard non-critical procedural gaps. Suggested Multiplier = 2. Suggested Score = 3 or 4.
   - "Low": Robust compliance, proactive maintenance, exemplary safety practices, or negligible administrative issues. Suggested Multiplier = 1. Suggested Score = 4.

2. CRITICAL CALIBRATION FOR SCORE 5 (EXEMPLARY):
   - Only suggest Score 5 in rare circumstances with zero gaps and state-of-the-art innovation. Otherwise, default compliant operations to Score 4.

3. Return ONLY a valid, raw JSON object (with no markdown code blocks, backticks, or commentary) strictly matching this schema:
{
  "indicators": {
    "<Exact Indicator Name>": {
      "severity": "Critical" | "High" | "Medium" | "Low",
      "suggestedMultiplier": 1 | 2 | 3,
      "suggestedScore": 1 | 2 | 3 | 4 | 5,
      "scoreDelta": 0,
      "rationale": "1-2 sentence risk justification"
    }
  }
}`;

    const res = await callGeminiAPI(apiKey, prompt, DEFAULT_RISK_MODEL, { responseMimeType: 'application/json', maxOutputTokens: 2500 });
    const parsed = parseAIRiskBatchResponse(res.text);

    let analyzedCount = 0;
    Object.entries(parsed).forEach(([indName, val]) => {
        if (!val || typeof val !== 'object') return;
        const targetIndName = Object.keys(catData.indicators).find(k => k.toLowerCase() === indName.toLowerCase()) || indName;
        if (state.auditData[catName]?.[targetIndName]) {
            const data = state.auditData[catName][targetIndName];
            const baseMultiplier = catData.indicators[targetIndName] || 2;
            const currentScore = Number(data.score) || 3;
            
            const mult = Number(val.suggestedMultiplier);
            const validMult = (mult >= 1 && mult <= 5) ? mult : baseMultiplier;
            const score = Number(val.suggestedScore);
            const validScore = (score >= 1 && score <= 5) ? score : currentScore;

            data.suggestedRisk = {
                severity: val.severity || "Medium",
                suggestedMultiplier: validMult,
                suggestedScore: validScore,
                scoreDelta: val.scoreDelta !== undefined ? Number(val.scoreDelta) : (validScore - currentScore),
                rationale: (val.rationale || "Evaluated based on qualitative findings.").slice(0, 300)
            };
            analyzedCount++;
            refreshCardDOM(catName, targetIndName);
        }
    });

    saveState();
    return { analyzedCount };
}

// === Automated Full-Audit AI Pipeline Controller ===

let isPipelineCancelled = false;
let pendingKeyResolution = null;

export function showAIPipelineModal() {
    isPipelineCancelled = false;
    const modal = document.getElementById('ai-pipeline-progress-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
    const keyPrompt = document.getElementById('ai-pipeline-key-prompt');
    if (keyPrompt) {
        keyPrompt.classList.add('hidden');
    }
    updateAIPipelineProgress('Phase 1 of 3: AI Category Enhancement', 0, 'Initializing AI audit synthesis...');
}

export function closeAIPipelineModal() {
    const modal = document.getElementById('ai-pipeline-progress-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function updateAIPipelineProgress(phaseText, percentage, statusText) {
    const phaseBadge = document.getElementById('ai-pipeline-phase-badge');
    if (phaseBadge) phaseBadge.textContent = phaseText;
    
    const pctLabel = document.getElementById('ai-pipeline-percentage');
    if (pctLabel) pctLabel.textContent = `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
    
    const progressBar = document.getElementById('ai-pipeline-progress-bar');
    if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, Math.round(percentage)))}%`;
    
    const statusLabel = document.getElementById('ai-pipeline-status-text');
    if (statusLabel) statusLabel.textContent = statusText;
}

export function cancelAIPipeline() {
    isPipelineCancelled = true;
    if (pendingKeyResolution) {
        pendingKeyResolution(false);
        pendingKeyResolution = null;
    }
    closeAIPipelineModal();
    showToast("AI processing pipeline cancelled.", "info");
}

export function resumeAIPipelineWithKey() {
    const input = document.getElementById('ai-pipeline-api-key-input');
    const key = input ? input.value.trim() : '';
    if (!key) {
        showToast("Please enter a valid Gemini API Key.", "warning");
        return;
    }
    setGeminiApiKey(key);
    updateApiKeyStatusUI();
    const keyPrompt = document.getElementById('ai-pipeline-key-prompt');
    if (keyPrompt) keyPrompt.classList.add('hidden');
    showToast("Gemini API key saved.", "success");
    if (pendingKeyResolution) {
        pendingKeyResolution(true);
        pendingKeyResolution = null;
    }
}

/**
 * Runs the automated full-audit AI pipeline across all categories and generates the Executive Summary.
 */
export async function runFullAuditAIPipeline() {
    showAIPipelineModal();

    // Verify Gemini API Key or Serverless Key Availability
    let apiKey = getGeminiApiKey();
    if (!apiKey && !hasNetlifyServerKey) {
        const serverKeyAvailable = await checkNetlifyServerKey();
        if (!serverKeyAvailable) {
            const keyPrompt = document.getElementById('ai-pipeline-key-prompt');
            if (keyPrompt) {
                keyPrompt.classList.remove('hidden');
                const keyInput = document.getElementById('ai-pipeline-api-key-input');
                if (keyInput) keyInput.focus();
            }
            updateAIPipelineProgress('API Key Required', 0, 'Awaiting Google Gemini API key...');
            const keyEntered = await new Promise(resolve => {
                pendingKeyResolution = resolve;
            });
            if (!keyEntered || isPipelineCancelled) {
                closeAIPipelineModal();
                return false;
            }
        }
    }

    const categoryNames = Object.keys(CATEGORIES);
    const totalCategories = categoryNames.length;

    try {
        // === Phase 1: AI Category Enhancement across all categories ===
        for (let i = 0; i < totalCategories; i++) {
            if (isPipelineCancelled) return false;
            const catName = categoryNames[i];
            const pct = Math.round((i / totalCategories) * 45);
            updateAIPipelineProgress(
                'Phase 1 of 3: AI Category Enhancement',
                pct,
                `Enhancing Category (${i + 1}/${totalCategories}): "${catName}"...`
            );
            try {
                await enhanceCategoryBatch(catName);
            } catch (catErr) {
                console.warn(`Category enhancement error in "${catName}":`, catErr);
            }
        }

        // === Phase 2: AI Dynamic Risk Assessment across all categories ===
        for (let i = 0; i < totalCategories; i++) {
            if (isPipelineCancelled) return false;
            const catName = categoryNames[i];
            const pct = 45 + Math.round((i / totalCategories) * 40);
            updateAIPipelineProgress(
                'Phase 2 of 3: AI Dynamic Risk Assessment',
                pct,
                `Evaluating Risk (${i + 1}/${totalCategories}): "${catName}"...`
            );
            try {
                await analyzeCategoryDynamicRisksBatch(catName);
            } catch (riskErr) {
                console.warn(`Category risk evaluation error in "${catName}":`, riskErr);
            }
        }

        // === Phase 3: AI Executive Summary ===
        if (isPipelineCancelled) return false;
        updateAIPipelineProgress(
            'Phase 3 of 3: AI Executive Summary',
            90,
            'Synthesizing full compliance audit findings & executive roadmap...'
        );

        try {
            await triggerAISummaryGeneration();
        } catch (sumErr) {
            console.error("AI Summary generation error in pipeline:", sumErr);
        }

        updateAIPipelineProgress('Complete', 100, 'Audit synthesis complete!');

        saveState.flush();
        await saveStateNow();
        updateCalculations();
        renderCategoryNavigation();
        renderActiveCategoryIndicators();

        await new Promise(r => setTimeout(r, 400));
        closeAIPipelineModal();

        // Automatically open AI Executive Summary modal in Preview tab
        openAISummaryModal();
        setAIActiveTab('preview');
        showToast("Full AI Analysis & Executive Summary complete!", "success");
        return true;
    } catch (err) {
        console.error("Error in full audit AI pipeline:", err);
        showToast(`AI Pipeline Error: ${err.message}`, "error");
        closeAIPipelineModal();
        return false;
    }
}


