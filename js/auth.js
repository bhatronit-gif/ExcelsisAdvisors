/**
 * js/auth.js — Auditor Profile Selector & Secure SHA-256 Authentication (AUD-JS-H3)
 * Replaces plaintext inline password checks with Web Cryptography API (crypto.subtle.digest) hashing.
 */

import { AUDITOR_HASHES } from './config.js';
import { state, saveState } from './state.js';
import { showToast, trapFocus, releaseFocus } from './ui.js';
import { fetchHistory } from './export.js';

/**
 * Asynchronously computes SHA-256 hash string for password verification (AUD-JS-H3)
 */
export async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkAuthentication() {
    const user = localStorage.getItem("excelsis_logged_in_user");
    if (user && AUDITOR_HASHES[user]) {
        state.loggedInUser = user;
        state.auditor = user;
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.classList.add('hidden');
        releaseFocus();
        const label = document.getElementById('active-auditor-label');
        if (label) label.innerHTML = user;
        await fetchHistory();
    } else {
        showLoginOverlay();
    }
}

export function showLoginOverlay() {
    state.loggedInUser = null;
    state.auditor = "";
    const label = document.getElementById('active-auditor-label');
    if (label) label.innerHTML = "Not Authenticated";
    
    const overlay = document.getElementById('login-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        trapFocus('login-overlay');
    }
    const passInput = document.getElementById('login-pass');
    if (passInput) passInput.value = "";
}

export async function handleLoginSubmit() {
    const userSelect = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');
    
    if (!userSelect || !passInput) return;
    
    const selectedUser = userSelect.value;
    const enteredPass = passInput.value;
    
    // Hash entered password using SHA-256 Web Crypto API (AUD-JS-H3)
    const enteredHash = await hashPassword(enteredPass);
    const expectedHash = AUDITOR_HASHES[selectedUser];
    
    if (expectedHash && expectedHash === enteredHash) {
        localStorage.setItem("excelsis_logged_in_user", selectedUser);
        state.loggedInUser = selectedUser;
        state.auditor = selectedUser;
        
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.classList.add('hidden');
        releaseFocus();
        
        const label = document.getElementById('active-auditor-label');
        if (label) label.innerHTML = selectedUser;
        
        saveState.flush();
        await saveState();
        await fetchHistory();
        showToast(`Welcome back, ${selectedUser}!`);
    } else {
        showToast("Invalid credentials. Please try again.", "error");
        passInput.value = "";
        passInput.focus();
    }
}

export function logOutAuditor() {
    if (!confirm("Are you sure you want to log out? Unsaved changes will remain in local drafts.")) return;
    saveState.flush();
    localStorage.removeItem("excelsis_logged_in_user");
    showLoginOverlay();
}

export const handleLogin = handleLoginSubmit;
export const handleLogout = logOutAuditor;
export { trapFocus, releaseFocus } from './ui.js';

