/**
 * js/annexures.js — Audit Annexures & Document Exhibits Module
 * Manages PDF annexure uploads, Mozilla PDF.js client-side page rendering, 
 * ordering, metadata, and seamless integration into generated audit PDF reports.
 */

import { state, saveState, saveStateNow } from './state.js';
import { showToast, trapFocus, releaseFocus } from './ui.js';

/**
 * Ensures Mozilla PDF.js library is loaded and configured with its Web Worker.
 */
export async function ensurePDFJsLoaded() {
    if (window.pdfjsLib && window.pdfjsLib.getDocument) {
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        return window.pdfjsLib;
    }

    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[src*="pdf.js"], script[src*="pdf.min.js"]');
        if (existingScript && window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            return resolve(window.pdfjsLib);
        }

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;
        script.onload = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve(window.pdfjsLib);
            } else {
                reject(new Error("PDF.js library failed to initialize."));
            }
        };
        script.onerror = () => reject(new Error("Unable to load PDF.js from CDN. Please check network connection."));
        document.head.appendChild(script);
    });
}

/**
 * Formats a clean human-readable default title from a file name.
 */
export function formatDefaultAnnexureTitle(filename) {
    if (!filename) return "Supporting Compliance Document";
    const withoutExt = filename.replace(/\.[^/.]+$/, "");
    return withoutExt
        .replace(/[-_.]+/g, " ")
        .replace(/\b\w/g, char => char.toUpperCase())
        .trim();
}

/**
 * Formats byte counts into human-readable strings.
 */
export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Parses a PDF array buffer and renders each page to a high-resolution JPEG Data URL.
 */
export async function renderPDFToImages(arrayBuffer) {
    const pdfjs = await ensurePDFJsLoaded();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const renderedPages = [];

    // Scale 1.75 delivers ~150-180 DPI on A4 paper printouts while keeping memory usage responsive
    const scale = 1.75;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        // Draw clean white background behind transparent PDF pages
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        renderedPages.push(imgData);
    }

    return { numPages, renderedPages };
}

/**
 * Reads a File object as an ArrayBuffer.
 */
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Reads a File object as a Data URL.
 */
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsDataURL(file);
    });
}

/**
 * Uploads and processes one or more PDF files as Annexures.
 */
export async function handleAnnexurePDFUpload(inputOrFiles) {
    const files = inputOrFiles instanceof HTMLInputElement 
        ? Array.from(inputOrFiles.files || [])
        : Array.isArray(inputOrFiles) 
            ? inputOrFiles 
            : [inputOrFiles];

    if (!files || files.length === 0) return;

    if (!Array.isArray(state.annexures)) {
        state.annexures = [];
    }

    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
        showToast("Please select valid PDF documents (.pdf).", "error");
        return;
    }

    showToast(`Processing ${pdfFiles.length} PDF Annexure(s)...`, "info");

    for (const file of pdfFiles) {
        try {
            const arrayBuffer = await readFileAsArrayBuffer(file);
            const dataUrl = await readFileAsDataURL(file);
            
            let numPages = 1;
            let renderedPages = [];

            try {
                const renderResult = await renderPDFToImages(arrayBuffer);
                numPages = renderResult.numPages;
                renderedPages = renderResult.renderedPages;
            } catch (renderErr) {
                console.warn(`[Annexures] PDF.js page rendering skipped or failed for ${file.name}:`, renderErr);
                // Graceful fallback: keep pdfData URL so it can still be downloaded/referenced
                numPages = 1;
            }

            const annexure = {
                id: "annexure_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
                title: formatDefaultAnnexureTitle(file.name),
                fileName: file.name,
                fileSize: file.size,
                pageCount: numPages,
                pdfData: dataUrl,
                renderedPages: renderedPages,
                uploadedAt: new Date().toISOString()
            };

            state.annexures.push(annexure);
            showToast(`Attached Annexure: ${annexure.title} (${numPages} page${numPages > 1 ? 's' : ''})`, "success");
        } catch (err) {
            console.error(`[Annexures] Failed to process ${file.name}:`, err);
            showToast(`Failed to process ${file.name}: ${err.message || 'Invalid PDF'}`, "error");
        }
    }

    await saveStateNow();
    updateAnnexureBadges();
    renderAnnexuresList();

    if (inputOrFiles instanceof HTMLInputElement) {
        inputOrFiles.value = "";
    }
}

/**
 * Removes an annexure by ID.
 */
export async function removeAnnexure(id) {
    if (!Array.isArray(state.annexures)) return;
    const index = state.annexures.findIndex(a => a.id === id);
    if (index !== -1) {
        const removed = state.annexures.splice(index, 1)[0];
        await saveStateNow();
        updateAnnexureBadges();
        renderAnnexuresList();
        showToast(`Removed Annexure: ${removed.title}`, "info");
    }
}

/**
 * Moves an annexure up or down in order.
 */
export async function reorderAnnexure(id, direction) {
    if (!Array.isArray(state.annexures)) return;
    const index = state.annexures.findIndex(a => a.id === id);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.annexures.length) return;

    const temp = state.annexures[index];
    state.annexures[index] = state.annexures[targetIndex];
    state.annexures[targetIndex] = temp;

    await saveStateNow();
    renderAnnexuresList();
}

/**
 * Updates the user-defined title of an annexure.
 */
export function updateAnnexureTitle(id, newTitle) {
    if (!Array.isArray(state.annexures)) return;
    const annexure = state.annexures.find(a => a.id === id);
    if (annexure) {
        annexure.title = newTitle.trim() || annexure.fileName;
        saveState();
        updateAnnexureBadges();
    }
}

/**
 * Synchronizes annexure count badges across the portal.
 */
export function updateAnnexureBadges() {
    const count = Array.isArray(state.annexures) ? state.annexures.length : 0;
    
    // Sidebar Badge
    const sidebarBadge = document.getElementById('sidebar-annexure-count-badge');
    if (sidebarBadge) {
        sidebarBadge.textContent = count;
        sidebarBadge.classList.toggle('hidden', count === 0);
    }

    // PDF Modal Badge
    const modalBadge = document.getElementById('pdf-modal-annexure-badge');
    if (modalBadge) {
        modalBadge.textContent = `${count} Attached`;
    }

    // Render compact annexures list in PDF modal
    renderPDFModalAnnexuresList();
}

/**
 * Opens the main Audit Annexures modal.
 */
export function openAnnexuresModal() {
    renderAnnexuresList();
    const modal = document.getElementById('annexures-modal-overlay');
    if (modal) {
        modal.classList.remove('hidden');
        trapFocus('annexures-modal-overlay');
    }
}

/**
 * Closes the main Audit Annexures modal.
 */
export function closeAnnexuresModal() {
    const modal = document.getElementById('annexures-modal-overlay');
    if (modal) {
        modal.classList.add('hidden');
        releaseFocus();
    }
}

/**
 * Opens the preview modal for an annexure, displaying its rendered pages.
 */
export function previewAnnexure(id) {
    if (!Array.isArray(state.annexures)) return;
    const annexure = state.annexures.find(a => a.id === id);
    if (!annexure) return;

    const modal = document.getElementById('annexure-preview-modal');
    const titleEl = document.getElementById('annexure-preview-title');
    const contentEl = document.getElementById('annexure-preview-content');

    if (titleEl) {
        titleEl.textContent = `${annexure.title} (${annexure.pageCount} page${annexure.pageCount > 1 ? 's' : ''})`;
    }

    if (contentEl) {
        const pages = annexure.renderedPages || [];
        if (pages.length === 0 && annexure.pdfData) {
            contentEl.innerHTML = `
                <div class="flex flex-col items-center justify-center p-12 text-center gap-4">
                    <svg class="w-16 h-16 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    <div class="text-sm font-bold text-slate-800 dark:text-slate-200">${annexure.fileName}</div>
                    <a href="${annexure.pdfData}" download="${annexure.fileName}" class="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">Download PDF File</a>
                </div>
            `;
        } else {
            contentEl.innerHTML = pages.map((pageImg, idx) => `
                <div class="flex flex-col gap-2 bg-slate-100 dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div class="flex justify-between items-center text-xs font-bold text-slate-500 dark:text-slate-400 px-1">
                        <span>Page ${idx + 1} of ${pages.length}</span>
                        <span class="font-mono text-[10px]">${annexure.fileName}</span>
                    </div>
                    <div class="bg-white rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 flex justify-center shadow-inner">
                        <img src="${pageImg}" alt="Page ${idx + 1} of ${annexure.title}" class="max-w-full h-auto object-contain">
                    </div>
                </div>
            `).join('');
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        trapFocus('annexure-preview-modal');
    }
}

/**
 * Closes the annexure preview modal.
 */
export function closeAnnexurePreviewModal() {
    const modal = document.getElementById('annexure-preview-modal');
    if (modal) {
        modal.classList.add('hidden');
        releaseFocus();
    }
}

/**
 * Renders the full list of annexures in the main management modal.
 */
export function renderAnnexuresList() {
    const container = document.getElementById('annexures-list-container');
    if (!container) return;

    const annexures = Array.isArray(state.annexures) ? state.annexures : [];

    if (annexures.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 sm:p-12 text-center gap-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
                <div class="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                    📎
                </div>
                <div>
                    <h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">No PDF Annexures Attached</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                        Upload certificates, compliance filings, laboratory water test reports, or fire safety approvals to append as annexures to the generated report.
                    </p>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = annexures.map((ann, idx) => {
        const letter = String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) : '');
        const isFirst = idx === 0;
        const isLast = idx === annexures.length - 1;
        const thumbnailSrc = ann.renderedPages && ann.renderedPages[0] ? ann.renderedPages[0] : null;

        return `
            <div class="bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1F2937] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all hover:border-emerald-500/40" data-annexure-id="${ann.id}">
                <div class="flex items-center gap-3.5 flex-1 min-w-0">
                    <!-- Page 1 Thumbnail or PDF Badge -->
                    <div onclick="previewAnnexure('${ann.id}')" title="Click to preview pages" class="w-14 h-18 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer shadow-sm group hover:ring-2 hover:ring-emerald-500 transition-all">
                        ${thumbnailSrc ? `
                            <img src="${thumbnailSrc}" alt="${ann.title}" class="w-full h-full object-cover">
                        ` : `
                            <span class="text-rose-500 font-extrabold text-xs">PDF</span>
                        `}
                    </div>

                    <!-- Annexure Details & Inline Editable Title -->
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                Annexure ${letter}
                            </span>
                            <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                ${ann.pageCount} page${ann.pageCount > 1 ? 's' : ''} &bull; ${formatFileSize(ann.fileSize)}
                            </span>
                        </div>
                        <input type="text" value="${escapeHtml(ann.title)}" 
                               onchange="updateAnnexureTitle('${ann.id}', this.value)" 
                               aria-label="Edit title for Annexure ${letter}"
                               placeholder="Document Title (e.g. Fire Safety NOC)"
                               class="bg-slate-50 dark:bg-[#1F2937] border border-slate-200 dark:border-[#374151] rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all w-full max-w-md">
                        <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate block">
                            ${escapeHtml(ann.fileName)}
                        </span>
                    </div>
                </div>

                <!-- Reorder & Action Controls -->
                <div class="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    <button type="button" onclick="previewAnnexure('${ann.id}')" title="Preview Annexure Pages" aria-label="Preview Annexure ${letter}" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                    <button type="button" onclick="reorderAnnexure('${ann.id}', 'up')" ${isFirst ? 'disabled' : ''} title="Move Up" aria-label="Move Annexure ${letter} up" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg>
                    </button>
                    <button type="button" onclick="reorderAnnexure('${ann.id}', 'down')" ${isLast ? 'disabled' : ''} title="Move Down" aria-label="Move Annexure ${letter} down" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <button type="button" onclick="removeAnnexure('${ann.id}')" title="Delete Annexure" aria-label="Delete Annexure ${letter}" class="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renders the compact annexures summary inside the PDF Report Settings modal.
 */
export function renderPDFModalAnnexuresList() {
    const listEl = document.getElementById('pdf-modal-annexures-list');
    if (!listEl) return;

    const annexures = Array.isArray(state.annexures) ? state.annexures : [];
    if (annexures.length === 0) {
        listEl.innerHTML = `
            <div class="text-[11px] text-slate-500 italic p-2 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-800 text-center">
                No PDF annexures attached yet. You can attach supporting documents below.
            </div>
        `;
        return;
    }

    listEl.innerHTML = annexures.map((ann, idx) => {
        const letter = String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) : '');
        return `
            <div class="flex items-center justify-between text-xs p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200/50 dark:border-slate-800">
                <div class="flex items-center gap-2 truncate">
                    <span class="font-extrabold text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                        ${letter}
                    </span>
                    <span class="font-semibold text-slate-700 dark:text-slate-300 truncate">${escapeHtml(ann.title)}</span>
                    <span class="text-[10px] text-slate-400">(${ann.pageCount}p)</span>
                </div>
                <button type="button" onclick="removeAnnexure('${ann.id}')" title="Remove" class="text-rose-500 hover:text-rose-700 font-bold p-0.5 cursor-pointer">✕</button>
            </div>
        `;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
