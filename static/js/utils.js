/**
 * Simple HTML sanitizer to prevent DOM-based XSS.
 * Escapes common sensitive characters.
 */
function sanitizeHTML(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// Export for use in other scripts
window.sanitizeHTML = sanitizeHTML;
