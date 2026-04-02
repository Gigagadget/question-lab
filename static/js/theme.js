/**
 * Theme Manager - Gestione tema scuro/chiaro
 * Salva la preferenza dell'utente su file server tramite API
 */

(function() {
    'use strict';

    const DARK_THEME = 'dark';
    const LIGHT_THEME = 'light';

    /**
     * Ottiene il tema corrente dal server o dal sistema
     */
    async function getPreferredTheme() {
        try {
            const response = await fetch('/api/preferences');
            if (response.ok) {
                const data = await response.json();
                return data.theme || LIGHT_THEME;
            }
        } catch (err) {
            console.warn('Errore nel caricamento preferenze dal server:', err);
        }
        
        // Fallback: preferenza del sistema
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return DARK_THEME;
        }
        
        return LIGHT_THEME;
    }

    /**
     * Applica il tema al documento
     */
    async function applyTheme(theme) {
        if (theme === DARK_THEME) {
            document.documentElement.setAttribute('data-theme', DARK_THEME);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        
        // Aggiorna tutti i toggle button nella pagina
        updateToggleButtons(theme);
        
        // Salva sul server
        try {
            const response = await fetch('/api/preferences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ theme: theme })
            });
            if (!response.ok) {
                console.warn('Errore nel salvataggio del tema sul server');
            }
        } catch (err) {
            console.warn('Errore nella comunicazione con il server:', err);
        }
    }

    /**
     * Aggiorna lo stato dei toggle button
     */
    function updateToggleButtons(theme) {
        const toggles = document.querySelectorAll('.theme-toggle');
        
        toggles.forEach(toggle => {
            const icon = toggle.querySelector('.theme-toggle-icon');
            
            if (icon) {
                icon.textContent = theme === DARK_THEME ? '🌙' : '☀️';
            }
        });
    }

    /**
     * Inverte il tema corrente
     */
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || LIGHT_THEME;
        const newTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
        applyTheme(newTheme);
        
        // Log per debug
        console.log(`Theme changed to: ${newTheme}`);
    }

    /**
     * Crea un toggle button e lo inserisce nella toolbar
     */
    function createThemeToggle() {
        // Cerca la toolbar
        const toolbar = document.querySelector('.toolbar');
        
        if (!toolbar) {
            console.warn('Toolbar non trovata, skip theme toggle');
            return;
        }
        
        // Controlla se il toggle esiste già
        if (toolbar.querySelector('.theme-toggle')) {
            return;
        }
        
        // Crea il toggle button
        const toggle = document.createElement('button');
        toggle.className = 'theme-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Cambia tema');
        toggle.setAttribute('title', 'Cambia tema (Scuro/Chiaro)');
        
        const currentTheme = document.documentElement.getAttribute('data-theme') || LIGHT_THEME;
        const icon = currentTheme === DARK_THEME ? '🌙' : '☀️';
        
        toggle.innerHTML = `
            <span class="theme-toggle-icon">${icon}</span>
        `;
        
        // Aggiungi event listener
        toggle.addEventListener('click', toggleTheme);
        
        // Inserisci nella toolbar (dopo status e auto-save)
        const autoSaveEl = toolbar.querySelector('.auto-save-indicator');
        if (autoSaveEl) {
            toolbar.appendChild(toggle);
        } else {
            const statusEl = toolbar.querySelector('.status');
            if (statusEl) {
                toolbar.insertBefore(toggle, statusEl.nextSibling);
            } else {
                toolbar.appendChild(toggle);
            }
        }
    }

    /**
     * Inizializza il theme manager
     */
    async function init() {
        // Applica il tema preferito
        const preferredTheme = await getPreferredTheme();
        applyTheme(preferredTheme);
        
        // Crea il toggle button
        createThemeToggle();
        
        // Ascolta i cambiamenti della preferenza di sistema
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
                // Solo se il server ritorna il tema di default
                const prefs = await getPreferredTheme();
                if (prefs === LIGHT_THEME || prefs === DARK_THEME) {
                    applyTheme(e.matches ? DARK_THEME : LIGHT_THEME);
                }
            });
        }
        
        console.log('Theme Manager inizializzato. Tema corrente:', preferredTheme);
    }

    // Inizializza quando il DOM è pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Esponi la funzione toggle globalmente per eventuali usi esterni
    window.toggleTheme = toggleTheme;
    window.setTheme = applyTheme;
    window.getTheme = () => document.documentElement.getAttribute('data-theme') || LIGHT_THEME;

})();
