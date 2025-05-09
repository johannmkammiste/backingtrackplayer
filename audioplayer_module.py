import os
import gc
import threading
import logging
import contextlib
import time
from collections import defaultdict
import traceback
import sys
from ctypes import c_float
from pathlib import Path  # Added pathlib

from modpybass.pybass import *
from modpybass.pybassmix import *

# Define BASS constants if not available from import *
if not hasattr(sys.modules[__name__], 'BASS_DEVICE_LOOPBACK'): BASS_DEVICE_LOOPBACK = 8
if not hasattr(sys.modules[__name__], 'BASS_MIXER_CHAN_NORAMPIN'): BASS_MIXER_CHAN_NORAMPIN = 0x800
if not hasattr(sys.modules[__name__], 'BASS_MIXER_MATRIX'): BASS_MIXER_MATRIX = 0x10000
if not hasattr(sys.modules[__name__], 'BASS_SAMPLE_MONO'): BASS_SAMPLE_MONO = 4
if not hasattr(sys.modules[__name__], 'BASS_STREAM_DECODE'): BASS_STREAM_DECODE = 0x200000
if not hasattr(sys.modules[__name__], 'BASS_SAMPLE_FLOAT'): BASS_SAMPLE_FLOAT = 256
if not hasattr(sys.modules[__name__], 'BASS_ATTRIB_VOL'): BASS_ATTRIB_VOL = 4
if not hasattr(sys.modules[__name__], 'BASS_MIXER_END'): BASS_MIXER_END = 0x10000

callback_lock = threading.Lock()


class AudioPlayer:
    def __init__(self, root_path, initial_audio_upload_folder_config,  # Changed parameter name
                 songs_data_provider_func, settings_data_provider_func,
                 max_logical_channels_const, default_sample_rate_const):
        self.root_path = root_path  # App's root path, for resolving relative paths
        self.current_audio_upload_folder_config_path = initial_audio_upload_folder_config  # Store the configured path (can be relative or absolute)

        self.get_songs_data = songs_data_provider_func
        self.get_settings_data = settings_data_provider_func

        self.MAX_LOGICAL_CHANNELS = max_logical_channels_const
        self.DEFAULT_SAMPLE_RATE = default_sample_rate_const

        self.initialized_devices = set()
        current_settings = self.get_settings_data()  # Initial settings load
        self.audio_outputs = current_settings.get('audio_outputs', [])
        self._current_global_volume = float(current_settings.get('volume', 1.0))
        self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
        # self.current_audio_upload_folder_config_path is already set from constructor argument

        self._preloaded_song_id = None
        self._preloaded_mixers = {}
        self._active_mixer_handles = []
        self._is_song_preloaded = False
        self._playback_active = False
        self._playback_monitor_thread = None
        # logging.basicConfig(level=logging.DEBUG) # Ensure logging is configured (usually done in app.py)

    def _get_resolved_audio_upload_folder_abs(self):
        """
        Resolves the currently configured audio upload folder path to an absolute path.
        Ensures the directory exists, creating it if necessary.
        """
        configured_path = self.current_audio_upload_folder_config_path
        if os.path.isabs(configured_path):
            abs_path = configured_path
        else:
            # Relative paths are resolved against the application's root_path
            abs_path = os.path.join(self.root_path, configured_path)

        abs_path = os.path.normpath(abs_path)

        try:
            Path(abs_path).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logging.error(
                f"AudioPlayer: Failed to create or access audio directory {abs_path}: {e}. Player might not find audio files.")
            # Depending on desired behavior, could raise error or fallback to a known default
        return abs_path

    def update_audio_upload_folder_config(self, new_path_config_value):
        """
        Updates the configured audio upload folder path.
        Called by the main app when the setting changes.
        """
        with callback_lock:
            old_path = self.current_audio_upload_folder_config_path
            self.current_audio_upload_folder_config_path = new_path_config_value
            logging.info(
                f"AudioPlayer: Audio upload folder configuration updated from '{old_path}' to '{new_path_config_value}'.")
            if self._is_song_preloaded or self._preloaded_mixers:
                logging.info("AudioPlayer: Clearing preload state due to audio folder change.")
                self.clear_preload_state(acquire_lock=False)  # Lock already held

    def initialize_bass(self):
        current_settings = self.get_settings_data()
        self.audio_outputs = current_settings.get('audio_outputs', [])
        self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
        self._current_global_volume = float(current_settings.get('volume', 1.0))
        # self.current_audio_upload_folder_config_path is set in __init__

        devices_to_init = sorted(
            list(set(mapping['device_id'] for mapping in self.audio_outputs if 'device_id' in mapping)))

        if not devices_to_init:
            logging.info("No specific devices in settings, attempting to initialize default BASS device.")
            if not BASS_Init(-1, self.target_sample_rate, 0, 0, None):
                if BASS_ErrorGetCode() != BASS_ERROR_ALREADY:
                    raise RuntimeError(f"BASS_Init default device failed! Error: {BASS_ErrorGetCode()}")
                logging.info("Default BASS device already initialized or was the target.")
                default_dev_id_after_init = BASS_GetDevice()
                if default_dev_id_after_init != 0xFFFFFFFF:
                    self.initialized_devices.add(default_dev_id_after_init)
                else:
                    logging.warning("Could not determine default device ID after BASS_Init(-1).")
            else:
                default_dev_id_after_init = BASS_GetDevice()
                if default_dev_id_after_init != 0xFFFFFFFF:
                    self.initialized_devices.add(default_dev_id_after_init)
                    logging.info(f"Default BASS device initialized successfully as device {default_dev_id_after_init}.")
                else:
                    logging.warning("BASS_Init(-1) succeeded but BASS_GetDevice() returned an error value.")
        else:
            for dev_id in devices_to_init:
                if dev_id in self.initialized_devices:
                    logging.info(f"BASS device {dev_id} was already initialized. Skipping BASS_Init.")
                    continue
                if not BASS_Init(dev_id, self.target_sample_rate, 0, 0, None):
                    if BASS_ErrorGetCode() == BASS_ERROR_ALREADY:
                        logging.info(f"BASS device {dev_id} already initialized.")
                        self.initialized_devices.add(dev_id)
                    else:
                        logging.error(f"BASS_Init failed for device {dev_id}! Error: {BASS_ErrorGetCode()}")
                else:
                    logging.info(f"BASS device {dev_id} initialized successfully.")
                    self.initialized_devices.add(dev_id)

        if not self.initialized_devices and self.audio_outputs:
            raise RuntimeError("Failed to initialize any of the configured BASS output devices.")
        elif not self.initialized_devices and not self.audio_outputs:
            logging.warning(
                "BASS initialized with no specific output devices configured and default device initialization failed or was not identified.")

        BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))
        BASS_SetConfig(BASS_CONFIG_UPDATEPERIOD, 10)
        BASS_SetConfig(BASS_CONFIG_BUFFER, 500)
        logging.info(
            f"BASS context ready. Global Vol: {self._current_global_volume:.2f}. Initialized devices: {self.initialized_devices}. Audio folder config: {self.current_audio_upload_folder_config_path}")

    def update_settings(self):
        with callback_lock:
            current_settings = self.get_settings_data()
            old_sr, old_vol, old_outputs = self.target_sample_rate, self._current_global_volume, self.audio_outputs
            old_audio_path_config = self.current_audio_upload_folder_config_path

            self.audio_outputs = current_settings.get('audio_outputs', [])
            self._current_global_volume = float(current_settings.get('volume', 1.0))
            self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
            # Audio path is updated via update_audio_upload_folder_config, not directly in this generic update_settings
            # However, if settings.json was modified externally, this is where it would be picked up.
            # For consistency, let's ensure it's re-read here as well.
            new_audio_path_config = current_settings.get('audio_directory_path',
                                                         self.current_audio_upload_folder_config_path)

            settings_changed_requiring_preload_clear = False
            if old_sr != self.target_sample_rate:
                logging.info(f"Sample rate changed from {old_sr} to {self.target_sample_rate}.")
                settings_changed_requiring_preload_clear = True
            if old_outputs != self.audio_outputs:  # Simple list comparison, might need deep compare for robustness
                logging.info("Audio outputs configuration changed.")
                settings_changed_requiring_preload_clear = True
            if old_audio_path_config != new_audio_path_config:
                logging.info(
                    f"Audio directory path config changed from '{old_audio_path_config}' to '{new_audio_path_config}'.")
                self.current_audio_upload_folder_config_path = new_audio_path_config  # Update internal state
                settings_changed_requiring_preload_clear = True

            if settings_changed_requiring_preload_clear:
                logging.info("Audio settings affecting playback changed. Clearing preload state.")
                self.clear_preload_state(acquire_lock=False)
                # Potentially re-initialize BASS devices if device list changed significantly.
                # For now, assume BASS_Init handled all potential devices at startup.

            if abs(old_vol - self._current_global_volume) > 1e-6:
                BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))

            logging.debug(
                f"AudioPlayer settings updated: {len(self.audio_outputs)} outputs, Vol:{self._current_global_volume:.2f}, SR:{self.target_sample_rate} Hz, AudioPath: {self.current_audio_upload_folder_config_path}")

    def _build_logical_channel_map(self):
        # (This function remains the same as before)
        logging.debug("Building logical channel map...")
        logical_map = {}
        if not self.audio_outputs:
            logging.warning("Building logical channel map: self.audio_outputs is empty.")
            return logical_map

        for i, mapping_info in enumerate(self.audio_outputs):
            bass_dev_id = mapping_info.get('device_id')
            app_logical_chans_for_this_device_mapping = mapping_info.get('channels', [])
            logging.debug(
                f"  Mapping entry {i}: device_id={bass_dev_id}, app_logical_channels={app_logical_chans_for_this_device_mapping}")

            if bass_dev_id is None or not isinstance(app_logical_chans_for_this_device_mapping, list):
                logging.warning(f"  Skipping mapping entry {i} due to missing device_id or invalid channels list.")
                continue

            if bass_dev_id not in self.initialized_devices:
                logging.warning(
                    f"  Device ID {bass_dev_id} in settings mapping entry {i} but not in initialized_devices set {self.initialized_devices}. Skipping this mapping for logical map.")
                continue

            for physical_idx_in_mapping, app_log_ch_val in enumerate(app_logical_chans_for_this_device_mapping):
                if isinstance(app_log_ch_val, int) and 1 <= app_log_ch_val <= self.MAX_LOGICAL_CHANNELS:
                    if app_log_ch_val in logical_map:
                        logging.warning(
                            f"  Logical channel {app_log_ch_val} redefined. Previous mapping: {logical_map[app_log_ch_val]}, New mapping for entry {i}: ({bass_dev_id}, {physical_idx_in_mapping}). Using new.")
                    logical_map[app_log_ch_val] = (bass_dev_id, physical_idx_in_mapping)
                    logging.debug(
                        f"    Mapped app_log_ch {app_log_ch_val} to (device: {bass_dev_id}, physical_mixer_out_idx: {physical_idx_in_mapping})")
                else:
                    logging.warning(
                        f"  Invalid app_log_ch_val {app_log_ch_val} in mapping entry {i}. Skipping this specific channel.")
        logging.debug(f"Finished building logical channel map: {logical_map}")
        return logical_map

    def preload_song(self, song_id):
        self.update_settings()
        songs_data_dict = self.get_songs_data()
        song = next((s for s in songs_data_dict.get('songs', []) if s.get('id') == song_id), None)

        if not song:
            self._is_song_preloaded = False
            logging.error(f"Song {song_id} not found for preload.")
            return False

        current_audio_folder = self._get_resolved_audio_upload_folder_abs()  # Get current absolute audio path
        logging.info(f"Preloading song {song_id} using audio folder: {current_audio_folder}")

        if not self.audio_outputs and song.get('audio_tracks'):
            self._is_song_preloaded = False
            logging.error("Cannot preload song: No audio outputs configured in settings.")
            return False

        with callback_lock:
            self.clear_preload_state(acquire_lock=False)
            logical_map = self._build_logical_channel_map()

            if not logical_map and song.get('audio_tracks'):
                self._is_song_preloaded = False
                logging.error("Cannot preload song: Logical channel map is empty but song has audio tracks.")
                return False

            temp_dev_mixers = {}
            all_src_streams = []

            try:
                target_mixer_chans_needed = defaultdict(int)
                for dev_id, physical_idx_in_mapping in logical_map.values():
                    target_mixer_chans_needed[dev_id] = max(target_mixer_chans_needed[dev_id],
                                                            physical_idx_in_mapping + 1)

                for b_dev_id, num_mix_chans in target_mixer_chans_needed.items():
                    if b_dev_id not in self.initialized_devices:
                        logging.warning(f"Device {b_dev_id} is required but not initialized. Skipping mixer creation.")
                        continue
                    if num_mix_chans == 0: continue

                    mixer = BASS_Mixer_StreamCreate(self.target_sample_rate, num_mix_chans, BASS_MIXER_END)
                    if not mixer:
                        logging.error(
                            f"Failed to create BASS mixer for device {b_dev_id} (chans: {num_mix_chans}). Error: {BASS_ErrorGetCode()}")
                        continue
                    temp_dev_mixers[b_dev_id] = mixer
                    logging.debug(f"Created mixer {mixer} for device {b_dev_id} with {num_mix_chans} output channels.")

                if not song.get('audio_tracks'):
                    self._preloaded_song_id = song_id
                    self._preloaded_mixers = temp_dev_mixers
                    self._is_song_preloaded = True
                    logging.info(f"Song {song_id} preloaded successfully (no audio tracks).")
                    return True

                for track_idx, track in enumerate(song.get('audio_tracks', [])):
                    f_path_rel = track.get('file_path')
                    if not f_path_rel:
                        logging.warning(f"Track {track_idx} in song {song_id} has no file_path. Skipping.")
                        continue

                    f_path_abs = os.path.join(current_audio_folder, f_path_rel)  # Use resolved path
                    if not os.path.exists(f_path_abs):
                        logging.warning(
                            f"Audio file not found for track {track_idx} ('{f_path_rel}') at {f_path_abs}. Skipping.")
                        continue

                    app_log_ch1 = track.get('output_channel', 1)
                    is_stereo_track_setting = track.get('is_stereo', False)
                    track_vol = float(track.get('volume', 1.0))
                    tgt_b_dev_id, phys_idx = logical_map.get(app_log_ch1, (None, -1))

                    if tgt_b_dev_id is None or tgt_b_dev_id not in temp_dev_mixers:
                        logging.warning(
                            f"No BASS device mixer for logical channel {app_log_ch1} (dev {tgt_b_dev_id}) for track '{f_path_rel}'. Skipping.")
                        continue

                    dev_mixer = temp_dev_mixers[tgt_b_dev_id]
                    src_flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT

                    temp_info_stream = BASS_StreamCreateFile(False, f_path_abs.encode('utf-8'), 0, 0,
                                                             BASS_STREAM_DECODE)
                    actual_file_channels = 0
                    if temp_info_stream:
                        src_info_check = BASS_CHANNELINFO()
                        if BASS_ChannelGetInfo(temp_info_stream, src_info_check):
                            actual_file_channels = src_info_check.chans
                        else:
                            logging.warning(
                                f"Could not get channel info for {f_path_rel} (temp stream). Error: {BASS_ErrorGetCode()}")
                        BASS_StreamFree(temp_info_stream)
                    else:
                        logging.warning(
                            f"Could not create temp stream to check channels for {f_path_rel}. Error: {BASS_ErrorGetCode()}")

                    if actual_file_channels > 1 and not is_stereo_track_setting:
                        src_flags |= BASS_SAMPLE_MONO
                        logging.info(
                            f"Track '{f_path_rel}' (actual: {actual_file_channels}ch) is set to play mono. Will load with BASS_SAMPLE_MONO.")

                    src_stream = BASS_StreamCreateFile(False, f_path_abs.encode('utf-8'), 0, 0, src_flags)
                    if not src_stream:
                        logging.error(
                            f"Failed to create BASS stream for '{f_path_rel}'. Error: {BASS_ErrorGetCode()}. Skipping track.")
                        continue
                    all_src_streams.append(src_stream)

                    src_info = BASS_CHANNELINFO()
                    if not BASS_ChannelGetInfo(src_stream, src_info):
                        logging.error(
                            f"Failed to get BASS channel info for stream '{f_path_rel}'. Error: {BASS_ErrorGetCode()}. Skipping.")
                        continue
                    num_src_chans = src_info.chans

                    mixer_info = BASS_CHANNELINFO()
                    if not BASS_ChannelGetInfo(dev_mixer, mixer_info):
                        logging.error(
                            f"Failed to get BASS channel info for mixer on device {tgt_b_dev_id}. Error: {BASS_ErrorGetCode()}. Skipping track '{f_path_rel}'.")
                        continue
                    num_mixer_chans = mixer_info.chans
                    matrix = (c_float * (num_src_chans * num_mixer_chans))()

                    if is_stereo_track_setting:
                        app_log_ch2 = app_log_ch1 + 1
                        tgt_b_dev_id_ch2, phys_idx_ch2 = logical_map.get(app_log_ch2, (None, -1))
                        if (
                                tgt_b_dev_id_ch2 == tgt_b_dev_id and phys_idx_ch2 != -1 and phys_idx_ch2 < num_mixer_chans and phys_idx < num_mixer_chans):
                            if num_src_chans >= 2:
                                matrix[0 * num_mixer_chans + phys_idx] = 1.0
                                matrix[1 * num_mixer_chans + phys_idx_ch2] = 1.0
                                logging.debug(
                                    f"Track '{f_path_rel}': Stereo source ({num_src_chans}ch) to stereo outputs (L->{phys_idx}, R->{phys_idx_ch2}) on dev {tgt_b_dev_id}.")
                            elif num_src_chans == 1:
                                matrix[0 * num_mixer_chans + phys_idx] = 1.0
                                matrix[0 * num_mixer_chans + phys_idx_ch2] = 1.0
                                logging.debug(
                                    f"Track '{f_path_rel}': Mono source ({num_src_chans}ch) to stereo outputs (L/R->{phys_idx}/{phys_idx_ch2}) on dev {tgt_b_dev_id}.")
                        else:
                            if num_src_chans >= 1 and phys_idx < num_mixer_chans: matrix[
                                0 * num_mixer_chans + phys_idx] = 1.0
                            logging.warning(
                                f"Track '{f_path_rel}': Stereo output requested, but second channel (logical {app_log_ch2}) invalid. Playing as mono to output {phys_idx} on dev {tgt_b_dev_id}.")
                    else:  # not is_stereo_track_setting
                        if num_src_chans == 1 and phys_idx < num_mixer_chans:
                            matrix[0 * num_mixer_chans + phys_idx] = 1.0
                            logging.debug(
                                f"Track '{f_path_rel}': Playing as mono (source {num_src_chans}ch) to output {phys_idx} on dev {tgt_b_dev_id}.")
                        elif num_src_chans > 1 and phys_idx < num_mixer_chans:  # Fallback if BASS_SAMPLE_MONO didn't reduce to 1ch
                            matrix[0 * num_mixer_chans + phys_idx] = 1.0
                            logging.warning(
                                f"Track '{f_path_rel}': Playing as mono (source {num_src_chans}ch, expected 1ch). Using first source channel to output {phys_idx} on dev {tgt_b_dev_id}.")
                        else:
                            logging.warning(
                                f"Track '{f_path_rel}': Cannot play as mono. Physical index {phys_idx} invalid for mixer (chans: {num_mixer_chans}) or source has {num_src_chans} channels (expected 1).")

                    if not BASS_Mixer_StreamAddChannel(dev_mixer, src_stream,
                                                       BASS_MIXER_CHAN_NORAMPIN | BASS_MIXER_MATRIX):
                        logging.error(
                            f"Failed to add stream '{f_path_rel}' to mixer on device {tgt_b_dev_id}. Error: {BASS_ErrorGetCode()}. Skipping.")
                        continue
                    if not BASS_ChannelSetAttribute(src_stream, BASS_ATTRIB_VOL, track_vol):
                        logging.warning(f"Failed to set volume for track '{f_path_rel}'. Error: {BASS_ErrorGetCode()}")
                    if not BASS_Mixer_ChannelSetMatrix(src_stream, matrix):
                        logging.error(
                            f"Failed to set channel matrix for stream '{f_path_rel}'. Error: {BASS_ErrorGetCode()}")

                self._preloaded_song_id = song_id
                self._preloaded_mixers = temp_dev_mixers
                self._is_song_preloaded = True
                logging.info(
                    f"Song '{song.get('name')}' (ID: {song_id}) preloaded successfully with {len(song.get('audio_tracks', []))} track(s) processed.")
                return True
            except Exception as e:
                logging.error(f"Exception during preload_song for song ID {song_id}: {e}")
                traceback.print_exc()
                for hmixer in temp_dev_mixers.values():
                    if hmixer: BASS_StreamFree(hmixer)
                for hstream in all_src_streams:
                    if hstream: BASS_StreamFree(hstream)
                self._preloaded_mixers = {}
                self._is_song_preloaded = False
                return False

    def play_preloaded_song(self):
        # (This function remains the same as before)
        with callback_lock:
            if not self._is_song_preloaded or not self._preloaded_mixers:
                logging.warning("Play called but song not preloaded or no mixers.")
                self._playback_active = False
                return False
            if self._playback_active:
                logging.info("Playback already active.")
                return True

            self.stop(acquire_lock=False)
            self._active_mixer_handles = []
            all_started_successfully = True

            for b_dev_id, mixer_h in self._preloaded_mixers.items():
                if not mixer_h: continue

                if b_dev_id not in self.initialized_devices:
                    logging.error(
                        f"Attempting to use BASS device {b_dev_id} for mixer {mixer_h}, but device was not successfully initialized. Skipping.")
                    all_started_successfully = False
                    continue

                if not BASS_ChannelSetDevice(mixer_h, b_dev_id):
                    logging.error(
                        f"BASS_ChannelSetDevice failed for mixer {mixer_h} to device {b_dev_id}: Err {BASS_ErrorGetCode()}")
                    all_started_successfully = False
                    continue

                if not BASS_ChannelPlay(mixer_h, False):
                    logging.error(
                        f"BASS_ChannelPlay failed for mixer {mixer_h} on device {b_dev_id}: Err {BASS_ErrorGetCode()}")
                    all_started_successfully = False
                else:
                    logging.info(f"Mixer {mixer_h} successfully started on device {b_dev_id}")
                    self._active_mixer_handles.append(mixer_h)

            if self._active_mixer_handles and all_started_successfully:
                self._playback_active = True
                if self._playback_monitor_thread is None or not self._playback_monitor_thread.is_alive():
                    self._playback_monitor_thread = threading.Thread(target=self._playback_monitor, daemon=True);
                    self._playback_monitor_thread.start()
                logging.info(
                    f"Playback started for song ID {self._preloaded_song_id} with {len(self._active_mixer_handles)} active mixer(s).")
                return True
            else:
                logging.error(
                    f"Playback could not be started for song ID {self._preloaded_song_id}. Active mixers: {len(self._active_mixer_handles)}, All started: {all_started_successfully}")
                for h_mixer in self._active_mixer_handles: BASS_ChannelStop(h_mixer)
                self._active_mixer_handles = [];
                self._playback_active = False;
                return False

    def _playback_monitor(self):
        # (This function remains the same as before)
        logging.debug(f"Playback monitor started for {len(self._active_mixer_handles)} BASS mixer(s).")
        while True:
            with callback_lock:
                if not self._playback_active or not self._active_mixer_handles:
                    logging.debug("Monitor: Playback no longer active or no active handles. Exiting.")
                    break

                still_active_count = 0
                for mixer_h in self._active_mixer_handles:
                    if BASS_ChannelIsActive(mixer_h) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED]:
                        still_active_count += 1

                if still_active_count == 0:
                    logging.info("Monitor: All BASS mixers appear to have finished or stopped.")
                    self._playback_active = False
                    break
            time.sleep(0.1)

        with callback_lock:
            if not self._playback_active:
                logging.debug("Monitor: Cleaning up active mixer handles as playback is no longer active.")
                self._active_mixer_handles = []
        logging.debug("Playback monitor thread finished.")

    def stop(self, acquire_lock=True):
        # (This function remains the same as before)
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            if not self._playback_active and not self._active_mixer_handles:
                if not self._active_mixer_handles:
                    self._playback_active = False
                    return

            logging.info("AudioPlayer: BASS Stop Requested.")
            self._playback_active = False

            if acquire_lock and self._playback_monitor_thread and self._playback_monitor_thread.is_alive():
                self._playback_monitor_thread.join(timeout=0.2)

            handles_to_stop = list(self._active_mixer_handles)
            self._active_mixer_handles = []

            for mixer_h in handles_to_stop:
                if mixer_h:
                    BASS_ChannelStop(mixer_h)
            gc.collect()

    def is_playing(self):
        # (This function remains the same as before)
        with callback_lock:
            if not self._playback_active or not self._active_mixer_handles: return False
            for mixer_h in self._active_mixer_handles:
                if BASS_ChannelIsActive(mixer_h) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED]: return True
            self._playback_active = False;  # Update state if no channels are active
            return False

    def clear_preload_state(self, acquire_lock=True):
        # (This function remains the same as before)
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            if self._is_song_preloaded or self._preloaded_mixers:
                if self._playback_active:
                    self.stop(acquire_lock=False)

                for mixer_h in self._preloaded_mixers.values():
                    if mixer_h:
                        BASS_StreamFree(mixer_h)  # Frees mixer and its source streams (due to BASS_MIXER_END)

                self._preloaded_song_id = None;
                self._preloaded_mixers = {}
                self._is_song_preloaded = False;
                if not self._playback_active:  # If stop wasn't called (because not playing)
                    self._active_mixer_handles = []
                gc.collect()

    def play_song_directly(self, song_id):
        # (This function remains the same as before)
        self.update_settings()  # Ensure latest settings, including audio path, are used
        needs_preload = True
        with callback_lock:
            if self._is_song_preloaded and self._preloaded_song_id == song_id:
                needs_preload = False

        if needs_preload:
            logging.info(f"Song {song_id} not preloaded or different from current preload. Preloading now.")
            if not self.preload_song(song_id):  # preload_song uses the current audio path
                logging.error(f"AudioPlayer: Preload failed for song {song_id}.")
                return False
        else:
            logging.info(f"Song {song_id} is already preloaded.")

        return self.play_preloaded_song()

    def shutdown(self):
        # (This function remains the same as before)
        logging.info("AudioPlayer shutting down BASS...")
        self.stop();
        self.clear_preload_state();

        current_device_before_free = BASS_GetDevice()
        initialized_devices_copy = list(self.initialized_devices)
        for dev_id in initialized_devices_copy:
            if BASS_SetDevice(dev_id):
                logging.info(f"Freeing BASS device: {dev_id}")
                if not BASS_Free():
                    logging.error(f"BASS_Free failed for device {dev_id}. Error: {BASS_ErrorGetCode()}")
            else:
                logging.error(
                    f"BASS_SetDevice failed for device {dev_id} during shutdown. Error: {BASS_ErrorGetCode()}")
        self.initialized_devices.clear()

        if not initialized_devices_copy and current_device_before_free != 0xFFFFFFFF:  # Check if default device needs freeing
            if BASS_SetDevice(current_device_before_free):
                logging.info(f"Attempting to free current/default BASS context (device {current_device_before_free}).")
                BASS_Free()
        logging.info("BASS Freed (attempted for all initialized devices).")

    def calculate_song_duration(self, song_data_item):
        max_duration = 0.0
        if not song_data_item or not isinstance(song_data_item.get('audio_tracks'), list): return 0.0

        current_audio_folder = self._get_resolved_audio_upload_folder_abs()  # Get current audio path

        for track in song_data_item['audio_tracks']:
            file_path_rel = track.get('file_path')
            if not file_path_rel: continue
            file_path_abs = os.path.join(current_audio_folder, file_path_rel)  # Use resolved path
            if not os.path.exists(file_path_abs): continue

            flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
            temp_stream = 0
            try:
                temp_stream = BASS_StreamCreateFile(False, file_path_abs.encode('utf-8'), 0, 0, flags)
                if temp_stream:
                    length_bytes = BASS_ChannelGetLength(temp_stream, BASS_POS_BYTE)
                    if length_bytes != 0xFFFFFFFFFFFFFFFF:
                        duration_sec = BASS_ChannelBytes2Seconds(temp_stream, length_bytes)
                        if duration_sec > max_duration: max_duration = duration_sec
                    else:
                        logging.warning(
                            f"BASS_ChannelGetLength failed for {file_path_rel} (duration calc). Error: {BASS_ErrorGetCode()}")
                else:
                    logging.warning(
                        f"BASS_StreamCreateFile failed for {file_path_rel} (duration calc). Error: {BASS_ErrorGetCode()}")
            except Exception as e:
                logging.error(f"Exception in duration calc for {file_path_rel}: {e}")
            finally:
                if temp_stream: BASS_StreamFree(temp_stream)
        return max_duration

