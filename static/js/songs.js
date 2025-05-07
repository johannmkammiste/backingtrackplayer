// static/js/songs.js
document.addEventListener('DOMContentLoaded', function () {
    // Constants
    const MAX_LOGICAL_CHANNELS = 64; // Ensure this matches your backend setting

    // DOM Elements
    const addSongBtn = document.getElementById('add-song-btn');
    const emptyState = document.getElementById('empty-state');
    const songForm = document.getElementById('song-form');
    const songTitle = document.getElementById('song-title');
    const songNameInput = document.getElementById('song-name');
    const songTempoInput = document.getElementById('song-tempo');
    const tracksList = document.getElementById('tracks-list');
    const saveSongBtn = document.getElementById('save-song');
    const deleteSongBtn = document.getElementById('delete-song');

    const manageMediaBtn = document.getElementById('manage-media-btn');
    const mediaLibraryModal = document.getElementById('media-library-modal');
    const globalFileUploadInput = document.getElementById('global-file-upload');
    const globalUploadArea = mediaLibraryModal ? mediaLibraryModal.querySelector('.global-upload-area') : null;
    const availableAudioFilesList = document.getElementById('available-audio-files-list');
    const globalUploadStatus = document.getElementById('global-upload-status');

    const addTrackToSongBtn = document.getElementById('add-track-to-song-btn');
    const selectAudioFileModal = document.getElementById('select-audio-file-modal');
    const audioFileSelectorList = document.getElementById('audio-file-selector-list');

    // State Variables
    let currentSongId = null;
    let isNewSong = false;
    let isSaving = false;
    let allAvailableAudioFiles = [];
    let nextTrackTempId = -1;

    // --- Initialization ---
    if (addSongBtn) addSongBtn.addEventListener('click', createNewSong);
    if (saveSongBtn) saveSongBtn.addEventListener('click', saveSong);
    if (deleteSongBtn) deleteSongBtn.addEventListener('click', deleteSong);
    setupSongItemClickHandlers();

    if (manageMediaBtn) manageMediaBtn.addEventListener('click', openMediaLibraryModal);
    if (mediaLibraryModal) {
        mediaLibraryModal.querySelectorAll('.close-modal-btn, .modal-button.cancel').forEach(btn => {
            const modalId = btn.closest('.modal')?.id;
            if(modalId) btn.addEventListener('click', () => closeModal(modalId));
        });
    }
    if (globalFileUploadInput && globalUploadArea) {
        globalFileUploadInput.addEventListener('change', handleGlobalFileUpload);
        setupGlobalDragAndDrop();
    } else if (globalFileUploadInput) {
        globalFileUploadInput.addEventListener('change', handleGlobalFileUpload);
    }

    // --- MODIFIED "Add Track to Song" Button Listener ---
    if (addTrackToSongBtn) {
        addTrackToSongBtn.addEventListener('click', async () => { // Listener is async
            console.log("'Add Track to Song' button clicked.");
            if (!currentSongId || isNewSong) {
                showGlobalNotification("Please save the song before adding tracks.", "warning");
                return;
            }

            let filesHaveBeenLoaded = (allAvailableAudioFiles.length > 0);

            if (!filesHaveBeenLoaded) { // If files are not already in our JS array
                console.log("No available audio files cached for track selection, fetching now...");
                try {
                    const response = await fetch('/api/audio/files'); // Wait for the fetch
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `Failed to fetch audio files (status ${response.status})`);
                    }
                    const data = await response.json();
                    allAvailableAudioFiles = data.files || []; // Update the global array
                    console.log("Fetched available audio files for track selection:", allAvailableAudioFiles);
                    filesHaveBeenLoaded = true; // Mark that we have (or attempted to load) files
                } catch (error) {
                    console.error('Error fetching available audio files for track selection:', error);
                    showGlobalNotification(`Could not load audio files list: ${error.message}. Try opening "Manage Audio Files" first.`, 'error');
                    return; // Stop if fetching fails
                }
            } else {
                console.log("Audio files were already available in js: ", allAvailableAudioFiles);
            }

            // Proceed only if files are confirmed to be loaded (either previously or just now)
            if (filesHaveBeenLoaded) {
                if (selectAudioFileModal && audioFileSelectorList) {
                    console.log("Attempting to populate audio file selector and show 'select-audio-file-modal'.");
                    populateAudioFileSelector(); // This will use the updated allAvailableAudioFiles
                    selectAudioFileModal.style.display = 'flex';
                } else {
                    console.error("selectAudioFileModal or audioFileSelectorList DOM elements not found.");
                }
            } else {
                // This case should ideally not be reached if the try/catch above handles errors correctly.
                console.error("Files are not ready after attempting to load, modal will not be shown.");
                 showGlobalNotification('Failed to load audio files. Please try again or use "Manage Audio Files".', 'error');
            }
        });
    }

    if (selectAudioFileModal) {
         selectAudioFileModal.querySelectorAll('.close-modal-btn, .modal-button.cancel').forEach(btn => {
            const modalId = btn.closest('.modal')?.id;
            if(modalId) btn.addEventListener('click', () => closeModal(modalId));
        });
    }

    // Initial page state
    const firstSongItem = document.querySelector('.songs-list .song-item');
    if (!firstSongItem && emptyState && songForm) {
        showEmptyState("No songs yet. Click 'Add New Song' to create one!");
    } else if (emptyState && songForm) {
        emptyState.style.display = 'flex';
        songForm.style.display = 'none';
    }

    // --- Core Functions (mostly unchanged from your last version) ---
    function setupSongItemClickHandlers() {
        const songsListContainer = document.querySelector('.songs-list');
        if (songsListContainer) {
            console.log('Setting up song item click handlers.');
            songsListContainer.addEventListener('click', function (e) {
                const targetItem = e.target.closest('.song-item');
                if (targetItem) {
                    console.log('Song item clicked:', targetItem);
                    const songIdStr = targetItem.dataset.songId;
                    console.log('Attempting to load song ID from data attribute:', songIdStr);
                    if (songIdStr) {
                        const songId = parseInt(songIdStr);
                        if (!isNaN(songId)) {
                            document.querySelectorAll('.songs-list .song-item.active').forEach(i => {
                                i.classList.remove('active');
                            });
                            targetItem.classList.add('active');
                            loadSong(songId);
                        } else { console.error('Invalid songId parsed:', songIdStr); }
                    } else { console.error('data-song-id attribute missing or empty.'); }
                }
            });
        } else { console.error('Songs list container not found.'); }
    }

    function createNewSong() {
        console.log('Creating new song UI.');
        currentSongId = null; isNewSong = true;
        if(emptyState) emptyState.style.display = 'none';
        if(songForm) songForm.style.display = 'block';
        if(songTitle) songTitle.textContent = 'New Song';
        if(songNameInput) songNameInput.value = '';
        if(songTempoInput) songTempoInput.value = '120';
        if(tracksList) tracksList.innerHTML = '';
        document.querySelectorAll('.songs-list .song-item.active').forEach(item => item.classList.remove('active'));
        nextTrackTempId = -1;
    }

    async function loadSong(songId) {
        console.log(`loadSong called for ID: ${songId}`);
        if(emptyState) { console.log('Hiding empty state.'); emptyState.style.display = 'none'; }
        if(songForm) {
            console.log('Showing song form and adding loading class.');
            songForm.style.display = 'block'; songForm.classList.add('loading');
        } else { console.error('songForm element not found in loadSong!'); return; }

        try {
            const response = await fetch(`/api/songs/${songId}`);
            console.log(`Response status for song ${songId}: ${response.status}`);
            if (!response.ok) {
                let errorText = `HTTP error ${response.status}`;
                try { const errorData = await response.json(); errorText = errorData.error || JSON.stringify(errorData) || errorText; } catch (e) {}
                console.error(`Failed to fetch song ${songId}: ${errorText}`); throw new Error(errorText);
            }
            const song = await response.json();
            console.log(`Successfully fetched song data for ${songId}:`, song);

            currentSongId = song.id; isNewSong = false;
            if(songTitle) songTitle.textContent = song.name;
            if(songNameInput) songNameInput.value = song.name;
            if(songTempoInput) songTempoInput.value = song.tempo;
            if(tracksList) tracksList.innerHTML = '';
            nextTrackTempId = -1;
            (song.audio_tracks || []).forEach(track => addTrackToUI(track));
            document.querySelectorAll('.songs-list .song-item').forEach(item => {
                item.classList.toggle('active', parseInt(item.dataset.songId) === song.id);
            });
        } catch (error) {
            console.error(`Full error in loadSong for ID ${songId}:`, error.message, error.stack);
            showEmptyState(`Failed to load song: ${error.message}`); currentSongId = null;
        } finally {
            if(songForm) songForm.classList.remove('loading');
            console.log('loadSong finished.');
        }
    }

    function showEmptyState(message = "Select a song from the list or create a new one") {
        console.log('showEmptyState called with message:', message);
        if(emptyState) { emptyState.innerHTML = `<p>${message}</p>`; emptyState.style.display = 'flex'; }
        if(songForm) songForm.style.display = 'none';
        currentSongId = null; isNewSong = false;
    }

    function openMediaLibraryModal() {
        if (mediaLibraryModal) {
            console.log('Opening media library modal.');
            mediaLibraryModal.style.display = 'flex';
            loadAvailableAudioFiles(); // This populates allAvailableAudioFiles
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            console.log(`Closing modal: ${modalId}`);
            modal.style.display = 'none';
        }
    }

    async function loadAvailableAudioFiles() { // Called by Media Library & potentially by Add Track
        if (!availableAudioFilesList && !addTrackToSongBtn) return; // Exit if no relevant UI element needs it
        if (availableAudioFilesList) availableAudioFilesList.innerHTML = '<p>Loading audio files...</p>';

        try {
            const response = await fetch('/api/audio/files');
            if (!response.ok) throw new Error('Failed to fetch audio files list');
            const data = await response.json();
            allAvailableAudioFiles = data.files || []; // Update global array
            console.log("Loaded allAvailableAudioFiles:", allAvailableAudioFiles);
            if (document.getElementById('media-library-modal')?.style.display === 'flex' && availableAudioFilesList) {
                 renderAvailableAudioFiles(); // Only render to media library if it's open
            }
        } catch (error) {
            console.error('Error loading available audio files:', error);
            if (availableAudioFilesList) availableAudioFilesList.innerHTML = '<p class="error">Could not load audio files.</p>';
            // Don't show global notification here if called internally by Add Track, handle there
        }
    }

    function renderAvailableAudioFiles() { // Specifically for the media library modal
        if (!availableAudioFilesList) return;
        availableAudioFilesList.innerHTML = '';
        if (allAvailableAudioFiles.length === 0) {
            availableAudioFilesList.innerHTML = '<p>No audio files uploaded yet.</p>'; return;
        }
        const ul = document.createElement('ul');
        allAvailableAudioFiles.forEach(filename => {
            const li = document.createElement('li'); li.textContent = filename; ul.appendChild(li);
        });
        availableAudioFilesList.appendChild(ul);
    }

    function setupGlobalDragAndDrop() {
        if (!globalUploadArea || !globalFileUploadInput) return;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            globalUploadArea.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });
        ['dragenter', 'dragover'].forEach(eName => globalUploadArea.addEventListener(eName, () => globalUploadArea.classList.add('dragover')));
        ['dragleave', 'drop'].forEach(eName => globalUploadArea.addEventListener(eName, () => globalUploadArea.classList.remove('dragover')));
        globalUploadArea.addEventListener('drop', handleGlobalDrop, false);
    }

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    function handleGlobalDrop(e) {
        if (globalFileUploadInput) globalFileUploadInput.files = e.dataTransfer.files;
        handleGlobalFileUpload();
    }

    async function handleGlobalFileUpload() {
        if (!globalFileUploadInput || !globalUploadStatus) return;
        const files = globalFileUploadInput.files;
        if (!files || files.length === 0) return;
        globalUploadStatus.textContent = 'Uploading...'; globalUploadStatus.className = 'status-uploading';
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append('files[]', files[i]);
        try {
            const response = await fetch('/api/audio/upload', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
            let messages = [];
            if (data.uploaded_files && data.uploaded_files.length > 0) {
                messages.push(`${data.uploaded_files.length} file(s) uploaded.`);
                loadAvailableAudioFiles(); // Refresh list after upload
            }
            if (data.errors && data.errors.length > 0) messages.push(`Errors: ${data.errors.join(', ')}`);
            globalUploadStatus.textContent = messages.join(' ');
            globalUploadStatus.className = data.errors?.length > 0 ? 'status-error' : 'status-success';
        } catch (error) {
            console.error('Global upload error:', error);
            globalUploadStatus.textContent = `Error: ${error.message}`; globalUploadStatus.className = 'status-error';
        } finally {
            if (globalFileUploadInput) globalFileUploadInput.value = '';
            setTimeout(() => { if (globalUploadStatus) globalUploadStatus.textContent = ''; }, 5000);
        }
    }

    function populateAudioFileSelector() { // For the "Select Audio File" modal when adding track to song
        if (!audioFileSelectorList || !selectAudioFileModal) {
            console.error("populateAudioFileSelector: audioFileSelectorList or selectAudioFileModal not found."); return;
        }
        audioFileSelectorList.innerHTML = '';
        console.log("Populating 'select-audio-file-modal' with:", allAvailableAudioFiles);

        if (allAvailableAudioFiles.length === 0) {
            audioFileSelectorList.innerHTML = '<p>No audio files available. Upload files via "Manage Audio Files" in the sidebar first.</p>';
            return;
        }
        allAvailableAudioFiles.forEach(filename => {
            const fileItem = document.createElement('div');
            fileItem.className = 'audio-file-select-item'; fileItem.textContent = filename;
            fileItem.addEventListener('click', () => {
                console.log(`Audio file selected for track: ${filename}`);
                addSelectedFileAsTrack(filename);
                closeModal(selectAudioFileModal.id);
            });
            audioFileSelectorList.appendChild(fileItem);
        });
    }

    function addSelectedFileAsTrack(filename) {
        const newTrackData = {
            id: nextTrackTempId--, file_path: filename, output_channel: 1, volume: 1.0, is_stereo: false
        };
        addTrackToUI(newTrackData);
    }

    function addTrackToUI(track) {
        if (!track || typeof track !== 'object' || !tracksList) { console.error("Invalid track data or UI element missing:", track); return; }
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item'; trackElement.dataset.trackId = track.id;
        const isStereoChecked = track.is_stereo ? 'checked' : '';
        const initialChannelOneBased = track.output_channel || 1;
        const initialNextChannelOneBased = initialChannelOneBased + 1;
        let channelOptionsHtml = '';
        for (let i = 1; i <= MAX_LOGICAL_CHANNELS; i++) {
             const selected = (initialChannelOneBased === i) ? 'selected' : '';
             channelOptionsHtml += `<option value="${i}" ${selected}>${i}</option>`;
        }
        trackElement.innerHTML = `
            <div class="track-info"><span class="track-name">${track.file_path || 'Unknown'}</span></div>
            <div class="track-controls">
                <div class="track-control-row"><label class="track-control-label">Output Ch:</label><select class="channel-select">${channelOptionsHtml}</select></div>
                <div class="track-control-row"><label class="track-control-label">Stereo:</label><input type="checkbox" class="is-stereo-checkbox" ${isStereoChecked}><span class="stereo-hint">(Ch ${initialChannelOneBased} & ${initialNextChannelOneBased})</span></div>
                <div class="track-control-row"><label class="track-control-label">Volume:</label><div class="volume-control"><input type="range" class="volume-slider" min="0" max="2" step="0.01" value="${track.volume ?? 1.0}"><span class="volume-value">${Math.round((track.volume ?? 1.0) * 100)}%</span></div></div>
                <div class="delete-track-container"><button class="delete-track action-button delete">Delete</button></div>
            </div>`;
        tracksList.appendChild(trackElement);
        const cS = trackElement.querySelector('.channel-select'), sC = trackElement.querySelector('.is-stereo-checkbox');
        const sH = trackElement.querySelector('.stereo-hint'), vS = trackElement.querySelector('.volume-slider');
        const vV = trackElement.querySelector('.volume-value'), dB = trackElement.querySelector('.delete-track');
        const uH = () => { if(sH && cS) sH.textContent = `(Ch ${cS.value} & ${parseInt(cS.value)+1})`; };
        if(cS){ cS.addEventListener('change', e => { if(track.id>0)updateTrackBackend(track.id,{output_channel:parseInt(e.target.value)}); uH();});}
        if(sC){ sC.addEventListener('change', e => { if(track.id>0)updateTrackBackend(track.id,{is_stereo:e.target.checked}); if(sH)sH.style.display=e.target.checked?'inline':'none';});}
        if(sH) sH.style.display=track.is_stereo?'inline':'none'; uH();
        if(vS&&vV){vS.addEventListener('input',e=>{const val=parseFloat(e.target.value); vV.textContent=`${Math.round(val*100)}%`; if(track.id>0)updateTrackBackend(track.id,{volume:val});});}
        if(dB){dB.addEventListener('click',()=>{if(track.id>0)deleteTrackBackend(track.id,trackElement);else trackElement.remove();});}
    }

    async function updateTrackBackend(trackId, data) {
        if (!currentSongId || trackId <= 0) return;
        try {
            const r=await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            const res=await r.json(); if(!r.ok||!res.success)throw new Error(res.error||`HTTP ${r.status}`); console.log(`Track ${trackId} updated.`);
        } catch (err) { console.error('Backend track update error:', err); showGlobalNotification(`Track update error: ${err.message}`, 'error');}
    }

    async function deleteTrackBackend(trackId, trackElement) {
        if (!currentSongId || trackId <= 0) return;
        if (confirm(`Delete track? Audio file removed if unused.`)) {
            try {
                const r=await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`,{method:'DELETE'});
                const d=await r.json(); if(!r.ok||!d.success)throw new Error(d.error||`HTTP ${r.status}`);
                trackElement.remove(); showGlobalNotification(d.message||'Track deleted.','success');
            } catch (err) { console.error('Backend track delete error:',err); showGlobalNotification(`Track delete error: ${err.message}`,'error');}
        }
    }

    async function saveSong() {
        if (isSaving || !songNameInput || !songTempoInput || !saveSongBtn || !songTitle || !tracksList) return;
        isSaving = true; saveSongBtn.disabled = true; saveSongBtn.textContent = 'Saving...';
        const name = songNameInput.value.trim(), tempo = parseInt(songTempoInput.value, 10);
        if (!name) { showGlobalNotification('Enter name.', 'warning'); saveSongBtn.disabled=false;saveSongBtn.textContent='Save';isSaving=false;return; }
        if (isNaN(tempo)||tempo<40||tempo>300) { showGlobalNotification('Tempo 40-300.', 'error');saveSongBtn.disabled=false;saveSongBtn.textContent='Save';isSaving=false;return;}
        const songD = {name:name,tempo:tempo,audio_tracks:[]};
        tracksList.querySelectorAll('.track-item').forEach(i=>{ const id=parseInt(i.dataset.trackId); songD.audio_tracks.push({id:id>0?id:null,file_path:i.querySelector('.track-name').textContent,output_channel:parseInt(i.querySelector('.channel-select').value),volume:parseFloat(i.querySelector('.volume-slider').value),is_stereo:i.querySelector('.is-stereo-checkbox').checked});});
        const url = isNewSong ? '/api/songs' : `/api/songs/${currentSongId}`, method = isNewSong ? 'POST' : 'PUT';
        try {
            const r = await fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(songD)});
            const sSong = await r.json(); if(!r.ok)throw new Error(sSong.error||`Save HTTP ${r.status}`);
            songTitle.textContent=sSong.name;
            if(isNewSong){currentSongId=sSong.id;isNewSong=false;addSongToSidebar(sSong);document.querySelectorAll('.songs-list .song-item').forEach(it=>it.classList.toggle('active',parseInt(it.dataset.songId)===currentSongId));}
            else{updateSongInSidebar(sSong);}
            if(tracksList&&sSong.audio_tracks){tracksList.innerHTML='';nextTrackTempId=-1;sSong.audio_tracks.forEach(t=>addTrackToUI(t));}
            showGlobalNotification('Song saved!','success');
        } catch(err){console.error('Save song error:',err);showGlobalNotification(`Save error: ${err.message}`,'error');}
        finally{isSaving=false;saveSongBtn.disabled=false;saveSongBtn.textContent='Save Song';}
    }

    function addSongToSidebar(song) {
        const cont = document.querySelector('.songs-list'); if(!cont||cont.querySelector(`.song-item[data-song-id="${song.id}"]`))return;
        const item = document.createElement('div'); item.className='song-item';item.dataset.songId=song.id;
        item.innerHTML=`<span class="song-name">${song.name}</span><span class="song-tempo">${song.tempo} BPM</span>`; cont.appendChild(item);
    }
    function updateSongInSidebar(song) {
        const item = document.querySelector(`.songs-list .song-item[data-song-id="${song.id}"]`);
        if(item){item.querySelector('.song-name').textContent=song.name;item.querySelector('.song-tempo').textContent=`${song.tempo} BPM`;}
    }

    async function deleteSong() {
        if(!currentSongId||isNewSong||!songNameInput){showGlobalNotification('No song selected.','warning');return;}
        if(confirm(`Delete "${songNameInput.value}"?`)){
            try{
                const r=await fetch(`/api/songs/${currentSongId}`,{method:'DELETE'}); const d=await r.json();
                if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
                if(d.success){const i=document.querySelector(`.songs-list .song-item[data-song-id="${currentSongId}"]`);if(i)i.remove();showEmptyState('Song deleted.');showGlobalNotification(d.message||'Song deleted.','success');}
                else{throw new Error(d.error||'Backend delete failure.');}
            }catch(err){console.error('Delete song error:',err);showGlobalNotification(`Delete error: ${err.message}`,'error');}
        }
    }

    function showGlobalNotification(message, type = 'info') {
        if (typeof window.showNotification === 'function') window.showNotification(message, type);
        else { console.warn('showNotification (global) not found, using alert.'); alert(`${type.toUpperCase()}: ${message}`);}
    }
});