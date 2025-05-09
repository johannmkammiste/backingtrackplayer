import os
import gc
import threading
import logging
import contextlib
import time
from collections import defaultdict
import traceback  # Import traceback
import sys  # For hasattr check
from ctypes import c_float

from modpybass.pybass import *
from modpybass.pybassmix import *

# Define BASS constants if not available from import *
if not hasattr(sys.modules[__name__], 'BASS_DEVICE_LOOPBACK'):
    BASS_DEVICE_LOOPBACK = 8
if not hasattr(sys.modules[__name__], 'BASS_MIXER_CHAN_NORAMPIN'):
    BASS_MIXER_CHAN_NORAMPIN = 0x800
if not hasattr(sys.modules[__name__], 'BASS_MIXER_MATRIX'):
    BASS_MIXER_MATRIX = 0x10000

callback_lock = threading.Lock()


class AudioPlayer:
    def __init__(self, root_path, audio_upload_folder_name,
                 songs_data_provider_func, settings_data_provider_func,
                 max_logical_channels_const, default_sample_rate_const):
        self.root_path = root_path
        self.audio_upload_folder_name = audio_upload_folder_name
        self.get_songs_data = songs_data_provider_func
        self.get_settings_data = settings_data_provider_func

        self.MAX_LOGICAL_CHANNELS = max_logical_channels_const
        self.DEFAULT_SAMPLE_RATE = default_sample_rate_const

        current_settings = self.get_settings_data()
        self.audio_outputs = current_settings.get('audio_outputs', [])
        self._current_global_volume = float(current_settings.get('volume', 1.0))
        self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))

        self._preloaded_song_id = None
        self._preloaded_mixers = {}
        self._active_mixer_handles = []
        self._is_song_preloaded = False
        self._playback_active = False
        self._playback_monitor_thread = None

    def _get_audio_upload_folder_abs(self):
        return os.path.join(self.root_path, self.audio_upload_folder_name)

    def initialize_bass(self):
        if not BASS_Init(-1, self.target_sample_rate, 0, 0, None):
            if BASS_ErrorGetCode() != BASS_ERROR_ALREADY:
                raise RuntimeError(f"BASS_Init failed! Error: {BASS_ErrorGetCode()}")
        BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))
        BASS_SetConfig(BASS_CONFIG_UPDATEPERIOD, 10)
        BASS_SetConfig(BASS_CONFIG_BUFFER, 50)
        logging.info(f"BASS context ready. Global Vol: {self._current_global_volume:.2f}")

    def update_settings(self):
        with callback_lock:
            current_settings = self.get_settings_data()
            old_sr, old_vol, old_outputs = self.target_sample_rate, self._current_global_volume, self.audio_outputs

            self.audio_outputs = current_settings.get('audio_outputs', [])
            self._current_global_volume = float(current_settings.get('volume', 1.0))
            self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))

            if old_sr != self.target_sample_rate or old_outputs != self.audio_outputs:
                self.clear_preload_state(acquire_lock=False)
            if abs(old_vol - self._current_global_volume) > 1e-6:
                BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))
            logging.debug(
                f"AudioPlayer settings updated: {len(self.audio_outputs)} outputs, Vol:{self._current_global_volume:.2f}, SR:{self.target_sample_rate} Hz")

    def _build_logical_channel_map(self):
        logical_map = {}
        for mapping in self.audio_outputs:
            bass_dev_id, app_log_chans = mapping.get('device_id'), mapping.get('channels', [])
            if bass_dev_id is None or not isinstance(app_log_chans, list): continue
            dev_info = BASS_DEVICEINFO()
            if not BASS_GetDeviceInfo(bass_dev_id, dev_info): continue
            for phys_idx, app_log_ch in enumerate(app_log_chans):
                if isinstance(app_log_ch, int) and 1 <= app_log_ch <= self.MAX_LOGICAL_CHANNELS:
                    logical_map[app_log_ch] = (bass_dev_id, phys_idx)
        return logical_map

    def preload_song(self, song_id):
        self.update_settings()
        songs_data_dict = self.get_songs_data()
        song = next((s for s in songs_data_dict.get('songs', []) if s.get('id') == song_id), None)

        if not song: self._is_song_preloaded = False; logging.error(f"Song {song_id} not found."); return False
        if not self.audio_outputs and song.get('audio_tracks'): self._is_song_preloaded = False; logging.error(
            "No audio outputs configured."); return False

        with callback_lock:
            self.clear_preload_state(acquire_lock=False)
            logical_map = self._build_logical_channel_map()
            if not logical_map and song.get('audio_tracks'): self._is_song_preloaded = False; logging.error(
                "Logical channel map empty."); return False

            temp_dev_mixers, all_src_streams = {}, []
            try:
                target_dev_info = {}
                for out_map in self.audio_outputs:
                    b_dev_id = out_map.get('device_id')
                    if b_dev_id is not None and b_dev_id not in target_dev_info:
                        target_dev_info[b_dev_id] = {'max_channels': len(out_map.get('channels', []))}

                for b_dev_id, params in target_dev_info.items():
                    num_mix_chans = params['max_channels']
                    if num_mix_chans == 0: continue
                    mixer = BASS_Mixer_StreamCreate(self.target_sample_rate, num_mix_chans, BASS_MIXER_END)
                    if not mixer: logging.error(
                        f"Failed BASS_Mixer_StreamCreate dev {b_dev_id}: Err {BASS_ErrorGetCode()}"); continue
                    temp_dev_mixers[b_dev_id] = mixer

                if not song.get('audio_tracks'):
                    self._preloaded_song_id = song_id;
                    self._preloaded_mixers = temp_dev_mixers;
                    self._is_song_preloaded = True;
                    return True
                if not temp_dev_mixers and song.get('audio_tracks'):
                    self._is_song_preloaded = False;
                    logging.error("No device mixers for tracks.");
                    return False

                for track in song.get('audio_tracks', []):
                    f_path_rel = track.get('file_path')
                    if not f_path_rel: continue
                    f_path_abs = os.path.join(self._get_audio_upload_folder_abs(), f_path_rel)
                    if not os.path.exists(f_path_abs): continue

                    app_log_ch1, is_stereo, track_vol = track.get('output_channel', 1), track.get('is_stereo',
                                                                                                  False), float(
                        track.get('volume', 1.0))
                    tgt_b_dev_id, phys_idx1 = logical_map.get(app_log_ch1, (None, -1))
                    if tgt_b_dev_id is None or tgt_b_dev_id not in temp_dev_mixers: continue

                    dev_mixer = temp_dev_mixers[tgt_b_dev_id]

                    src_flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
                    src_stream = BASS_StreamCreateFile(False, f_path_abs.encode('utf-8'), 0, 0, src_flags)
                    if not src_stream: logging.error(
                        f"BASS_StreamCreateFile failed {f_path_rel}: Err {BASS_ErrorGetCode()}"); continue
                    all_src_streams.append(src_stream)

                    src_info = BASS_CHANNELINFO()
                    if not BASS_ChannelGetInfo(src_stream, src_info):
                        logging.error(
                            f"BASS_ChannelGetInfo failed for source stream {src_stream} ({f_path_rel}). Error: {BASS_ErrorGetCode()}. Skipping track for this mixer.")
                        continue

                    mixer_info_for_matrix = BASS_CHANNELINFO()
                    if not BASS_ChannelGetInfo(dev_mixer, mixer_info_for_matrix):
                        logging.error(
                            f"BASS_ChannelGetInfo failed for device mixer {dev_mixer}. Error: {BASS_ErrorGetCode()}. Cannot set matrix. Skipping track for this mixer.")
                        continue

                    num_src_chans_for_matrix = src_info.chans
                    num_mixer_out_chans_for_matrix = mixer_info_for_matrix.chans

                    if num_src_chans_for_matrix <= 0 or num_mixer_out_chans_for_matrix <= 0:
                        logging.warning(
                            f"Invalid channel counts for matrix: src={num_src_chans_for_matrix}, mix_out={num_mixer_out_chans_for_matrix} for {f_path_rel}. Skipping matrix.")
                        continue

                    logging.debug(
                        f"Preparing matrix for track '{f_path_rel}': src_chans={num_src_chans_for_matrix}, mixer_out_chans={num_mixer_out_chans_for_matrix}")
                    matrix_total_elements = num_src_chans_for_matrix * num_mixer_out_chans_for_matrix

                    try:
                        matrix = (c_float * matrix_total_elements)()
                    except OverflowError as oe:
                        logging.error(
                            f"OverflowError creating matrix for '{f_path_rel}': total_elements={matrix_total_elements}. Error: {oe}")
                        continue

                    mix_flags_add = BASS_MIXER_CHAN_NORAMPIN | BASS_MIXER_MATRIX
                    if not BASS_Mixer_StreamAddChannel(dev_mixer, src_stream, mix_flags_add):
                        logging.error(
                            f"BASS_Mixer_StreamAddChannel failed for {src_stream} to {dev_mixer}: Err {BASS_ErrorGetCode()}");
                        continue

                    BASS_ChannelSetAttribute(src_stream, BASS_ATTRIB_VOL, track_vol)

                    if phys_idx1 < num_mixer_out_chans_for_matrix: matrix[
                        0 * num_mixer_out_chans_for_matrix + phys_idx1] = 1.0

                    if is_stereo and num_src_chans_for_matrix >= 2:
                        app_log_ch2 = app_log_ch1 + 1
                        tgt_b_dev_id2, phys_idx2 = logical_map.get(app_log_ch2, (None, -1))
                        if tgt_b_dev_id2 == tgt_b_dev_id and phys_idx2 != -1 and phys_idx2 < num_mixer_out_chans_for_matrix:
                            matrix[1 * num_mixer_out_chans_for_matrix + phys_idx2] = 1.0

                    if not BASS_Mixer_ChannelSetMatrix(dev_mixer, src_stream, matrix):
                        logging.error(
                            f"BASS_Mixer_ChannelSetMatrix failed for {src_stream} on {dev_mixer}: Err {BASS_ErrorGetCode()}")

                self._preloaded_song_id = song_id;
                self._preloaded_mixers = temp_dev_mixers;
                self._is_song_preloaded = True
                return True
            except Exception as e_preload:
                logging.error(f"Exception in preload_song: {e_preload}");
                traceback.print_exc()
                for hmixer in temp_dev_mixers.values(): BASS_StreamFree(hmixer)
                for hstream in all_src_streams: BASS_StreamFree(hstream)
                self._preloaded_mixers = {};
                self._is_song_preloaded = False;
                return False

    def play_preloaded_song(self):
        with callback_lock:
            if not self._is_song_preloaded or not self._preloaded_mixers: self._playback_active = False; return False
            if self._playback_active: return True
            self.stop(acquire_lock=False)
            self._active_mixer_handles = []
            all_started = True
            for b_dev_id, mixer_h in self._preloaded_mixers.items():
                if not mixer_h: continue
                if not BASS_ChannelSetDevice(mixer_h, b_dev_id):
                    logging.error(
                        f"BASS_ChannelSetDevice failed dev {b_dev_id} mixer {mixer_h}: Err {BASS_ErrorGetCode()}");
                    all_started = False;
                    continue
                BASS_ChannelSetAttribute(mixer_h, BASS_ATTRIB_VOL, self._current_global_volume)
                if not BASS_ChannelPlay(mixer_h, False):
                    logging.error(f"BASS_ChannelPlay failed mixer {mixer_h} dev {b_dev_id}: Err {BASS_ErrorGetCode()}");
                    all_started = False
                else:
                    self._active_mixer_handles.append(mixer_h)

            if self._active_mixer_handles and all_started:
                self._playback_active = True
                if self._playback_monitor_thread is None or not self._playback_monitor_thread.is_alive():
                    self._playback_monitor_thread = threading.Thread(target=self._playback_monitor, daemon=True);
                    self._playback_monitor_thread.start()
                return True
            else:
                for h_mixer in self._active_mixer_handles: BASS_ChannelStop(h_mixer)
                self._active_mixer_handles = [];
                self._playback_active = False;
                return False

    def _playback_monitor(self):
        logging.debug(f"Playback monitor started for {len(self._active_mixer_handles)} BASS mixer(s).")
        while True:
            with callback_lock:
                if not self._playback_active or not self._active_mixer_handles:
                    logging.debug("Monitor: Playback no longer active or no handles. Exiting.")
                    break
                current_active_mixers = sum(1 for mh in self._active_mixer_handles if
                                            BASS_ChannelIsActive(mh) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED])
                if current_active_mixers == 0:
                    logging.info("Monitor: All BASS mixers appear to have finished or stopped.")
                    self._playback_active = False
                    break
            time.sleep(0.1)
        with callback_lock:
            if not self._playback_active:
                self._active_mixer_handles = []
        logging.debug("Playback monitor thread finished.")

    def stop(self, acquire_lock=True):
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            if not self._playback_active and not self._active_mixer_handles:
                if not self._active_mixer_handles: self._playback_active = False
                return
            logging.info("AudioPlayer: BASS Stop Requested.")
            self._playback_active = False
            handles_to_stop = list(self._active_mixer_handles)
            self._active_mixer_handles = []
            for mixer_h in handles_to_stop:
                if mixer_h: BASS_ChannelStop(mixer_h)
            gc.collect()

    def is_playing(self):
        with callback_lock:
            if not self._playback_active or not self._active_mixer_handles: return False
            for mixer_h in self._active_mixer_handles:
                if BASS_ChannelIsActive(mixer_h) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED]: return True
            self._playback_active = False;
            return False

    def clear_preload_state(self, acquire_lock=True):
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            if self._is_song_preloaded or self._preloaded_mixers:
                if self._playback_active: self.stop(acquire_lock=False)
                for mixer_h in self._preloaded_mixers.values():
                    if mixer_h: BASS_StreamFree(mixer_h)
                self._preloaded_song_id = None;
                self._preloaded_mixers = {}
                self._is_song_preloaded = False;
                self._active_mixer_handles = []
                gc.collect()

    def play_song_directly(self, song_id):
        self.update_settings()
        needs_preload = True
        with callback_lock:
            if self._is_song_preloaded and self._preloaded_song_id == song_id: needs_preload = False
        if needs_preload:
            if not self.preload_song(song_id):
                logging.error(f"AudioPlayer: Preload failed for song {song_id}.")
                return False
        return self.play_preloaded_song()

    def shutdown(self):
        logging.info("AudioPlayer shutting down BASS...")
        self.stop();
        self.clear_preload_state();
        BASS_Free()
        logging.info("BASS Freed.")

    def calculate_song_duration(self, song_data_item):
        max_duration = 0.0
        if not song_data_item or not isinstance(song_data_item.get('audio_tracks'), list): return 0.0
        for track in song_data_item['audio_tracks']:
            file_path_rel = track.get('file_path')
            if not file_path_rel: continue
            file_path_abs = os.path.join(self._get_audio_upload_folder_abs(), file_path_rel)
            if not os.path.exists(file_path_abs): continue
            flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
            temp_stream = 0
            try:
                temp_stream = BASS_StreamCreateFile(False, file_path_abs.encode('utf-8'), 0, 0, flags)
                if temp_stream:
                    length_bytes = BASS_ChannelGetLength(temp_stream, BASS_POS_BYTE)
                    duration_sec = BASS_ChannelBytes2Seconds(temp_stream, length_bytes)
                    if duration_sec > max_duration: max_duration = duration_sec
                else:
                    logging.warning(
                        f"BASS failed to load {file_path_rel} for duration calc. Error: {BASS_ErrorGetCode()}")
            except Exception as e:
                logging.error(f"Exception in duration calc for {file_path_rel}: {e}")
            finally:
                if temp_stream: BASS_StreamFree(temp_stream)
        return max_duration