/**
 * InputControlService
 * Manages keyboard shortcuts for application control.
 */
class InputControlService {
    constructor() {
        this.settings = {
            enabled: false,
            shortcuts: {},
        };
        this.isLearning = false;
        this.actionToLearn = null;
        this.statusIndicator = null; // Reference to status display element

        // Bind methods to ensure 'this' context is correct
        this._handleKeyDown = this._handleKeyDown.bind(this);
        this.saveSettings = this.saveSettings.bind(this);
        this.toggleEnabled = this.toggleEnabled.bind(this);
        this.startLearning = this.startLearning.bind(this);

        console.log("InputControlService initialized");
    }

    /**
     * Loads settings from the backend and sets up the listener.
     */
    async loadSettings() {
        console.log("Loading keyboard settings...");
        try {
            // Use the consolidated API endpoint which reads from midi_settings.json [cite: 1]
            const response = await fetch('/api/settings/keyboard'); // This endpoint now handles the correct file
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const loadedSettings = await response.json();
            // Ensure defaults if backend returns partial data
            this.settings.enabled = loadedSettings.enabled ?? false; // [cite: 1] Uses 'enabled' key
            this.settings.shortcuts = loadedSettings.shortcuts || {}; // [cite: 1] Uses 'shortcuts' key
            console.log("Keyboard settings loaded:", this.settings);

            this.setupKeyListener();
            this.updateStatusIndicator();

        } catch (error) {
            console.error('Error loading keyboard settings:', error);
            this.settings.enabled = false;
            this.settings.shortcuts = {};
            this.setupKeyListener();
            this.updateStatusIndicator();
        }
    }

    /**
     * Saves the current settings (enabled, shortcuts) to the backend.
     */
    async saveSettings() {
        // Only save the keyboard-related parts [cite: 1]
        const payload = {
             enabled: this.settings.enabled,
             shortcuts: this.settings.shortcuts
        };
        console.log("Saving keyboard settings:", payload);
        try {
            const response = await fetch('/api/settings/keyboard', { // This endpoint now handles the correct file
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload), // Send only relevant parts
            });
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
                 throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const result = await response.json(); // Backend confirms saved state
            console.log("Keyboard settings save confirmed by server:", result.settings);
            // Optionally show a success message to the user based on result.success
        } catch (error) {
            console.error('Error saving keyboard settings:', error);
            // Optionally show an error message to the user
             showNotification(`Error saving keyboard settings: ${error.message}`, 'error'); // Assumes showNotification exists
        }
    }

    /**
     * Adds or removes the global keydown listener based on the enabled state.
     */
    setupKeyListener() {
        document.removeEventListener('keydown', this._handleKeyDown);
        if (this.settings.enabled) { // [cite: 1] Checks 'enabled' flag
            console.log("Attaching keydown listener.");
            document.addEventListener('keydown', this._handleKeyDown);
        } else {
            console.log("Removing keydown listener.");
        }
        this.updateStatusIndicator();
    }

    /**
     * Handles the global keydown event.
     * @param {KeyboardEvent} event
     */
    _handleKeyDown(event) {
        const targetTagName = event.target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(targetTagName)) {
            return;
        }

        let isBoundKey = false;

        if (this.isLearning) {
            event.preventDefault();
            this._assignShortcut(event);
            isBoundKey = true;
            return;
        }

        if (!this.settings.enabled) return; // [cite: 1] Checks 'enabled' flag

        // Find matching action for the pressed key using the 'shortcuts' map [cite: 1]
        for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            if (this._compareKeys(event, keyBinding)) {
                 isBoundKey = true;
                 console.log(`Shortcut match: ${action} (${keyBinding})`);
                 this._dispatchAction(action);
                 break;
            }
        }

        if (isBoundKey) {
             event.preventDefault();
        }
    }

    /**
     * Compares a keyboard event with a stored key binding string.
     * @param {KeyboardEvent} event
     * @param {string} keyBinding - e.g., "Space", "ArrowRight", "KeyA", "Digit1"
     * @returns {boolean}
     */
    _compareKeys(event, keyBinding) {
        if (!keyBinding) return false;
        if (keyBinding.startsWith('Key') || keyBinding.startsWith('Digit')) {
            return event.code === keyBinding;
        }
        return event.key === keyBinding;
    }

    /**
     * Triggers the corresponding application action based on the shortcut.
     * @param {string} action - e.g., "play_pause", "stop"
     */
    _dispatchAction(action) {
        console.log(`Dispatching action: ${action}`);
        const playBtn = document.getElementById('play-btn');
        const stopBtn = document.getElementById('stop-btn');
        const prevBtn = document.getElementById('previous-btn');
        const nextBtn = document.getElementById('next-btn');

        try {
            switch (action) {
                case 'play_pause': // [cite: 1] Matches default 'shortcuts' keys
                    if (playBtn) playBtn.click();
                    else console.warn(`Button for action '${action}' not found.`);
                    break;
                case 'stop': // [cite: 1] Matches default 'shortcuts' keys
                    if (stopBtn) stopBtn.click();
                    else console.warn(`Button for action '${action}' not found.`);
                    break;
                case 'next': // [cite: 1] Matches default 'shortcuts' keys
                    if (nextBtn) nextBtn.click();
                    else console.warn(`Button for action '${action}' not found.`);
                    break;
                case 'previous': // [cite: 1] Matches default 'shortcuts' keys
                    if (prevBtn) prevBtn.click();
                    else console.warn(`Button for action '${action}' not found.`);
                    break;
                default:
                    console.warn(`Unhandled action: ${action}`);
            }
        } catch (error) {
            console.error(`Error executing action '${action}':`, error);
        }
    }

    // --- Methods for Settings UI ---

    /**
     * Initializes the UI elements on the settings page.
     */
    initSettingsUI() {
        console.log("Initializing Settings UI for Keyboard Controls");
        this.statusIndicator = document.getElementById('keyboard-status');

        this.loadSettings().then(() => {
             this._updateSettingsDisplay();

            const enabledCheckbox = document.getElementById('keyboard-enabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = this.settings.enabled; // [cite: 1] Uses 'enabled' flag
                enabledCheckbox.removeEventListener('change', this.toggleEnabled);
                enabledCheckbox.addEventListener('change', this.toggleEnabled);
            }

             document.querySelectorAll('.learn-keyboard-btn').forEach(button => {
                const action = button.dataset.action;
                if (action) {
                     button.addEventListener('click', () => this.startLearning(action));
                 }
            });
        });
    }

    /**
     * Toggles the enabled state and saves settings.
     * @param {Event} event - The change event from the checkbox.
     */
    toggleEnabled(event) {
        this.settings.enabled = event.target.checked; // [cite: 1] Uses 'enabled' flag
        console.log("Keyboard enabled toggled:", this.settings.enabled);
        this.setupKeyListener();
        this.saveSettings(); // Saves the updated 'enabled' flag and existing 'shortcuts' [cite: 1]
        this.updateStatusIndicator();
    }


    /**
     * Updates the display elements on the settings page.
     */
    _updateSettingsDisplay() {
         console.log("Updating settings display", this.settings.shortcuts);
         // Update shortcut displays based on the 'shortcuts' map [cite: 1]
         for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            const displayElement = document.getElementById(`shortcut-${action}-display`);
            if (displayElement) {
                displayElement.textContent = this.formatKey(keyBinding) || 'Not Set';
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

    /** Formats the key binding string for display */
    formatKey(keyBinding) {
        if (!keyBinding) return '';
        if (keyBinding.startsWith('Key')) return keyBinding.substring(3);
        if (keyBinding.startsWith('Digit')) return keyBinding.substring(5);
        return keyBinding;
    }

    /**
     * Puts the service into learning mode for a specific action.
     * @param {string} action - The action to learn a shortcut for (e.g., "play_pause").
     */
    startLearning(action) {
        if (this.isLearning) {
            this.stopLearning();
        }
        this.isLearning = true;
        this.actionToLearn = action;
        console.log(`Learning shortcut for: ${action}`);
        this._updateSettingsDisplay();
        document.body.classList.add('is-learning-shortcut');
    }

    /** Stops the learning mode */
     stopLearning() {
        this.isLearning = false;
        this.actionToLearn = null;
        console.log("Stopped learning mode.");
        this._updateSettingsDisplay();
        document.body.classList.remove('is-learning-shortcut');
    }

    /**
     * Assigns the pressed key to the action currently being learned.
     * @param {KeyboardEvent} event
     */
    _assignShortcut(event) {
        let keyBinding;
        if (event.code.startsWith('Key') || event.code.startsWith('Digit')) {
            keyBinding = event.code;
        } else {
            keyBinding = event.key;
        }

        if (['Shift', 'Control', 'Alt', 'Meta'].includes(keyBinding)) {
             console.warn("Modifier keys cannot be assigned as shortcuts directly.");
             this.stopLearning();
             return;
        }

        console.log(`Assigning key '${keyBinding}' to action '${this.actionToLearn}'`);
        this.settings.shortcuts[this.actionToLearn] = keyBinding; // Updates the 'shortcuts' map [cite: 1]
        this.saveSettings(); // Saves the updated map
        this.stopLearning();
    }

     /** Updates the status indicator element */
     updateStatusIndicator() {
         if (!this.statusIndicator) {
             this.statusIndicator = document.getElementById('keyboard-status');
         }
         if (this.statusIndicator) {
             this.statusIndicator.textContent = `Keyboard: ${this.settings.enabled ? 'Active' : 'Inactive'}`; // Checks 'enabled' flag [cite: 1]
             this.statusIndicator.className = this.settings.enabled ? 'status-enabled' : 'status-disabled';
         }
     }
}

// Create a single instance for the application to use
const inputControlService = new InputControlService();

// Load settings as soon as the script runs
inputControlService.loadSettings();

// Assume showNotification is defined globally (e.g., in main.js)
// function showNotification(message, type = 'info') { /* ... implementation ... */ }