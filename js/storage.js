/**
 * js/storage.js — Storage & Persistence Layer
 * Client-side IndexedDB with LocalStorage fallback, draft management, and timer debounce helper.
 */

import { DB_NAME, DB_VERSION, STORAGE_KEY, getDefaultAcademicYear } from './config.js';

let dbInstance = null;
let useLocalStorageFallback = false;

/**
 * Creates a debounced version of a function that delays execution until after 'delay' ms.
 * Attaches a .flush() method to force immediate execution of pending invocations.
 */
export function debounce(fn, delay = 400) {
    let timeoutId = null;
    let lastArgs = null;
    let lastThis = null;

    const debounced = function(...args) {
        lastArgs = args;
        lastThis = this;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn.apply(lastThis, lastArgs);
            timeoutId = null;
            lastArgs = null;
            lastThis = null;
        }, delay);
    };

    debounced.flush = function() {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            fn.apply(lastThis, lastArgs);
            timeoutId = null;
            lastArgs = null;
            lastThis = null;
        }
    };

    debounced.cancel = function() {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
            lastArgs = null;
            lastThis = null;
        }
    };

    return debounced;
}

export function isFallbackMode() {
    return useLocalStorageFallback;
}

export function initIndexedDB() {
    return new Promise((resolve) => {
        if (!window.indexedDB) {
            console.warn("IndexedDB not supported. Falling back to localStorage.");
            useLocalStorageFallback = true;
            resolve(null);
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("active_state")) {
                db.createObjectStore("active_state");
            }
            if (!db.objectStoreNames.contains("drafts")) {
                db.createObjectStore("drafts");
            }
        };
        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };
        request.onerror = (e) => {
            console.error("IndexedDB blocked or failed to initialize:", e.target.error);
            useLocalStorageFallback = true;
            resolve(null);
        };
    });
}

export function dbGet(storeName, key) {
    if (useLocalStorageFallback) {
        const item = localStorage.getItem(storeName === "active_state" ? key : `excelsis_draft_${key}`);
        return Promise.resolve(item ? JSON.parse(item) : null);
    }
    return new Promise((resolve, reject) => {
        if (!dbInstance) return resolve(null);
        const transaction = dbInstance.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

export function dbSet(storeName, key, value) {
    if (useLocalStorageFallback) {
        localStorage.setItem(storeName === "active_state" ? key : `excelsis_draft_${key}`, JSON.stringify(value));
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        if (!dbInstance) return resolve();
        const transaction = dbInstance.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export function dbDelete(storeName, key) {
    if (useLocalStorageFallback) {
        localStorage.removeItem(storeName === "active_state" ? key : `excelsis_draft_${key}`);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        if (!dbInstance) return resolve();
        const transaction = dbInstance.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export function dbGetAll(storeName) {
    if (useLocalStorageFallback) {
        if (storeName === "active_state") {
            const item = localStorage.getItem(STORAGE_KEY);
            return Promise.resolve(item ? [JSON.parse(item)] : []);
        } else {
            const drafts = [];
            const oldDbStr = localStorage.getItem("excelsis_local_db_drafts");
            if (oldDbStr) {
                try {
                    const oldDb = JSON.parse(oldDbStr);
                    Object.values(oldDb).forEach(val => drafts.push(val));
                } catch(e) {}
            }
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith("excelsis_draft_")) {
                    try {
                        drafts.push(JSON.parse(localStorage.getItem(key)));
                    } catch(e) {}
                }
            }
            return Promise.resolve(drafts);
        }
    }
    return new Promise((resolve, reject) => {
        if (!dbInstance) return resolve([]);
        const transaction = dbInstance.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

export async function migrateLocalStorageToIndexedDB(onNotify = () => {}) {
    if (useLocalStorageFallback) return;

    // 1. Migrate drafts
    const oldDbStr = localStorage.getItem("excelsis_local_db_drafts");
    if (oldDbStr) {
        try {
            const oldDb = JSON.parse(oldDbStr);
            const keys = Object.keys(oldDb);
            if (keys.length > 0) {
                onNotify(`Migrating ${keys.length} drafts from localStorage to IndexedDB...`, "info");
                for (const key of keys) {
                    const draft = oldDb[key];
                    await dbSet("drafts", key, draft);
                }
                localStorage.removeItem("excelsis_local_db_drafts");
                onNotify(`Successfully migrated ${keys.length} drafts!`, "success");
            }
        } catch(e) {
            console.error("Migration of drafts failed:", e);
        }
    }

    // 2. Migrate current active state
    const activeStateStr = localStorage.getItem(STORAGE_KEY);
    if (activeStateStr) {
        try {
            const activeState = JSON.parse(activeStateStr);
            await dbSet("active_state", "state", activeState);
            localStorage.removeItem(STORAGE_KEY);
        } catch(e) {
            console.error("Migration of active state failed:", e);
        }
    }
}

export async function saveLocalDraftToDB(filename, auditor, data, currentScore) {
    const key = `${filename}|${auditor}`;
    const draft = {
        filename: filename,
        school: data.school,
        academicYear: data.academicYear || data.academic_year || getDefaultAcademicYear(data.date),
        auditor: auditor,
        date: data.date,
        score: currentScore,
        ai_summary: data.aiSummary || "",
        audit_data: data.auditData,
        last_updated: new Date().toISOString()
    };
    await dbSet("drafts", key, draft);
}

export async function deleteLocalDraftFromDB(filename, auditor) {
    const key = `${filename}|${auditor}`;
    await dbDelete("drafts", key);
}

export { loadState, saveState, saveStateNow } from './state.js';
export { saveState as debouncedSaveState } from './state.js';

