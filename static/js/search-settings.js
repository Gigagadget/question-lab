/**
 * Search Settings UI - Settings panel management and persistence
 */

class SearchSettings {
    constructor() {
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSettings();
    }

setupEventListeners() {
    const settingsNav = document.getElementById('settingsNavItem');
    if (settingsNav) {
      settingsNav.addEventListener('click', () => this.togglePanel());
    }

    const backdrop = document.getElementById('settingsBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => this.closePanel());
    }

        // Search mode select
        const modeSelect = document.getElementById('searchModeSelect');
        if (modeSelect) {
            modeSelect.addEventListener('change', (e) => {
                this.updateSetting('mode', e.target.value);
            });
        }

        // Toggle switches
        const toggles = [
            { id: 'highlightEnabled', key: 'highlightEnabled' },
            { id: 'searchAnswers', key: 'searchAnswers' },
            { id: 'searchNotes', key: 'searchNotes' },
            { id: 'searchCategories', key: 'searchCategories' }
        ];

        toggles.forEach(({ id, key }) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', (e) => {
                    this.updateSetting(key, e.target.checked);
                });
            }
        });
    }

togglePanel() {
    const panel = document.getElementById('searchSettingsPanel');
    const backdrop = document.getElementById('settingsBackdrop');
    if (panel) {
      panel.classList.toggle('collapsed');
      if (backdrop) {
        backdrop.classList.toggle('active');
      }
    }
  }

  closePanel() {
    const panel = document.getElementById('searchSettingsPanel');
    const backdrop = document.getElementById('settingsBackdrop');
    if (panel) {
      panel.classList.add('collapsed');
    }
    if (backdrop) {
      backdrop.classList.remove('active');
    }
  }

async loadSettings() {
    try {
      const response = await fetch('/api/search-config');
      const config = await response.json();

      const userConfig = JSON.parse(localStorage.getItem('questionlab_search_settings') || '{}');

      const finalConfig = {
        ...window.SEARCH_CONFIG,
        ...config,
        ...userConfig
      };

      SmartSearch.setConfig(finalConfig);
      this.updateUI(finalConfig);

    } catch (error) {
      console.warn('Could not load search config, using defaults:', error);
      this.updateUI(window.SEARCH_CONFIG);
    }
  }

    updateUI(config) {
        // Update mode select
        const modeSelect = document.getElementById('searchModeSelect');
        if (modeSelect) {
            modeSelect.value = config.mode || 'normal';
        }

        // Update toggles
        document.getElementById('highlightEnabled').checked = config.highlightEnabled !== false;
        document.getElementById('searchAnswers').checked = config.searchAnswers !== false;
        document.getElementById('searchNotes').checked = config.searchNotes !== false;
        document.getElementById('searchCategories').checked = config.searchCategories !== false;
    }

    async updateSetting(key, value) {
        // Update in memory
        const currentConfig = SmartSearch.getConfig();
        currentConfig[key] = value;
        SmartSearch.setConfig(currentConfig);

        // Save to localStorage
        localStorage.setItem('questionlab_search_settings', JSON.stringify(currentConfig));

        // Emit event to notify pages that search config has changed
        document.dispatchEvent(new CustomEvent('search-config-changed', {
            detail: {
                key: key,
                value: value,
                config: currentConfig
            }
        }));

        // Try to save to server if API exists
        try {
            await fetch('/api/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ search: currentConfig })
            });
        } catch (error) {
            // Silently fail, settings are still saved in localStorage
            console.debug('Could not save config to server, using localStorage only');
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.searchSettings = new SearchSettings();
});
