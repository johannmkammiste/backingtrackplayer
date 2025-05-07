// static/js/alpine_songs.js
document.addEventListener('alpine:init', () => {
    // This global store will hold the ID of the currently active/selected song
    // Both Alpine instances can react to this.
    Alpine.store('sharedSongState', {
        activeSongId: null,
        isLoading: false, // Global loading state if needed
        songsList: []    // The shared list of songs
    });

    Alpine.data('songManager', () => ({
        // --- Constants ---
        MAX_LOGICAL_CHANNELS: 16,

        // --- Local State for this instance ---
        // editableSong, isNewSong, etc. will be specific to the main content editor instance.
        // The sidebar instance will primarily use the global store.
        editableSong: null,
        isNewSong: false,
        isLoadingSong: false, // Local loading for the editor part
        isSavingSong: false,
        isUploadingFiles: false,
        isDraggingOver: false,

        // --- Computed property to get global songs list ---
        get songs() {
            return Alpine.store('sharedSongState').songsList;
        },
        // --- Computed property to get global active song ID for sidebar ---
        get alpineCurrentSongId() {
            return Alpine.store('sharedSongState').activeSongId;
        },

        // --- Initialization ---
        // initSongs() is for the sidebar instance primarily
        initSongs() {
            console.log("Alpine songManager (sidebar) initializing...");
            this.fetchSongsAndUpdateStore();
        },
        // initEditor() is for the main content instance
        initEditor() {
            console.log("Alpine songManager (editor) initializing...");
            // Listen for an event that tells the editor to load a song
            // This replaces directly calling loadSong from the sidebar click
            document.addEventListener('load-song-in-editor', (event) => {
                const songId = event.detail.songId;
                if (songId === 'new') {
                    this.prepareNewSong();
                } else if (songId) {
                    this.loadSong(songId);
                } else {
                    this.resetSongForm();
                }
            });
             // Also initialize its own list if it's the first one loading
            if (Alpine.store('sharedSongState').songsList.length === 0) {
                this.fetchSongsAndUpdateStore();
            }
        },

        fetchSongsAndUpdateStore() {
            Alpine.store('sharedSongState').isLoading = true;
            fetch('/api/songs')
                .then(response => response.json())
                .then(data => {
                    Alpine.store('sharedSongState').songsList = data.songs || [];
                })
                .catch(error => {
                    console.error('Error fetching songs:', error);
                    if (typeof showNotification === 'function') showNotification('Error fetching songs list.', 'error');
                })
                .finally(() => {
                    Alpine.store('sharedSongState').isLoading = false;
                });
        },

        // --- Sidebar Actions (these will dispatch events to the editor component) ---
        prepareNewSongAndNotifyContent() {
            // Sidebar sets the global activeSongId to null (or a special 'new' marker)
            Alpine.store('sharedSongState').activeSongId = null; // Or some 'new-song-marker'
            // Dispatch an event for the editor to pick up
            document.dispatchEvent(new CustomEvent('load-song-in-editor', { detail: { songId: 'new' } }));
        },

        loadSongAndNotifyContent(songId) {
            Alpine.store('sharedSongState').activeSongId = songId;
            document.dispatchEvent(new CustomEvent('load-song-in-editor', { detail: { songId: songId } }));
        },

        // --- Editor-specific methods (previously in the single songManager) ---
        prepareNewSong() { // Called by event listener in initEditor
            this.isNewSong = true;
            this.editableSong = { id: null, name: '', tempo: 120, audio_tracks: [] };
            this.isLoadingSong = false;
            Alpine.store('sharedSongState').activeSongId = null; // Ensure global state reflects no specific song selected
        },

        async loadSong(songId) { // Called by event listener in initEditor
            if (this.isLoadingSong) return;
            this.isLoadingSong = true;
            this.isNewSong = false;
            Alpine.store('sharedSongState').activeSongId = songId;


            try {
                const response = await fetch(`/api/songs/${songId}`);
                if (!response.ok) throw new Error(`Song not found (HTTP ${response.status})`);
                const songData = await response.json();
                this.editableSong = JSON.parse(JSON.stringify(songData)); // Deep copy
                if (!this.editableSong.audio_tracks) this.editableSong.audio_tracks = [];
                this.editableSong.audio_tracks.forEach(track => {
                    track.volume = track.volume !== undefined ? track.volume : 1.0;
                    track.output_channel = track.output_channel !== undefined ? track.output_channel : 1;
                    track.is_stereo = track.is_stereo !== undefined ? track.is_stereo : false;
                });
            } catch (error) {
                console.error('Error loading song:', error);
                if (typeof showNotification === 'function') showNotification(`Failed to load song: ${error.message}`, 'error');
                this.resetSongForm();
            } finally {
                this.isLoadingSong = false;
            }
        },

        resetSongForm() {
            this.editableSong = null;
            this.isNewSong = false;
            Alpine.store('sharedSongState').activeSongId = null; // Reset global state
        },

        async saveSong() {
            if (this.isSavingSong) return;
            if (!this.editableSong || !this.editableSong.name || !this.editableSong.name.trim()) {
                if (typeof showNotification === 'function') showNotification('Please enter a song name.', 'warning');
                return;
            }
            // ... (rest of saveSong logic as before, but ensure it calls fetchSongsAndUpdateStore on success)
            // ...
            // Inside try block, on success:
            // if (typeof showNotification === 'function') showNotification('Song saved successfully!', 'success');
            // const savedId = savedSongResult.id;
            // this.fetchSongsAndUpdateStore(); // This updates the global list
            // this.isNewSong = false;
            // this.loadSong(savedId); // Reload the song in the editor, which also sets activeSongId
            //
            // For brevity, I'll paste the modified saveSong
            this.isSavingSong = true;
            const songDataToSave = {
                name: this.editableSong.name,
                tempo: parseInt(this.editableSong.tempo, 10)
            };

            const url = (this.isNewSong || this.editableSong.id === null) ? '/api/songs' : `/api/songs/${this.editableSong.id}`;
            const method = (this.isNewSong || this.editableSong.id === null) ? 'POST' : 'PUT';

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(songDataToSave)
                });
                const savedSongResult = await response.json();

                if (!response.ok) {
                    throw new Error(savedSongResult.error || `Failed to save song (HTTP ${response.status})`);
                }

                if (typeof showNotification === 'function') showNotification('Song saved successfully!', 'success');

                this.isNewSong = false; // Important to set this before loadSong if it was a new song

                // Fetch updated list and then load the song (new or existing) into the editor
                // This ensures the sidebar also reflects changes from fetchSongsAndUpdateStore
                await this.fetchSongsAndUpdateStore(); // Updates Alpine.store('sharedSongState').songsList

                // loadSong will set editableSong and also the global activeSongId
                await this.loadSong(savedSongResult.id);

            } catch (error) {
                console.error('Error saving song:', error);
                if (typeof showNotification === 'function') showNotification(`Error saving song: ${error.message}`, 'error');
            } finally {
                this.isSavingSong = false;
            }
        },

        async deleteSong() {
            if (!this.editableSong || this.editableSong.id === null) { /*...*/ return; }
            if (!confirm(`Are you sure you want to delete "${this.editableSong.name}"?`)) return;

            this.isSavingSong = true; // block UI
            try {
                const response = await fetch(`/api/songs/${this.editableSong.id}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `HTTP error`);
                if (typeof showNotification === 'function') showNotification(data.message || 'Song deleted.', 'success');
                this.resetSongForm(); // Clears editor and activeSongId in store
                this.fetchSongsAndUpdateStore(); // Refresh list in store
            } catch (error) { /* ... */ }
            finally { this.isSavingSong = false; }
        },

        // --- Track Management (methods mostly as before, but operate on 'this.editableSong') ---
        // handleFileDrop, handleFileSelect, uploadFiles, updateTrack, updateTrackVolume, deleteTrack
        // Make sure these methods, when successfully modifying tracks, also call:
        // await this.loadSong(this.editableSong.id);
        // OR more efficiently, update this.editableSong directly AND the corresponding song in Alpine.store('sharedSongState').songsList
        // For simplicity now, `loadSong` after track changes is robust.

        async handleFileDrop(event) {
            this.isDraggingOver = false;
            if (!this.editableSong || !this.editableSong.id) { /* ... */ return; }
            await this.uploadFiles(event.dataTransfer.files);
        },
        async handleFileSelect(filesFromInput) {
            if (!this.editableSong || !this.editableSong.id) { /* ... */ document.getElementById('file-upload').value = ''; return; }
            await this.uploadFiles(filesFromInput);
            document.getElementById('file-upload').value = '';
        },
        async uploadFiles(files) {
            if (!files || files.length === 0) return;
            if (!this.editableSong || this.editableSong.id === null) { /* ... */ return; }

            this.isUploadingFiles = true;
            // ... (FormData and fetch logic as before) ...
            // Inside try block on successful upload:
            // if (successCount > 0) {
            //     if (typeof showNotification === 'function') showNotification(`${successCount} new track(s) added.`, 'success');
            //     await this.loadSong(this.editableSong.id); // Reload song details
            // }
            // For brevity, I'll paste the modified uploadFiles
            const formData = new FormData();
            for (let i = 0; i < files.length; i++) formData.append('files[]', files[i]);
            const uploadUrl = `/api/songs/${this.editableSong.id}/upload`;

            try {
                const response = await fetch(uploadUrl, { method: 'POST', body: formData });
                const data = await response.json();
                if (!response.ok && response.status !== 207) throw new Error(data.error || `Upload failed`);

                let successCount = (data.tracks && data.tracks.length > 0) ? data.tracks.length : 0;
                if (successCount > 0) if (typeof showNotification === 'function') showNotification(`${successCount} track(s) added.`, 'success');
                if (data.errors && data.errors.length > 0) if (typeof showNotification === 'function') showNotification(`Upload issues: ${data.errors.join(', ')}`, 'warning');

                if (successCount > 0) await this.loadSong(this.editableSong.id); // Reload song
            } catch (error) { /* ... */ }
            finally { this.isUploadingFiles = false; }
        },

        _updateTrackDebounceTimers: {},
        updateTrack(track) {
            if (!this.editableSong || !this.editableSong.id || !track.id) return;
            const trackId = track.id;
            clearTimeout(this._updateTrackDebounceTimers[trackId]);
            this._updateTrackDebounceTimers[trackId] = setTimeout(async () => {
                const payload = { output_channel: parseInt(track.output_channel), is_stereo: track.is_stereo, volume: parseFloat(track.volume) };
                try {
                    const response = await fetch(`/api/songs/${this.editableSong.id}/tracks/${trackId}`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                    });
                    const result = await response.json();
                    if (!response.ok || !result.success) throw new Error(result.error || 'Backend error');
                    // Update the main store's song list if you want changes reflected without full list reload
                    const songInStore = Alpine.store('sharedSongState').songsList.find(s => s.id === this.editableSong.id);
                    if (songInStore) {
                        const trackInStore = songInStore.audio_tracks.find(t => t.id === trackId);
                        if (trackInStore) Object.assign(trackInStore, payload);
                    }
                } catch (error) { /* ... */ }
            }, 750);
        },
        updateTrackVolume(track, newVolume) {
            track.volume = parseFloat(newVolume);
            this.updateTrack(track);
        },
        async deleteTrack(trackId, indexInEditableArray) {
            if (!this.editableSong || !this.editableSong.id || !trackId) return;
            const trackToDelete = this.editableSong.audio_tracks.find(t => t.id === trackId);
            if (!trackToDelete || !confirm(`Delete track "${trackToDelete.file_path}"?`)) return;

            try {
                const response = await fetch(`/api/songs/${this.editableSong.id}/tracks/${trackId}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Backend error');
                if (typeof showNotification === 'function') showNotification(data.message || 'Track deleted.', 'success');
                await this.loadSong(this.editableSong.id); // Easiest way to refresh track list
            } catch (error) { /* ... */ }
        }
    }));
});