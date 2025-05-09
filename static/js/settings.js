document.addEventListener('DOMContentLoaded', function() {
    // Constants
    const MAX_LOGICAL_CHANNELS = 64;

    // DOM Elements
    const settingsEditor = document.getElementById('settings-editor');
    const audioOutputSection = document.getElementById('audio-output-section');
    const mappingsContainer = document.getElementById('audio-output-mappings');
    const addMappingBtn = document.getElementById('add-mapping-btn');
    const saveAudioSettingsBtn = document.getElementById('save-audio-settings-btn');
    const globalVolumeSlider = document.getElementById('global-volume-control');
    const globalVolumeValue = document.getElementById('global-volume-value');
    const audioSaveStatus = document.getElementById('audio-save-status');
    const sampleRateSelect = document.getElementById('sample-rate-select');

    const keyboardControlSection = document.getElementById('keyboard-control-section');

    const dataManagementSection = document.getElementById('data-management-section');
    const importSongsFileEl = document.getElementById('import-songs-file');
    const importSongsBtn = document.getElementById('import-songs-btn');
    const importSongsStatusEl = document.getElementById('import-songs-status');
    const importSetlistsFileEl = document.getElementById('import-setlists-file');
    const importSetlistsBtn = document.getElementById('import-setlists-btn');
    const importSetlistsStatusEl = document.getElementById('import-setlists-status');

    const customAudioDirectoryPathInput = document.getElementById('custom-audio-directory-path');
    const setAudioDirectoryBtn = document.getElementById('set-audio-directory-btn');
    const audioDirectoryStatusEl = document.getElementById('audio-directory-status');
    const browseAudioDirectoryBtn = document.getElementById('browse-audio-directory-btn');

    const openAudioDirBtn = document.getElementById('open-audio-dir');
    const clearCacheBtn = document.getElementById('clear-cache');

    const dangerZoneSection = document.getElementById('danger-zone-section');
    const factoryResetBtn = document.getElementById('factory-reset');
    const deleteAllSongsBtn = document.getElementById('delete-all-songs');

    let availableAudioDevices = [];

    const sectionNavItems = document.querySelectorAll('.songs-sidebar .song-item');
    const sections = {
        'audio-output': audioOutputSection,
        'keyboard-control': keyboardControlSection,
        'data-management': dataManagementSection,
        'danger-zone': dangerZoneSection
    };

    // Helper to show status messages inline (not global notifications)
    function showStatusMessage(element, message, isError = false, duration = 4000) {
        if (!element) return;
        element.textContent = message;
        element.className = 'save-status setting-status-message ' + (isError ? 'error active' : 'success active');
        element.style.display = 'block';
        setTimeout(() => {
            if (element) {
                element.textContent = '';
                element.style.display = 'none';
                element.classList.remove('active', 'success', 'error');
            }
        }, duration);
    }

    function parseChannels(channelString) {
        if (!channelString || typeof channelString !== 'string') return null;
        const channels = new Set();
        const parts = channelString.split(',');
        const rangeRegex = /^(\d+)\s*-\s*(\d+)$/;
        const singleRegex = /^\d+$/;
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            let begin, end;
            if (singleRegex.test(trimmed)) {
                begin = end = parseInt(trimmed, 10);
            } else {
                const match = trimmed.match(rangeRegex);
                if (match) { begin = parseInt(match[1], 10); end = parseInt(match[2], 10); }
                else { return null; }
            }
            if (isNaN(begin) || isNaN(end) || begin < 1 || end < 1 || begin > MAX_LOGICAL_CHANNELS || end > MAX_LOGICAL_CHANNELS || begin > end) {
                return null;
            }
            for (let i = begin; i <= end; i++) channels.add(i - 1);
        }
        return channels.size > 0 ? Array.from(channels).sort((a, b) => a - b) : [];
    }

    function formatChannels(channels) {
        if (!channels || channels.length === 0) return "";
        const uniqueChannels = [...new Set(channels)].sort((a, b) => a - b);
        const parts = [];
        let rangeStart = -1;
        for (let i = 0; i < uniqueChannels.length; i++) {
            const current = uniqueChannels[i];
            if (rangeStart === -1) rangeStart = current;
            const next = uniqueChannels[i + 1];
            if (next !== current + 1 || i === uniqueChannels.length - 1) {
                const begin = rangeStart + 1; const end = current + 1;
                if (begin === end) parts.push(`${begin}`);
                else parts.push(`${begin}-${end}`);
                rangeStart = -1;
            }
        }
        return parts.join(',');
    }

    function addMappingRow(mapping = null) {
        if (!mappingsContainer) return;
        const row = document.createElement('div'); row.className = 'mapping-row setting-row';
        const deviceLabel = document.createElement('label'); deviceLabel.textContent = "Device:";
        const deviceSelect = document.createElement('select'); deviceSelect.className = 'settings-select device-select';
        const defaultOption = document.createElement('option'); defaultOption.value = "-1"; defaultOption.textContent = "Select Device...";
        deviceSelect.appendChild(defaultOption);
        availableAudioDevices.forEach(device => {
            const option = document.createElement('option'); option.value = device.id;
            option.textContent = `${device.name} (${device.max_output_channels} ch)`;
            if (mapping && device.id === mapping.device_id) option.selected = true;
            deviceSelect.appendChild(option);
        });
        const channelLabel = document.createElement('label'); channelLabel.textContent = "Logical Ch:";
        const channelInput = document.createElement('input'); channelInput.type = 'text'; channelInput.className = 'settings-input channel-input';
        channelInput.placeholder = `Channels (1-${MAX_LOGICAL_CHANNELS})`;
        if (mapping && mapping.channels) channelInput.value = formatChannels(mapping.channels.map(ch => ch -1));
        const removeBtn = document.createElement('button'); removeBtn.textContent = '✕ Remove'; removeBtn.className = 'settings-button danger remove-mapping-btn';
        removeBtn.type = 'button'; removeBtn.addEventListener('click', () => row.remove());
        row.appendChild(deviceLabel); row.appendChild(deviceSelect); row.appendChild(channelLabel); row.appendChild(channelInput); row.appendChild(removeBtn);
        mappingsContainer.appendChild(row);
    }

    async function loadAndDisplayAudioSettings() {
        if (!mappingsContainer || !sampleRateSelect) return;
        mappingsContainer.innerHTML = '<p>Loading...</p>';
        try {
            const response = await fetch('/api/settings/audio_device');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            availableAudioDevices = data.available_devices || [];
            mappingsContainer.innerHTML = '';
            if (data.current_config && data.current_config.length > 0) {
                data.current_config.forEach(mapping => addMappingRow(mapping));
            } else {
                mappingsContainer.innerHTML = `<p class="setting-hint">No audio output mappings defined. Click "Add Output Mapping" to begin.</p>`;
            }
            if (globalVolumeSlider && data.volume !== undefined) {
                globalVolumeSlider.value = data.volume * 100;
                if (globalVolumeValue) globalVolumeValue.textContent = `${Math.round(data.volume * 100)}%`;
            }
            sampleRateSelect.innerHTML = '';
            (data.supported_sample_rates || [44100, 48000, 88200, 96000]).forEach(rate => {
                const option = document.createElement('option'); option.value = rate; option.textContent = `${rate} Hz`;
                sampleRateSelect.appendChild(option);
            });
            if (data.current_sample_rate !== undefined) sampleRateSelect.value = data.current_sample_rate;
            else sampleRateSelect.value = "48000";
        } catch (error) {
            console.error("Error loading audio settings:", error);
            if (mappingsContainer) mappingsContainer.innerHTML = '<p class="error-message">Error loading audio settings.</p>';
            showGlobalNotification(`Audio settings load failed: ${error.message}`, 'error'); // MODIFIED
        }
    }

    async function saveAudioConfiguration() {
        if (!mappingsContainer || !saveAudioSettingsBtn) return;
        saveAudioSettingsBtn.disabled = true; saveAudioSettingsBtn.textContent = 'Saving...';
        if (audioSaveStatus) showStatusMessage(audioSaveStatus, '', false);
        const rows = mappingsContainer.querySelectorAll('.mapping-row');
        const outputs = []; let errorOccurred = false; const usedLogicalChannels = new Set();
        rows.forEach(row => {
            if (errorOccurred) return;
            const deviceSelect = row.querySelector('.device-select'); const channelInput = row.querySelector('.channel-input');
            const deviceId = parseInt(deviceSelect.value, 10); const channelString = channelInput.value;
            const parsedZeroBasedChannels = parseChannels(channelString);
            deviceSelect.classList.remove('input-error'); channelInput.classList.remove('input-error');
            if (deviceId === -1) {
                showStatusMessage(audioSaveStatus, `Please select a device for each mapping.`, true);
                errorOccurred = true; deviceSelect.classList.add('input-error'); return;
            }
            if (parsedZeroBasedChannels === null) {
                showStatusMessage(audioSaveStatus, `Invalid channel format: "${channelString}". Use numbers or ranges (e.g., 1, 3-5).`, true);
                errorOccurred = true; channelInput.classList.add('input-error'); return;
            }
            const logicalChannelsOneBased = parsedZeroBasedChannels.map(ch => ch + 1);
            for (const ch of logicalChannelsOneBased) {
                if (usedLogicalChannels.has(ch)) {
                    showStatusMessage(audioSaveStatus, `Logical channel ${ch} is assigned more than once.`, true);
                    errorOccurred = true; channelInput.classList.add('input-error'); return;
                }
                usedLogicalChannels.add(ch);
            }
            outputs.push({ device_id: deviceId, channels: logicalChannelsOneBased });
        });
        if (errorOccurred) {
            saveAudioSettingsBtn.disabled = false; saveAudioSettingsBtn.textContent = 'Save Audio Settings'; return;
        }
        const volume = parseFloat(globalVolumeSlider.value) / 100; const sampleRate = parseInt(sampleRateSelect.value, 10);
        try {
            const response = await fetch('/api/settings/audio_device', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_outputs: outputs, volume: volume, sample_rate: sampleRate })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            showStatusMessage(audioSaveStatus, 'Audio settings saved successfully!', false);
            showGlobalNotification("Audio settings saved. Changes will apply on next song load or app restart if devices were altered.", "success", 6000);
        } catch (error) {
            console.error("Error saving audio configuration:", error);
            showStatusMessage(audioSaveStatus, `Error: ${error.message}`, true);
            showGlobalNotification(`Save failed: ${error.message}`, 'error'); // MODIFIED
        } finally {
            saveAudioSettingsBtn.disabled = false; saveAudioSettingsBtn.textContent = 'Save Audio Settings';
        }
    }

    async function loadAudioDirectorySetting() {
        if (!customAudioDirectoryPathInput) return;
        try {
            const response = await fetch('/api/settings/audio_directory');
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${response.status}`);
            }
            const data = await response.json();
            customAudioDirectoryPathInput.value = data.audio_directory_path || '';
        } catch (error) {
            console.error('Error loading audio directory setting:', error);
            showStatusMessage(audioDirectoryStatusEl, `Error loading path: ${error.message}`, true);
        }
    }

    async function saveAudioDirectorySetting() {
        if (!customAudioDirectoryPathInput || !setAudioDirectoryBtn || !audioDirectoryStatusEl) return;
        const newPath = customAudioDirectoryPathInput.value.trim();
        if (!newPath) {
            showStatusMessage(audioDirectoryStatusEl, "Audio directory path cannot be empty.", true); return;
        }
        setAudioDirectoryBtn.disabled = true; setAudioDirectoryBtn.textContent = 'Setting...';
        showStatusMessage(audioDirectoryStatusEl, "Updating path...", false, 60000);
        try {
            const response = await fetch('/api/settings/audio_directory', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_directory_path: newPath })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP error ${response.status}`);
            if (result.success) {
                showStatusMessage(audioDirectoryStatusEl, result.message || "Audio directory updated successfully!", false);
                showGlobalNotification(result.message || "Audio directory updated. Restart may be needed for full effect.", "success", 6000);
            } else {
                throw new Error(result.error || "Failed to update audio directory.");
            }
        } catch (error) {
            console.error('Error saving audio directory setting:', error);
            showStatusMessage(audioDirectoryStatusEl, `Error: ${error.message}`, true, 8000);
            showGlobalNotification(`Failed to set audio directory: ${error.message}`, 'error'); // MODIFIED
        } finally {
            setAudioDirectoryBtn.disabled = false; setAudioDirectoryBtn.textContent = 'Set Path';
        }
    }

    async function handleBrowseAudioDirectory() {
        if (!customAudioDirectoryPathInput) return;
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.select_audio_directory === 'function') {
            try {
                showStatusMessage(audioDirectoryStatusEl, "Opening folder dialog...", false, 5000);
                const selectedPath = await window.pywebview.api.select_audio_directory();
                if (selectedPath) {
                    customAudioDirectoryPathInput.value = selectedPath;
                    showStatusMessage(audioDirectoryStatusEl, "Path selected. Click 'Set Path' to save.", false);
                } else {
                    showStatusMessage(audioDirectoryStatusEl, "Folder selection cancelled.", true, 3000);
                }
            } catch (error) {
                console.error("Error calling pywebview API for folder selection:", error);
                showStatusMessage(audioDirectoryStatusEl, "Error opening folder dialog.", true);
                showGlobalNotification("Could not open folder dialog. Ensure the app is running via pywebview.", "error"); // MODIFIED
            }
        } else {
            showGlobalNotification("Browse feature is not available in this environment (pywebview API not found). Please type the path manually.", "warning", 6000); // MODIFIED
            console.warn("window.pywebview.api.select_audio_directory is not available.");
        }
    }

    async function handleImport(importType, fileInputEl, statusEl, importBtnEl) {
        if (!fileInputEl || !fileInputEl.files || fileInputEl.files.length === 0) {
            showStatusMessage(statusEl, "Please select a file first.", true); return;
        }
        const file = fileInputEl.files[0];
        if (!file.name.endsWith('.json')) {
            showStatusMessage(statusEl, "Invalid file type. Please select a .json file.", true); return;
        }

        // MODIFIED: Use custom confirm
        const confirmed = await showCustomConfirm(`Importing ${importType} will OVERWRITE current data. Are you sure you want to proceed? It's recommended to export your current data first.`, `Confirm Import ${importType.charAt(0).toUpperCase() + importType.slice(1)}`);
        if (!confirmed) {
            showStatusMessage(statusEl, "Import cancelled by user.", true);
            if (fileInputEl) fileInputEl.value = ''; // Clear file input if cancelled
            return;
        }

        if (importBtnEl) { importBtnEl.disabled = true; importBtnEl.textContent = 'Importing...'; }
        showStatusMessage(statusEl, "Importing data...", false, 60000);
        const formData = new FormData(); formData.append('file', file);
        try {
            const response = await fetch(`/api/import/${importType}`, { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.success) {
                showStatusMessage(statusEl, result.message || `${importType.charAt(0).toUpperCase() + importType.slice(1)} imported successfully.`, false);
                showGlobalNotification(result.message || `${importType.charAt(0).toUpperCase() + importType.slice(1)} imported. Please refresh relevant pages if needed.`, "success", 6000);
            } else {
                throw new Error(result.error || `Failed to import ${importType}.`);
            }
        } catch (error) {
            console.error(`Import error (${importType}):`, error);
            showStatusMessage(statusEl, `Error: ${error.message}`, true);
            showGlobalNotification(`Import failed: ${error.message}`, 'error'); // MODIFIED
        } finally {
            if (importBtnEl) { importBtnEl.disabled = false; importBtnEl.textContent = `Import ${importType.charAt(0).toUpperCase() + importType.slice(1)}`; }
            if (fileInputEl) fileInputEl.value = '';
        }
    }

    function switchSection(sectionId) {
        if (!sectionId || !sections[sectionId]) {
            const firstKey = Object.keys(sections).find(k => sections[k]);
            if (firstKey) {
                sectionId = firstKey;
                const firstNav = document.querySelector(`.songs-sidebar .song-item[data-section="${sectionId}"]`);
                if (firstNav) firstNav.classList.add('active');
            } else { console.error("No valid sections found to switch to."); return; }
        }
        sectionNavItems.forEach(nav => nav.classList.toggle('active', nav.dataset.section === sectionId));
        Object.keys(sections).forEach(key => {
            if (sections[key]) sections[key].style.display = (key === sectionId) ? 'block' : 'none';
        });
        if (sectionId === 'audio-output') loadAndDisplayAudioSettings();
        else if (sectionId === 'keyboard-control') {
            if (typeof inputControlService !== 'undefined' && typeof inputControlService.initSettingsUI === 'function') {
                inputControlService.initSettingsUI();
            }
        } else if (sectionId === 'data-management') {
            loadAudioDirectorySetting();
        }
    }

    // Event Listeners
    if (addMappingBtn) addMappingBtn.addEventListener('click', () => {
        if (mappingsContainer) { const hint = mappingsContainer.querySelector('p.setting-hint'); if (hint) hint.remove(); }
        addMappingRow();
    });
    if (saveAudioSettingsBtn) saveAudioSettingsBtn.addEventListener('click', saveAudioConfiguration);
    if (globalVolumeSlider && globalVolumeValue) globalVolumeSlider.addEventListener('input', () => {
        globalVolumeValue.textContent = `${globalVolumeSlider.value}%`;
    });

    // MODIFIED: Import buttons to use async/await with custom confirm
    if (importSongsBtn && importSongsFileEl && importSongsStatusEl) {
        importSongsBtn.addEventListener('click', async () => { // Made async
            if (!importSongsFileEl.files?.length) {
                showStatusMessage(importSongsStatusEl, "Please select a songs.json file.", true); return;
            }
            // No need for separate confirm() call here, handleImport will do it
            await handleImport('songs', importSongsFileEl, importSongsStatusEl, importSongsBtn);
        });
    }
    if (importSetlistsBtn && importSetlistsFileEl && importSetlistsStatusEl) {
        importSetlistsBtn.addEventListener('click', async () => { // Made async
            if (!importSetlistsFileEl.files?.length) {
                showStatusMessage(importSetlistsStatusEl, "Please select a setlists.json file.", true); return;
            }
            await handleImport('setlists', importSetlistsFileEl, importSetlistsStatusEl, importSetlistsBtn);
        });
    }

    if (setAudioDirectoryBtn) setAudioDirectoryBtn.addEventListener('click', saveAudioDirectorySetting);
    if (browseAudioDirectoryBtn) browseAudioDirectoryBtn.addEventListener('click', handleBrowseAudioDirectory);

    if (openAudioDirBtn) openAudioDirBtn.addEventListener('click', function() {
        fetch('/api/settings/open_directory', { method: 'POST' })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok || !data.success) throw new Error(data.error || 'Unknown error opening directory');
            showGlobalNotification(data.message || 'Opened Audio Directory (OS dependent).', 'info'); // MODIFIED
        }).catch(error => {
            console.error('Error opening audio directory:', error);
            showGlobalNotification(error.message, 'error'); // MODIFIED
        });
    });

    if (clearCacheBtn) clearCacheBtn.addEventListener('click', async function() { // Made async
        const confirmed = await showCustomConfirm('Are you sure you want to clear the application cache? This might resolve some display issues but will not delete your data files.', 'Confirm Clear Cache');
        if (confirmed) { // MODIFIED
            fetch('/api/clear_cache', { method: 'POST' })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) throw new Error(data.message || 'Cache clear failed');
                showGlobalNotification('Application cache cleared successfully.', 'success'); // MODIFIED
            }).catch(error => {
                console.error('Cache clear error:', error);
                showGlobalNotification(error.message, 'error'); // MODIFIED
            });
        } else {
            showGlobalNotification("Cache clear cancelled.", "info");
        }
    });

    if (factoryResetBtn) factoryResetBtn.addEventListener('click', async function() { // Made async
        let confirmed = await showCustomConfirm('DANGER ZONE! Are you absolutely sure you want to perform a factory reset? This will DELETE ALL songs, setlists, audio files, and reset ALL settings to their defaults. This action is IRREVERSIBLE.', 'Confirm Factory Reset');
        if (confirmed) { // MODIFIED
            confirmed = await showCustomConfirm('SECOND AND FINAL CONFIRMATION: Really proceed with factory reset? There is no going back.', 'Final Confirmation');
            if (confirmed) { // MODIFIED
                fetch('/api/factory_reset', { method: 'POST' })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) throw new Error(data.message || 'Factory reset failed');
                    showGlobalNotification('Factory reset complete. The application will attempt to reload.', 'success', 8000); // MODIFIED
                    setTimeout(() => window.location.reload(), 3000);
                }).catch(error => {
                    console.error('Factory reset error:', error);
                    showGlobalNotification(error.message, 'error'); // MODIFIED
                });
            } else {
                 showGlobalNotification("Factory reset cancelled (second confirmation).", "info");
            }
        } else {
            showGlobalNotification("Factory reset cancelled.", "info");
        }
    });

    if (deleteAllSongsBtn) deleteAllSongsBtn.addEventListener('click', async function() { // Made async
        const confirmed = await showCustomConfirm('Are you sure you want to delete ALL songs and their associated audio files? This will also empty all setlists. This action is IRREVERSIBLE.', 'Confirm Delete All Songs');
        if (confirmed) { // MODIFIED
            fetch('/api/songs', { method: 'DELETE' })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) throw new Error(data.message || 'Delete all songs failed');
                showGlobalNotification('All songs and associated audio files have been deleted.', 'success'); // MODIFIED
            }).catch(error => {
                console.error('Delete all songs error:', error);
                showGlobalNotification(error.message, 'error'); // MODIFIED
            });
        } else {
            showGlobalNotification("Delete all songs cancelled.", "info");
        }
    });

    sectionNavItems.forEach(item => item.addEventListener('click', function() { switchSection(this.dataset.section); }));

    const initialActiveNavItem = document.querySelector('.songs-sidebar .song-item.active');
    let initialSectionId = null;
    if (initialActiveNavItem) initialSectionId = initialActiveNavItem.dataset.section;
    else if (sectionNavItems.length > 0) { initialSectionId = sectionNavItems[0].dataset.section; sectionNavItems[0].classList.add('active'); }
    if (initialSectionId) switchSection(initialSectionId);
    else { Object.values(sections).forEach(sectionEl => { if (sectionEl) sectionEl.style.display = 'none'; }); console.warn("No initial section to display in settings."); }
});
if (typeof window.showGlobalNotification !== 'function') {
    console.warn("settings.js: window.showGlobalNotification is not defined. Using basic alert fallback.");
    window.showGlobalNotification = function(message, type = 'info') { // Define it on window if not present
        alert(`[${type.toUpperCase()}] ${message}`);
    };
}
// Fallback for custom confirm if main.js one isn't available
if (typeof window.showCustomConfirm !== 'function') {
    console.warn("settings.js: window.showCustomConfirm is not defined. Using native confirm fallback.");
    window.showCustomConfirm = function(message, title) {
        const fullMessage = title ? `${title}\n${message}` : message;
        return Promise.resolve(window.confirm(fullMessage));
    };
}
