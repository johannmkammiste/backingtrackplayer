// static/js/settings.js
document.addEventListener('DOMContentLoaded', function() {
    // Constants
    const MAX_LOGICAL_CHANNELS = 16; // Should match backend

    // Global state
    let availableAudioDevices = [];
    const settingsEditor = document.getElementById('settings-editor');

    // Section Navigation Elements
    const sectionItems = document.querySelectorAll('.songs-sidebar .song-item');
    const sections = {
        'audio-output': document.getElementById('audio-output-section'),
        'keyboard-control': document.getElementById('keyboard-control-section'),
        'file-management': document.getElementById('file-management-section'),
        'danger-zone': document.getElementById('danger-zone-section')
    };

    const mappingsContainer = document.getElementById('audio-output-mappings');
    const addMappingBtn = document.getElementById('add-mapping-btn');
    const saveAudioSettingsBtn = document.getElementById('save-audio-settings-btn');
    const globalVolumeSlider = document.getElementById('global-volume-control');
    const globalVolumeValue = document.getElementById('global-volume-value');
    const audioSaveStatus = document.getElementById('audio-save-status');
    const sampleRateSelect = document.getElementById('sample-rate-select');

    const openAudioDirBtn = document.getElementById('open-audio-dir');
    const clearCacheBtn = document.getElementById('clear-cache');
    const factoryResetBtn = document.getElementById('factory-reset');
    const deleteAllSongsBtn = document.getElementById('delete-all-songs');

    // Helper: Show Status Message
    function showStatusMessage(element, message, isError = false) {
         if (!element) return;
         element.textContent = message;
         element.className = isError ? 'save-status error' : 'save-status success';
         element.style.display = 'inline';
         setTimeout(() => {
             element.textContent = '';
             element.style.display = 'none';
         }, 3000);
     }

     function showSuccessMessage(message) {
    showNotification(message, 'success'); // Assuming 'success' is a valid type in showNotification's CSS
    }

    function showErrorMessage(message) {
        // Prepend "Error: " if not already present in the message from the catch block
        const displayMessage = message.startsWith('Error:') ? message : 'Error: ' + message;
        showNotification(displayMessage, 'error'); // Assuming 'error' is a valid type
    }

    /**
     * Parses a 1-based channel input string (e.g., "1,2", "3-5", "16") into a
     * sorted array of 0-based numbers (e.g., [0, 1], [2, 3, 4], [15]).
     * Returns null if input is invalid or out of range (1 to MAX_LOGICAL_CHANNELS).
     */
    function parseChannels(channelString) {
        if (!channelString || typeof channelString !== 'string') return null;
        const channels = new Set();
        const parts = channelString.split(',');
        const rangeRegex = /^(\d+)\s*-\s*(\d+)$/;
        const singleNumRegex = /^\d+$/;

        for (const part of parts) {
            const trimmedPart = part.trim();
            if (!trimmedPart) continue;
            let startNum, endNum;
            if (singleNumRegex.test(trimmedPart)) { startNum = endNum = parseInt(trimmedPart, 10); }
            else {
                const rangeMatch = trimmedPart.match(rangeRegex);
                if (rangeMatch) { startNum = parseInt(rangeMatch[1], 10); endNum = parseInt(rangeMatch[2], 10); }
                else { return null; }
            }
            if (isNaN(startNum) || isNaN(endNum) || startNum < 1 || endNum < 1 || startNum > MAX_LOGICAL_CHANNELS || endNum > MAX_LOGICAL_CHANNELS || startNum > endNum) {
                console.error(`Invalid channel/range: ${trimmedPart}. Must be 1-${MAX_LOGICAL_CHANNELS}.`);
                return null;
            }
            for (let i = startNum; i <= endNum; i++) { channels.add(i - 1); } // Store 0-based
        }
         return channels.size > 0 ? Array.from(channels).sort((a, b) => a - b) : [];
    }

    /**
     * Formats a 0-based array of channels into a 1-based comma-separated string,
     * condensing consecutive numbers into ranges (e.g., [0, 1, 3, 4] -> "1-2,4-5").
     */
    function formatChannels(channelArrayZeroBased) {
        if (!channelArrayZeroBased || channelArrayZeroBased.length === 0) return "";
        const sortedChannels = [...new Set(channelArrayZeroBased)].sort((a, b) => a - b);
        const parts = [];
        let rangeStartZeroBased = -1;
        for (let i = 0; i < sortedChannels.length; i++) {
            const currentChannelZeroBased = sortedChannels[i];
            if (rangeStartZeroBased === -1) { rangeStartZeroBased = currentChannelZeroBased; }
            const nextChannelZeroBased = sortedChannels[i + 1];
            if (nextChannelZeroBased !== currentChannelZeroBased + 1 || i === sortedChannels.length - 1) {
                const startOneBased = rangeStartZeroBased + 1;
                const endOneBased = currentChannelZeroBased + 1;
                if (startOneBased === endOneBased) { parts.push(`${startOneBased}`); }
                else { parts.push(`${startOneBased}-${endOneBased}`); }
                rangeStartZeroBased = -1;
            }
        }
        return parts.join(',');
    }

    /**
     * Creates and adds a mapping row UI element.
     * Expects mappingData.channels to be 1-based array from backend.
     */
    function addMappingRow(mappingData = null) {
        if (!mappingsContainer) return;
        const row = document.createElement('div');
        row.className = 'mapping-row meta-row';
        const deviceSelect = document.createElement('select');
        deviceSelect.className = 'settings-select device-select';
        const placeholderOpt = document.createElement('option');
        placeholderOpt.value = "-1"; placeholderOpt.textContent = "Select Device..."; deviceSelect.appendChild(placeholderOpt);
        availableAudioDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id; option.textContent = `${device.name} (${device.max_output_channels} ch)`;
            if (mappingData && device.id === mappingData.device_id) { option.selected = true; }
            deviceSelect.appendChild(option);
        });
        const channelInput = document.createElement('input');
        channelInput.type = 'text'; channelInput.className = 'settings-input channel-input';
        channelInput.placeholder = `Channels (1-${MAX_LOGICAL_CHANNELS})`; // Updated placeholder
        if (mappingData && mappingData.channels) {
            // Format the 1-based channel array from backend into 1-based string
            channelInput.value = formatChannels(mappingData.channels.map(ch => ch - 1)); // Convert to 0-based for formatChannels helper
        }
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕ Remove'; removeBtn.className = 'settings-button danger remove-mapping-btn'; removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => { row.remove(); });
        const deviceLabel = document.createElement('label'); deviceLabel.textContent = "Device:";
        const channelLabel = document.createElement('label'); channelLabel.textContent = "Logical Ch:";
        row.appendChild(deviceLabel); row.appendChild(deviceSelect); row.appendChild(channelLabel); row.appendChild(channelInput); row.appendChild(removeBtn);
        mappingsContainer.appendChild(row);
    }

    /**
     * Fetches audio settings (including sample rate) and devices, then populates the UI.
     */
    async function loadAndDisplayAudioSettings() {
        if (!mappingsContainer) return;
        console.log("Loading audio settings and devices...");
        mappingsContainer.innerHTML = '<p>Loading configuration...</p>';

        try {
            const response = await fetch('/api/settings/audio_device');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const data = await response.json();

            console.log("Received audio data:", data);
            availableAudioDevices = data.available_devices || [];
            mappingsContainer.innerHTML = ''; // Clear loading

            const currentConfig = data.current_config || [];
            if (currentConfig.length > 0) {
                currentConfig.forEach(mapping => addMappingRow(mapping)); // addMappingRow handles 1-based display
            } else {
                mappingsContainer.innerHTML = `<p>No output mappings configured. Click "Add".</p>`;
            }

            if (globalVolumeSlider && data.volume !== undefined) {
                globalVolumeSlider.value = data.volume * 100;
                if(globalVolumeValue) globalVolumeValue.textContent = `${Math.round(data.volume * 100)}%`;
            }

            if (sampleRateSelect && data.sample_rate !== undefined) {
                sampleRateSelect.value = data.sample_rate;
            } else if (sampleRateSelect) {
                 // If sample_rate wasn't received, default to 44100
                 sampleRateSelect.value = "44100";
            }

        } catch (error) {
            console.error("Error loading audio settings:", error);
            if (mappingsContainer) mappingsContainer.innerHTML = '<p class="error">Error loading audio configuration.</p>';
        }
    }

    /**
     * Gathers data from UI rows (including sample rate) and saves the audio configuration.
     */
    async function saveAudioConfiguration() {
        if (!mappingsContainer || !saveAudioSettingsBtn) return;
        console.log("Saving audio configuration...");
        saveAudioSettingsBtn.disabled = true; saveAudioSettingsBtn.textContent = 'Saving...';
        showStatusMessage(audioSaveStatus, '');

        const mappingRows = mappingsContainer.querySelectorAll('.mapping-row');
        const newAudioOutputs = [];
        let parseError = false;
        const usedLogicalChannels = new Set(); // Track used 1-based channels

        mappingRows.forEach(row => {
             if (parseError) return;
             const deviceSelect = row.querySelector('.device-select');
             const channelInput = row.querySelector('.channel-input');
             const device_id = parseInt(deviceSelect.value, 10);
             const channelString = channelInput.value;
             const channelsZeroBased = parseChannels(channelString); // Expects 1-based input -> returns 0-based array

             if (device_id === -1) { showStatusMessage(audioSaveStatus, `Error: Select device.`, true); parseError = true; deviceSelect.classList.add('input-error'); return; }
             else { deviceSelect.classList.remove('input-error'); }

             if (channelsZeroBased === null) { showStatusMessage(audioSaveStatus, `Error: Invalid channel format/range "${channelString}" (1-${MAX_LOGICAL_CHANNELS}).`, true); parseError = true; channelInput.classList.add('input-error'); return; }
             else { channelInput.classList.remove('input-error'); }

             const channelsOneBased = channelsZeroBased.map(ch => ch + 1); // Convert back to 1-based for duplicate check and payload
             for (const ch of channelsOneBased) {
                 if (usedLogicalChannels.has(ch)) { showStatusMessage(audioSaveStatus, `Error: Logical channel ${ch} assigned multiple times.`, true); parseError = true; return; }
                 usedLogicalChannels.add(ch);
             }

             newAudioOutputs.push({ device_id: device_id, channels: channelsOneBased }); // Send 1-based array
        });

         if (parseError) { saveAudioSettingsBtn.disabled = false; saveAudioSettingsBtn.textContent = 'Save Audio Settings'; return; }

        const volume = globalVolumeSlider ? parseFloat(globalVolumeSlider.value) / 100 : 1.0;
        const sample_rate = sampleRateSelect ? parseInt(sampleRateSelect.value, 10) : 44100;

        const payload = { audio_outputs: newAudioOutputs, volume: volume, sample_rate: sample_rate };
        console.log("Sending payload:", JSON.stringify(payload));

        try {
            const response = await fetch('/api/settings/audio_device', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) { const errorData = await response.json().catch(() => ({error: 'Unknown server error'})); throw new Error(errorData.error || `HTTP error ${response.status}`); }
            const result = await response.json();
            console.log("Save result:", result);
            showStatusMessage(audioSaveStatus, 'Audio settings saved!', false);
            loadAndDisplayAudioSettings(); // Reload to confirm
        } catch (error) {
            console.error("Error saving audio settings:", error);
            showStatusMessage(audioSaveStatus, `Error: ${error.message}`, true);
        } finally {
            saveAudioSettingsBtn.disabled = false; saveAudioSettingsBtn.textContent = 'Save Audio Settings';
        }
    }

    // Event Listeners Setup
    if (addMappingBtn) { addMappingBtn.addEventListener('click', () => { const p = mappingsContainer.querySelector('p'); if(p) p.remove(); addMappingRow(); }); }
    if (saveAudioSettingsBtn) { saveAudioSettingsBtn.addEventListener('click', saveAudioConfiguration); }
    if (globalVolumeSlider && globalVolumeValue) { globalVolumeSlider.addEventListener('input', () => { globalVolumeValue.textContent = `${globalVolumeSlider.value}%`; }); }

    // Section Navigation Logic
    sectionItems.forEach(item => {
        const sectionId = item.getAttribute('data-section');
        if (sections[sectionId]) sections[sectionId].style.display = 'none';
        else console.warn(`Settings section not found: ${sectionId}`);
        item.addEventListener('click', function() {
            sectionItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            Object.values(sections).forEach(section => { if (section) section.style.display = 'none'; });
            const currentSectionId = this.getAttribute('data-section');
            if (sections[currentSectionId]) {
                sections[currentSectionId].style.display = 'block';
                if (currentSectionId === 'audio-output') { loadAndDisplayAudioSettings(); }
                 else if (currentSectionId === 'keyboard-control' && typeof inputControlService !== 'undefined') { inputControlService.initSettingsUI(); }
                 else if (currentSectionId === 'keyboard-control') { console.error("inputControlService not found."); }
            }
        });
    });

    // Initialize Default Section View
    const firstSectionItem = sectionItems[0];
    if (firstSectionItem) {
        firstSectionItem.classList.add('active');
        const firstSectionId = firstSectionItem.getAttribute('data-section');
        if (sections[firstSectionId]) {
           sections[firstSectionId].style.display = 'block';
           if (firstSectionId === 'audio-output') { loadAndDisplayAudioSettings(); }
           else if (firstSectionId === 'keyboard-control' && typeof inputControlService !== 'undefined'){ inputControlService.initSettingsUI(); }
           else if (firstSectionId === 'keyboard-control') { console.error("inputControlService not found."); }
        }
    }

    // Open audio directory handler (Keep this listener)
if (openAudioDirBtn) {
    openAudioDirBtn.addEventListener('click', function() {
        fetch('/api/settings/open_directory', { method: 'POST' })
        .then(response => { if (!response.ok) throw new Error('Failed to open directory'); return response.json(); })
        .then(data => { if (!data.success) throw new Error(data.error || 'Unknown error'); showSuccessMessage('Audio directory opened'); })
        .catch(error => { console.error('Error opening directory:', error); showErrorMessage('Error: ' + error.message); });
    });
}

// Clear cache handler (Keep this listener)
if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to clear the application cache? This will remove temporary files but not your songs or settings.')) {
            fetch('/api/clear_cache', { method: 'POST' })
            .then(response => { if (!response.ok) throw new Error('Failed to clear cache'); return response.json(); })
            .then(data => { if (data.success) { showSuccessMessage('Cache cleared successfully'); } else { throw new Error(data.error || 'Cache clear failed'); } })
            .catch(error => { console.error('Error clearing cache:', error); showErrorMessage('Error: ' + error.message); });
        }
    });
}

// Factory reset handler (Keep this listener)
if (factoryResetBtn) {
     factoryResetBtn.addEventListener('click', function() {
         if (confirm('Are you sure you want to reset ALL data? This will delete ALL songs, setlists, and settings. This cannot be undone!')) {
             fetch('/api/factory_reset', { method: 'POST' })
             .then(response => { if (!response.ok) throw new Error('Failed to reset'); return response.json(); })
             .then(data => { if (data.success) { showSuccessMessage('Factory reset complete. Page will reload.'); setTimeout(() => window.location.reload(), 1500); } else { throw new Error(data.error || 'Reset failed'); } })
             .catch(error => { console.error('Error during factory reset:', error); showErrorMessage('Error: ' + error.message); });
         }
     });
}

// Delete all songs handler (Keep this listener)
if (deleteAllSongsBtn) {
     deleteAllSongsBtn.addEventListener('click', function() {
         if (confirm('Are you sure you want to delete ALL songs? This cannot be undone!')) {
             fetch('/api/songs', { method: 'DELETE' })
             .then(response => { if (!response.ok) throw new Error('Failed to delete songs'); return response.json(); })
             .then(data => { if (data.success) { showSuccessMessage('All songs deleted successfully'); } else { throw new Error(data.error || 'Delete failed'); } })
             .catch(error => { console.error('Error deleting songs:', error); showErrorMessage('Error: ' + error.message); });
         }
     });
}


}); // End DOMContentLoaded