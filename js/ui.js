/**
 * js/ui.js — UI Renderers, Accessibility & Event Handlers
 * Theme toggling, toasts, focus trap, DOM visibility search filtering (AUD-JS-M1), and card interaction handlers.
 */

import { CATEGORIES, RISK_SEVERITY_LEVELS } from './config.js';
import { state, saveState, updateCalculations, getEffectiveMultiplier } from './state.js';

// --- Focus Trap State ---
let activeModalFocusTrap = null;
let lastFocusedElementBeforeModal = null;

export function setupTheme() {
    const isDark = localStorage.getItem('theme') === 'dark' || 
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    const sunIcon = document.getElementById('theme-sun');
    const moonIcon = document.getElementById('theme-moon');

    if (isDark) {
        document.documentElement.classList.add('dark');
        if (sunIcon) sunIcon.classList.remove('hidden');
        if (moonIcon) moonIcon.classList.add('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        if (sunIcon) sunIcon.classList.add('hidden');
        if (moonIcon) moonIcon.classList.remove('hidden');
    }
}

export function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    const sunIcon = document.getElementById('theme-sun');
    const moonIcon = document.getElementById('theme-moon');

    if (isDark) {
        if (sunIcon) sunIcon.classList.remove('hidden');
        if (moonIcon) moonIcon.classList.add('hidden');
    } else {
        if (sunIcon) sunIcon.classList.add('hidden');
        if (moonIcon) moonIcon.classList.remove('hidden');
    }
}

export function toggleMobileDrawer() {
    const drawer = document.getElementById('mobile-drawer-content');
    const toggleBtn = document.getElementById('mobile-drawer-toggle');
    const statusText = document.getElementById('mobile-drawer-status');
    const chevron = document.getElementById('mobile-drawer-chevron');
    
    if (!drawer) return;
    const isHidden = drawer.classList.contains('hidden');
    
    if (isHidden) {
        drawer.classList.remove('hidden');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
        if (statusText) statusText.textContent = 'Hide';
        if (chevron) chevron.classList.add('rotate-180');
    } else {
        drawer.classList.add('hidden');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        if (statusText) statusText.textContent = 'Show';
        if (chevron) chevron.classList.remove('rotate-180');
    }
}

export function toggleDataDropdown() {
    const btn = document.getElementById('data-dropdown-btn');
    const menu = document.getElementById('data-dropdown-menu');
    const chevron = document.getElementById('data-chevron');
    if (menu) {
        const isHidden = menu.classList.toggle('hidden');
        const isExpanded = !isHidden;
        if (btn) btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        if (chevron) chevron.classList.toggle('rotate-180', isExpanded);
    }
}

export function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.className = `px-4 py-3 rounded-xl shadow-xl text-white font-semibold text-sm transition-all duration-300 transform translate-y-4 opacity-0 flex items-center gap-2 pointer-events-auto ${
        type === 'success' ? 'bg-emerald-600' : type === 'info' ? 'bg-indigo-600' : 'bg-rose-600'
    }`;
    
    const icon = type === 'success' 
        ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
        : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
        
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    }, 50);
    
    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

export function trapFocus(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    lastFocusedElementBeforeModal = document.activeElement;
    const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    setTimeout(() => {
        firstElement.focus();
    }, 50);

    if (activeModalFocusTrap) {
        document.removeEventListener('keydown', activeModalFocusTrap);
    }
    
    activeModalFocusTrap = function(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === firstElement) {
                lastElement.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastElement) {
                firstElement.focus();
                e.preventDefault();
            }
        }
    };
    
    document.addEventListener('keydown', activeModalFocusTrap);
}

export function releaseFocus() {
    if (activeModalFocusTrap) {
        document.removeEventListener('keydown', activeModalFocusTrap);
        activeModalFocusTrap = null;
    }
    if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
        lastFocusedElementBeforeModal.focus();
    }
}

export function renderCategoryNavigation() {
    const sidebar = document.getElementById('category-sidebar-list');
    const mobilebar = document.getElementById('category-mobile-list');
    if (!sidebar || !mobilebar) return;
    
    let sidebarHTML = '';
    let mobileHTML = '';
    
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        const isActive = state.activeCategory === catName && !state.searchQuery;
        
        const indicatorsList = Object.keys(catData.indicators);
        const total = indicatorsList.length;
        const completed = indicatorsList.filter(ind => {
            const data = state.auditData[catName]?.[ind];
            return data && (data.reviewed || data.features || data.gaps || data.actions || data.score !== 3 || data.photoName);
        }).length;
        
        const activeSidebarClass = "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-100 font-semibold border-l-4 border-brand-500";
        const inactiveSidebarClass = "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#1F2937]/50 hover:text-slate-900 dark:hover:text-slate-100 border-l-4 border-transparent";
        
        sidebarHTML += `
            <button onclick="handleCategorySelect('${catName}')" class="w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between text-xs transition-all-custom cursor-pointer ${isActive ? activeSidebarClass : inactiveSidebarClass}">
                <div class="flex flex-col gap-0.5 max-w-[80%]">
                    <span class="truncate font-medium">${catName}</span>
                    <span class="text-xs text-slate-600 dark:text-slate-300 font-medium">Weight: ${catData.weight * 100}%</span>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${completed === total ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}">
                    ${completed}/${total}
                </span>
            </button>
        `;
        
        const activeMobileClass = "bg-brand-500 text-white font-bold shadow-sm";
        const inactiveMobileClass = "bg-slate-100 dark:bg-[#1F2937] text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-200 dark:hover:bg-[#2b3547]";
        
        mobileHTML += `
            <button onclick="handleCategorySelect('${catName}')" class="shrink-0 px-4 py-2.5 rounded-full text-xs font-semibold transition-all-custom cursor-pointer ${isActive ? activeMobileClass : inactiveMobileClass}">
                ${catName.split('. ')[1] || catName}
            </button>
        `;
    });
    
    sidebar.innerHTML = sidebarHTML;
    mobilebar.innerHTML = mobileHTML;
}

/**
 * Initializes all indicator cards into DOM grid once.
 */
export function initIndicatorsGrid() {
    const grid = document.getElementById('indicators-grid');
    if (!grid) return;
    
    let html = '';
    Object.entries(CATEGORIES).forEach(([catName, catData]) => {
        Object.entries(catData.indicators).forEach(([indName, multiplier]) => {
            html += renderCardHTML(catName, indName, multiplier);
        });
    });
    
    const saveDraftBtnHTML = `
        <div id="save-draft-footer" class="col-span-full flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 p-5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1F2937] rounded-2xl shadow-sm">
            <div class="text-xs text-slate-600 dark:text-slate-300 font-medium">Draft modifications are kept in app memory. Press checkpoint to commit draft.</div>
            <button onclick="saveDraftAction()" class="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-5 py-3 rounded-xl transition-all-custom cursor-pointer flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                <span>Save Draft File</span>
            </button>
        </div>
    `;
    
    grid.innerHTML = html + saveDraftBtnHTML;
}

/**
 * Optimizes DOM Card Grid Filtering (AUD-JS-M1).
 * Toggles element visibility ('hidden' class) on persistent card elements instead of destroying and recreating innerHTML.
 */
export function renderActiveCategoryIndicators() {
    const grid = document.getElementById('indicators-grid');
    const emptyState = document.getElementById('search-empty-state');
    const headerTitle = document.getElementById('active-category-title');
    const headerSubtitle = document.getElementById('active-category-subtitle');
    if (!grid) return;

    if (!grid.querySelector('.audit-card')) {
        initIndicatorsGrid();
    }

    const query = (state.searchQuery || '').trim().toLowerCase();
    const cards = grid.querySelectorAll('.audit-card');
    let matchCount = 0;

    if (query) {
        if (headerTitle) headerTitle.innerHTML = `Search Results: "${state.searchQuery}"`;
        if (headerSubtitle) headerSubtitle.innerHTML = "Filtering indicators across all categories";

        cards.forEach(card => {
            const catName = card.getAttribute('data-category') || '';
            const indName = card.getAttribute('data-indicator') || '';
            const searchText = card.getAttribute('data-search-text') || `${catName} ${indName}`.toLowerCase();
            const matches = searchText.includes(query);
            
            card.classList.toggle('hidden', !matches);
            if (matches) matchCount++;
        });
    } else {
        const catData = CATEGORIES[state.activeCategory];
        if (headerTitle) headerTitle.innerHTML = state.activeCategory;
        if (headerSubtitle) headerSubtitle.innerHTML = `Macro-Weight: ${catData ? catData.weight * 100 : 0}% of Total Audit`;

        cards.forEach(card => {
            const catName = card.getAttribute('data-category') || '';
            const isCurrentCategory = (catName === state.activeCategory);
            
            card.classList.toggle('hidden', !isCurrentCategory);
            if (isCurrentCategory) matchCount++;
        });
    }

    const saveFooter = document.getElementById('save-draft-footer');
    if (saveFooter) {
        saveFooter.classList.toggle('hidden', query !== '' && matchCount === 0);
    }

    if (matchCount === 0) {
        grid.classList.add('hidden');
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
        }
    } else {
        grid.classList.remove('hidden');
        if (emptyState) {
            emptyState.classList.add('hidden');
            emptyState.classList.remove('flex');
        }
    }
}

export function renderCardHTML(catName, indName, baseMultiplier) {
    const data = state.auditData[catName]?.[indName] || { score: 3, features: "", gaps: "", actions: "", photoName: "", photoData: "", reviewed: false };
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');

    const effectiveMultiplier = getEffectiveMultiplier(catName, indName);
    const isRiskModified = !!(data.riskApplied && data.customMultiplier != null);

    let badgeColorClass = "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    if (effectiveMultiplier === 2) {
        badgeColorClass = "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    } else if (effectiveMultiplier === 3) {
        badgeColorClass = "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
    }

    if (isRiskModified) {
        badgeColorClass = "bg-purple-100 text-purple-900 border border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-700 font-extrabold";
    }
    
    const hasModifications = data.reviewed || data.features || data.gaps || data.actions || data.aiFeatures || data.aiGaps || data.aiActions || data.score !== 3 || data.photoName || isRiskModified;
    const borderAccentClass = isRiskModified 
        ? "border-purple-500/40 dark:border-purple-500/30 ring-1 ring-purple-500/20"
        : (hasModifications 
            ? "border-emerald-500/30 dark:border-emerald-500/20" 
            : "border-slate-200 dark:border-[#1F2937]");
    
    const modifiedClass = hasModifications ? "audit-card-modified" : "";
    const searchText = `${catName} ${indName}`.toLowerCase();

    // Severity styling helper for suggestedRisk
    const suggested = data.suggestedRisk;
    let sevBadgeBg = "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300";
    if (suggested?.severity === "Critical") {
        sevBadgeBg = "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300";
    } else if (suggested?.severity === "High") {
        sevBadgeBg = "bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300";
    } else if (suggested?.severity === "Low") {
        sevBadgeBg = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300";
    }

    return `
        <div class="glass-card audit-card ${modifiedClass} rounded-2xl p-5 md:p-6 transition-all duration-300 border ${borderAccentClass} shadow-sm flex flex-col gap-4 relative" id="card-${catEscaped}-${indEscaped}" data-category="${catName}" data-indicator="${indName}" data-search-text="${searchText}">
            
            <div class="absolute top-0 right-0 h-1.5 w-12 ${isRiskModified ? 'bg-purple-500' : 'bg-emerald-500'} rounded-bl-lg rounded-tr-2xl transition-transform duration-300 ${hasModifications ? 'scale-x-100' : 'scale-x-0'}"></div>
            
            <!-- Card Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex flex-col gap-0.5">
                    <span class="search-cat-badge text-[10px] text-brand-500 dark:text-brand-300 font-bold uppercase tracking-wider ${state.searchQuery ? '' : 'hidden'}">${catName}</span>
                    <h3 class="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        ${indName}
                    </h3>
                </div>
                
                <div class="flex items-center gap-2 relative group focus-within:z-50 flex-wrap">
                    <!-- AI Enhance Card Button -->
                    <button type="button" 
                            id="ai-btn-${catEscaped}-${indEscaped}"
                            onclick="enhanceIndicatorCard('${catName}', '${indName}')" 
                            title="AI Enhance write-ups for this indicator"
                            class="text-xs font-bold px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-500/10 to-indigo-500/10 hover:from-purple-500/20 hover:to-indigo-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/20 flex items-center gap-1.5 transition-all-custom cursor-pointer active:scale-95">
                        <svg class="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        <span>AI Enhance</span>
                    </button>

                    <!-- Dynamic Risk Button -->
                    <button type="button" 
                            id="risk-btn-${catEscaped}-${indEscaped}"
                            onclick="analyzeDynamicRisk('${catName}', '${indName}')" 
                            title="Calculate Dynamic Risk Modifier based on Notable Features, Gaps, and Actions"
                            class="text-xs font-bold px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex items-center gap-1.5 transition-all-custom cursor-pointer active:scale-95">
                        <span class="text-amber-500 dark:text-amber-400 font-bold">⚡</span>
                        <span>Dynamic Risk</span>
                    </button>

                    <!-- Interactive Clickable Risk Multiplier Pill -->
                    <button type="button" 
                            id="tooltip-trigger-${catEscaped}-${indEscaped}"
                            onclick="cycleRiskMultiplier('${catName}', '${indName}')"
                            aria-describedby="tooltip-desc-${catEscaped}-${indEscaped}"
                            title="Click to change Risk Multiplier (1x ➔ 2x ➔ 3x)"
                            class="text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 ${badgeColorClass} cursor-pointer hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all shadow-sm group/btn">
                        <svg class="w-3.5 h-3.5 ${isRiskModified ? 'text-purple-600 dark:text-purple-300' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        <span>${isRiskModified ? `⚡ ${effectiveMultiplier}x (${data.riskSeverity || 'Modified'})` : `Multiplier: ${effectiveMultiplier}x`}</span>
                        <span class="text-[10px] opacity-70 group-hover/btn:opacity-100 group-hover/btn:scale-110 transition-transform font-black" title="Click to change multiplier">↻</span>
                    </button>
                    <!-- Hover & Focus Tooltip -->
                    <div id="tooltip-desc-${catEscaped}-${indEscaped}"
                         role="tooltip"
                         class="absolute bottom-full right-0 mb-2 hidden group-hover:block group-focus-within:block w-72 bg-slate-900 dark:bg-slate-800 text-white text-xs p-2.5 rounded-xl shadow-xl z-50 text-left font-semibold leading-relaxed border border-slate-200/10 pointer-events-none transition-all duration-200">
                        <div class="text-[11px] text-amber-300 font-bold mb-1">💡 Click badge to cycle (1x ➔ 2x ➔ 3x)</div>
                        ${isRiskModified 
                            ? `<strong>⚡ Dynamic Risk Active (${effectiveMultiplier}x)</strong>: Adjusted from baseline ${baseMultiplier}x. Severity: <em>${data.riskSeverity || 'Modified'}</em>.<br><span class="text-slate-300">${data.riskRationale || ''}</span>`
                            : (effectiveMultiplier === 3 ? '<strong>3x Critical Risk</strong>: Standard safety, health, or statutory requirements. Failures present immediate physical, medical, or legal closure hazards.' : 
                               effectiveMultiplier === 2 ? '<strong>2x Moderate Risk</strong>: Operational infrastructure and campus standards. Core educational spaces, facilities, and standard compliance processes.' : 
                               '<strong>1x Low Risk</strong>: Support systems or administrative checks. Secondary rooms, routine records, or general campus operations.')
                        }
                    </div>
                </div>
            </div>

            <!-- Dynamic Risk Proposal Notification Widget (if pending suggestion) -->
            ${suggested ? `
            <div id="risk-box-${catEscaped}-${indEscaped}" class="p-3.5 rounded-xl bg-gradient-to-r from-amber-50/90 to-orange-50/90 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800/60 shadow-sm flex flex-col gap-2 animate-fadeIn">
                <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${sevBadgeBg}">
                            ⚡ ${suggested.severity} Risk
                        </span>
                        <span class="text-xs font-bold text-slate-800 dark:text-slate-200">
                            Suggested Multiplier: <strong class="text-brand-600 dark:text-brand-400">${suggested.suggestedMultiplier}x</strong> <span class="text-slate-400 font-normal text-[11px]">(Baseline: ${baseMultiplier}x)</span>
                        </span>
                        ${suggested.scoreDelta !== 0 ? `
                            <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                Suggested Rating: ${data.score} → <strong class="text-purple-600 dark:text-purple-400">${suggested.suggestedScore}</strong> (${suggested.scoreDelta > 0 ? '+' : ''}${suggested.scoreDelta})
                            </span>
                        ` : ''}
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button type="button" onclick="applyDynamicRiskModifier('${catName}', '${indName}')" title="Apply proposed multiplier and rating" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-sm transition-colors cursor-pointer flex items-center gap-1 active:scale-95">
                            ✓ Apply Modifier
                        </button>
                        <select onchange="if(this.value){applyDynamicRiskModifier('${catName}', '${indName}', this.value); this.value='';}" aria-label="Custom risk multiplier selection" class="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                            <option value="" disabled selected>Custom Weight...</option>
                            <option value="1">Set to 1x (Low)</option>
                            <option value="2">Set to 2x (Moderate)</option>
                            <option value="3">Set to 3x (Critical)</option>
                        </select>
                        <button type="button" onclick="dismissDynamicRiskModifier('${catName}', '${indName}')" title="Dismiss risk proposal" class="px-1.5 py-1 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 text-xs font-bold transition-colors cursor-pointer">✕</button>
                    </div>
                </div>
                <p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic bg-white/60 dark:bg-[#121827]/60 p-2 rounded-lg border border-amber-200/50 dark:border-amber-800/30">
                    <strong class="not-italic text-slate-900 dark:text-slate-100 font-bold">AI Rationale:</strong> ${suggested.rationale}
                </p>
            </div>
            ` : ''}

            <!-- Active Dynamic Risk Status Banner (if already applied) -->
            ${isRiskModified && !suggested ? `
            <div class="p-2.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/80 dark:border-purple-800/40 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="px-2 py-0.5 rounded-md font-black uppercase text-[10px] bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                        ⚡ Dynamic Modifier: ${effectiveMultiplier}x (${data.riskSeverity || 'Modified'})
                    </span>
                    <span class="text-slate-600 dark:text-slate-400 font-medium italic text-[11px]">
                        ${data.riskRationale || 'Adjusted based on qualitative audit findings.'}
                    </span>
                </div>
                <button type="button" onclick="resetDynamicRiskModifier('${catName}', '${indName}')" title="Revert to standard baseline multiplier" class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer">
                    Reset to Baseline (${baseMultiplier}x)
                </button>
            </div>
            ` : ''}
            
            <!-- Score Selection Pill Control -->
            <div class="flex flex-col gap-1.5">
                <span id="rating-label-${catEscaped}-${indEscaped}" class="text-xs font-bold text-slate-700 dark:text-slate-300">Compliance Rating (1 - 5)</span>
                <div role="radiogroup" aria-labelledby="rating-label-${catEscaped}-${indEscaped}" class="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    ${[1,2,3,4,5].map(scoreNum => {
                        const active = data.score === scoreNum;
                        return `
                            <button type="button" 
                                    id="btn-${catEscaped}-${indEscaped}-${scoreNum}" 
                                    role="radio" 
                                    aria-checked="${active ? 'true' : 'false'}" 
                                    aria-label="Compliance score ${scoreNum} out of 5 for ${indName}"
                                    tabindex="${active ? '0' : '-1'}"
                                    onclick="handleScoreChange('${catName}', '${indName}', ${scoreNum})" 
                                    onkeydown="handleScoreKeyDown(event, '${catName}', '${indName}', ${scoreNum})" 
                                    class="w-9 sm:w-11 h-9 sm:h-10 rounded-xl font-extrabold text-xs sm:text-sm border flex items-center justify-center transition-all-custom cursor-pointer ${getScoreButtonClass(scoreNum, active)}">
                                ${scoreNum}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <!-- Descriptive Input Areas -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-1">
                <!-- Notable Features -->
                <div class="flex flex-col gap-1">
                    <label for="feat-${catEscaped}-${indEscaped}" class="text-xs font-bold text-slate-700 dark:text-slate-300">Notable Features</label>
                    <textarea id="feat-${catEscaped}-${indEscaped}" 
                              aria-label="Notable Features for ${indName}"
                              oninput="handleTextChange('${catName}', '${indName}', 'features', this.value)" 
                              placeholder="Highlights, achievements..." 
                              class="w-full bg-slate-50/50 dark:bg-[#172033] border border-slate-200 dark:border-[#2C3854] rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 transition-all-custom h-20 resize-y">${data.features || ''}</textarea>
                    
                    <!-- AI Notable Features Suggestion -->
                    ${data.aiFeatures ? `
                    <div id="ai-box-feat-${catEscaped}-${indEscaped}" class="mt-1.5 p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/25 border border-purple-200 dark:border-purple-800/50 flex flex-col gap-1.5 shadow-sm animate-fadeIn">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1">
                                <svg class="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                AI Enhanced
                            </span>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'features', 'replace')" title="Replace original text with AI text" class="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] shadow-sm transition-colors cursor-pointer">Replace</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'features', 'append')" title="Append to existing text" class="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] transition-colors cursor-pointer">Append</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'features', 'discard')" title="Discard suggestion" class="px-1 py-0.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 text-xs font-bold transition-colors cursor-pointer">✕</button>
                            </div>
                        </div>
                        <textarea id="ai-feat-${catEscaped}-${indEscaped}"
                                  aria-label="AI Enhanced Notable Features for ${indName}"
                                  oninput="handleAITextChange('${catName}', '${indName}', 'features', this.value)"
                                  class="w-full bg-white/90 dark:bg-[#121827]/90 border border-purple-200/80 dark:border-purple-800/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all h-20 resize-y leading-relaxed">${data.aiFeatures}</textarea>
                    </div>
                    ` : ''}
                </div>
                
                <!-- Gaps Identified -->
                <div class="flex flex-col gap-1">
                    <label for="gaps-${catEscaped}-${indEscaped}" class="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        Gaps Identified <span class="text-amber-500">🚩</span>
                    </label>
                    <textarea id="gaps-${catEscaped}-${indEscaped}" 
                              aria-label="Gaps Identified for ${indName}"
                              oninput="handleTextChange('${catName}', '${indName}', 'gaps', this.value)" 
                              placeholder="Risks, gaps..." 
                              class="w-full bg-slate-50/50 dark:bg-[#172033] border border-slate-200 dark:border-[#2C3854] rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 transition-all-custom h-20 resize-y">${data.gaps || ''}</textarea>
                    
                    <!-- AI Gaps Identified Suggestion -->
                    ${data.aiGaps ? `
                    <div id="ai-box-gaps-${catEscaped}-${indEscaped}" class="mt-1.5 p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/25 border border-purple-200 dark:border-purple-800/50 flex flex-col gap-1.5 shadow-sm animate-fadeIn">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1">
                                <svg class="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                AI Enhanced
                            </span>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'gaps', 'replace')" title="Replace original text with AI text" class="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] shadow-sm transition-colors cursor-pointer">Replace</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'gaps', 'append')" title="Append to existing text" class="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] transition-colors cursor-pointer">Append</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'gaps', 'discard')" title="Discard suggestion" class="px-1 py-0.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 text-xs font-bold transition-colors cursor-pointer">✕</button>
                            </div>
                        </div>
                        <textarea id="ai-gaps-${catEscaped}-${indEscaped}"
                                  aria-label="AI Enhanced Gaps Identified for ${indName}"
                                  oninput="handleAITextChange('${catName}', '${indName}', 'gaps', this.value)"
                                  class="w-full bg-white/90 dark:bg-[#121827]/90 border border-purple-200/80 dark:border-purple-800/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all h-20 resize-y leading-relaxed">${data.aiGaps}</textarea>
                    </div>
                    ` : ''}
                </div>
                
                <!-- Actions Recommended -->
                <div class="flex flex-col gap-1">
                    <label for="act-${catEscaped}-${indEscaped}" class="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        Actions Recommended <span class="text-emerald-500">🛠</span>
                    </label>
                    <textarea id="act-${catEscaped}-${indEscaped}" 
                              aria-label="Actions Recommended for ${indName}"
                              oninput="handleTextChange('${catName}', '${indName}', 'actions', this.value)" 
                              placeholder="Proposed corrective tasks..." 
                              class="w-full bg-slate-50/50 dark:bg-[#172033] border border-slate-200 dark:border-[#2C3854] rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-brand-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 transition-all-custom h-20 resize-y">${data.actions || ''}</textarea>
                    
                    <!-- AI Actions Recommended Suggestion -->
                    ${data.aiActions ? `
                    <div id="ai-box-act-${catEscaped}-${indEscaped}" class="mt-1.5 p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/25 border border-purple-200 dark:border-purple-800/50 flex flex-col gap-1.5 shadow-sm animate-fadeIn">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1">
                                <svg class="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                AI Enhanced
                            </span>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'actions', 'replace')" title="Replace original text with AI text" class="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] shadow-sm transition-colors cursor-pointer">Replace</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'actions', 'append')" title="Append to existing text" class="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] transition-colors cursor-pointer">Append</button>
                                <button type="button" onclick="applyAIEnhancement('${catName}', '${indName}', 'actions', 'discard')" title="Discard suggestion" class="px-1 py-0.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 text-xs font-bold transition-colors cursor-pointer">✕</button>
                            </div>
                        </div>
                        <textarea id="ai-act-${catEscaped}-${indEscaped}"
                                  aria-label="AI Enhanced Actions Recommended for ${indName}"
                                  oninput="handleAITextChange('${catName}', '${indName}', 'actions', this.value)"
                                  class="w-full bg-white/90 dark:bg-[#121827]/90 border border-purple-200/80 dark:border-purple-800/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all h-20 resize-y leading-relaxed">${data.aiActions}</textarea>
                    </div>
                    ` : ''}
                </div>
            </div>

            <!-- Photographic Evidence Mapping Row (Embedded Images) -->
            <div class="flex flex-col gap-1.5 mt-2 border-t border-slate-100 dark:border-[#1F2937]/60 pt-3">
                <span class="text-xs font-bold text-slate-700 dark:text-slate-300">Attached Photographic Evidence</span>
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-3 flex-wrap">
                        <label for="photo-file-${catEscaped}-${indEscaped}" class="px-3 py-1.5 border border-slate-200 dark:border-[#2C3854] rounded-lg text-xs font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-[#1c273d] transition-all-custom flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <svg class="w-3.5 h-3.5 text-brand-500" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                            <span>Choose Image</span>
                            <input type="file" id="photo-file-${catEscaped}-${indEscaped}" accept="image/*" class="hidden" aria-label="Upload photographic evidence for ${indName}" onchange="handlePhotoUpload('${catName}', '${indName}', this)">
                        </label>
                        
                        <div id="photo-info-${catEscaped}-${indEscaped}" class="flex items-center gap-1.5 text-[11px]">
                            ${data.photoName 
                                ? `<span class="text-slate-500 dark:text-slate-400 italic font-medium truncate max-w-[200px] block">${data.photoName}</span>
                                   <button type="button" onclick="removePhoto('${catName}', '${indName}')" aria-label="Remove attached evidence photo for ${indName}" class="text-rose-500 hover:text-rose-700 font-bold p-1 cursor-pointer">✕</button>`
                                : `<span class="text-slate-400 dark:text-slate-600">No photographic evidence attached</span>`
                            }
                        </div>
                    </div>
                    
                    <!-- Medium Image Preview Block in Card -->
                    <div id="photo-preview-${catEscaped}-${indEscaped}" class="w-full max-w-sm rounded-xl border border-slate-200 dark:border-[#2C3854] overflow-hidden bg-slate-100 dark:bg-[#172033] ${data.photoData ? '' : 'hidden'} mt-1">
                        <img id="img-preview-${catEscaped}-${indEscaped}" src="${data.photoData || ''}" alt="Photographic evidence preview for ${indName}" class="object-cover w-full max-h-48">
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function getScoreButtonClass(score, active) {
    const classes = {
        1: active 
            ? "score-btn-1-active bg-rose-500 border-rose-500 text-white shadow-md shadow-rose-500/20" 
            : "score-btn-1 border-rose-200 dark:border-rose-950/60 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20",
        2: active 
            ? "score-btn-2-active bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/20" 
            : "score-btn-2 border-orange-200 dark:border-orange-950/60 text-orange-500 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20",
        3: active 
            ? "score-btn-3-active bg-amber-500 border-amber-500 text-white shadow-md shadow-amber-500/20" 
            : "score-btn-3 border-amber-200 dark:border-amber-950/60 text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20",
        4: active 
            ? "score-btn-4-active bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/20" 
            : "score-btn-4 border-emerald-200 dark:border-emerald-950/60 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20",
        5: active 
            ? "score-btn-5-active bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20" 
            : "score-btn-5 border-indigo-200 dark:border-indigo-950/60 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
    };
    return classes[score];
}

export function updateLiveIndicatorsForCard(catName, indName) {
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    
    const card = document.getElementById(`card-${catEscaped}-${indEscaped}`);
    if (card) {
        card.className = card.className.replace(
            /border-(emerald-500\/30|slate-200|emerald-500\/20|#1F2937)/g, 
            'border-emerald-500/30'
        );
    }
    renderCategoryNavigation();
}

/**
 * In-place replaces a specific indicator card's DOM without affecting scroll or other cards.
 */
export function refreshCardDOM(catName, indName) {
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    const cardEl = document.getElementById(`card-${catEscaped}-${indEscaped}`);
    if (!cardEl) return;

    const catData = CATEGORIES[catName];
    const multiplier = catData?.indicators?.[indName] || 1;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderCardHTML(catName, indName, multiplier);
    const newCardEl = tempDiv.firstElementChild;
    if (newCardEl) {
        cardEl.replaceWith(newCardEl);
    }
}

export function handleCategorySelect(catName) {
    saveState.flush();
    state.activeCategory = catName;
    state.searchQuery = "";
    
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = "";
    
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
    
    saveState();
    renderCategoryNavigation();
    renderActiveCategoryIndicators();
    
    const gridParent = document.getElementById('indicators-grid')?.parentElement;
    if (gridParent) gridParent.scrollTo({ top: 0, behavior: 'smooth' });
}

export function handleScoreChange(catName, indName, score) {
    const item = state.auditData[catName][indName];
    item.score = score;
    item.reviewed = true;
    
    saveState();
    
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    for (let s = 1; s <= 5; s++) {
        const btn = document.getElementById(`btn-${catEscaped}-${indEscaped}-${s}`);
        if (btn) {
            btn.setAttribute('aria-checked', s === score ? 'true' : 'false');
            btn.setAttribute('tabindex', s === score ? '0' : '-1');
            btn.className = `w-9 sm:w-11 h-9 sm:h-10 rounded-xl font-extrabold text-xs sm:text-sm border flex items-center justify-center transition-all-custom cursor-pointer ${getScoreButtonClass(s, s === score)}`;
        }
    }
    
    updateLiveIndicatorsForCard(catName, indName);
    updateCalculations();
}

export function handleScoreKeyDown(event, catName, indName, currentScore) {
    let newScore = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        newScore = currentScore < 5 ? currentScore + 1 : 1;
        event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        newScore = currentScore > 1 ? currentScore - 1 : 5;
        event.preventDefault();
    } else if (event.key === 'Home') {
        newScore = 1;
        event.preventDefault();
    } else if (event.key === 'End') {
        newScore = 5;
        event.preventDefault();
    }

    if (newScore !== null) {
        if (newScore !== currentScore) {
            handleScoreChange(catName, indName, newScore);
        }
        const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
        const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
        const targetBtn = document.getElementById(`btn-${catEscaped}-${indEscaped}-${newScore}`);
        if (targetBtn) {
            targetBtn.focus();
        }
    }
}

export function handleTextChange(catName, indName, field, value) {
    const item = state.auditData[catName][indName];
    item[field] = value;
    
    if (item.features !== "" || item.gaps !== "" || item.actions !== "" || item.score !== 3 || item.photoName !== "") {
        item.reviewed = true;
    }
    
    // 400ms Debounced saveState (AUD-JS-H1)
    saveState();
    updateCalculations();
}

export function compressImage(file, maxDim, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            callback(dataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function handlePhotoUpload(catName, indName, input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        showToast("Compressing photo for offline storage...", "info");
        
        compressImage(file, 1024, 0.7, function(base64Data) {
            const item = state.auditData[catName][indName];
            item.photoName = file.name;
            item.photoData = base64Data;
            item.reviewed = true;
            
            saveState();
            
            const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
            const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
            
            const infoEl = document.getElementById(`photo-info-${catEscaped}-${indEscaped}`);
            if (infoEl) {
                infoEl.innerHTML = `
                    <span class="text-slate-600 dark:text-slate-300 italic font-medium truncate max-w-[200px] block">${file.name}</span>
                    <button type="button" onclick="removePhoto('${catName}', '${indName}')" aria-label="Remove attached photo evidence for ${indName}" class="text-rose-500 hover:text-rose-700 font-bold p-1 cursor-pointer">✕</button>
                `;
            }
            
            const previewContainer = document.getElementById(`photo-preview-${catEscaped}-${indEscaped}`);
            const imgEl = document.getElementById(`img-preview-${catEscaped}-${indEscaped}`);
            if (previewContainer && imgEl) {
                imgEl.src = base64Data;
                imgEl.alt = `Photographic evidence preview for ${indName} (${file.name})`;
                previewContainer.classList.remove('hidden');
            }
            
            updateLiveIndicatorsForCard(catName, indName);
            updateCalculations();
            showToast(`Attached evidence: ${file.name}`);
        });
    }
}

export function removePhoto(catName, indName) {
    const item = state.auditData[catName][indName];
    const oldName = item.photoName;
    item.photoName = "";
    item.photoData = "";
    
    saveState();
    
    const catEscaped = catName.replace(/[^a-zA-Z0-9]/g, '');
    const indEscaped = indName.replace(/[^a-zA-Z0-9]/g, '');
    
    const infoEl = document.getElementById(`photo-info-${catEscaped}-${indEscaped}`);
    if (infoEl) {
        infoEl.innerHTML = `<span class="text-slate-600 dark:text-slate-300">No photographic evidence attached</span>`;
    }
    
    const previewContainer = document.getElementById('photo-preview-' + catEscaped + '-' + indEscaped);
    if (previewContainer) {
        previewContainer.classList.add('hidden');
    }
    
    updateLiveIndicatorsForCard(catName, indName);
    updateCalculations();
    showToast(`Removed attached photo: ${oldName}`, 'info');
}

export function handleSearch(query) {
    state.searchQuery = (query || "").trim().toLowerCase();
    const clearBtn = document.getElementById('search-clear-btn');
    
    if (state.searchQuery) {
        if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
        if (clearBtn) clearBtn.classList.add('hidden');
    }
    
    renderActiveCategoryIndicators();
}

export function clearSearch() {
    state.searchQuery = "";
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = "";
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
    
    renderActiveCategoryIndicators();
}

export function handleFilenameChange(val) {
    state.filename = val.trim() || "Untitled_Audit";
    saveState();
}

export function handleMetaChange(field, val) {
    state[field] = val;
    saveState();
}

/**
 * Cycles an indicator's risk multiplier directly on click (1x -> 2x -> 3x -> baseline).
 */
export function cycleRiskMultiplier(catName, indName) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    const baseMultiplier = CATEGORIES[catName]?.indicators?.[indName] || 2;
    const currentEffective = getEffectiveMultiplier(catName, indName);
    
    // Cycle: 1 -> 2 -> 3 -> 1
    let nextMultiplier = currentEffective === 1 ? 2 : (currentEffective === 2 ? 3 : 1);

    if (nextMultiplier === baseMultiplier) {
        // Reverted to baseline
        data.customMultiplier = null;
        data.riskApplied = false;
        data.riskSeverity = "";
        data.riskRationale = "";
        data.riskScoreDelta = 0;
        showToast(`${indName}: Reset to default ${baseMultiplier}x baseline multiplier.`, "info");
    } else {
        data.customMultiplier = nextMultiplier;
        data.riskApplied = true;
        data.riskSeverity = nextMultiplier === 3 ? "Critical" : (nextMultiplier === 2 ? "Moderate" : "Low");
        data.riskRationale = `Manually set to ${nextMultiplier}x by auditor.`;
        data.reviewed = true;
        showToast(`${indName}: Set to ${nextMultiplier}x (${data.riskSeverity} Risk).`, "success");
    }

    saveState();
    updateCalculations();
    refreshCardDOM(catName, indName);
}

/**
 * Sets an indicator's risk multiplier directly.
 */
export function setIndicatorMultiplier(catName, indName, multValue) {
    const data = state.auditData[catName]?.[indName];
    if (!data) return;

    const baseMultiplier = CATEGORIES[catName]?.indicators?.[indName] || 2;
    const nextMultiplier = parseInt(multValue, 10);
    if (!nextMultiplier || nextMultiplier < 1 || nextMultiplier > 3) return;

    if (nextMultiplier === baseMultiplier) {
        data.customMultiplier = null;
        data.riskApplied = false;
        data.riskSeverity = "";
        data.riskRationale = "";
        data.riskScoreDelta = 0;
        showToast(`${indName}: Reset to default ${baseMultiplier}x baseline multiplier.`, "info");
    } else {
        data.customMultiplier = nextMultiplier;
        data.riskApplied = true;
        data.riskSeverity = nextMultiplier === 3 ? "Critical" : (nextMultiplier === 2 ? "Moderate" : "Low");
        data.riskRationale = `Manually set to ${nextMultiplier}x by auditor.`;
        data.reviewed = true;
        showToast(`${indName}: Set to ${nextMultiplier}x (${data.riskSeverity} Risk).`, "success");
    }

    saveState();
    updateCalculations();
    refreshCardDOM(catName, indName);
}

export const mountAllIndicatorsGrid = initIndicatorsGrid;


