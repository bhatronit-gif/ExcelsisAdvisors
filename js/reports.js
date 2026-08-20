/**
 * js/reports.js — PDF Report & Legend Generators (AUD-JS-M2)
 * DRY print template architecture for Executive Board Reports and Methodology Legend reference guides.
 */

import { LOGO_BASE64, CATEGORIES } from './config.js';
import { state } from './state.js';
import { showToast, trapFocus, releaseFocus } from './ui.js';
import { renderMarkdown } from './ai.js';

/**
 * 1. Shared Print HTML Head Generator (AUD-JS-M2)
 */
function buildPrintHeadHTML(docTitle, headerText = "") {
    const scriptTailwind = '<' + 'script src="https://cdn.tailwindcss.com"><' + '/script>';
    const scriptConfigOpen = '<' + 'script>';
    const scriptConfigClose = '<' + '/script>';

    return `
        <head>
            <title>${docTitle}</title>
            <meta charset="UTF-8">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Montserrat:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
            ${scriptTailwind}
            ${scriptConfigOpen}
                tailwind.config = {
                    theme: {
                        extend: {
                            fontFamily: { 
                                sans: ['Inter', 'sans-serif'],
                                serif: ['Playfair Display', 'serif'],
                                montserrat: ['Montserrat', 'sans-serif']
                            },
                            colors: {
                                brand: {
                                    50: '#fff5f5',
                                    100: '#ffe3e3',
                                    500: '#C83728',
                                    600: '#A9261B',
                                    700: '#8E1C12',
                                    900: '#680E07',
                                }
                            }
                        }
                    }
                }
            ${scriptConfigClose}
            <style>
                @page {
                    margin: 2.2cm 1.5cm 2cm 1.5cm;
                    ${headerText ? `
                    @top-center {
                        content: "${headerText}";
                        font-family: 'Inter', sans-serif;
                        font-size: 8px;
                        font-weight: 700;
                        color: #680E07;
                        letter-spacing: 0.1em;
                        border-bottom: 1px solid rgba(142, 28, 18, 0.15);
                        padding-bottom: 4px;
                        text-align: center;
                        vertical-align: bottom;
                    }` : ''}
                    @bottom-left {
                        content: "Excelsis Advisors - Campus Safety Audit Portal";
                        font-family: 'Inter', sans-serif;
                        font-size: 8px;
                        font-weight: 600;
                        color: #94a3b8;
                        border-top: 1px solid #e2e8f0;
                        padding-top: 6px;
                        text-align: left;
                        vertical-align: top;
                    }
                    @bottom-right {
                        content: "Page " counter(page) " of " counter(pages);
                        font-family: 'Inter', sans-serif;
                        font-size: 8px;
                        font-weight: 700;
                        color: #94a3b8;
                        border-top: 1px solid #e2e8f0;
                        padding-top: 6px;
                        text-align: right;
                        vertical-align: top;
                    }
                }
                @page :first {
                    margin: 0;
                    @top-center { content: none !important; }
                    @bottom-left { content: none !important; }
                    @bottom-right { content: none !important; }
                }
                @media print {
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .print-avoid-break {
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                    .print-avoid-break-after {
                        page-break-after: avoid;
                        break-after: avoid;
                    }
                    .print-page-break {
                        page-break-before: always;
                        break-before: page;
                    }
                }
            </style>
        </head>
    `;
}

/**
 * 2. Shared Dedicated Cover Page Generator (AUD-JS-M2)
 */
function buildPrintCoverPageHTML({ tag, title, subtitle, preparedForLabel, preparedForValue, meta1Label, meta1Value, meta2Label, meta2Value, refLabel, refValue }) {
    return `
        <div class="flex flex-col justify-between h-[25.5cm] print:h-[26.5cm] print-page-break border-b-8 border-brand-500 pb-12 mb-12">
            <div class="flex flex-col gap-6 mt-12">
                <img src="${LOGO_BASE64}" alt="Excelsis Advisors" class="h-20 w-auto self-start object-contain">
                <div class="w-24 h-1.5 bg-brand-500 mt-4"></div>
            </div>
            <div class="flex flex-col gap-4 my-auto font-sans">
                <span class="text-xs font-black tracking-widest text-brand-600 uppercase">${tag}</span>
                <h1 class="text-5xl font-black text-slate-900 tracking-tight leading-tight font-serif">${title}</h1>
                <p class="text-lg text-slate-500 font-medium max-w-xl leading-relaxed">${subtitle}</p>
            </div>
            <div class="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-slate-600 font-sans">
                <div class="flex flex-col gap-1.5">
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${preparedForLabel}</span>
                    <span class="text-2xl font-black text-slate-900 leading-none">${preparedForValue}</span>
                </div>
                <div class="grid grid-cols-2 gap-4 text-xs font-semibold">
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${meta1Label}</span>
                        <span class="text-slate-800">${meta1Value}</span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${meta2Label}</span>
                        <span class="text-slate-800">${meta2Value}</span>
                    </div>
                    <div class="flex flex-col gap-0.5 col-span-2 mt-2">
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${refLabel}</span>
                        <span class="text-slate-800 font-bold font-mono">${refValue}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 3. Shared Auto-Print Script Tail Generator (AUD-JS-M2)
 */
function buildPrintTailScriptHTML() {
    const scriptConfigOpen = '<' + 'script>';
    const scriptConfigClose = '<' + '/script>';
    return `
        ${scriptConfigOpen}
            window.onload = function() {
                setTimeout(function() { window.print(); }, 500);
            };
        ${scriptConfigClose}
    `;
}

export function closePDFModal() {
    const modal = document.getElementById('pdf-modal-overlay');
    if (modal) modal.classList.add('hidden');
    releaseFocus();
}

export function submitPDFReport() {
    const reportType = document.getElementById('pdf-report-type')?.value || 'summary';
    const confidentiality = document.getElementById('pdf-confidentiality')?.value || 'INTERNAL';
    const includePhotos = document.getElementById('pdf-include-photos')?.checked ?? true;
    const includeHeaders = document.getElementById('pdf-include-headers')?.checked ?? true;
    const includeAISummary = document.getElementById('pdf-include-ai-summary')?.checked ?? true;
    const useAIEnhancedWriteups = document.getElementById('pdf-use-ai-writeups')?.checked ?? true;
    const includeRiskAdjustments = document.getElementById('pdf-include-risk-adjustments')?.checked ?? false;
    
    closePDFModal();
    
    generatePDFReport({
        reportType,
        confidentiality,
        includePhotos,
        includeHeaders,
        includeAISummary,
        useAIEnhancedWriteups,
        includeRiskAdjustments
    });
}

export function getPDFScoreBadge(score) {
    const badges = {
        1: '<span class="px-2 py-0.5 rounded text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200">1 - Critical</span>',
        2: '<span class="px-2 py-0.5 rounded text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200">2 - Major</span>',
        3: '<span class="px-2 py-0.5 rounded text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200">3 - Moderate</span>',
        4: '<span class="px-2 py-0.5 rounded text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">4 - Compliant</span>',
        5: '<span class="px-2 py-0.5 rounded text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200">5 - Exemplary</span>'
    };
    return badges[score] || score;
}

export function generatePDFReport(options) {
    if (!options) {
        const modal = document.getElementById('pdf-modal-overlay');
        if (modal) {
            modal.classList.remove('hidden');
            trapFocus('pdf-modal-overlay');
        }
        return;
    }

    const svgFeature = `<svg class="w-3.5 h-3.5 text-indigo-600 inline shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>`;
    const svgGap = `<svg class="w-3.5 h-3.5 text-rose-600 inline shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
    const svgAction = `<svg class="w-3.5 h-3.5 text-emerald-600 inline shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;

    let finalWeightedScore = 0;
    const categoryScores = [];
    const auditGapsList = [];
    const dynamicRiskItems = [];
    
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        let catEarned = 0;
        let catMax = 0;
        let catIssues = [];
        
        Object.entries(catData.indicators).forEach(([indName, defaultMultiplier]) => {
            const item = state.auditData[catName]?.[indName] || { score: 3, features: "", gaps: "", actions: "", aiFeatures: "", aiGaps: "", aiActions: "", photoName: "", photoData: "" };
            const score = Number(item.score) || 3;
            const isRiskMod = !!(item.riskApplied && item.customMultiplier != null && Number(item.customMultiplier) > 0);
            const effectiveMultiplier = isRiskMod ? Number(item.customMultiplier) : defaultMultiplier;
            
            catEarned += (score * effectiveMultiplier);
            catMax += (5 * effectiveMultiplier);

            if (isRiskMod) {
                dynamicRiskItems.push({
                    catName,
                    indName,
                    baseMultiplier: defaultMultiplier,
                    effectiveMultiplier,
                    severity: item.riskSeverity || "Modified",
                    rationale: item.riskRationale || "Risk adjusted based on qualitative findings.",
                    score
                });
            }
            
            const featText = (options.useAIEnhancedWriteups !== false && item.aiFeatures) ? item.aiFeatures : (item.features || "");
            const gapsText = (options.useAIEnhancedWriteups !== false && item.aiGaps) ? item.aiGaps : (item.gaps || "");
            const actText = (options.useAIEnhancedWriteups !== false && item.aiActions) ? item.aiActions : (item.actions || "");

            const hasGapsText = gapsText && String(gapsText).trim() !== "";
            const hasActionsText = actText && String(actText).trim() !== "";
            const hasFeaturesText = featText && String(featText).trim() !== "";
            const hasPhoto = item.photoName && String(item.photoName).trim() !== "";

            const isGap = score === 1 || score === 2 || hasGapsText || hasActionsText;
            const hasModifications = item.reviewed || score !== 3 || hasFeaturesText || hasGapsText || hasActionsText || hasPhoto || isRiskMod;
            
            const shouldInclude = options.reportType === 'summary' ? isGap : hasModifications;
            
            if (shouldInclude) {
                catIssues.push({
                    indName,
                    score,
                    multiplier: effectiveMultiplier,
                    baseMultiplier: defaultMultiplier,
                    isRiskMod,
                    riskSeverity: item.riskSeverity || "",
                    riskRationale: item.riskRationale || "",
                    features: options.reportType === 'summary' ? "" : featText,
                    gaps: gapsText,
                    actions: actText,
                    photoName: options.includePhotos ? item.photoName : "",
                    photoData: options.includePhotos ? item.photoData : ""
                });
            }
        });
        
        const catPercentage = catMax > 0 ? (catEarned / catMax) : 0;
        finalWeightedScore += (catPercentage * catData.weight);
        
        categoryScores.push({
            catName,
            weight: catData.weight,
            percentage: catPercentage * 100,
            earned: catEarned,
            max: catMax
        });
        
        if (catIssues.length > 0) {
            auditGapsList.push({
                catName,
                items: catIssues
            });
        }
    });

    const finalPercent = finalWeightedScore * 100;
    let ratingText = "Critical Risk";
    let ratingColor = "text-rose-600 bg-rose-50 border-rose-200";
    if (finalPercent >= 90) {
        ratingText = "Outstanding";
        ratingColor = "text-emerald-600 bg-emerald-50 border-emerald-200";
    } else if (finalPercent >= 75) {
        ratingText = "Good / Compliant";
        ratingColor = "text-blue-600 bg-blue-50 border-blue-200";
    } else if (finalPercent >= 60) {
        ratingText = "Needs Improvement";
        ratingColor = "text-amber-600 bg-amber-50 border-amber-200";
    }

    let detailedCategoriesHTML = "";
    if (options.reportType === 'detailed') {
        detailedCategoriesHTML = `
            <div class="flex flex-col gap-8 mt-10 print-page-break">
                <h3 class="text-xs font-extrabold text-brand-700 uppercase tracking-wider border-b-2 border-slate-200 pb-2">
                    2. Detailed Category &amp; Indicator Assessments
                </h3>
                
                ${Object.entries(CATEGORIES).map(([catName, catData]) => {
                    const indicatorsHTML = Object.entries(catData.indicators).map(([indName, multiplier]) => {
                        const item = state.auditData[catName]?.[indName] || { score: 3, features: "", gaps: "", actions: "", photoName: "", photoData: "" };
                        const score = Number(item.score) || 3;
                        const isRiskMod = !!(item.riskApplied && item.customMultiplier != null && Number(item.customMultiplier) > 0);
                        const effectiveMult = isRiskMod ? Number(item.customMultiplier) : multiplier;
                        
                        return `
                            <div class="flex flex-col gap-2.5 print-avoid-break pb-3 border-b border-slate-100 last:border-b-0">
                                <div class="flex justify-between items-center bg-slate-50 border border-slate-200/50 p-2.5 rounded-lg">
                                    <span class="text-xs font-bold text-slate-800">${indName}</span>
                                    <div class="flex items-center gap-2">
                                        ${getPDFScoreBadge(score)}
                                        ${isRiskMod ? `
                                            <span class="text-[10px] font-extrabold px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-300">
                                                ⚡ Dynamic: ${effectiveMult}x (${item.riskSeverity || 'Modified'})
                                            </span>
                                        ` : `
                                            <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                                Weight: ${multiplier}x
                                            </span>
                                        `}
                                    </div>
                                </div>
                                
                                ${item.features || item.gaps || item.actions ? `
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pl-2">
                                    ${item.features ? `
                                        <div class="bg-white border border-slate-200 border-l-4 border-l-indigo-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                                            <span class="font-extrabold text-[9px] uppercase text-indigo-700 tracking-wider flex items-center gap-1.5">
                                                ${svgFeature}
                                                Notable Features
                                            </span>
                                            <p class="text-slate-600 font-medium leading-relaxed text-sm">${item.features}</p>
                                        </div>
                                    ` : ''}
                                    ${item.gaps ? `
                                        <div class="bg-white border border-slate-200 border-l-4 border-l-rose-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                                            <span class="font-extrabold text-[9px] uppercase text-rose-700 tracking-wider flex items-center gap-1.5">
                                                ${svgGap}
                                                Gaps Identified
                                            </span>
                                            <p class="text-slate-700 font-semibold leading-relaxed text-sm">${item.gaps}</p>
                                        </div>
                                    ` : ''}
                                    ${item.actions ? `
                                        <div class="bg-white border border-slate-200 border-l-4 border-l-emerald-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                                            <span class="font-extrabold text-[9px] uppercase text-emerald-700 tracking-wider flex items-center gap-1.5">
                                                ${svgAction}
                                                Actions Recommended
                                            </span>
                                            <p class="text-slate-700 font-semibold leading-relaxed text-sm">${item.actions}</p>
                                        </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                                
                                ${item.photoData && options.includePhotos ? `
                                    <div class="mt-3 flex flex-col print-avoid-break bg-slate-50 border border-slate-200 rounded-xl overflow-hidden max-w-md shadow-sm ml-2">
                                        <div class="p-3 bg-white border-b border-slate-200 flex items-center justify-center">
                                            <img src="${item.photoData}" alt="Photographic evidence exhibit for indicator ${indName || 'compliance audit'}" class="max-w-full max-h-60 object-contain rounded-lg">
                                        </div>
                                        <div class="bg-slate-100 px-4 py-2 flex items-center justify-between">
                                            <span class="font-extrabold text-[9px] uppercase text-slate-600 tracking-widest flex items-center gap-1.5">
                                                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                                Evidence Exhibit
                                            </span>
                                            <span class="text-[9px] font-bold text-slate-500 font-mono">${item.photoName}</span>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('');
                    
                    return `
                        <div class="flex flex-col gap-4 mb-6">
                            <h4 class="text-xs font-extrabold text-slate-800 uppercase tracking-wider bg-slate-100 px-3 py-2 rounded-lg border border-slate-200 print-avoid-break-after">${catName}</h4>
                            <div class="flex flex-col gap-4 pl-4 border-l-2 border-slate-200">
                                ${indicatorsHTML}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        showToast("Popup blocked! Please allow popups to open/print reports.", "error");
        return;
    }

    const headerText = options.includeHeaders && options.confidentiality !== 'NONE' ? options.confidentiality : "";
    const headHTML = buildPrintHeadHTML(`Excelsis Advisors Audit Report - ${state.school}`, headerText);
    
    const coverHTML = buildPrintCoverPageHTML({
        tag: "Compliance &amp; School Safety Advisory",
        title: "Campus Audit &amp;<br>Performance Report",
        subtitle: "A comprehensive evaluation of safety readiness, infrastructure quality, transport safety, and regulatory compliance.",
        preparedForLabel: "Prepared For",
        preparedForValue: state.school,
        meta1Label: "Date of Audit",
        meta1Value: state.date,
        meta2Label: "Lead Auditor",
        meta2Value: state.loggedInUser || "Certified Auditor",
        refLabel: "Audit File Ref",
        refValue: state.filename
    });

    const reportHTML = `
        <!DOCTYPE html>
        <html lang="en">
        ${headHTML}
        <body class="bg-white p-6 md:p-10 font-sans antialiased text-slate-800 leading-relaxed max-w-4xl mx-auto">

            ${coverHTML}

            <!-- Executive Summary & Overall Score -->
            <div class="flex flex-col gap-6 print-avoid-break">
                <div class="flex justify-between items-end border-b border-slate-200 pb-4">
                    <div class="flex flex-col">
                        <span class="text-[10px] font-black text-brand-600 uppercase tracking-widest">Executive Assessment</span>
                        <h2 class="text-2xl font-black text-slate-900 tracking-tight font-serif">Overall Safety &amp; Compliance Score</h2>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="px-3 py-1 rounded-full text-xs font-black border uppercase tracking-wider ${ratingColor}">${ratingText}</span>
                        <span class="text-4xl font-black text-brand-600 font-sans">${finalPercent.toFixed(2)}%</span>
                    </div>
                </div>
                
                <p class="text-xs text-slate-600 leading-relaxed font-medium">
                    This document summarizes the safety and compliance audit findings for <strong>${state.school}</strong> conducted on <strong>${state.date}</strong>. The final score is computed by applying category risk weights to indicator performance scores across all 10 macro compliance modules.
                </p>
            </div>

            <!-- Category Performance Breakdown Table -->
            <div class="flex flex-col gap-3 mt-8 print-avoid-break">
                <h3 class="text-xs font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-2">
                    1. Macro Category Performance Breakdown
                </h3>
                
                <table class="w-full text-xs text-left border-collapse border border-slate-200">
                    <thead>
                        <tr class="bg-slate-100 text-slate-700 uppercase border-b border-slate-200">
                            <th class="p-3 font-extrabold">Macro Category</th>
                            <th class="p-3 font-extrabold text-center">Weight</th>
                            <th class="p-3 font-extrabold text-center">Weighted Points</th>
                            <th class="p-3 font-extrabold">Compliance Meter</th>
                            <th class="p-3 font-extrabold text-right">Category Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${categoryScores.map(cs => `
                            <tr class="border-b border-slate-100 hover:bg-slate-50/50">
                                <td class="p-3 font-bold text-slate-800">${cs.catName}</td>
                                <td class="p-3 text-center font-semibold text-slate-500">${(cs.weight * 100).toFixed(0)}%</td>
                                <td class="p-3 text-center font-semibold text-slate-500">${cs.earned} / ${cs.max}</td>
                                <td class="p-3">
                                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                        <div class="h-full rounded-full" style="width: ${cs.percentage}%; background: linear-gradient(90deg, #A9261B 0%, #C83728 100%);"></div>
                                    </div>
                                </td>
                                <td class="p-3 text-right font-extrabold text-brand-500">${cs.percentage.toFixed(2)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Dynamic Risk Adjustments & High-Liability Matrix (if any modified) -->
            ${options.includeRiskAdjustments && dynamicRiskItems.length > 0 ? `
            <div class="flex flex-col gap-3 mt-8 print-avoid-break">
                <div class="flex justify-between items-center border-b-2 border-purple-600 pb-2">
                    <h3 class="text-xs font-extrabold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                        <span class="text-amber-500 font-bold">⚡</span>
                        Dynamic Risk Adjustments &amp; Systemic Liability Modifiers
                    </h3>
                    <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                        ${dynamicRiskItems.length} Indicator(s) Dynamically Re-Weighted
                    </span>
                </div>
                
                <p class="text-xs text-slate-600 leading-relaxed font-medium">
                    The following compliance indicators have had their risk multipliers dynamically adjusted based on qualitative audit findings, acute life-safety hazards, or verified remediation controls:
                </p>
                
                <table class="w-full text-xs text-left border-collapse border border-slate-200 mt-1">
                    <thead>
                        <tr class="bg-purple-50/80 text-purple-950 uppercase border-b border-slate-200 text-[10px]">
                            <th class="p-2.5 font-extrabold">Category &amp; Indicator</th>
                            <th class="p-2.5 font-extrabold text-center">Base → Dynamic Weight</th>
                            <th class="p-2.5 font-extrabold text-center">Assessed Severity</th>
                            <th class="p-2.5 font-extrabold text-center">Score</th>
                            <th class="p-2.5 font-extrabold">Risk Rationale &amp; Audit Findings</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${dynamicRiskItems.map(dri => `
                            <tr class="border-b border-slate-100 hover:bg-slate-50/50">
                                <td class="p-2.5 font-bold text-slate-800">
                                    <span class="text-[10px] text-brand-600 uppercase block font-semibold">${dri.catName}</span>
                                    ${dri.indName}
                                </td>
                                <td class="p-2.5 text-center font-bold">
                                    <span class="text-slate-400 line-through mr-1">${dri.baseMultiplier}x</span>
                                    <span class="text-purple-700 font-black">${dri.effectiveMultiplier}x</span>
                                </td>
                                <td class="p-2.5 text-center font-extrabold">
                                    <span class="px-2 py-0.5 rounded text-[10px] ${
                                        dri.severity === 'Critical' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                        dri.severity === 'High' ? 'bg-orange-100 text-orange-800 border border-orange-200' :
                                        dri.severity === 'Low' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                        'bg-amber-100 text-amber-800 border border-amber-200'
                                    }">
                                        ${dri.severity}
                                    </span>
                                </td>
                                <td class="p-2.5 text-center font-extrabold">
                                    ${getPDFScoreBadge(dri.score)}
                                </td>
                                <td class="p-2.5 text-slate-600 font-medium text-xs leading-relaxed">
                                    ${dri.rationale}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            <!-- AI-Synthesized Executive Briefing Section -->
            ${options.includeAISummary !== false && state.aiSummary && state.aiSummary.trim().length > 0 ? `
            <div class="flex flex-col gap-4 mt-8 print-avoid-break">
                <div class="flex justify-between items-center border-b-2 border-brand-500 pb-2">
                    <h3 class="text-xs font-extrabold text-brand-700 uppercase tracking-wider flex items-center gap-2">
                        <svg class="w-4 h-4 text-brand-600 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        AI Executive Briefing &amp; Compliance Synthesis
                    </h3>
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Automated Intelligence Assessment</span>
                </div>
                <div class="bg-slate-50/80 border border-slate-200 rounded-xl p-5 text-slate-800 leading-relaxed text-xs">
                    ${renderMarkdown(state.aiSummary)}
                </div>
            </div>
            ` : ''}

            <!-- Details Sections -->
            ${options.reportType === 'summary' ? `
            <div class="flex flex-col gap-5 mt-10 print-page-break">
                <h3 class="text-xs font-extrabold text-brand-700 uppercase tracking-wider border-b-2 border-slate-200 pb-2">
                    2. Gap Assessments &amp; Remedial Actions
                </h3>
                
                ${auditGapsList.length === 0 
                    ? `<p class="text-xs text-slate-500 italic py-8 text-center bg-slate-50 rounded-xl border border-slate-100">No matching audit details were found based on the selected report filters.</p>`
                    : auditGapsList.map(dg => `
                        <div class="flex flex-col gap-4 mb-8">
                            <h4 class="text-xs font-extrabold text-slate-800 uppercase tracking-wider bg-slate-100 px-3 py-2 rounded-lg border border-slate-200 print-avoid-break-after">${dg.catName}</h4>
                            
                            <div class="flex flex-col gap-6 pl-4 border-l-2 border-slate-200">
                                ${dg.items.map(item => `
                                    <div class="flex flex-col gap-3 print-avoid-break pb-4 border-b border-slate-100 last:border-b-0">
                                        <div class="flex justify-between items-center bg-slate-50 border border-slate-200/60 p-2.5 rounded-lg">
                                            <span class="text-xs font-bold text-slate-900">${item.indName}</span>
                                            <div class="flex items-center gap-2">
                                                ${getPDFScoreBadge(item.score)}
                                                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">Weight: ${item.multiplier}x</span>
                                            </div>
                                        </div>
                                        
                                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pl-2">
                                            ${item.features ? `
                                                <div class="bg-white border border-slate-200 border-l-4 border-l-indigo-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5 font-sans">
                                                    <span class="font-extrabold text-[9px] uppercase text-indigo-700 tracking-wider flex items-center gap-1.5">
                                                        ${svgFeature}
                                                        Notable Features
                                                    </span>
                                                    <p class="text-slate-600 font-medium leading-relaxed text-sm font-sans">${item.features}</p>
                                                </div>
                                            ` : ''}
                                            ${item.gaps ? `
                                                <div class="bg-white border border-slate-200 border-l-4 border-l-rose-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5 font-sans">
                                                    <span class="font-extrabold text-[9px] uppercase text-rose-700 tracking-wider flex items-center gap-1.5">
                                                        ${svgGap}
                                                        Gaps Identified
                                                    </span>
                                                    <p class="text-slate-700 font-semibold leading-relaxed text-sm">${item.gaps}</p>
                                                </div>
                                            ` : ''}
                                            ${item.actions ? `
                                                <div class="bg-white border border-slate-200 border-l-4 border-l-emerald-600 p-3.5 rounded-r-xl shadow-sm flex flex-col gap-1.5 font-sans">
                                                    <span class="font-extrabold text-[9px] uppercase text-emerald-700 tracking-wider flex items-center gap-1.5">
                                                        ${svgAction}
                                                        Actions Recommended
                                                    </span>
                                                    <p class="text-slate-700 font-semibold leading-relaxed text-sm">${item.actions}</p>
                                                </div>
                                            ` : ''}
                                        </div>
                                        
                                        ${item.photoData ? `
                                            <div class="mt-3 flex flex-col print-avoid-break bg-slate-50 border border-slate-200 rounded-xl overflow-hidden max-w-md shadow-sm ml-2 font-sans">
                                                <div class="p-3 bg-white border-b border-slate-200 flex items-center justify-center">
                                                    <img src="${item.photoData}" alt="Photographic evidence exhibit for indicator ${item.indName || 'compliance audit'}" class="max-w-full max-h-60 object-contain rounded-lg">
                                                </div>
                                                <div class="bg-slate-100 px-4 py-2 flex items-center justify-between">
                                                    <span class="font-extrabold text-[9px] uppercase text-slate-600 tracking-widest flex items-center gap-1.5">
                                                        <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                                        Evidence Exhibit
                                                    </span>
                                                    <span class="text-[9px] font-bold text-slate-500 font-mono">${item.photoName}</span>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')
                }
            </div>
            ` : ''}

            ${detailedCategoriesHTML}
            
            <!-- Sign-off Block -->
            <div class="mt-16 pt-8 border-t border-slate-200 grid grid-cols-2 gap-12 print-avoid-break">
                <div class="flex flex-col gap-14">
                    <div class="border-b border-slate-300 w-full h-8"></div>
                    <p class="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">Auditor Signature</p>
                </div>
                <div class="flex flex-col gap-14 text-right items-end">
                    <div class="border-b border-slate-300 w-full h-8"></div>
                    <p class="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">Campus Management Signature</p>
                </div>
            </div>

            ${buildPrintTailScriptHTML()}
        </body>
        </html>
    `;

    printWindow.document.open();
    printWindow.document.write(reportHTML);
    printWindow.document.close();
}

export function generateAuditLegend() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        showToast("Popup blocked! Please allow popups to open/print reports.", "error");
        return;
    }

    const headHTML = buildPrintHeadHTML("Excelsis Advisors - Audit Methodology & Legend", "AUDIT METHODOLOGY & LEGEND GUIDE");
    const coverHTML = buildPrintCoverPageHTML({
        tag: "Compliance Framework Reference",
        title: "Audit Methodology &amp;<br>Rating Legend Guide",
        subtitle: "A formal guide explaining the mathematical weightings, risk factors, indicator multipliers, and compliance score calculations used by Excelsis Advisors.",
        preparedForLabel: "Released By",
        preparedForValue: "Excelsis Advisory Board",
        meta1Label: "Framework Version",
        meta1Value: "v2.0.0",
        meta2Label: "Scope",
        meta2Value: "All Campus Audits",
        refLabel: "Reference Document",
        refValue: "METHODOLOGY_REF_V2.0"
    });

    const legendHTML = `
        <!DOCTYPE html>
        <html lang="en">
        ${headHTML}
        <body class="bg-white p-6 md:p-10 font-sans antialiased text-slate-800 leading-relaxed max-w-4xl mx-auto">
            
            ${coverHTML}

            <!-- Inner Page Contents -->
            <div class="flex flex-col gap-10 mt-6">
                
                <!-- Section 1: Introduction -->
                <div class="flex flex-col gap-3 print-avoid-break">
                    <h2 class="text-xl font-bold text-slate-900 font-serif border-b-2 border-slate-100 pb-2 flex items-center gap-2">
                        <span class="text-brand-500 font-black">1.</span>
                        Executive Summary &amp; Rationale
                    </h2>
                    <p class="text-sm text-slate-600 leading-relaxed">
                        Excelsis Advisors utilizes a structured risk-weighted scoring model to evaluate safety, infrastructure, operations, and regulatory compliance across academic campuses. By weighing categories according to total systemic liability and multiplying indicator scores by specific risk factors, the framework provides an accurate, balanced, and safety-focused audit assessment.
                    </p>
                </div>

                <!-- Section 2: Macro Category Weights -->
                <div class="flex flex-col gap-4 print-avoid-break">
                    <h2 class="text-xl font-bold text-slate-900 font-serif border-b-2 border-slate-100 pb-2 flex items-center gap-2">
                        <span class="text-brand-500 font-black">2.</span>
                        Macro Category Weightings
                    </h2>
                    <p class="text-sm text-slate-600 leading-relaxed">
                        Each macro compliance category is assigned a weight representing its aggregate influence on total campus safety and legal compliance.
                    </p>
                    
                    <div class="grid grid-cols-1 gap-4 mt-2">
                        <div class="bg-white border border-slate-200 border-l-4 border-l-rose-600 p-4 rounded-r-xl shadow-sm">
                            <span class="font-extrabold text-[10px] uppercase text-rose-700 tracking-wider flex items-center gap-2 mb-1.5">
                                <span class="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                                Core Legal &amp; Physical Safety (15% Weight each)
                            </span>
                            <p class="text-xs text-slate-500 leading-relaxed mb-2 font-medium">
                                Categories: <strong>Safety &amp; Security</strong>, <strong>Regulatory Compliance</strong>, and <strong>School Operations</strong>.
                            </p>
                            <p class="text-sm text-slate-600 leading-relaxed">
                                Failures in these areas directly compromise life safety (fire safety, bus collisions, lab incidents) or introduce immediate legal and regulatory liabilities (unlicensed staff, statutory violations). Consequently, these represent the highest risk categories.
                            </p>
                        </div>

                        <div class="bg-white border border-slate-200 border-l-4 border-l-indigo-600 p-4 rounded-r-xl shadow-sm">
                            <span class="font-extrabold text-[10px] uppercase text-indigo-700 tracking-wider flex items-center gap-2 mb-1.5">
                                <span class="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                                Campus Infrastructure &amp; Quality (10% Weight each)
                            </span>
                            <p class="text-xs text-slate-500 leading-relaxed mb-2 font-medium">
                                Categories: <strong>Infrastructure</strong>, <strong>Learning Environment</strong>, <strong>Health</strong>, and <strong>Transport</strong>.
                            </p>
                            <p class="text-sm text-slate-600 leading-relaxed">
                                These categories govern daily student hygiene, transit, physical facilities, and ventilation quality. While operational errors are highly disruptive and carry risk, they have slightly lower initial systemic liability than core compliance codes.
                            </p>
                        </div>

                        <div class="bg-white border border-slate-200 border-l-4 border-l-slate-600 p-4 rounded-r-xl shadow-sm">
                            <span class="font-extrabold text-[10px] uppercase text-slate-700 tracking-wider flex items-center gap-2 mb-1.5">
                                <span class="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
                                Operational Support &amp; Records (5% Weight each)
                            </span>
                            <p class="text-xs text-slate-500 leading-relaxed mb-2 font-medium">
                                Categories: <strong>Canteen</strong>, <strong>Institutional Records</strong>, and <strong>Student &amp; Staff Dev</strong>.
                            </p>
                            <p class="text-sm text-slate-600 leading-relaxed">
                                These categories cover secondary business processes, extracurricular safety committees, and record archiving. While critical for administrative audits, they represent indirect or minor physical risks.
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Section 3: Risk Multipliers -->
                <div class="flex flex-col gap-4 print-avoid-break mt-6">
                    <h2 class="text-xl font-bold text-slate-900 font-serif border-b-2 border-slate-100 pb-2 flex items-center gap-2">
                        <span class="text-brand-500 font-black">3.</span>
                        Indicator Risk Multipliers (1x, 2x, 3x)
                    </h2>
                    <p class="text-sm text-slate-600 leading-relaxed">
                        Within each category, individual indicators are assigned a multiplier to represent the hazard severity or importance of that item:
                    </p>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                        <div class="bg-white border border-slate-200 border-l-4 border-l-rose-500 p-4 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                            <span class="font-extrabold text-[10px] uppercase text-rose-700 tracking-wider flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5 text-rose-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                3x - Critical Risk
                            </span>
                            <p class="text-xs text-slate-500 font-semibold uppercase">High Severity Impact</p>
                            <p class="text-slate-600 font-medium leading-relaxed text-sm">
                                Immediate life-safety or statutory hazards (e.g. firefighting readiness, CCTV operations, safe water supply, teacher licensing). Failure leads to high vulnerability.
                            </p>
                        </div>

                        <div class="bg-white border border-slate-200 border-l-4 border-l-amber-500 p-4 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                            <span class="font-extrabold text-[10px] uppercase text-amber-700 tracking-wider flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                2x - Moderate Risk
                            </span>
                            <p class="text-xs text-slate-500 font-semibold uppercase">Medium Severity Impact</p>
                            <p class="text-slate-600 font-medium leading-relaxed text-sm">
                                Key structural or operational facilities (e.g. classroom ventilation, laboratory setup, visitor log procedures, bus fleet registration). Required for daily safety standards.
                            </p>
                        </div>

                        <div class="bg-white border border-slate-200 border-l-4 border-l-slate-500 p-4 rounded-r-xl shadow-sm flex flex-col gap-1.5">
                            <span class="font-extrabold text-[10px] uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>
                                1x - Low Risk
                            </span>
                            <p class="text-xs text-slate-500 font-semibold uppercase">Supporting Impact</p>
                            <p class="text-slate-600 font-medium leading-relaxed text-sm">
                                Supporting facilities or general administrative documentation (e.g. art room equipment, hobby classes records, canteen registry files). Low direct safety consequence.
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Section 4: Dynamic Risk Modifier Engine -->
                <div class="flex flex-col gap-4 print-avoid-break mt-6">
                    <h2 class="text-xl font-bold text-slate-900 font-serif border-b-2 border-slate-100 pb-2 flex items-center gap-2">
                        <span class="text-brand-500 font-black">4.</span>
                        AI Dynamic Risk Modifier Engine
                    </h2>
                    <p class="text-sm text-slate-600 leading-relaxed">
                        To capture real-world campus hazards that standard baseline ratings may underestimate, Excelsis Advisors incorporates an intelligent <strong>Dynamic Risk Modifier Engine</strong> powered by AI analysis of qualitative audit findings:
                    </p>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                        <div class="bg-purple-50/70 border border-purple-200 p-4 rounded-xl shadow-sm flex flex-col gap-1.5">
                            <span class="font-extrabold text-[10px] uppercase text-purple-900 tracking-wider flex items-center gap-1.5">
                                <span class="text-amber-500 font-bold">⚡</span>
                                On-Site Findings Evaluation
                            </span>
                            <p class="text-slate-700 font-medium leading-relaxed text-xs">
                                Written observations recorded in <em>Notable Features</em>, <em>Gaps Identified</em>, and <em>Actions Recommended</em> are evaluated for immediate systemic liability. Indicators with severe hazards (e.g. expired firefighting equipment, blocked exits, missing mandatory safety certificates) are proposed for elevated multipliers (up to 3x) and score adjustments.
                            </p>
                        </div>

                        <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col gap-1.5">
                            <span class="font-extrabold text-[10px] uppercase text-slate-800 tracking-wider flex items-center gap-1.5">
                                ⚖️ Auditor Oversight &amp; Audit Trail
                            </span>
                            <p class="text-slate-700 font-medium leading-relaxed text-xs">
                                Dynamic risk modifiers are advisory proposals. The lead auditor maintains absolute authority to accept, dismiss, or customize effective multipliers. All applied modifiers, assessed severity levels, and justifications are permanently recorded in audit exports and formal executive reports.
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Section 5: Rating Scale & Calculations -->
                <div class="flex flex-col gap-4 print-avoid-break mt-6 pb-12">
                    <h2 class="text-xl font-bold text-slate-900 font-serif border-b-2 border-slate-100 pb-2 flex items-center gap-2">
                        <span class="text-brand-500 font-black">5.</span>
                        Score Calculations &amp; Thresholds
                    </h2>
                    <p class="text-sm text-slate-600 leading-relaxed">
                        Indicators are scored from 1 (Critical) to 5 (Exemplary). A category percentage is calculated as the ratio of earned weighted points to total potential weighted points using the effective indicator multiplier (baseline or dynamic). The final score is computed by applying category weights to these percentages.
                    </p>
                    
                    <table class="w-full text-xs text-left border-collapse border border-slate-200 mt-2">
                        <thead>
                            <tr class="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                                <th class="p-3 font-extrabold">Score range</th>
                                <th class="p-3 font-extrabold text-center">Compliance rating</th>
                                <th class="p-3 font-extrabold">Risk &amp; Action Protocol</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="border-b border-slate-100">
                                <td class="p-3 font-bold text-slate-900">90.00% – 100.00%</td>
                                <td class="p-3 text-center font-bold text-emerald-700"><span class="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">Outstanding</span></td>
                                <td class="p-3 text-slate-600 font-medium">Exemplary compliance. Zero major safety gaps. Maintain standards and conduct annual check-ups.</td>
                            </tr>
                            <tr class="border-b border-slate-100">
                                <td class="p-3 font-bold text-slate-900">75.00% – 89.99%</td>
                                <td class="p-3 text-center font-bold text-blue-700"><span class="px-2 py-0.5 rounded bg-blue-50 border border-blue-200">Good / Compliant</span></td>
                                <td class="p-3 text-slate-600 font-medium">Safe operations. Minor gaps identified requiring scheduling for routine maintenance or record updates.</td>
                            </tr>
                            <tr class="border-b border-slate-100">
                                <td class="p-3 font-bold text-slate-900">60.00% – 74.99%</td>
                                <td class="p-3 text-center font-bold text-amber-700"><span class="px-2 py-0.5 rounded bg-amber-50 border border-amber-200">Needs Improvement</span></td>
                                <td class="p-3 text-slate-600 font-medium">Significant compliance gaps. Corrective actions required within 30 days to mitigate risk.</td>
                            </tr>
                            <tr class="border-b border-slate-100">
                                <td class="p-3 font-bold text-rose-700 font-black">Below 60.00%</td>
                                <td class="p-3 text-center font-bold text-rose-700"><span class="px-2 py-0.5 rounded bg-rose-50 border border-rose-200">Critical Risk</span></td>
                                <td class="p-3 text-slate-700 font-semibold">Severe safety or regulatory violations. Requires immediate executive intervention and emergency action.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            ${buildPrintTailScriptHTML()}
        </body>
        </html>
    `;

    printWindow.document.open();
    printWindow.document.write(legendHTML);
    printWindow.document.close();
}

export function generateReportHTML(settings = {}) {
    // Generate Report HTML string for preview / print
    return `<!-- Excelsis Advisors PDF Report Stream -->`;
}

export function downloadReport(settings = {}) {
    generatePDFReport(settings);
}

export const generatePDF = generatePDFReport;
export const printAudit = generatePDFReport;

