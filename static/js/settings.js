// static/js/settings.js
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
    // REMOVED export button constants:
    // const exportSongsBtn = document.getElementById('export-songs-btn');
    // const exportSetlistsBtn = document.getElementById('export-setlists-btn');
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

    // --- Helper Functions (showStatusMessage, showGlobalSuccess, showGlobalError) ---
    function showStatusMessage(element, message, isError = false, duration = 4000) { if (!element) return; element.textContent = message; element.className = 'save-status setting-status-message ' + (isError ? 'error active' : 'success active'); element.style.display = 'block'; setTimeout(() => { if (element) { element.textContent = ''; element.style.display = 'none'; element.classList.remove('active', 'success', 'error'); } }, duration); }
    // Ensure showGlobalSuccess/Error are available (e.g., in main.js or globally)
    window.showGlobalSuccess = window.showGlobalSuccess || function(message) { console.log("SUCCESS:", message); alert(message); };
    window.showGlobalError = window.showGlobalError || function(message) { const msg = message.startsWith('Error:') ? message : 'Error: ' + message; console.error("ERROR:", msg); alert(msg); };

    // --- Audio Output Functions (Keep as is) ---
    function parseChannels(channelString) { if (!channelString || typeof channelString !== 'string') return null; const c=new Set(), p=channelString.split(','), r=/^(\d+)\s*-\s*(\d+)$/, s=/^\d+$/; for(const t of p){ const m=t.trim(); if(!m)continue; let b,e; if(s.test(m)){b=e=parseInt(m,10);}else{const n=m.match(r);if(n){b=parseInt(n[1],10);e=parseInt(n[2],10);}else return null;} if(isNaN(b)||isNaN(e)||b<1||e<1||b>MAX_LOGICAL_CHANNELS||e>MAX_LOGICAL_CHANNELS||b>e)return null; for(let i=b;i<=e;i++)c.add(i-1);} return c.size>0?Array.from(c).sort((a,b)=>a-b):[];}
    function formatChannels(a){if(!a||a.length===0)return""; const s=[...new Set(a)].sort((x,y)=>x-y),p=[]; let r=-1; for(let i=0;i<s.length;i++){const c=s[i]; if(r===-1)r=c; const n=s[i+1]; if(n!==c+1||i===s.length-1){const b=r+1, e=c+1; if(b===e)p.push(`${b}`); else p.push(`${b}-${e}`); r=-1;}} return p.join(',');}
    function addMappingRow(m=null){if(!mappingsContainer)return;const r=document.createElement('div');r.className='mapping-row setting-row';const s=document.createElement('select');s.className='settings-select device-select';const h=document.createElement('option');h.value="-1";h.textContent="Select Device...";s.appendChild(h);availableAudioDevices.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=`${d.name} (${d.max_output_channels} ch)`;if(m&&d.id===m.device_id)o.selected=true;s.appendChild(o);});const i=document.createElement('input');i.type='text';i.className='settings-input channel-input';i.placeholder=`Channels (1-${MAX_LOGICAL_CHANNELS})`;if(m&&m.channels)i.value=formatChannels(m.channels.map(ch=>ch-1));const b=document.createElement('button');b.textContent='✕ Remove';b.className='settings-button danger remove-mapping-btn';b.type='button';b.addEventListener('click',()=>r.remove());const l1=document.createElement('label');l1.textContent="Device:";const l2=document.createElement('label');l2.textContent="Logical Ch:";r.appendChild(l1);r.appendChild(s);r.appendChild(l2);r.appendChild(i);r.appendChild(b);mappingsContainer.appendChild(r);}
    async function loadAndDisplayAudioSettings(){if(!mappingsContainer||!sampleRateSelect)return;console.log("Loading audio settings...");mappingsContainer.innerHTML='<p>Loading...</p>';try{const p=await fetch('/api/settings/audio_device');if(!p.ok)throw new Error(`HTTP ${p.status}`);const d=await p.json();console.log("Received audio:",d);availableAudioDevices=d.available_devices||[];mappingsContainer.innerHTML='';const c=d.current_config||[];if(c.length>0)c.forEach(m=>addMappingRow(m));else mappingsContainer.innerHTML=`<p class="setting-hint">No mappings. Click "Add".</p>`;if(globalVolumeSlider&&d.volume!==undefined){globalVolumeSlider.value=d.volume*100;if(globalVolumeValue)globalVolumeValue.textContent=`${Math.round(d.volume*100)}%`;}sampleRateSelect.innerHTML='';(d.supported_sample_rates||[44100,48000,88200,96000]).forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=`${t} Hz`;sampleRateSelect.appendChild(o);});if(d.current_sample_rate!==undefined)sampleRateSelect.value=d.current_sample_rate;else sampleRateSelect.value="48000";}catch(e){console.error("Load audio error:",e);if(mappingsContainer)mappingsContainer.innerHTML='<p class="error-message">Error loading.</p>';showGlobalError(`Audio load failed: ${e.message}`);}}
    async function saveAudioConfiguration(){if(!mappingsContainer||!saveAudioSettingsBtn||!globalVolumeSlider||!sampleRateSelect)return;console.log("Saving audio config...");saveAudioSettingsBtn.disabled=true;saveAudioSettingsBtn.textContent='Saving...';if(audioSaveStatus)showStatusMessage(audioSaveStatus,'',false);const rows=mappingsContainer.querySelectorAll('.mapping-row'),outputs=[];let err=false;const used=new Set();rows.forEach(r=>{if(err)return;const s=r.querySelector('.device-select'),i=r.querySelector('.channel-input'),d_id=parseInt(s.value,10),cStr=i.value,c0=parseChannels(cStr);s.classList.remove('input-error');i.classList.remove('input-error');if(d_id===-1){showStatusMessage(audioSaveStatus,`Select device.`,true);err=true;s.classList.add('input-error');return;}if(c0===null){showStatusMessage(audioSaveStatus,`Invalid channels "${cStr}".`,true);err=true;i.classList.add('input-error');return;}const c1=c0.map(ch=>ch+1);for(const ch of c1){if(used.has(ch)){showStatusMessage(audioSaveStatus,`Channel ${ch} used twice.`,true);err=true;i.classList.add('input-error');return;}used.add(ch);}outputs.push({device_id:d_id,channels:c1});});if(err){saveAudioSettingsBtn.disabled=false;saveAudioSettingsBtn.textContent='Save';return;}const vol=parseFloat(globalVolumeSlider.value)/100,sr=parseInt(sampleRateSelect.value,10);const load={audio_outputs:outputs,volume:vol,sample_rate:sr};try{const p=await fetch('/api/settings/audio_device',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(load)});const res=await p.json();if(!p.ok)throw new Error(res.error||`HTTP ${p.status}`);console.log("Save result:",res);showStatusMessage(audioSaveStatus,'Saved!',false);showGlobalSuccess("Audio saved.");}catch(e){console.error("Save audio error:",e);showStatusMessage(audioSaveStatus,`Error: ${e.message}`,true);showGlobalError(`Save failed: ${e.message}`);}finally{saveAudioSettingsBtn.disabled=false;saveAudioSettingsBtn.textContent='Save Audio Settings';}}


    // --- Data Management Section Functions ---

    // REMOVED handleExport function

    // Import function (Keep as is)
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
    // REMOVED export button listeners

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
    function switchSection(sectionId) { /* ... keep this function as is ... */
        if (!sectionId || !sections[sectionId]) { const firstKey = Object.keys(sections).find(k => sections[k]); if (firstKey) { sectionId = firstKey; const firstNav = document.querySelector(`.songs-sidebar .song-item[data-section="${sectionId}"]`); if(firstNav) firstNav.classList.add('active'); } else { console.error("No valid sections found."); return; }}
        sectionNavItems.forEach(nav => { nav.classList.toggle('active', nav.dataset.section === sectionId); });
        Object.keys(sections).forEach(key => { if (sections[key]) sections[key].style.display = (key === sectionId) ? 'block' : 'none'; });
        if (sectionId === 'audio-output') { loadAndDisplayAudioSettings(); }
        else if (sectionId === 'keyboard-control') { if (typeof inputControlService !== 'undefined' && typeof inputControlService.initSettingsUI === 'function') inputControlService.initSettingsUI(); else console.warn("inputControlService not found."); }
    }
    sectionNavItems.forEach(item => { item.addEventListener('click', function() { switchSection(this.dataset.section); }); });
    const initialActive = document.querySelector('.songs-sidebar .song-item.active');
    let initialId = null; if (initialActive) initialId = initialActive.dataset.section; else if (sectionNavItems.length > 0) { initialId = sectionNavItems[0].dataset.section; sectionNavItems[0].classList.add('active'); }
    if (initialId) switchSection(initialId); else { console.warn("No initial section."); Object.values(sections).forEach(s => { if(s) s.style.display = 'none'; }); }

}); // End DOMContentLoaded