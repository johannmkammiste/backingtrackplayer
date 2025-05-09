// static/js/songs.js
document.addEventListener('DOMContentLoaded', function () {
    // Constants
    const MAX_LOGICAL_CHANNELS = 64;

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
    if (deleteSongBtn) deleteSongBtn.addEventListener('click', deleteSong); // deleteSong is now async
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

    if (addTrackToSongBtn) {
        addTrackToSongBtn.addEventListener('click', async () => {
            if (!currentSongId || isNewSong) {
                _showGlobalNotification("Please save the song before adding tracks.", "warning");
                return;
            }
            let filesHaveBeenLoaded = (allAvailableAudioFiles.length > 0);
            if (!filesHaveBeenLoaded) {
                try {
                    const response = await fetch('/api/audio/files');
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `Failed to fetch audio files (status ${response.status})`);
                    }
                    const data = await response.json();
                    allAvailableAudioFiles = data.files || [];
                    filesHaveBeenLoaded = true;
                } catch (error) {
                    console.error('Error fetching available audio files for track selection:', error);
                    _showGlobalNotification(`Could not load audio files list: ${error.message}. Try "Manage Audio Files" first.`, 'error');
                    return;
                }
            }
            if (filesHaveBeenLoaded) {
                if (selectAudioFileModal && audioFileSelectorList) {
                    populateAudioFileSelector();
                    selectAudioFileModal.style.display = 'flex';
                } else { console.error("selectAudioFileModal or audioFileSelectorList DOM elements not found."); }
            } else {
                 _showGlobalNotification('Failed to load audio files. Please try again or use "Manage Audio Files".', 'error');
            }
        });
    }

    if (selectAudioFileModal) {
         selectAudioFileModal.querySelectorAll('.close-modal-btn, .modal-button.cancel').forEach(btn => {
            const modalId = btn.closest('.modal')?.id;
            if(modalId) btn.addEventListener('click', () => closeModal(modalId));
        });
    }

    const firstSongItem = document.querySelector('.songs-list .song-item');
    if (!firstSongItem && emptyState && songForm) {
        showEmptyState("No songs yet. Click 'Add New Song' to create one!");
    } else if (emptyState && songForm) {
        emptyState.style.display = 'flex';
        songForm.style.display = 'none';
    }

    function setupSongItemClickHandlers() {
        const songsListContainer = document.querySelector('.songs-list');
        if (songsListContainer) {
            songsListContainer.addEventListener('click', function (e) {
                const targetItem = e.target.closest('.song-item');
                if (targetItem) {
                    const songIdStr = targetItem.dataset.songId;
                    if (songIdStr) {
                        const songId = parseInt(songIdStr);
                        if (!isNaN(songId)) {
                            document.querySelectorAll('.songs-list .song-item.active').forEach(i => i.classList.remove('active'));
                            targetItem.classList.add('active');
                            loadSong(songId);
                        } else { console.error('Invalid songId parsed:', songIdStr); }
                    } else { console.error('data-song-id attribute missing or empty.'); }
                }
            });
        } else { console.error('Songs list container not found.'); }
    }

    function createNewSong() {
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
        if(emptyState) emptyState.style.display = 'none';
        if(!songForm) { console.error('songForm element not found in loadSong!'); return; }
        songForm.style.display = 'block'; songForm.classList.add('loading');
        try {
            const response = await fetch(`/api/songs/${songId}`);
            if (!response.ok) {
                let errorText = `HTTP error ${response.status}`;
                try { const errorData = await response.json(); errorText = errorData.error || JSON.stringify(errorData) || errorText; } catch (e) {}
                throw new Error(errorText);
            }
            const song = await response.json();
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
            console.error(`Error in loadSong for ID ${songId}:`, error.message, error.stack);
            showEmptyState(`Failed to load song: ${error.message}`); currentSongId = null;
        } finally {
            if(songForm) songForm.classList.remove('loading');
        }
    }

    function showEmptyState(message = "Select a song from the list or create a new one") {
        if(emptyState) { emptyState.innerHTML = `<p>${message}</p>`; emptyState.style.display = 'flex'; }
        if(songForm) songForm.style.display = 'none';
        currentSongId = null; isNewSong = false;
    }

    function openMediaLibraryModal() {
        if (mediaLibraryModal) {
            mediaLibraryModal.style.display = 'flex';
            loadAvailableAudioFiles();
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    }

    async function loadAvailableAudioFiles() {
        if (!availableAudioFilesList && !addTrackToSongBtn) return;
        if (availableAudioFilesList) availableAudioFilesList.innerHTML = '<p>Loading audio files...</p>';
        try {
            const response = await fetch('/api/audio/files');
            if (!response.ok) throw new Error('Failed to fetch audio files list');
            const data = await response.json();
            allAvailableAudioFiles = data.files || [];
            if (document.getElementById('media-library-modal')?.style.display === 'flex' && availableAudioFilesList) {
                 renderAvailableAudioFiles();
            }
        } catch (error) {
            console.error('Error loading available audio files:', error);
            if (availableAudioFilesList) availableAudioFilesList.innerHTML = '<p class="error">Could not load audio files.</p>';
        }
    }

    function renderAvailableAudioFiles() {
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
                loadAvailableAudioFiles();
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

    function populateAudioFileSelector() {
        if (!audioFileSelectorList || !selectAudioFileModal) {
            console.error("populateAudioFileSelector: audioFileSelectorList or selectAudioFileModal not found."); return;
        }
        audioFileSelectorList.innerHTML = '';
        if (allAvailableAudioFiles.length === 0) {
            audioFileSelectorList.innerHTML = '<p>No audio files available. Upload files via "Manage Audio Files" first.</p>';
            return;
        }
        allAvailableAudioFiles.forEach(filename => {
            const fileItem = document.createElement('div');
            fileItem.className = 'audio-file-select-item'; fileItem.textContent = filename;
            fileItem.addEventListener('click', () => {
                addSelectedFileAsTrack(filename);
                closeModal(selectAudioFileModal.id);
            });
            audioFileSelectorList.appendChild(fileItem);
        });
    }

    function addSelectedFileAsTrack(filename) {
        const newTrackData = {
            id: nextTrackTempId--,
            file_path: filename, output_channel: 1, volume: 1.0, is_stereo: false
        };
        addTrackToUI(newTrackData);
    }

    function addTrackToUI(track) {
        if (!track || typeof track !== 'object' || !tracksList) {
            console.error("Invalid track data or tracksList element missing:", track); return;
        }
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.dataset.trackId = String(track.id);
        const isStereoChecked = track.is_stereo ? 'checked' : '';
        const initialChannelOneBased = track.output_channel || 1;
        const checkboxId = `stereo-checkbox-${track.id || Date.now() + Math.random()}`;
        let channelOptionsHtml = '';
        for (let i = 1; i <= MAX_LOGICAL_CHANNELS; i++) {
             const selected = (initialChannelOneBased === i) ? 'selected' : '';
             channelOptionsHtml += `<option value="${i}" ${selected}>${i}</option>`;
        }
        trackElement.innerHTML = `
            <div class="track-info"><span class="track-name">${track.file_path || 'Unknown File'}</span></div>
            <div class="track-controls">
                <div class="track-control-row">
                    <label class="track-control-label">Output Ch:</label>
                    <select class="channel-select">${channelOptionsHtml}</select>
                </div>
                <div class="track-control-row stereo-control-row"> 
                    <label for="${checkboxId}" class="track-control-label stereo-label">Stereo:</label>
                    <input type="checkbox" id="${checkboxId}" class="is-stereo-checkbox" ${isStereoChecked}>
                    <span class="stereo-hint" style="display: ${track.is_stereo ? 'inline' : 'none'};">(Ch ${initialChannelOneBased} & ${initialChannelOneBased + 1})</span>
                </div>
                <div class="track-control-row">
                    <label class="track-control-label">Volume:</label>
                    <div class="volume-control">
                        <input type="range" class="volume-slider" min="0" max="2" step="0.01" value="${track.volume ?? 1.0}">
                        <span class="volume-value">${Math.round((track.volume ?? 1.0) * 100)}%</span>
                    </div>
                </div>
                <div class="delete-track-container">
                    <button class="delete-track action-button delete">Delete</button>
                </div>
            </div>`;
        tracksList.appendChild(trackElement);

        const channelSelect = trackElement.querySelector('.channel-select');
        const stereoCheckbox = trackElement.querySelector('.is-stereo-checkbox');
        const stereoHint = trackElement.querySelector('.stereo-hint');
        const volumeSlider = trackElement.querySelector('.volume-slider');
        const volumeValue = trackElement.querySelector('.volume-value');
        const deleteButton = trackElement.querySelector('.delete-track');

        const updateStereoHintText = () => {
            if (stereoHint && channelSelect) {
                const currentOutputChannel = parseInt(channelSelect.value, 10);
                stereoHint.textContent = `(Ch ${currentOutputChannel} & ${currentOutputChannel + 1})`;
            }
        };
        updateStereoHintText();

        if (channelSelect) {
            channelSelect.addEventListener('change', async (event) => {
                const newChannel = parseInt(event.target.value, 10);
                updateStereoHintText();
                if (track.id > 0) {
                    try { await updateTrackBackend(track.id, { output_channel: newChannel }); } catch (error) {}
                }
            });
        }
        if (stereoCheckbox) {
            stereoCheckbox.addEventListener('change', async (event) => {
                const isChecked = event.target.checked;
                if (stereoHint) stereoHint.style.display = isChecked ? 'inline' : 'none';
                if (track.id > 0) {
                    try { await updateTrackBackend(track.id, { is_stereo: isChecked }); }
                    catch (error) { console.error(`Error updating stereo status for track ${track.id} on backend:`, error); }
                }
            });
        }
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', async (event) => {
                const newVolume = parseFloat(event.target.value);
                volumeValue.textContent = `${Math.round(newVolume * 100)}%`;
                if (track.id > 0) {
                    try { await updateTrackBackend(track.id, { volume: newVolume }); } catch (error) {}
                }
            });
        }
        if (deleteButton) {
            deleteButton.addEventListener('click', async () => { // Made async
                if (track.id > 0) {
                    await deleteTrackBackend(track.id, trackElement); // deleteTrackBackend is now async
                } else {
                    trackElement.remove();
                    _showGlobalNotification('Track removed from list.', 'info');
                }
            });
        }
    }

    async function updateTrackBackend(trackId, data) {
        if (!currentSongId || typeof currentSongId !== 'number' || currentSongId <= 0) {
            console.warn(`updateTrackBackend: Invalid currentSongId (${currentSongId}). Skipping update for track ${trackId}.`);
            throw new Error("Invalid song context for track update.");
        }
        if (typeof trackId !== 'number' || trackId <= 0) {
             console.warn(`updateTrackBackend: Invalid trackId (${trackId}). Skipping backend update.`);
             throw new Error("Invalid track ID for backend update.");
        }
        try {
            const response = await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || `HTTP Error ${response.status} while updating track.`);
            }
        } catch (err) {
            console.error(`Backend track update error for track ${trackId}:`, err);
            _showGlobalNotification(`Track update error: ${err.message}`, 'error');
            throw err;
        }
    }

    // MODIFIED: To use showCustomConfirm
    async function deleteTrackBackend(trackId, trackElement) {
        if (!currentSongId || trackId <= 0) return;

        const confirmed = await window.showCustomConfirm(
            `Are you sure you want to delete this track? If the audio file is not used by other songs, it will also be removed.`,
            'Confirm Delete Track'
        );

        if (confirmed) {
            try {
                const response = await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
                trackElement.remove();
                _showGlobalNotification(data.message || 'Track deleted successfully.', 'success');
            } catch (err) {
                console.error('Backend track delete error:', err);
                _showGlobalNotification(`Track delete error: ${err.message}`, 'error');
            }
        } else {
            _showGlobalNotification('Track deletion cancelled.', 'info');
        }
    }

    async function saveSong() {
        if (isSaving || !songNameInput || !songTempoInput || !saveSongBtn || !songTitle || !tracksList) return;
        isSaving = true; saveSongBtn.disabled = true; saveSongBtn.textContent = 'Saving...';
        const name = songNameInput.value.trim();
        const tempo = parseInt(songTempoInput.value, 10);

        if (!name) {
            _showGlobalNotification('Song name cannot be empty.', 'warning');
            isSaving = false; saveSongBtn.disabled = false; saveSongBtn.textContent = 'Save Song';
            return;
        }
        if (isNaN(tempo) || tempo < 40 || tempo > 300) {
            _showGlobalNotification('Tempo must be a number between 40 and 300.', 'error');
            isSaving = false; saveSongBtn.disabled = false; saveSongBtn.textContent = 'Save Song';
            return;
        }

        const songDataPayload = { name: name, tempo: tempo, audio_tracks: [] };
        tracksList.querySelectorAll('.track-item').forEach(item => {
            const trackIdFromDOM = parseInt(item.dataset.trackId, 10);
            songDataPayload.audio_tracks.push({
                id: trackIdFromDOM > 0 ? trackIdFromDOM : null,
                file_path: item.querySelector('.track-name').textContent,
                output_channel: parseInt(item.querySelector('.channel-select').value, 10),
                volume: parseFloat(item.querySelector('.volume-slider').value),
                is_stereo: item.querySelector('.is-stereo-checkbox').checked
            });
        });

        const url = isNewSong ? '/api/songs' : `/api/songs/${currentSongId}`;
        const method = isNewSong ? 'POST' : 'PUT';
        try {
            const response = await fetch(url, {
                method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(songDataPayload)
            });
            const savedSong = await response.json();
            if (!response.ok) throw new Error(savedSong.error || `Save failed with HTTP ${response.status}`);
            _showGlobalNotification('Song saved successfully!', 'success');
            if(songTitle) songTitle.textContent = savedSong.name;
            if (isNewSong) {
                currentSongId = savedSong.id;
                isNewSong = false;
                addSongToSidebar(savedSong);
                document.querySelectorAll('.songs-list .song-item.active').forEach(i => i.classList.remove('active'));
                const newSidebarItem = document.querySelector(`.songs-list .song-item[data-song-id="${currentSongId}"]`);
                if (newSidebarItem) newSidebarItem.classList.add('active');
            } else {
                updateSongInSidebar(savedSong);
            }
            if (tracksList && savedSong.audio_tracks) {
                tracksList.innerHTML = '';
                nextTrackTempId = -1;
                savedSong.audio_tracks.forEach(track => addTrackToUI(track));
            }
        } catch(err) {
            console.error('Save song error:', err);
            _showGlobalNotification(`Save error: ${err.message}`, 'error');
        } finally {
            isSaving = false; saveSongBtn.disabled = false; saveSongBtn.textContent = 'Save Song';
        }
    }

    function addSongToSidebar(song) {
        const songsListContainer = document.querySelector('.songs-list');
        if (!songsListContainer || songsListContainer.querySelector(`.song-item[data-song-id="${song.id}"]`)) return;
        const songItemDiv = document.createElement('div');
        songItemDiv.className = 'song-item';
        songItemDiv.dataset.songId = song.id;
        songItemDiv.innerHTML = `
            <span class="song-name">${song.name}</span>
            <span class="song-tempo">${song.tempo} BPM</span>`;
        songsListContainer.appendChild(songItemDiv);
    }

    function updateSongInSidebar(song) {
        const item = document.querySelector(`.songs-list .song-item[data-song-id="${song.id}"]`);
        if (item) {
            const nameEl = item.querySelector('.song-name');
            const tempoEl = item.querySelector('.song-tempo');
            if (nameEl) nameEl.textContent = song.name;
            if (tempoEl) tempoEl.textContent = `${song.tempo} BPM`;
        }
    }

    // MODIFIED: To use showCustomConfirm
    async function deleteSong() {
        if (!currentSongId || isNewSong || !songNameInput) {
            _showGlobalNotification('No song selected or new song not saved.', 'warning');
            return;
        }
        const confirmed = await window.showCustomConfirm(
            `Are you sure you want to delete the song "${songNameInput.value}"? This action cannot be undone.`,
            'Confirm Delete Song'
        );

        if (confirmed) {
            try {
                const response = await fetch(`/api/songs/${currentSongId}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                if (data.success) {
                    const itemToRemove = document.querySelector(`.songs-list .song-item[data-song-id="${currentSongId}"]`);
                    if (itemToRemove) itemToRemove.remove();
                    showEmptyState('Song deleted successfully.');
                    _showGlobalNotification(data.message || 'Song deleted.', 'success');
                    currentSongId = null;
                } else {
                    throw new Error(data.error || 'Backend indicated delete failure.');
                }
            } catch(err) {
                console.error('Delete song error:', err);
                _showGlobalNotification(`Delete error: ${err.message}`, 'error');
            }
        } else {
            _showGlobalNotification('Song deletion cancelled.', 'info');
        }
    }

    // MODIFIED: Local helper to use window.showGlobalNotification
    function _showGlobalNotification(message, type = 'info') {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type);
        } else {
            console.warn('songs.js: window.showGlobalNotification function not found. Using alert as fallback.');
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
});
