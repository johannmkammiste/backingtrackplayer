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
    const openAudioDirBtn = document.getElementById('open-audio-dir');
    const clearCacheBtn = document.getElementById('clear-cache');
    const dangerZoneSection = document.getElementById('danger-zone-section');
    const factoryResetBtn = document.getElementById('factory-reset');
    const deleteAllSongsBtn = document.getElementById('delete-all-songs');

    // Global state
    let availableAudioDevices = [];

    // Section Navigation
    const sectionNavItems = document.querySelectorAll('.songs-sidebar .song-item');
    const sections = {
        'audio-output': audioOutputSection,
        'keyboard-control': keyboardControlSection,
        'data-management': dataManagementSection,
        'danger-zone': dangerZoneSection
    };

    // Helper Functions
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
                if (match) {
                    begin = parseInt(match[1], 10);
                    end = parseInt(match[2], 10);
                } else {
                    return null;
                }
            }

            if (isNaN(begin) || isNaN(end) || begin < 1 || end < 1 || 
                begin > MAX_LOGICAL_CHANNELS || end > MAX_LOGICAL_CHANNELS || begin > end) {
                return null;
            }

            for (let i = begin; i <= end; i++) {
                channels.add(i - 1); // Convert to 0-based index
            }
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
                const begin = rangeStart + 1; // Convert back to 1-based
                const end = current + 1;
                if (begin === end) {
                    parts.push(`${begin}`);
                } else {
                    parts.push(`${begin}-${end}`);
                }
                rangeStart = -1;
            }
        }

        return parts.join(',');
    }

    function addMappingRow(mapping = null) {
        if (!mappingsContainer) return;

        const row = document.createElement('div');
        row.className = 'mapping-row setting-row';

        const deviceLabel = document.createElement('label');
        deviceLabel.textContent = "Device:";
        
        const deviceSelect = document.createElement('select');
        deviceSelect.className = 'settings-select device-select';
        
        const defaultOption = document.createElement('option');
        defaultOption.value = "-1";
        defaultOption.textContent = "Select Device...";
        deviceSelect.appendChild(defaultOption);

        availableAudioDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = `${device.name} (${device.max_output_channels} ch)`;
            if (mapping && device.id === mapping.device_id) {
                option.selected = true;
            }
            deviceSelect.appendChild(option);
        });

        const channelLabel = document.createElement('label');
        channelLabel.textContent = "Logical Ch:";
        
        const channelInput = document.createElement('input');
        channelInput.type = 'text';
        channelInput.className = 'settings-input channel-input';
        channelInput.placeholder = `Channels (1-${MAX_LOGICAL_CHANNELS})`;
        if (mapping && mapping.channels) {
            channelInput.value = formatChannels(mapping.channels.map(ch => ch - 1));
        }

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕ Remove';
        removeBtn.className = 'settings-button danger remove-mapping-btn';
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => row.remove());

        row.appendChild(deviceLabel);
        row.appendChild(deviceSelect);
        row.appendChild(channelLabel);
        row.appendChild(channelInput);
        row.appendChild(removeBtn);

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
                mappingsContainer.innerHTML = `<p class="setting-hint">No mappings. Click "Add".</p>`;
            }

            if (globalVolumeSlider && data.volume !== undefined) {
                globalVolumeSlider.value = data.volume * 100;
                if (globalVolumeValue) {
                    globalVolumeValue.textContent = `${Math.round(data.volume * 100)}%`;
                }
            }

            sampleRateSelect.innerHTML = '';
            (data.supported_sample_rates || [44100, 48000, 88200, 96000]).forEach(rate => {
                const option = document.createElement('option');
                option.value = rate;
                option.textContent = `${rate} Hz`;
                sampleRateSelect.appendChild(option);
            });

            if (data.current_sample_rate !== undefined) {
                sampleRateSelect.value = data.current_sample_rate;
            } else {
                sampleRateSelect.value = "48000";
            }
        } catch (error) {
            console.error("Load audio error:", error);
            if (mappingsContainer) {
                mappingsContainer.innerHTML = '<p class="error-message">Error loading.</p>';
            }
            alert(`Audio load failed: ${error.message}`);
        }
    }

    async function saveAudioConfiguration() {
        if (!mappingsContainer || !saveAudioSettingsBtn) return;
        
        saveAudioSettingsBtn.disabled = true;
        saveAudioSettingsBtn.textContent = 'Saving...';
        if (audioSaveStatus) showStatusMessage(audioSaveStatus, '', false);
        
        const rows = mappingsContainer.querySelectorAll('.mapping-row');
        const outputs = [];
        let error = false;
        const usedChannels = new Set();

        rows.forEach(row => {
            if (error) return;
            
            const deviceSelect = row.querySelector('.device-select');
            const channelInput = row.querySelector('.channel-input');
            const deviceId = parseInt(deviceSelect.value, 10);
            const channelString = channelInput.value;
            const channels = parseChannels(channelString);

            deviceSelect.classList.remove('input-error');
            channelInput.classList.remove('input-error');

            if (deviceId === -1) {
                showStatusMessage(audioSaveStatus, `Select device.`, true);
                error = true;
                deviceSelect.classList.add('input-error');
                return;
            }

            if (channels === null) {
                showStatusMessage(audioSaveStatus, `Invalid channels "${channelString}".`, true);
                error = true;
                channelInput.classList.add('input-error');
                return;
            }

            const logicalChannels = channels.map(ch => ch + 1);
            for (const ch of logicalChannels) {
                if (usedChannels.has(ch)) {
                    showStatusMessage(audioSaveStatus, `Channel ${ch} used twice.`, true);
                    error = true;
                    channelInput.classList.add('input-error');
                    return;
                }
                usedChannels.add(ch);
            }

            outputs.push({
                device_id: deviceId,
                channels: logicalChannels
            });
        });

        if (error) {
            saveAudioSettingsBtn.disabled = false;
            saveAudioSettingsBtn.textContent = 'Save';
            return;
        }

        const volume = parseFloat(globalVolumeSlider.value) / 100;
        const sampleRate = parseInt(sampleRateSelect.value, 10);

        try {
            const response = await fetch('/api/settings/audio_device', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_outputs: outputs,
                    volume: volume,
                    sample_rate: sampleRate
                })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

            showStatusMessage(audioSaveStatus, 'Saved!', false);
            alert("Audio settings saved successfully.");
        } catch (error) {
            console.error("Save audio error:", error);
            showStatusMessage(audioSaveStatus, `Error: ${error.message}`, true);
            alert(`Save failed: ${error.message}`);
        } finally {
            saveAudioSettingsBtn.disabled = false;
            saveAudioSettingsBtn.textContent = 'Save Audio Settings';
        }
    }

    async function handleImport(importType, fileInputEl, statusEl, importBtnEl) {
        if (!fileInputEl || !fileInputEl.files || fileInputEl.files.length === 0) {
            showStatusMessage(statusEl, "Select file.", true);
            return;
        }
        
        const file = fileInputEl.files[0];
        if (!file.name.endsWith('.json')) {
            showStatusMessage(statusEl, "Invalid file type (.json).", true);
            return;
        }

        if (importBtnEl) {
            importBtnEl.disabled = true;
            importBtnEl.textContent = 'Importing...';
        }
        showStatusMessage(statusEl, "Importing...", false);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`/api/import/${importType}`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            if (result.success) {
                showStatusMessage(statusEl, result.message || `${importType} imported.`, false);
                alert(result.message || `${importType} imported.`);
            } else {
                throw new Error(result.error || `Failed to import.`);
            }
        } catch (error) {
            console.error(`Import error (${importType}):`, error);
            showStatusMessage(statusEl, `Error: ${error.message}`, true);
            alert(`Import failed: ${error.message}`);
        } finally {
            if (importBtnEl) {
                importBtnEl.disabled = false;
                importBtnEl.textContent = `Import ${importType.charAt(0).toUpperCase() + importType.slice(1)}`;
            }
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
            } else {
                console.error("No valid sections found.");
                return;
            }
        }

        sectionNavItems.forEach(nav => {
            nav.classList.toggle('active', nav.dataset.section === sectionId);
        });

        Object.keys(sections).forEach(key => {
            if (sections[key]) {
                sections[key].style.display = (key === sectionId) ? 'block' : 'none';
            }
        });

        if (sectionId === 'audio-output') {
            loadAndDisplayAudioSettings();
        } else if (sectionId === 'keyboard-control') {
            if (typeof inputControlService !== 'undefined' && typeof inputControlService.initSettingsUI === 'function') {
                inputControlService.initSettingsUI();
            }
        }
    }

    // Event Listeners
    if (addMappingBtn) {
        addMappingBtn.addEventListener('click', () => {
            if (mappingsContainer) {
                const hint = mappingsContainer.querySelector('p.setting-hint');
                if (hint) hint.remove();
            }
            addMappingRow();
        });
    }

    if (saveAudioSettingsBtn) {
        saveAudioSettingsBtn.addEventListener('click', saveAudioConfiguration);
    }

    if (globalVolumeSlider && globalVolumeValue) {
        globalVolumeSlider.addEventListener('input', () => {
            globalVolumeValue.textContent = `${globalVolumeSlider.value}%`;
        });
    }

    if (importSongsBtn && importSongsFileEl && importSongsStatusEl) {
        importSongsBtn.addEventListener('click', () => {
            if (!importSongsFileEl.files?.length) {
                showStatusMessage(importSongsStatusEl, "Select file.", true);
                return;
            }
            if (confirm("Import songs? OVERWRITES current. Backup first!")) {
                handleImport('songs', importSongsFileEl, importSongsStatusEl, importSongsBtn);
            }
        });
    }

    if (importSetlistsBtn && importSetlistsFileEl && importSetlistsStatusEl) {
        importSetlistsBtn.addEventListener('click', () => {
            if (!importSetlistsFileEl.files?.length) {
                showStatusMessage(importSetlistsStatusEl, "Select file.", true);
                return;
            }
            if (confirm("Import setlists? OVERWRITES current. Backup first!")) {
                handleImport('setlists', importSetlistsFileEl, importSetlistsStatusEl, importSetlistsBtn);
            }
        });
    }

    if (openAudioDirBtn) {
        openAudioDirBtn.addEventListener('click', function() {
            fetch('/api/settings/open_directory', {
                method: 'POST'
            })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) throw new Error(data.error || 'Unknown error');
                alert('Opened Audio Directory (OS dependent).');
            })
            .catch(error => {
                console.error('Error opening dir:', error);
                alert(error.message);
            });
        });
    }

    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', function() {
            if (confirm('Clear app cache?')) {
                fetch('/api/clear_cache', {
                    method: 'POST'
                })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) throw new Error(data.message || 'Cache clear failed');
                    alert('Cache cleared.');
                })
                .catch(error => {
                    console.error('Cache clear error:', error);
                    alert(error.message);
                });
            }
        });
    }

    if (factoryResetBtn) {
        factoryResetBtn.addEventListener('click', function() {
            if (confirm('FACTORY RESET? Deletes ALL data & files! IRREVERSIBLE!')) {
                if (confirm('SECOND CONFIRMATION: Really factory reset?')) {
                    fetch('/api/factory_reset', {
                        method: 'POST'
                    })
                    .then(response => response.json().then(data => ({ ok: response.ok, data })))
                    .then(({ ok, data }) => {
                        if (!ok || !data.success) throw new Error(data.message || 'Reset failed');
                        alert('Factory reset complete. Reloading...');
                        setTimeout(() => window.location.reload(), 2000);
                    })
                    .catch(error => {
                        console.error('Factory reset error:', error);
                        alert(error.message);
                    });
                }
            }
        });
    }

    if (deleteAllSongsBtn) {
        deleteAllSongsBtn.addEventListener('click', function() {
            if (confirm('DELETE ALL songs & audio files? IRREVERSIBLE!')) {
                fetch('/api/songs', {
                    method: 'DELETE'
                })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) throw new Error(data.message || 'Delete failed');
                    alert('All songs deleted.');
                })
                .catch(error => {
                    console.error('Delete all songs error:', error);
                    alert(error.message);
                });
            }
        });
    }

    sectionNavItems.forEach(item => {
        item.addEventListener('click', function() {
            switchSection(this.dataset.section);
        });
    });

    // Initialize
    const initialActive = document.querySelector('.songs-sidebar .song-item.active');
    let initialId = null;
    
    if (initialActive) {
        initialId = initialActive.dataset.section;
    } else if (sectionNavItems.length > 0) {
        initialId = sectionNavItems[0].dataset.section;
        sectionNavItems[0].classList.add('active');
    }

    if (initialId) {
        switchSection(initialId);
    } else {
        Object.values(sections).forEach(section => {
            if (section) section.style.display = 'none';
        });
    }
});