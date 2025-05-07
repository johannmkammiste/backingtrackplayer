// static/js/settings.js
document.addEventListener('DOMContentLoaded', function() {
    // Constants
    const MAX_LOGICAL_CHANNELS = 64; // Ensure this matches your backend setting

    // DOM Elements
    const settingsEditor = document.getElementById('settings-editor');

    // Audio Output Section
    const audioOutputSection = document.getElementById('audio-output-section');
    const mappingsContainer = document.getElementById('audio-output-mappings');
    const addMappingBtn = document.getElementById('add-mapping-btn');
    const saveAudioSettingsBtn = document.getElementById('save-audio-settings-btn');
    const globalVolumeSlider = document.getElementById('global-volume-control');
    const globalVolumeValue = document.getElementById('global-volume-value');
    const audioSaveStatus = document.getElementById('audio-save-status');
    const sampleRateSelect = document.getElementById('sample-rate-select');

    // Keyboard Control Section
    const keyboardControlSection = document.getElementById('keyboard-control-section');
    // (Keyboard logic primarily in input-control.js)

    // Data Management Section (Unified)
    const dataManagementSection = document.getElementById('data-management-section');
    // --- Export Elements (Buttons)
    const exportSongsBtn = document.getElementById('export-songs-btn');
    const exportSetlistsBtn = document.getElementById('export-setlists-btn');
    // --- Import Elements
    const importSongsFileEl = document.getElementById('import-songs-file');
    const importSongsBtn = document.getElementById('import-songs-btn');
    const importSongsStatusEl = document.getElementById('import-songs-status');
    const importSetlistsFileEl = document.getElementById('import-setlists-file');
    const importSetlistsBtn = document.getElementById('import-setlists-btn');
    const importSetlistsStatusEl = document.getElementById('import-setlists-status');
    // --- File System & Cache Elements
    const openAudioDirBtn = document.getElementById('open-audio-dir');
    const clearCacheBtn = document.getElementById('clear-cache');

    // Danger Zone Section
    const dangerZoneSection = document.getElementById('danger-zone-section');
    const factoryResetBtn = document.getElementById('factory-reset');
    const deleteAllSongsBtn = document.getElementById('delete-all-songs');

    // Global state for audio settings
    let availableAudioDevices = [];

    // Section Navigation Elements and Mapping
    const sectionNavItems = document.querySelectorAll('.songs-sidebar .song-item'); // Selector for sidebar items
    const sections = {
        'audio-output': audioOutputSection,
        'keyboard-control': keyboardControlSection,
        'data-management': dataManagementSection, // Unified section
        'danger-zone': dangerZoneSection
    };

    // --- Helper Functions ---
    function showStatusMessage(element, message, isError = false, duration = 4000) {
         if (!element) return;
         // Ensure class names match CSS for styling status messages
         element.className = 'save-status setting-status-message ' + (isError ? 'error active' : 'success active');
         element.textContent = message;
         element.style.display = 'block';
         setTimeout(() => {
             if (element) {
                 element.textContent = '';
                 element.style.display = 'none';
                 element.classList.remove('active', 'success', 'error');
             }
         }, duration);
    }

    // Uses global showNotification if available (e.g., from main.js)
    function showGlobalSuccess(message) {
        if (typeof window.showNotification === 'function') window.showNotification(message, 'success');
        else alert(message);
    }
    function showGlobalError(message) {
        const displayMessage = message.startsWith('Error:') ? message : 'Error: ' + message;
        if (typeof window.showNotification === 'function') window.showNotification(displayMessage, 'error');
        else alert(displayMessage);
    }

    // --- Audio Output Settings Functions (No changes needed from previous correct version) ---
    function parseChannels(channelString) { if (!channelString || typeof channelString !== 'string') return null; const c=new Set(), p=channelString.split(','), r=/^(\d+)\s*-\s*(\d+)$/, s=/^\d+$/; for(const t of p){ const m=t.trim(); if(!m)continue; let b,e; if(s.test(m)){b=e=parseInt(m,10);}else{const n=m.match(r);if(n){b=parseInt(n[1],10);e=parseInt(n[2],10);}else return null;} if(isNaN(b)||isNaN(e)||b<1||e<1||b>MAX_LOGICAL_CHANNELS||e>MAX_LOGICAL_CHANNELS||b>e)return null; for(let i=b;i<=e;i++)c.add(i-1);} return c.size>0?Array.from(c).sort((a,b)=>a-b):[];}
    function formatChannels(a){if(!a||a.length===0)return""; const s=[...new Set(a)].sort((x,y)=>x-y),p=[]; let r=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(r===-1)r=c; const n=s[i+1]; if(n!==c+1||i===s.length-1){const b=r+1, e=c+1; if(b===e)p.push(`${b}`); else p.push(`${b}-${e}`); r=-1;}} return p.join(',');}
    function addMappingRow(m=null){if(!mappingsContainer)return;const r=document.createElement('div');r.className='mapping-row setting-row';const s=document.createElement('select');s.className='settings-select device-select';const h=document.createElement('option');h.value="-1";h.textContent="Select Device...";s.appendChild(h);availableAudioDevices.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=`${d.name} (${d.max_output_channels} ch)`;if(m&&d.id===m.device_id)o.selected=true;s.appendChild(o);});const i=document.createElement('input');i.type='text';i.className='settings-input channel-input';i.placeholder=`Channels (1-${MAX_LOGICAL_CHANNELS})`;if(m&&m.channels)i.value=formatChannels(m.channels.map(ch=>ch-1));const b=document.createElement('button');b.textContent='✕ Remove';b.className='settings-button danger remove-mapping-btn';b.type='button';b.addEventListener('click',()=>r.remove());const l1=document.createElement('label');l1.textContent="Device:";const l2=document.createElement('label');l2.textContent="Logical Ch:";r.appendChild(l1);r.appendChild(s);r.appendChild(l2);r.appendChild(i);r.appendChild(b);mappingsContainer.appendChild(r);}
    async function loadAndDisplayAudioSettings(){if(!mappingsContainer||!sampleRateSelect)return;console.log("Loading audio settings...");mappingsContainer.innerHTML='<p>Loading...</p>';try{const p=await fetch('/api/settings/audio_device');if(!p.ok)throw new Error(`HTTP ${p.status}`);const d=await p.json();console.log("Received audio:",d);availableAudioDevices=d.available_devices||[];mappingsContainer.innerHTML='';const c=d.current_config||[];if(c.length>0)c.forEach(m=>addMappingRow(m));else mappingsContainer.innerHTML=`<p class="setting-hint">No mappings. Click "Add".</p>`;if(globalVolumeSlider&&d.volume!==undefined){globalVolumeSlider.value=d.volume*100;if(globalVolumeValue)globalVolumeValue.textContent=`${Math.round(d.volume*100)}%`;}sampleRateSelect.innerHTML='';(d.supported_sample_rates||[44100,48000,88200,96000]).forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=`${t} Hz`;sampleRateSelect.appendChild(o);});if(d.current_sample_rate!==undefined)sampleRateSelect.value=d.current_sample_rate;else sampleRateSelect.value="48000";}catch(e){console.error("Load audio error:",e);if(mappingsContainer)mappingsContainer.innerHTML='<p class="error-message">Error loading.</p>';showGlobalError(`Audio load failed: ${e.message}`);}}
    async function saveAudioConfiguration(){if(!mappingsContainer||!saveAudioSettingsBtn||!globalVolumeSlider||!sampleRateSelect)return;console.log("Saving audio config...");saveAudioSettingsBtn.disabled=true;saveAudioSettingsBtn.textContent='Saving...';if(audioSaveStatus)showStatusMessage(audioSaveStatus,'',false);const rows=mappingsContainer.querySelectorAll('.mapping-row'),outputs=[];let err=false;const used=new Set();rows.forEach(r=>{if(err)return;const s=r.querySelector('.device-select'),i=r.querySelector('.channel-input'),d_id=parseInt(s.value,10),cStr=i.value,c0=parseChannels(cStr);s.classList.remove('input-error');i.classList.remove('input-error');if(d_id===-1){showStatusMessage(audioSaveStatus,`Select device.`,true);err=true;s.classList.add('input-error');return;}if(c0===null){showStatusMessage(audioSaveStatus,`Invalid channels "${cStr}".`,true);err=true;i.classList.add('input-error');return;}const c1=c0.map(ch=>ch+1);for(const ch of c1){if(used.has(ch)){showStatusMessage(audioSaveStatus,`Channel ${ch} used twice.`,true);err=true;i.classList.add('input-error');return;}used.add(ch);}outputs.push({device_id:d_id,channels:c1});});if(err){saveAudioSettingsBtn.disabled=false;saveAudioSettingsBtn.textContent='Save';return;}const vol=parseFloat(globalVolumeSlider.value)/100,sr=parseInt(sampleRateSelect.value,10);const load={audio_outputs:outputs,volume:vol,sample_rate:sr};try{const p=await fetch('/api/settings/audio_device',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(load)});const res=await p.json();if(!p.ok)throw new Error(res.error||`HTTP ${p.status}`);console.log("Save result:",res);showStatusMessage(audioSaveStatus,'Saved!',false);showGlobalSuccess("Audio saved.");}catch(e){console.error("Save audio error:",e);showStatusMessage(audioSaveStatus,`Error: ${e.message}`,true);showGlobalError(`Save failed: ${e.message}`);}finally{saveAudioSettingsBtn.disabled=false;saveAudioSettingsBtn.textContent='Save Audio Settings';}}

    // --- Data Management Section Functions ---

// static/js/settings.js

// ... (keep existing code above handleExport) ...

    // REINSTATED: JavaScript function to handle export using fetch/blob
    async function handleExport(exportType, buttonElement) {
        console.log(`[Export Step 1] Exporting ${exportType}...`); // Log Start
        const originalButtonText = buttonElement ? buttonElement.textContent : '';
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.textContent = 'Exporting...';
        }
        // showGlobalSuccess(`${exportType} data export started...`); // Maybe too early

        try {
            console.log("[Export Step 2] Fetching URL:", `/api/export/${exportType}`); // Log URL
            const response = await fetch(`/api/export/${exportType}`);
            console.log(`[Export Step 3] Fetch response status: ${response.status}`, response); // Log Response Status

            if (!response.ok) {
                let errorMsg = `Export failed: ${response.status}`;
                try { const errorData = await response.json(); errorMsg = errorData.error || JSON.stringify(errorData); } catch(e) {}
                console.error("[Export Error] Fetch failed:", errorMsg); // Log Fetch Error
                throw new Error(errorMsg);
            }

            // Log Headers
            let filename = `${exportType}.json`; // Default
            try {
                 const disposition = response.headers.get('Content-Disposition');
                 console.log("[Export Step 4] Content-Disposition Header:", disposition); // Log Header
                 if (disposition && disposition.includes('attachment')) {
                     const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                     const matches = filenameRegex.exec(disposition);
                     if (matches?.[1]) {
                         filename = matches[1].replace(/['"]/g, '');
                         console.log("[Export Step 5] Filename extracted from header:", filename); // Log Filename
                     } else {
                          console.log("[Export Step 5a] Could not extract filename from header, using default.");
                     }
                 } else {
                     console.log("[Export Step 5b] Content-Disposition not 'attachment', using default filename.");
                 }
            } catch(headerError) {
                console.warn("Could not parse headers, using default filename.", headerError)
            }


            console.log("[Export Step 6] Getting response as blob..."); // Log before blob
            const blob = await response.blob();
            console.log("[Export Step 7] Blob created:", blob); // Log blob info

            if (!blob || blob.size === 0) {
                throw new Error("Received empty file data from server.");
            }

            console.log("[Export Step 8] Creating Object URL..."); // Log before createObjectURL
            const url = window.URL.createObjectURL(blob);
            console.log("[Export Step 9] Object URL created:", url); // Log URL

            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename; // Set the filename
            console.log(`[Export Step 10] Link created: href=${a.href}, download=${a.download}`); // Log link setup

            document.body.appendChild(a);
            console.log("[Export Step 11] Appended link to body, attempting click..."); // Log before click
            a.click(); // Simulate click
            console.log("[Export Step 12] Link click simulated."); // Log after click

            // Clean up
            console.log("[Export Step 13] Cleaning up: Revoking URL and removing link..."); // Log cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            console.log("[Export Step 14] Cleanup complete."); // Log end

            showGlobalSuccess(`${filename} download initiated.`); // Notify success

        } catch (error) {
            console.error(`[Export Error] Error during export process for ${exportType}:`, error); // Log any error
            showGlobalError(`Export failed: ${error.message}`);
        } finally {
            if (buttonElement) { // Re-enable button
                buttonElement.disabled = false;
                buttonElement.textContent = originalButtonText;
            }
        }
    }

// ... (keep the rest of settings.js, including handleImport, event listeners, etc.) ...

    // Import function (no changes needed from previous correct version)
    async function handleImport(importType, fileInputEl, statusEl, importBtnEl) {
        if (!fileInputEl || !fileInputEl.files || fileInputEl.files.length === 0) { showStatusMessage(statusEl, "Select file.", true); return; }
        const file = fileInputEl.files[0]; if (!file.name.endsWith('.json')) { showStatusMessage(statusEl, "Invalid file type (.json).", true); return; }
        if (importBtnEl) { importBtnEl.disabled = true; importBtnEl.textContent = 'Importing...'; }
        showStatusMessage(statusEl, "Importing...", false);
        const formData = new FormData(); formData.append('file', file);
        try {
            const response = await fetch(`/api/import/${importType}`, { method: 'POST', body: formData });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            if (result.success) { showStatusMessage(statusEl, result.message || `${importType} imported.`, false); showGlobalSuccess(result.message || `${importType} imported.`); }
            else { throw new Error(result.error || `Failed to import.`); }
        } catch (error) { console.error(`Import error (${importType}):`, error); showStatusMessage(statusEl, `Error: ${error.message}`, true); showGlobalError(`Import failed: ${error.message}`);
        } finally { if (importBtnEl) { importBtnEl.disabled = false; importBtnEl.textContent = `Import ${importType.charAt(0).toUpperCase() + importType.slice(1)}`; } if (fileInputEl) fileInputEl.value = ''; }
    }

    // --- Event Listeners Setup ---
    // Audio Output
    if (addMappingBtn) addMappingBtn.addEventListener('click', () => { if (mappingsContainer) { const p = mappingsContainer.querySelector('p.setting-hint'); if(p) p.remove(); } addMappingRow(); });
    if (saveAudioSettingsBtn) saveAudioSettingsBtn.addEventListener('click', saveAudioConfiguration);
    if (globalVolumeSlider && globalVolumeValue) { globalVolumeSlider.addEventListener('input', () => { if(globalVolumeValue) globalVolumeValue.textContent = `${globalVolumeSlider.value}%`; }); }

    // Data Management Section Listeners
    // RE-ADD listeners for export buttons, calling the JS handler
    if (exportSongsBtn) { exportSongsBtn.addEventListener('click', (event) => handleExport('songs', event.target)); }
    if (exportSetlistsBtn) { exportSetlistsBtn.addEventListener('click', (event) => handleExport('setlists', event.target)); }

    // Import listeners
    if (importSongsBtn && importSongsFileEl && importSongsStatusEl) { importSongsBtn.addEventListener('click', () => { if (!importSongsFileEl.files?.length) { showStatusMessage(importSongsStatusEl, "Select file.", true); return; } if (confirm("Import songs? OVERWRITES current. Backup first!")) handleImport('songs', importSongsFileEl, importSongsStatusEl, importSongsBtn); }); }
    if (importSetlistsBtn && importSetlistsFileEl && importSetlistsStatusEl) { importSetlistsBtn.addEventListener('click', () => { if (!importSetlistsFileEl.files?.length) { showStatusMessage(importSetlistsStatusEl, "Select file.", true); return; } if (confirm("Import setlists? OVERWRITES current. Backup first!")) handleImport('setlists', importSetlistsFileEl, importSetlistsStatusEl, importSetlistsBtn); }); }

    // File/Cache listeners
    if (openAudioDirBtn) { openAudioDirBtn.addEventListener('click', function() { fetch('/api/settings/open_directory', { method: 'POST' }).then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{if(!ok||!d.success)throw new Error(d.error||'Unknown error');showGlobalSuccess('Opened Audio Directory (OS dependent).');}).catch(e=>{console.error('Error opening dir:',e);showGlobalError(e.message);}); }); }
    if (clearCacheBtn) { clearCacheBtn.addEventListener('click', function() { if(confirm('Clear app cache?')){fetch('/api/clear_cache',{method:'POST'}).then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{if(!ok||!d.success)throw new Error(d.message||'Cache clear failed');showGlobalSuccess('Cache cleared.');}).catch(e=>{console.error('Cache clear error:',e);showGlobalError(e.message);});}}); }

    // Danger Zone Listeners
    if (factoryResetBtn) { factoryResetBtn.addEventListener('click', function() { if(confirm('FACTORY RESET? Deletes ALL data & files! IRREVERSIBLE!')){if(confirm('SECOND CONFIRMATION: Really factory reset?')){fetch('/api/factory_reset',{method:'POST'}).then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{if(!ok||!d.success)throw new Error(d.message||'Reset failed');showGlobalSuccess('Factory reset complete. Reloading...');setTimeout(()=>window.location.reload(),2000);}).catch(e=>{console.error('Factory reset error:',e);showGlobalError(e.message);});}}}); }
    if (deleteAllSongsBtn) { deleteAllSongsBtn.addEventListener('click', function() { if(confirm('DELETE ALL songs & audio files? IRREVERSIBLE!')){fetch('/api/songs',{method:'DELETE'}).then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{if(!ok||!d.success)throw new Error(d.message||'Delete failed');showGlobalSuccess('All songs deleted.');}).catch(e=>{console.error('Delete all songs error:',e);showGlobalError(e.message);});}}); }


    // --- Section Navigation Logic ---
    function switchSection(sectionId) {
        if (!sectionId || !sections[sectionId]) {
             const firstSectionKey = Object.keys(sections).find(key => sections[key]); // Find first valid section key
             if (firstSectionKey) {
                 sectionId = firstSectionKey;
                 const firstNavItem = document.querySelector(`.songs-sidebar .song-item[data-section="${sectionId}"]`);
                 if(firstNavItem) firstNavItem.classList.add('active'); // Ensure visually active
                 console.log(`Defaulting to section: ${sectionId}`);
             } else {
                 console.error("Cannot switch section - no valid sections defined or found.");
                 return;
             }
        }

        sectionNavItems.forEach(navItem => {
            navItem.classList.toggle('active', navItem.dataset.section === sectionId);
        });

        Object.keys(sections).forEach(key => {
            if (sections[key]) {
                sections[key].style.display = (key === sectionId) ? 'block' : 'none';
            }
        });

        // Load data for specific sections when they become active
        if (sectionId === 'audio-output') {
            loadAndDisplayAudioSettings();
        } else if (sectionId === 'keyboard-control') {
            if (typeof inputControlService !== 'undefined' && typeof inputControlService.initSettingsUI === 'function') {
                inputControlService.initSettingsUI();
            } else {
                console.warn("inputControlService not found. Ensure input-control.js is loaded.");
            }
        }
    }

    sectionNavItems.forEach(item => {
        item.addEventListener('click', function() {
            switchSection(this.dataset.section);
        });
    });

    // Initialize Default Section View
    const initialActiveSectionItem = document.querySelector('.songs-sidebar .song-item.active');
    let initialSectionId = null;
    if (initialActiveSectionItem) {
        initialSectionId = initialActiveSectionItem.dataset.section;
    } else if (sectionNavItems.length > 0) { // Default to first item if none are marked active
        initialSectionId = sectionNavItems[0].dataset.section;
        sectionNavItems[0].classList.add('active'); // Make sure first one is visually active
    }

    if (initialSectionId) {
        switchSection(initialSectionId);
    } else {
        console.warn("No initial section to display.");
        Object.values(sections).forEach(section => { if(section) section.style.display = 'none'; });
    }

}); // End DOMContentLoaded