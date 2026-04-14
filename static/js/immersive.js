/**
 * Immersive Mode - Mobile Only
 * Toggles a fullscreen mode that hides the sidebar and shows a draggable FAB.
 * State is persisted via localStorage.
 */
(function () {
    'use strict';

    const STORAGE_KEY_MODE = 'immersiveMode';
    const STORAGE_KEY_POS = 'immersiveFabPos';
    const MOBILE_BREAKPOINT = 768;

    let fabEl = null;
    let modalEl = null;
    let backdropEl = null;
    let isImmersive = false;
    let isModalOpen = false;
    let fabPos = { x: 24, y: null }; // y is from bottom
    let isDragging = false;
    let dragStart = { x: 0, y: 0, fabX: 0, fabY: 0 };
    let hasDragged = false;

    // SVG Icons
    const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>`;

    const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>`;

    /**
     * Initialize immersive mode on DOMContentLoaded
     */
    function init() {
        // Only activate on mobile
        if (window.innerWidth > MOBILE_BREAKPOINT) return;

        // Restore state
        isImmersive = localStorage.getItem(STORAGE_KEY_MODE) === 'true';
        const savedPos = localStorage.getItem(STORAGE_KEY_POS);
        if (savedPos) {
            try { fabPos = JSON.parse(savedPos); } catch (e) { /* ignore */ }
        }

        if (isImmersive) {
            enterImmersiveMode(false);
        }

        // Setup sidebar button
        const btn = document.getElementById('btnImmersiveSidebar');
        if (btn) {
            btn.addEventListener('click', () => {
                if (window.innerWidth <= MOBILE_BREAKPOINT) {
                    toggleImmersiveMode();
                }
            });
        }
    }

    /**
     * Toggle immersive mode
     */
    function toggleImmersiveMode() {
        if (isImmersive) {
            exitImmersiveMode();
        } else {
            enterImmersiveMode(true);
        }
    }

    /**
     * Enter immersive mode
     * @param {boolean} saveState - Whether to save to localStorage
     */
    function enterImmersiveMode(saveState) {
        isImmersive = true;
        document.body.classList.add('immersive-active');

        // Create FAB
        if (!fabEl) {
            createFAB();
        }
        fabEl.style.display = 'flex';
        positionFAB();

        // Close modal if open
        closeModal();

        if (saveState) {
            localStorage.setItem(STORAGE_KEY_MODE, 'true');
        }

        // Update sidebar button icon
        updateSidebarButtonIcon();
    }

    /**
     * Exit immersive mode
     */
    function exitImmersiveMode() {
        isImmersive = false;
        document.body.classList.remove('immersive-active');

        // Hide FAB and modal
        if (fabEl) fabEl.style.display = 'none';
        closeModal();

        localStorage.setItem(STORAGE_KEY_MODE, 'false');
        updateSidebarButtonIcon();
    }

    /**
     * Create the Floating Action Button
     */
    function createFAB() {
        fabEl = document.createElement('button');
        fabEl.className = 'immersive-fab';
        fabEl.innerHTML = ICON_GRID;
        fabEl.setAttribute('aria-label', 'Apri navigazione');
        fabEl.style.display = 'none';
        document.body.appendChild(fabEl);

        // Click handler (works on both desktop and mobile)
        fabEl.addEventListener('click', (e) => {
            if (!hasDragged) {
                openModal();
            }
            hasDragged = false;
        });

        // Drag handlers - use pointer events for unified mouse/touch handling
        fabEl.addEventListener('pointerdown', startPointerDrag);
    }

    /**
     * Position FAB based on saved coordinates
     */
    function positionFAB() {
        if (!fabEl) return;
        const rect = fabEl.getBoundingClientRect();
        const w = rect.width || 56;
        const h = rect.height || 56;

        let left = fabPos.x;
        let bottom = fabPos.y;

        // Defaults
        if (left === undefined || left === null) left = 24;
        if (bottom === undefined || bottom === null) bottom = 24;

        // Clamp
        const maxX = window.innerWidth - w;
        const maxY = window.innerHeight - h;

        left = Math.max(0, Math.min(left, maxX));
        bottom = Math.max(0, Math.min(bottom, maxY));

        fabEl.style.left = left + 'px';
        fabEl.style.top = (window.innerHeight - bottom - h) + 'px';
        fabEl.style.bottom = 'auto';
    }

    /**
     * Save FAB position
     */
    function saveFABPos() {
        if (!fabEl) return;
        const rect = fabEl.getBoundingClientRect();
        fabPos.x = rect.left;
        fabPos.y = window.innerHeight - rect.bottom;
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(fabPos));
    }

    /* ============================================
       DRAG LOGIC - Pointer Events (unified mouse+touch)
       ============================================ */

    function startPointerDrag(e) {
        // Only handle primary button (left click / first touch)
        if (e.button !== 0) return;

        e.preventDefault();
        hasDragged = false;
        isDragging = false;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        const rect = fabEl.getBoundingClientRect();
        dragStart.fabX = rect.left;
        dragStart.fabY = rect.top;

        const moveHandler = (ev) => {
            const dx = ev.clientX - dragStart.x;
            const dy = ev.clientY - dragStart.y;

            // Start dragging only after 5px threshold
            if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                isDragging = true;
                fabEl.classList.add('dragging');
            }

            if (isDragging) {
                moveDrag(ev.clientX, ev.clientY);
            }
        };

        const endHandler = () => {
            endDrag();
            document.removeEventListener('pointermove', moveHandler);
            document.removeEventListener('pointerup', endHandler);
            document.removeEventListener('pointercancel', endHandler);
        };

        // Register on document so drag works even when pointer leaves the FAB
        document.addEventListener('pointermove', moveHandler);
        document.addEventListener('pointerup', endHandler);
        document.addEventListener('pointercancel', endHandler);
    }

    function moveDrag(clientX, clientY) {
        if (!isDragging || !fabEl) return;
        const dx = clientX - dragStart.x;
        const dy = clientY - dragStart.y;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasDragged = true;
        }

        let newX = dragStart.fabX + dx;
        let newY = dragStart.fabY + dy;

        // Clamp
        const w = fabEl.offsetWidth;
        const h = fabEl.offsetHeight;
        newX = Math.max(0, Math.min(newX, window.innerWidth - w));
        newY = Math.max(0, Math.min(newY, window.innerHeight - h));

        fabEl.style.left = newX + 'px';
        fabEl.style.top = newY + 'px';
    }

    function endDrag() {
        if (!fabEl) return;
        isDragging = false;
        fabEl.classList.remove('dragging');
        saveFABPos();
    }

    /* ============================================
       MODAL LOGIC
       ============================================ */

    function openModal() {
        if (isModalOpen) return;
        isModalOpen = true;

        if (!modalEl) {
            createModal();
        }

        backdropEl.style.display = 'flex';
        // Force reflow for animation
        requestAnimationFrame(() => {
            backdropEl.classList.add('show');
        });

        // Update active state in modal
        updateModalActiveState();
    }

    function closeModal() {
        if (!isModalOpen || !backdropEl) return;
        isModalOpen = false;
        backdropEl.classList.remove('show');
        setTimeout(() => {
            if (backdropEl && !isModalOpen) {
                backdropEl.style.display = 'none';
            }
        }, 200);
    }

    function createModal() {
        // Backdrop
        backdropEl = document.createElement('div');
        backdropEl.className = 'immersive-modal-backdrop';
        backdropEl.style.display = 'none';

        // Click on backdrop closes modal
        backdropEl.addEventListener('click', (e) => {
            if (e.target === backdropEl) {
                closeModal();
            }
        });

        // Modal content
        const currentPage = window.location.pathname;
        const navItems = [
            { href: '/', label: 'Home', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
            { href: '/editor', label: 'Editor', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>` },
            { href: '/quiz', label: 'Quiz', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>` },
            { href: '/view', label: 'View', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
            { href: '/databases', label: 'Database', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>` },
        ];

        // Check if help button exists on this page (not home)
        const hasHelp = !document.body.classList.contains('page-home');

        let navHTML = navItems.map(item => {
            const isActive = currentPage === item.href ? ' active' : '';
            return `<a href="${item.href}" class="immersive-nav-item${isActive}">${item.icon}<span>${item.label}</span></a>`;
        }).join('');

        let actionsHTML = '';
        if (hasHelp) {
            actionsHTML += `<button class="immersive-action help-action" id="immersiveHelpBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>Aiuto</span>
            </button>`;
        }

        actionsHTML += `<button class="immersive-action" id="immersiveThemeBtn" onclick="toggleTheme()">
            <svg class="immersive-theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <svg class="immersive-theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            <span>Tema</span>
        </button>`;

        actionsHTML += `<button class="immersive-action exit-immersive" id="immersiveExitBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            <span>Esci modalità immersiva</span>
        </button>`;

        modalEl = document.createElement('div');
        modalEl.className = 'immersive-modal';
        modalEl.innerHTML = `
            <div class="immersive-modal-header">
                <span class="immersive-modal-title">Navigazione</span>
                <button class="immersive-modal-close" id="immersiveCloseBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="immersive-nav-grid">${navHTML}</div>
            <div class="immersive-actions">${actionsHTML}</div>
        `;

        backdropEl.appendChild(modalEl);
        document.body.appendChild(backdropEl);

        // Event listeners
        document.getElementById('immersiveCloseBtn').addEventListener('click', closeModal);
        document.getElementById('immersiveExitBtn').addEventListener('click', () => {
            closeModal();
            exitImmersiveMode();
        });

        // Help button
        const helpBtn = document.getElementById('immersiveHelpBtn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                closeModal();
                // Trigger the existing help modal
                const originalHelp = document.getElementById('btnHelpSidebar');
                if (originalHelp) originalHelp.click();
            });
        }

        // Theme button - update icons on theme change
        updateThemeIcons();
    }

    /**
     * Update the active state of nav items in the modal
     */
    function updateModalActiveState() {
        if (!modalEl) return;
        const currentPage = window.location.pathname;
        const items = modalEl.querySelectorAll('.immersive-nav-item');
        items.forEach(item => {
            if (item.getAttribute('href') === currentPage) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    /**
     * Update theme icons in the modal based on current theme
     */
    function updateThemeIcons() {
        if (!modalEl) return;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const moon = modalEl.querySelector('.immersive-theme-moon');
        const sun = modalEl.querySelector('.immersive-theme-sun');
        if (moon && sun) {
            moon.style.display = isDark ? 'none' : 'block';
            sun.style.display = isDark ? 'block' : 'none';
        }
    }

    /**
     * Update sidebar button icon based on immersive state
     * Only replaces the SVG element, preserving the span label and classes
     */
    function updateSidebarButtonIcon() {
        const btn = document.getElementById('btnImmersiveSidebar');
        if (!btn) return;
        const svgEl = btn.querySelector('svg');
        if (!svgEl) return;

        // Update SVG attributes instead of replacing innerHTML
        svgEl.innerHTML = isImmersive
            ? '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'
            : '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
        // Note: both states use the same icon for now (maximize/expand)
    }

    /* ============================================
       HANDLE RESIZE
       ============================================ */

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > MOBILE_BREAKPOINT && isImmersive) {
                exitImmersiveMode();
            }
            if (isImmersive && fabEl) {
                positionFAB();
            }
        }, 150);
    });

    /* ============================================
       HANDLE THEME CHANGE (observe attribute)
       ============================================ */

    const observer = new MutationObserver(() => {
        if (isModalOpen) {
            updateThemeIcons();
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ============================================
       INIT
       ============================================ */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
