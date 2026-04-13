/**
 * JavaScript per la pagina Gestione Database v2
 * UI moderna con cards grid, stats bar e SVG icons
 */

// ==================== STATE ====================
let databases = [];
let activeDatabase = null;
let deleteTarget = null;
let globalStats = {
    totalQuestions: 0,
    totalDuplicates: 0,
    totalCategories: 0
};

// ==================== SVG ICONS ====================
const SVG_ICONS = {
    check: '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    eye: '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    download: '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    trash: '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    list: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    tag: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    calendar: '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    emptyDb: '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    initDatabasesPage();
});

function initDatabasesPage() {
    loadAllData();
    setupEventListeners();
    setInterval(loadAllData, 10000);
}

async function loadAllData() {
    await Promise.all([
        loadDatabases(),
        loadGlobalStats(),
        loadBackups()
    ]);
    await loadCategoryCounts();
    render();
}

async function loadCategoryCounts() {
    // Carica le statistiche (categorie) per ogni database
    const promises = databases.map(async (db) => {
        try {
            const response = await fetch(`/api/databases/${encodeURIComponent(db.name)}/stats`);
            if (response.ok) {
                const stats = await response.json();
                db.category_count = stats.category_count;
                db.duplicate_count = stats.duplicate_count;
            }
        } catch (error) {
            console.error(`Errore stats per ${db.name}:`, error);
        }
    });
    await Promise.all(promises);
}

// ==================== DATA LOADING ====================
async function loadDatabases() {
    try {
        const response = await fetch('/api/databases');
        const data = await response.json();
        if (response.ok) {
            databases = data.databases || [];
            activeDatabase = data.active_database;
        } else {
            showStatus('Errore nel caricamento database: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

async function loadGlobalStats() {
    try {
        const response = await fetch('/api/stats');
        if (response.ok) {
            const data = await response.json();
            globalStats = {
                totalQuestions: data.total_questions || 0,
                totalDuplicates: data.total_duplicates || 0,
                totalCategories: data.primary_domain_count || 0
            };
        }
    } catch (error) {
        console.error('Errore caricamento stats:', error);
    }
}

async function loadBackups() {
    try {
        const response = await fetch('/api/backups');
        if (response.ok) {
            const data = await response.json();
            if (data.backups && data.backups.length > 0) {
                globalStats.lastBackup = formatRelativeTime(data.backups[0].modified);
            } else {
                globalStats.lastBackup = 'N/D';
            }
        }
    } catch (error) {
        console.error('Errore caricamento backup:', error);
        globalStats.lastBackup = 'N/D';
    }
}

// ==================== RENDERING ====================
function render() {
    renderStatsBar();
    renderDatabasesGrid();
    updateDbCount();
}

function renderStatsBar() {
    document.getElementById('statTotalQuestions').textContent = globalStats.totalQuestions.toLocaleString('it-IT');
    document.getElementById('statActiveDb').textContent = activeDatabase || 'Nessuno';
    document.getElementById('statLastBackup').textContent = globalStats.lastBackup || 'N/D';
}

function renderDatabasesGrid() {
    const container = document.getElementById('databasesGrid');

    if (databases.length === 0) {
        container.innerHTML = renderEmptyState();
        return;
    }

    container.innerHTML = databases.map(db => renderDatabaseCard(db)).join('');
}

function renderEmptyState() {
    return `
        <div class="empty-state">
            ${SVG_ICONS.emptyDb}
            <h3>Nessun Database</h3>
            <p>Crea un nuovo database o importa un file JSON per iniziare</p>
            <button class="btn-primary" onclick="showModal('newDbModal')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nuovo Database
            </button>
        </div>
    `;
}

function renderDatabaseCard(db) {
    const isActive = db.name === activeDatabase;

    const badge = isActive
        ? `<span class="active-badge">${SVG_ICONS.check.replace('btn-icon', 'badge-icon')} Attivo</span>`
        : '';

    const catCount = db.category_count != null ? db.category_count : '—';

    const stats = `
        <div class="card-stats">
            <div class="stat">
                ${SVG_ICONS.list}
                <span><strong>${db.question_count}</strong> domande</span>
            </div>
            <div class="stat">
                ${SVG_ICONS.tag}
                <span><strong>${catCount}</strong> categorie</span>
            </div>
            <div class="stat">
                ${SVG_ICONS.calendar}
                <span>${formatRelativeTime(db.last_modified)}</span>
            </div>
        </div>
    `;

    const selectButton = !isActive
        ? `<button class="db-action-btn primary" onclick="selectDatabase('${db.name}')">${SVG_ICONS.check} Seleziona</button>`
        : `<button class="db-action-btn primary" disabled>${SVG_ICONS.check} Già Attivo</button>`;

    return `
        <div class="database-card ${isActive ? 'active' : ''}" data-name="${escapeHtml(db.name)}">
            <div class="card-header">
                <div class="db-name-section">
                    <span class="db-name">${escapeHtml(db.name)}</span>
                    ${badge}
                </div>
            </div>
            ${stats}
            <div class="card-actions">
                ${selectButton}
                <button class="db-action-btn" onclick="showRenameModal('${db.name}')">${SVG_ICONS.edit} Rinomina</button>
                <button class="db-action-btn" onclick="downloadDatabase('${db.name}')">${SVG_ICONS.download} Download</button>
                <button class="db-action-btn danger" onclick="showDeleteModal('${db.name}')">${SVG_ICONS.trash} Elimina</button>
            </div>
        </div>
    `;
}

function updateDbCount() {
    const count = databases.length;
    document.getElementById('dbCountLabel').textContent = `(${count} totali)`;
}

// ==================== DATABASE ACTIONS ====================
async function selectDatabase(name) {
    try {
        showStatus('Selezione database in corso...', 'info');
        const response = await fetch('/api/databases/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        if (response.ok) {
            activeDatabase = name;
            // Ricarica tutti i dati per aggiornare stats bar con il nuovo database
            await loadAllData();
            showStatus(`Database '${name}' selezionato`, 'success');
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

function showDatabaseDetail(name) {
    const db = databases.find(d => d.name === name);
    if (!db) return;
    showStatus(`Database: ${db.name} - ${db.question_count} domande`, 'info');
}

function downloadDatabase(name) {
    window.location.href = `/api/databases/${name}/download`;
}

// ==================== CREATE DATABASE ====================
async function createDatabase() {
    const nameInput = document.getElementById('newDbName');
    const name = nameInput.value.trim();
    const validation = validateDatabaseName(name);
    if (!validation.valid) {
        showInputError('newDbName', validation.errors[0]);
        return;
    }
    clearInputError('newDbName');
    try {
        showStatus('Creazione database in corso...', 'info');
        const response = await fetch('/api/databases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        if (response.ok) {
            hideModal('newDbModal');
            nameInput.value = '';
            showStatus(`Database '${data.database.name}' creato con successo`, 'success');
            loadAllData();
        } else {
            showInputError('newDbName', data.error);
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== UPLOAD DATABASE ====================
async function uploadDatabase() {
    const fileInput = document.getElementById('uploadFile');
    const nameInput = document.getElementById('uploadName');
    if (!fileInput.files.length) {
        showStatus('Seleziona un file JSON', 'error');
        return;
    }
    const file = fileInput.files[0];
    const customName = nameInput.value.trim();
    const formData = new FormData();
    formData.append('file', file);
    if (customName) {
        formData.append('name', customName);
    }
    try {
        showStatus('Upload in corso...', 'info');
        const response = await fetch('/api/databases/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            hideModal('uploadModal');
            fileInput.value = '';
            nameInput.value = '';
            showStatus(`Database '${data.database.name}' caricato con successo (${data.database.question_count} domande)`, 'success');
            loadAllData();
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== RENAME DATABASE ====================
function showRenameModal(name) {
    document.getElementById('renameOldName').value = name;
    document.getElementById('renameNewName').value = name;
    showModal('renameModal');
    document.getElementById('renameNewName').focus();
    document.getElementById('renameNewName').select();
}

async function renameDatabase() {
    const oldName = document.getElementById('renameOldName').value;
    const newNameInput = document.getElementById('renameNewName');
    const newName = newNameInput.value.trim();
    const validation = validateDatabaseName(newName);
    if (!validation.valid) {
        showInputError('renameNewName', validation.errors[0]);
        return;
    }
    if (newName === oldName) {
        hideModal('renameModal');
        return;
    }
    clearInputError('renameNewName');
    try {
        showStatus('Rinomina in corso...', 'info');
        const response = await fetch(`/api/databases/${oldName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName })
        });
        const data = await response.json();
        if (response.ok) {
            hideModal('renameModal');
            showStatus(`Database rinominato in '${data.new_name}'`, 'success');
            loadAllData();
        } else {
            showInputError('renameNewName', data.error);
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== DELETE DATABASE ====================
function showDeleteModal(name) {
    deleteTarget = name;
    document.getElementById('deleteMessage').innerHTML = `Stai per eliminare il database <strong>'${escapeHtml(name)}'</strong>. Questa azione non può essere annullata.`;
    showModal('deleteModal');
}

async function confirmDelete() {
    if (!deleteTarget) return;
    hideModal('deleteConfirm2Modal');
    try {
        showStatus('Eliminazione in corso...', 'info');
        const response = await fetch(`/api/databases/${deleteTarget}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`Database '${deleteTarget}' eliminato`, 'success');
            deleteTarget = null;
            loadAllData();
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== SCAN ====================
async function scanDatabases() {
    try {
        showStatus('Scansione in corso...', 'info');
        const response = await fetch('/api/databases/scan', {
            method: 'POST'
        });
        const data = await response.json();
        if (response.ok) {
            showStatus('Scansione completata', 'success');
            loadAllData();
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== VALIDATION ====================
function validateDatabaseName(name) {
    const errors = [];
    if (!name || name.trim() === '') {
        errors.push('Il nome non può essere vuoto');
        return { valid: false, errors };
    }
    const trimmed = name.trim();
    if (trimmed.length < 2) errors.push('Il nome deve avere almeno 2 caratteri');
    if (trimmed.length > 50) errors.push('Il nome non può superare 50 caratteri');
    if (/[^a-zA-Z0-9\s\-_]/.test(trimmed)) errors.push('Il nome contiene caratteri non validi (solo lettere, numeri, spazi, trattini e underscore)');
    if (/^[\s\-_]+|[\s\-_]+$/.test(trimmed)) errors.push('Il nome non può iniziare o finire con spazi, trattini o underscore');
    if (/[\s\-_]{2,}/.test(trimmed)) errors.push('Il nome non può avere spazi, trattini o underscore consecutivi');
    return {
        valid: errors.length === 0,
        errors,
        sanitized: errors.length === 0 ? sanitizeName(trimmed) : null
    };
}

function sanitizeName(name) {
    return name
        .toLowerCase()
        .replace(/[^\w\s\-]/g, '')
        .replace(/[\s]+/g, '_')
        .replace(/[_\-]+/g, '_')
        .replace(/^[_\-]+|[_\-]+$/g, '')
        .substring(0, 50);
}

function showInputError(inputId, message) {
    const input = document.getElementById(inputId);
    input.classList.add('error');
    clearInputError(inputId);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.id = inputId + '-error';
    input.parentNode.insertBefore(errorDiv, input.nextSibling);
}

function clearInputError(inputId) {
    const input = document.getElementById(inputId);
    input.classList.remove('error');
    const existingError = document.getElementById(inputId + '-error');
    if (existingError) existingError.remove();
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Sidebar help button
    document.getElementById('btnHelpSidebar')?.addEventListener('click', () => showModal('helpModal'));

    // Top bar buttons
    document.getElementById('btnNew')?.addEventListener('click', () => showModal('newDbModal'));
    document.getElementById('btnUpload')?.addEventListener('click', () => showModal('uploadModal'));
    document.getElementById('btnScan')?.addEventListener('click', scanDatabases);

    // New Database modal
    document.getElementById('btnCreateDb').addEventListener('click', createDatabase);
    document.getElementById('btnCancelNew').addEventListener('click', () => hideModal('newDbModal'));
    document.getElementById('newDbName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createDatabase();
    });

    // Upload modal
    document.getElementById('btnDoUpload').addEventListener('click', uploadDatabase);
    document.getElementById('btnCancelUpload').addEventListener('click', () => hideModal('uploadModal'));

    // Rename modal
    document.getElementById('btnDoRename').addEventListener('click', renameDatabase);
    document.getElementById('btnCancelRename').addEventListener('click', () => hideModal('renameModal'));
    document.getElementById('renameNewName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') renameDatabase();
    });

    // Delete modals
    document.getElementById('btnDoDelete').addEventListener('click', () => {
        hideModal('deleteModal');
        showModal('deleteConfirm2Modal');
    });
    document.getElementById('btnCancelDelete').addEventListener('click', () => {
        hideModal('deleteModal');
        deleteTarget = null;
    });
    document.getElementById('btnDoDelete2').addEventListener('click', confirmDelete);
    document.getElementById('btnCancelDelete2').addEventListener('click', () => {
        hideModal('deleteConfirm2Modal');
        deleteTarget = null;
    });

    // Close buttons per tutti i modal (usa .close-modal come le altre pagine)
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });

    // Chiudi modal cliccando fuori
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    });
}

// ==================== UTILITIES ====================
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMsg');
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    if (type === 'success') {
        setTimeout(() => {
            statusEl.textContent = 'Pronto';
            statusEl.className = 'status';
        }, 5000);
    }
}

function formatRelativeTime(dateString) {
    if (!dateString) return 'N/D';
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffMins < 1) return 'Ora';
        if (diffMins < 60) return `${diffMins}m fa`;
        if (diffHours < 24) return `${diffHours}h fa`;
        if (diffDays < 7) return `${diffDays}g fa`;
        return date.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch {
        return 'N/D';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== GLOBAL API ====================
window.selectDatabase = selectDatabase;
window.showDatabaseDetail = showDatabaseDetail;
window.downloadDatabase = downloadDatabase;
window.showRenameModal = showRenameModal;
window.showDeleteModal = showDeleteModal;
window.showModal = showModal;
window.hideModal = hideModal;
