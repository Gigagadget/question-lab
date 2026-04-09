/**
 * JavaScript per la pagina Gestione Database
 */

// Variabili globali
let databases = [];
let activeDatabase = null;
let deleteTarget = null;

// ==================== INIZIALIZZAZIONE ====================

document.addEventListener('DOMContentLoaded', function() {
    initDatabasesPage();
});

function initDatabasesPage() {
    // Carica i database
    loadDatabases();
    
    // Setup event listeners
    setupEventListeners();
    
    // Auto-refresh ogni 10 secondi
    setInterval(loadDatabases, 10000);
}

function setupEventListeners() {
    // Toolbar buttons
    document.getElementById('btnHelp')?.addEventListener('click', () => showModal('helpModal'));
    document.getElementById('btnNew')?.addEventListener('click', () => showModal('newDbModal'));
    document.getElementById('btnUpload')?.addEventListener('click', () => showModal('uploadModal'));
    document.getElementById('btnScan')?.addEventListener('click', scanDatabases);
    
    // Modal: New Database
    document.getElementById('btnCreateDb').addEventListener('click', createDatabase);
    document.getElementById('btnCancelNew').addEventListener('click', () => hideModal('newDbModal'));
    document.getElementById('newDbName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createDatabase();
    });
    
    // Modal: Upload
    document.getElementById('btnDoUpload').addEventListener('click', uploadDatabase);
    document.getElementById('btnCancelUpload').addEventListener('click', () => hideModal('uploadModal'));
    
    // Modal: Rename
    document.getElementById('btnDoRename').addEventListener('click', renameDatabase);
    document.getElementById('btnCancelRename').addEventListener('click', () => hideModal('renameModal'));
    document.getElementById('renameNewName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') renameDatabase();
    });
    
    // Modal: Delete (prima conferma)
    document.getElementById('btnDoDelete').addEventListener('click', () => {
        hideModal('deleteModal');
        showModal('deleteConfirm2Modal');
    });
    document.getElementById('btnCancelDelete').addEventListener('click', () => {
        hideModal('deleteModal');
        deleteTarget = null;
    });
    
    // Modal: Delete (seconda conferma)
    document.getElementById('btnDoDelete2').addEventListener('click', confirmDelete);
    document.getElementById('btnCancelDelete2').addEventListener('click', () => {
        hideModal('deleteConfirm2Modal');
        deleteTarget = null;
    });
    
    // Close buttons per tutti i modal
    document.querySelectorAll('.modal .close').forEach(btn => {
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

// ==================== CARICAMENTO DATABASE ====================

async function loadDatabases() {
    try {
        const response = await fetch('/api/databases');
        const data = await response.json();
        
        if (response.ok) {
            databases = data.databases || [];
            activeDatabase = data.active_database;
            renderDatabasesList();
            updateDbCount();
        } else {
            showStatus('Errore nel caricamento database: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

function renderDatabasesList() {
    const container = document.getElementById('databasesList');
    
    if (databases.length === 0) {
        container.innerHTML = '<div class="empty-list">Nessun database trovato. Crea un nuovo database o carica un file JSON.</div>';
        return;
    }
    
    let html = '';
    databases.forEach(db => {
        const isActive = db.name === activeDatabase;
        html += `
            <div class="database-card ${isActive ? 'active' : ''}" data-name="${db.name}">
                <div class="database-card-header">
                    <span class="database-icon">📊</span>
                    <span class="database-name">${db.name}</span>
                    ${isActive ? '<span class="active-badge">ATTIVO</span>' : ''}
                </div>
                <div class="database-info">
                    <span>📝 ${db.question_count} domande</span>
                    <span>📅 ${formatDate(db.last_modified)}</span>
                </div>
                <div class="database-actions">
                    ${!isActive ? `<button class="success" onclick="selectDatabase('${db.name}')">✅ Seleziona</button>` : ''}
                    <button class="info" onclick="showDatabaseDetail('${db.name}')">👁️ Dettagli</button>
                    <button class="warning" onclick="showRenameModal('${db.name}')">✏️ Rinomina</button>
                    <button class="secondary" onclick="downloadDatabase('${db.name}')">⬇️ Download</button>
                    <button class="danger" onclick="showDeleteModal('${db.name}')">🗑️ Elimina</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updateDbCount() {
    document.getElementById('dbCount').textContent = databases.length;
}

// ==================== SELEZIONE DATABASE ====================

async function selectDatabase(name) {
    try {
        showStatus('Selezione database in corso...', 'info');
        
        const response = await fetch('/api/databases/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            activeDatabase = name;
            renderDatabasesList();
            showStatus(`Database '${name}' selezionato`, 'success');
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== DETTAGLIO DATABASE ====================

function showDatabaseDetail(name) {
    const db = databases.find(d => d.name === name);
    if (!db) return;
    
    const panel = document.getElementById('detailPanel');
    const isActive = db.name === activeDatabase;
    
    panel.innerHTML = `
        <div class="database-detail-content">
            <div class="detail-header">
                <span class="detail-icon">📊</span>
                <div class="detail-title">
                    <h2>${db.name}</h2>
                    <p>${isActive ? 'Database attivo' : 'Database disponibile'}</p>
                </div>
            </div>
            
            <div class="detail-stats">
                <div class="stat-card">
                    <div class="stat-value">${db.question_count}</div>
                    <div class="stat-label">Domande</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatDate(db.created)}</div>
                    <div class="stat-label">Creato</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatDate(db.last_modified)}</div>
                    <div class="stat-label">Ultima Modifica</div>
                </div>
            </div>
            
            <div class="detail-actions">
                ${!isActive ? `<button class="success" onclick="selectDatabase('${db.name}')">✅ Seleziona come Attivo</button>` : '<button class="info" disabled>✅ Già Attivo</button>'}
                <button class="warning" onclick="showRenameModal('${db.name}')">✏️ Rinomina</button>
                <button class="secondary" onclick="downloadDatabase('${db.name}')">⬇️ Download JSON</button>
                <button class="danger" onclick="showDeleteModal('${db.name}')">🗑️ Elimina</button>
            </div>
        </div>
    `;
}

// ==================== VALIDAZIONE NOMI ====================

function validateDatabaseName(name) {
    const errors = [];
    
    if (!name || name.trim() === '') {
        errors.push('Il nome non può essere vuoto');
        return { valid: false, errors };
    }
    
    const trimmed = name.trim();
    
    if (trimmed.length < 2) {
        errors.push('Il nome deve avere almeno 2 caratteri');
    }
    
    if (trimmed.length > 50) {
        errors.push('Il nome non può superare 50 caratteri');
    }
    
    if (/[^a-zA-Z0-9\s\-_]/.test(trimmed)) {
        errors.push('Il nome contiene caratteri non validi (solo lettere, numeri, spazi, trattini e underscore)');
    }
    
    if (/^[\s\-_]+|[\s\-_]+$/.test(trimmed)) {
        errors.push('Il nome non può iniziare o finire con spazi, trattini o underscore');
    }
    
    if (/[\s\-_]{2,}/.test(trimmed)) {
        errors.push('Il nome non può avere spazi, trattini o underscore consecutivi');
    }
    
    return {
        valid: errors.length === 0,
        errors: errors,
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
    const formGroup = input.closest('.form-group');
    
    // Rimuovi errore precedente
    clearInputError(inputId);
    
    // Aggiungi classe errore all'input
    input.classList.add('error');
    
    // Crea messaggio di errore
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.id = inputId + '-error';
    
    // Inserisci dopo l'input
    input.parentNode.insertBefore(errorDiv, input.nextSibling);
}

function clearInputError(inputId) {
    const input = document.getElementById(inputId);
    const formGroup = input.closest('.form-group');
    
    // Rimuovi classe errore
    input.classList.remove('error');
    
    // Rimuovi messaggio di errore se esiste
    const existingError = document.getElementById(inputId + '-error');
    if (existingError) {
        existingError.remove();
    }
}

// ==================== CREAZIONE DATABASE ====================

async function createDatabase() {
    const nameInput = document.getElementById('newDbName');
    const name = nameInput.value.trim();
    
    // Valida il nome
    const validation = validateDatabaseName(name);
    
    if (!validation.valid) {
        showInputError('newDbName', validation.errors[0]);
        return;
    }
    
    // Pulisci eventuali errori precedenti
    clearInputError('newDbName');
    
    try {
        showStatus('Creazione database in corso...', 'info');
        
        const response = await fetch('/api/databases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            hideModal('newDbModal');
            nameInput.value = '';
            showStatus(`Database '${data.database.name}' creato con successo`, 'success');
            loadDatabases();
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
            loadDatabases();
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== RINOMINA DATABASE ====================

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
    
    // Valida il nome
    const validation = validateDatabaseName(newName);
    
    if (!validation.valid) {
        showInputError('renameNewName', validation.errors[0]);
        return;
    }
    
    if (newName === oldName) {
        hideModal('renameModal');
        return;
    }
    
    // Pulisci eventuali errori precedenti
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
            loadDatabases();
        } else {
            showInputError('renameNewName', data.error);
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== ELIMINAZIONE DATABASE ====================

function showDeleteModal(name) {
    deleteTarget = name;
    document.getElementById('deleteMessage').innerHTML = `Stai per eliminare il database <strong>'${name}'</strong>. Questa azione non può essere annullata.`;
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
            
            // Reset detail panel
            document.getElementById('detailPanel').innerHTML = `
                <div class="detail-placeholder">
                    <div class="placeholder-icon">📖</div>
                    <h3>Seleziona un database</h3>
                    <p>Scegli un database dalla lista per visualizzarne i dettagli</p>
                </div>
            `;
            
            loadDatabases();
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== DOWNLOAD DATABASE ====================

function downloadDatabase(name) {
    window.location.href = `/api/databases/${name}/download`;
}

// ==================== SCANSIONE ====================

async function scanDatabases() {
    try {
        showStatus('Scansione in corso...', 'info');
        
        const response = await fetch('/api/databases/scan', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            databases = data.databases || [];
            activeDatabase = data.active_database;
            renderDatabasesList();
            updateDbCount();
            showStatus('Scansione completata', 'success');
        } else {
            showStatus('Errore: ' + data.error, 'error');
        }
    } catch (error) {
        showStatus('Errore di connessione: ' + error.message, 'error');
    }
}

// ==================== UTILITY ====================

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
    
    // Auto-clear dopo 5 secondi per messaggi di successo
    if (type === 'success') {
        setTimeout(() => {
            statusEl.textContent = 'Pronto';
            statusEl.className = 'status';
        }, 5000);
    }
}

function formatDate(dateString) {
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