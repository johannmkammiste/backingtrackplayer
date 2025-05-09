/**
 * InputControlService
 * Manages keyboard shortcuts for application control.
 */
class InputControlService {
    constructor() {
        this.settings = {
            enabled: false,
            shortcuts: {}, // e.g., { "play_pause": "Space", "stop": "Escape" }
        };
        this.isLearning = false;
        this.actionToLearn = null;
        this.statusIndicator = null;
        this.saveStatusElement = null; // For keyboard save status messages

        this._handleKeyDown = this._handleKeyDown.bind(this);
        this.saveSettings = this.saveSettings.bind(this);
        this.toggleEnabled = this.toggleEnabled.bind(this);
        this.startLearning = this.startLearning.bind(this);

        // console.log("InputControlService initialized");
    }

    // Helper to use window.showGlobalNotification or fallback
    _notify(message, type = 'info', duration = 4000) {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type, duration);
        } else {
            console.warn('input-control.js: window.showGlobalNotification not found. Using alert.');
            alert(`[${type.toUpperCase()}] ${message}`);
        }
    }


    async loadSettings() {
        // console.log("Loading keyboard settings...");
        try {
            const response = await fetch('/api/settings/keyboard');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const loadedSettings = await response.json();
            this.settings.enabled = loadedSettings.enabled ?? false;
            this.settings.shortcuts = loadedSettings.shortcuts || {};
            // console.log("Keyboard settings loaded:", this.settings);

            this.setupKeyListener();
            this.updateStatusIndicator();
            if (document.getElementById('settings-editor')) { // Only update display if on settings page
                this._updateSettingsDisplay();
            }

        } catch (error) {
            console.error('Error loading keyboard settings:', error);
            this._notify(`Error loading keyboard settings: ${error.message}`, 'error');
            this.settings.enabled = false;
            this.settings.shortcuts = {};
            this.setupKeyListener();
            this.updateStatusIndicator();
             if (document.getElementById('settings-editor')) {
                this._updateSettingsDisplay();
            }
        }
    }

    async saveSettings() {
        const payload = {
             enabled: this.settings.enabled,
             shortcuts: this.settings.shortcuts
        };
        // console.log("Saving keyboard settings:", payload);
        if (this.saveStatusElement) this.saveStatusElement.textContent = 'Saving...';

        try {
            const response = await fetch('/api/settings/keyboard', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
                 throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            // console.log("Keyboard settings save confirmed by server:", result.settings);
            if (this.saveStatusElement) {
                this.saveStatusElement.textContent = 'Saved!';
                this.saveStatusElement.className = 'save-status setting-status-message success active';
                setTimeout(() => {
                    if(this.saveStatusElement) {
                        this.saveStatusElement.textContent = '';
                        this.saveStatusElement.classList.remove('active', 'success');
                    }
                }, 3000);
            }
        } catch (error) {
            console.error('Error saving keyboard settings:', error);
            this._notify(`Error saving keyboard settings: ${error.message}`, 'error');
            if (this.saveStatusElement) {
                this.saveStatusElement.textContent = `Error: ${error.message}`;
                this.saveStatusElement.className = 'save-status setting-status-message error active';
            }
        }
    }

    setupKeyListener() {
        document.removeEventListener('keydown', this._handleKeyDown);
        if (this.settings.enabled) {
            // console.log("Attaching keydown listener.");
            document.addEventListener('keydown', this._handleKeyDown);
        } else {
            // console.log("Removing keydown listener.");
        }
        this.updateStatusIndicator();
    }

    _handleKeyDown(event) {
        const targetTagName = event.target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(targetTagName) && !event.target.classList.contains('learn-keyboard-btn')) { // Allow if target is learn button
            return;
        }

        let isBoundKey = false;

        if (this.isLearning) {
            event.preventDefault(); event.stopPropagation(); // Important for learning mode
            this._assignShortcut(event);
            isBoundKey = true;
            return;
        }

        if (!this.settings.enabled) return;

        for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            if (this._compareKeys(event, keyBinding)) {
                 isBoundKey = true;
                 // console.log(`Shortcut match: ${action} (${keyBinding})`);
                 this._dispatchAction(action);
                 break;
            }
        }
        if (isBoundKey) event.preventDefault();
    }

    _compareKeys(event, keyBinding) {
        if (!keyBinding) return false;
        // Prioritize event.code for physical keys, event.key for special keys like "Space", "ArrowRight"
        if (keyBinding.startsWith('Key') || keyBinding.startsWith('Digit') || keyBinding.startsWith('Numpad')) {
            return event.code === keyBinding;
        }
        return event.key === keyBinding;
    }

    _dispatchAction(action) {
        // console.log(`Dispatching action: ${action}`);
        const playBtn = document.getElementById('play-btn');
        const stopBtn = document.getElementById('stop-btn');
        const prevBtn = document.getElementById('previous-btn');
        const nextBtn = document.getElementById('next-btn');

        try {
            switch (action) {
                case 'play_pause': if (playBtn) playBtn.click(); break;
                case 'stop': if (stopBtn) stopBtn.click(); break;
                case 'next': if (nextBtn) nextBtn.click(); break;
                case 'previous': if (prevBtn) prevBtn.click(); break;
                default: console.warn(`Unhandled keyboard action: ${action}`);
            }
        } catch (error) {
            console.error(`Error executing action '${action}':`, error);
        }
    }

    initSettingsUI() {
        // console.log("Initializing Settings UI for Keyboard Controls");
        this.statusIndicator = document.getElementById('keyboard-status');
        this.saveStatusElement = document.getElementById('keyboard-save-status');


        this.loadSettings().then(() => { // loadSettings now updates display if on settings page
            const enabledCheckbox = document.getElementById('keyboard-enabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = this.settings.enabled;
                enabledCheckbox.removeEventListener('change', this.toggleEnabled); // Prevent multiple listeners
                enabledCheckbox.addEventListener('change', this.toggleEnabled);
            }
             document.querySelectorAll('.learn-keyboard-btn').forEach(button => {
                const action = button.dataset.action;
                if (action) {
                     button.removeEventListener('click', this.startLearning); // Prevent multiple
                     button.addEventListener('click', () => this.startLearning(action));
                 }
            });
        });
    }

    toggleEnabled(event) {
        this.settings.enabled = event.target.checked;
        // console.log("Keyboard enabled toggled:", this.settings.enabled);
        this.setupKeyListener();
        this.saveSettings();
        this.updateStatusIndicator();
    }

    _updateSettingsDisplay() {
         // console.log("Updating settings display", this.settings.shortcuts);
         for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            const displayElement = document.getElementById(`shortcut-${action}-display`);
            if (displayElement) {
                displayElement.textContent = this.formatKeyForDisplay(keyBinding) || 'Not Set';
            }
            const learnButton = document.querySelector(`.learn-keyboard-btn[data-action="${action}"]`);
             if (learnButton) {
                 if (this.isLearning && this.actionToLearn === action) {
                     learnButton.textContent = 'Press Key...';
                     learnButton.classList.add('learning');
                 } else {
                     learnButton.textContent = 'Learn';
                     learnButton.classList.remove('learning');
                 }
             }
         }
         this.updateStatusIndicator();
    }

    formatKeyForDisplay(keyBinding) {
        if (!keyBinding) return '';
        if (keyBinding === " ") return "Space"; // Special case for Space
        if (keyBinding.startsWith('Key')) return keyBinding.substring(3); // KeyA -> A
        if (keyBinding.startsWith('Digit')) return keyBinding.substring(5); // Digit1 -> 1
        if (keyBinding.startsWith('Numpad')) return `Numpad ${keyBinding.substring(6)}`; // Numpad1 -> Numpad 1
        // For Arrow keys, Escape, etc., event.key is usually descriptive enough
        return keyBinding;
    }

    startLearning(action) {
        if (this.isLearning) this.stopLearning(false); // Stop previous learning without saving
        this.isLearning = true;
        this.actionToLearn = action;
        // console.log(`Learning shortcut for: ${action}`);
        this._updateSettingsDisplay(); // Update button text to "Press Key..."
        document.body.classList.add('is-learning-shortcut'); // Optional: for global styling
        // Focus a relevant button to ensure keyboard events are captured if user clicks away
        const learnButton = document.querySelector(`.learn-keyboard-btn[data-action="${action}"]`);
        if(learnButton) learnButton.focus();
    }

    stopLearning(save = true) { // Add save parameter
        this.isLearning = false;
        this.actionToLearn = null;
        // console.log("Stopped learning mode.");
        document.body.classList.remove('is-learning-shortcut');
        if(save) this.saveSettings(); // Save only if explicitly told (e.g., after assigning)
        this._updateSettingsDisplay(); // Revert button text
    }

    _assignShortcut(event) {
        let keyBinding;
        // Prefer event.code for physical keys, event.key for others like Space, Arrow keys
        if (event.code.startsWith('Key') || event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
            keyBinding = event.code;
        } else {
            keyBinding = event.key; // Such as " ", "ArrowRight", "Escape"
        }

        if (['Shift', 'Control', 'Alt', 'Meta'].includes(keyBinding)) {
             this._notify("Modifier keys (Shift, Ctrl, Alt, Meta) cannot be assigned as shortcuts directly.", "warning");
             this.stopLearning(false); // Stop without saving
             return;
        }
        if (event.code === "Tab") { // Prevent Tab from being learned easily as it shifts focus
            this._notify("Tab key cannot be assigned as a shortcut.", "warning");
            this.stopLearning(false);
            return;
        }

        // console.log(`Assigning key '${keyBinding}' (Code: ${event.code}, Key: ${event.key}) to action '${this.actionToLearn}'`);
        this.settings.shortcuts[this.actionToLearn] = keyBinding;
        this.stopLearning(true); // Stop and save the new assignment
    }

     updateStatusIndicator() {
         if (!this.statusIndicator) this.statusIndicator = document.getElementById('keyboard-status');
         if (this.statusIndicator) {
             this.statusIndicator.textContent = `Keyboard: ${this.settings.enabled ? 'Active' : 'Inactive'}`;
             this.statusIndicator.className = `status-indicator ${this.settings.enabled ? 'status-enabled' : 'status-disabled'}`;
         }
     }
}

const inputControlService = new InputControlService();
inputControlService.loadSettings(); // Load settings as soon as the script runs

// Fallback showGlobalNotification (if main.js one isn't loaded or working)
// It's better if main.js always provides the primary one.
if (typeof window.showGlobalNotification !== 'function') {
    console.warn("input-control.js: window.showGlobalNotification is not defined. Using basic alert fallback.");
    window.showGlobalNotification = function(message, type = 'info') { // Define it on window if not present
        alert(`[${type.toUpperCase()}] ${message}`);
    };
}
