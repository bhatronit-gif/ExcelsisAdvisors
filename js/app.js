/**
 * js/app.js — Main Application Entry Point
 * Imports ES modules, registers global window bridge handlers, and manages initialization sequence.
 */

import { SCHOOLS } from './config.js';
import { initIndexedDB, migrateLocalStorageToIndexedDB } from './storage.js';
import { state, loadState, saveState, updateCalculations, startNewAudit } from './state.js';
import { checkAuthentication, showLoginOverlay, handleLoginSubmit, logOutAuditor } from './auth.js';
import { 
    setupTheme, toggleTheme, toggleMobileDrawer, toggleDataDropdown, showToast,
    renderCategoryNavigation, initIndicatorsGrid, renderActiveCategoryIndicators,
    handleCategorySelect, handleScoreChange, handleScoreKeyDown, handleTextChange,
    handlePhotoUpload, removePhoto, handleSearch, clearSearch, handleFilenameChange, handleMetaChange
} from './ui.js';
import { 
    exportToCSV, exportToJSON, importFromJSON, importFromCSV, downloadCSVTemplate,
    fetchHistory, loadAuditFromDatabase, loadAuditFromDatabaseForSuperadmin,
    deleteAuditFromDatabase, deleteAuditFromDatabaseForSuperadmin, saveDraftAction,
    saveAsAction, handleConsolidateCheckboxClick, consolidateSelectedAudits
} from './export.js';
import { closePDFModal, submitPDFReport, generatePDFReport, generateAuditLegend } from './reports.js';
import { 
    openAISummaryModal, closeAISummaryModal, setAIActiveTab, toggleAISettingsDrawer,
    saveGeminiApiKeyFromUI, testGeminiApiKey, triggerAISummaryGeneration,
    handleAISummaryEditorChange, copyAISummaryToClipboard, clearAISummary,
    enhanceIndicatorCard, enhanceActiveCategoryWriteups, applyAIEnhancement, handleAITextChange
} from './ai.js';
import { refreshCardDOM } from './ui.js';

// --- Window Bridge Bindings (Ensures 100% backward compatibility for inline HTML event attributes) ---
window.handleCategorySelect = handleCategorySelect;
window.handleScoreChange = handleScoreChange;
window.handleScoreKeyDown = handleScoreKeyDown;
window.handleTextChange = handleTextChange;
window.handlePhotoUpload = handlePhotoUpload;
window.removePhoto = removePhoto;
window.handleSearch = handleSearch;
window.clearSearch = clearSearch;
window.handleFilenameChange = handleFilenameChange;
window.handleMetaChange = handleMetaChange;
window.saveDraftAction = saveDraftAction;
window.saveAsAction = saveAsAction;
window.startNewAudit = startNewAudit;
window.toggleDataDropdown = toggleDataDropdown;
window.toggleTheme = toggleTheme;
window.toggleMobileDrawer = toggleMobileDrawer;
window.handleLoginSubmit = handleLoginSubmit;
window.logOutAuditor = logOutAuditor;
window.closePDFModal = closePDFModal;
window.submitPDFReport = submitPDFReport;
window.generatePDFReport = generatePDFReport;
window.generateAuditLegend = generateAuditLegend;
window.exportToCSV = exportToCSV;
window.exportToJSON = exportToJSON;
window.importFromJSON = importFromJSON;
window.importFromCSV = importFromCSV;
window.downloadCSVTemplate = downloadCSVTemplate;
window.loadAuditFromDatabase = loadAuditFromDatabase;
window.loadAuditFromDatabaseForSuperadmin = loadAuditFromDatabaseForSuperadmin;
window.deleteAuditFromDatabase = deleteAuditFromDatabase;
window.deleteAuditFromDatabaseForSuperadmin = deleteAuditFromDatabaseForSuperadmin;
window.handleConsolidateCheckboxClick = handleConsolidateCheckboxClick;
window.consolidateSelectedAudits = consolidateSelectedAudits;
window.openAISummaryModal = openAISummaryModal;
window.closeAISummaryModal = closeAISummaryModal;
window.setAIActiveTab = setAIActiveTab;
window.toggleAISettingsDrawer = toggleAISettingsDrawer;
window.saveGeminiApiKeyFromUI = saveGeminiApiKeyFromUI;
window.testGeminiApiKey = testGeminiApiKey;
window.triggerAISummaryGeneration = triggerAISummaryGeneration;
window.handleAISummaryEditorChange = handleAISummaryEditorChange;
window.copyAISummaryToClipboard = copyAISummaryToClipboard;
window.clearAISummary = clearAISummary;
window.enhanceIndicatorCard = enhanceIndicatorCard;
window.enhanceActiveCategoryWriteups = enhanceActiveCategoryWriteups;
window.applyAIEnhancement = applyAIEnhancement;
window.handleAITextChange = handleAITextChange;
window.refreshCardDOM = refreshCardDOM;
window.confirmReset = () => {
    if (!confirm("Reset active view back to blank defaults? (Saved drafts remain in history)")) return;
    startNewAudit(true);
};

// Global Escape key listener for active modals
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const pdfModal = document.getElementById('pdf-modal-overlay');
        if (pdfModal && !pdfModal.classList.contains('hidden')) {
            closePDFModal();
        }
        const aiModal = document.getElementById('ai-summary-modal-overlay');
        if (aiModal && !aiModal.classList.contains('hidden')) {
            closeAISummaryModal();
        }
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const container = document.getElementById('data-dropdown-container');
    const btn = document.getElementById('data-dropdown-btn');
    const menu = document.getElementById('data-dropdown-menu');
    const chevron = document.getElementById('data-chevron');
    if (container && !container.contains(event.target) && menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.remove('rotate-180');
    }
});

// Flush debounced storage before window unloads
window.addEventListener('beforeunload', () => {
    if (saveState && typeof saveState.flush === 'function') {
        saveState.flush();
    }
});

function initializeMetadataSelectors() {
    const selectEl = document.getElementById('meta-school');
    if (selectEl) {
        selectEl.innerHTML = SCHOOLS.map(s => `<option value="${s}">${s}</option>`).join('');
        selectEl.value = state.school;
    }
    const dateEl = document.getElementById('meta-date');
    if (dateEl) dateEl.value = state.date;
    const fileEl = document.getElementById('meta-filename');
    if (fileEl) fileEl.value = state.filename;
    
    if (state.loggedInUser) {
        const labelEl = document.getElementById('active-auditor-label');
        if (labelEl) labelEl.innerHTML = state.loggedInUser;
    }
}

// --- System Initialization Sequence ---
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Storage initialization & automatic migration
    await initIndexedDB();
    await migrateLocalStorageToIndexedDB((msg, type) => showToast(msg, type));
    await loadState();

    // 2. UI & Component initialization
    initializeMetadataSelectors();
    setupTheme();
    renderCategoryNavigation();
    initIndicatorsGrid();
    renderActiveCategoryIndicators();
    updateCalculations();

    // 3. Auth check & session setup
    await checkAuthentication();
});
