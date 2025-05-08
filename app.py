import contextlib
import json
import sys
import subprocess
import os
import gc
import threading
import traceback
import logging
from pathlib import Path
from collections import defaultdict
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_from_directory, render_template, abort
import sounddevice as sd
import soundfile as sf
import numpy as np
from flask_caching import Cache
import time
from flask import send_file  # For file downloads

app = Flask(__name__)

AUDIO_UPLOAD_FOLDER = os.path.join(app.root_path, 'static/audio')
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'aiff'}
DATA_DIR = os.path.join(app.root_path, 'data')
SONGS_FILE = 'songs.json'
SETLISTS_FILE = 'setlists.json'
SETTINGS_FILE = 'settings.json'
MIDI_SETTINGS_FILE = 'midi_settings.json'
DATA_TYPE = 'float32'
DEFAULT_SAMPLE_RATE = 48000
DEFAULT_CHANNELS = 2
MAX_LOGICAL_CHANNELS = 64
SUPPORTED_SAMPLE_RATES = [44100, 48000, 88200, 96000]

SONGS_CACHE_KEY = 'songs_data'
SETLISTS_CACHE_KEY = 'setlists_data'
SETTINGS_CACHE_KEY = 'settings_data'
MIDI_SETTINGS_CACHE_KEY = 'midi_settings_data'

playback_lock = threading.Lock()
active_streams = []
playback_threads = []

logging.basicConfig(level=logging.DEBUG)

config = {
    "DEBUG": True,
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 300
}
app.config.from_mapping(config)
cache = Cache(app)


def initialize_app():
    print("Initializing application...")
    Path('data').mkdir(exist_ok=True)
    Path(AUDIO_UPLOAD_FOLDER).mkdir(exist_ok=True)
    _init_settings_file(SETTINGS_FILE, {
        'audio_outputs': [],
        'volume': 1.0,
        'sample_rate': DEFAULT_SAMPLE_RATE
    })
    _init_settings_file(MIDI_SETTINGS_FILE, {
        'enabled': True,
        'shortcuts': {
            'play_pause': 'Space', 'stop': 'Escape',
            'next': 'ArrowRight', 'previous': 'ArrowLeft'
        },
        'midi_mappings': {}, 'midi_input_device': None
    })
    _init_settings_file(SONGS_FILE, {'songs': []})
    _init_settings_file(SETLISTS_FILE, {'setlists': []})
    print("Initialization complete.")


def _init_settings_file(file_name, default_data):
    file_path = os.path.join(DATA_DIR, file_name)
    cache_key = None
    if file_name == SETTINGS_FILE:
        cache_key = SETTINGS_CACHE_KEY
    elif file_name == MIDI_SETTINGS_FILE:
        cache_key = MIDI_SETTINGS_CACHE_KEY
    elif file_name == SONGS_FILE:
        cache_key = SONGS_CACHE_KEY
    elif file_name == SETLISTS_FILE:
        cache_key = SETLISTS_CACHE_KEY

    if not os.path.exists(file_path):
        logging.info(f"File '{file_path}' not found. Creating default.")
        if cache_key:
            if write_json(file_path, default_data, cache_key):
                logging.info(f"Default file {file_name} created and cache key '{cache_key}' handled.")
            else:
                logging.error(f"ERROR: Could not create settings file {file_path}")
                sys.exit(f"Failed to initialize critical file: {file_path}")
        else:
            try:
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(default_data, f, indent=2)
            except IOError as e:
                logging.error(f"ERROR: Could not create settings file {file_path} (no cache key method): {e}")
                sys.exit(f"Failed to initialize critical file: {file_path}")


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def read_json(file_path, cache_key):
    """Safely read JSON data from a file, using cache, returning defaults on error."""
    cached_data = cache.get(cache_key)
    if cached_data is not None:
        logging.debug(f"Cache hit for key '{cache_key}'.")
        return cached_data
    logging.info(f"Cache miss for key '{cache_key}'. Reading from '{file_path}'.")

    default_value_map = {
        SONGS_FILE: {'songs': []},
        SETLISTS_FILE: {'setlists': []},
        SETTINGS_FILE: {'audio_outputs': [], 'volume': 1.0, 'sample_rate': DEFAULT_SAMPLE_RATE},
        MIDI_SETTINGS_FILE: {'enabled': False, 'shortcuts': {}, 'midi_mappings': {}, 'midi_input_device': None}
    }
    default_value = next((val for key, val in default_value_map.items() if file_path.endswith(key)), {})

    if not os.path.exists(file_path):
        logging.warning(f"File not found {file_path}. Returning default and caching default value for 60s.")
        cache.set(cache_key, default_value, timeout=60)
        return default_value

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if file_path.endswith(SETTINGS_FILE):
            data.setdefault('audio_outputs', default_value['audio_outputs'])
            data.setdefault('volume', default_value['volume'])
            data.setdefault('sample_rate', default_value['sample_rate'])
        elif file_path.endswith(MIDI_SETTINGS_FILE):
            data.setdefault('enabled', default_value['enabled'])
            data.setdefault('shortcuts', default_value['shortcuts'])
            data.setdefault('midi_mappings', default_value['midi_mappings'])
            data.setdefault('midi_input_device', default_value['midi_input_device'])

        cache.set(cache_key, data)
        logging.debug(f"Data read from '{file_path}' and stored in cache key '{cache_key}'.")
        return data
    except (json.JSONDecodeError, IOError) as e:
        logging.error(
            f"Error reading or decoding {file_path}: {e}. Returning default and caching default value for 60s.")
        cache.set(cache_key, default_value, timeout=60)
        return default_value


def write_json(file_path, data, cache_key):
    """Writes JSON data and invalidates the cache."""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        logging.debug(f"Successfully wrote to '{file_path}'. Invalidating cache key '{cache_key}'.")
        cache.delete(cache_key)
        return True
    except (IOError, TypeError) as e:
        logging.error(f"ERROR: Could not write to file {file_path}: {e}")
        return False


def get_next_id(items):
    if not isinstance(items, list):
        return 1
    ids = [item['id'] for item in items if isinstance(item, dict) and isinstance(item.get('id'), int)]
    return max(ids, default=0) + 1


def calculate_song_duration(song):
    max_duration = 0.0
    if not song or not isinstance(song.get('audio_tracks'), list):
        return 0.0
    for track in song['audio_tracks']:
        try:
            file_path_rel = track.get('file_path')
            if not file_path_rel: continue
            file_path_abs = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER, file_path_rel)
            info = sf.info(file_path_abs)
            duration = info.duration
            if duration > max_duration:
                max_duration = duration
        except FileNotFoundError:
            logging.warning(f"Audio file not found for duration calculation: {file_path_rel}")
        except Exception as e:
            if not isinstance(e, FileNotFoundError):
                logging.error(f"Error getting duration for {track.get('file_path', 'N/A')}: {e}")
            continue
    return max_duration


def _play_on_stream(stream: sd.OutputStream, audio_buffer: np.ndarray):
    device_info = f"Device {stream.device}" if stream.device is not None else "Default Device"
    try:
        stream.write(audio_buffer)
        logging.debug(f"Stream {device_info} finished writing.")
    except sd.PortAudioError as pae:
        if pae.args and pae.args[0] != -9986:  # Ignore common abort error
            logging.warning(f"PortAudioError during playback on {device_info}: {pae}")
    except Exception as e:
        logging.error(f"ERROR during playback on {device_info}: {e}")
    finally:
        try:
            if not stream.closed:
                stream.close(ignore_errors=True)
                logging.debug(f"Stream {device_info} closed.")
        except Exception as e:
            logging.error(f"ERROR closing stream {device_info}: {e}")
        gc.collect()


def _get_device_details(device_id):
    try:
        device_info = sd.query_devices(device=device_id if device_id is not None and device_id >= 0 else None,
                                       kind='output')
        if device_info and isinstance(device_info, dict):
            sr = int(device_info.get('default_samplerate', DEFAULT_SAMPLE_RATE))
            ch = int(device_info.get('max_output_channels', DEFAULT_CHANNELS))
            return sr, ch
        else:
            logging.warning(f"Warning: No/invalid device info for ID {device_id}. Using defaults.")
            return DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS
    except (ValueError, sd.PortAudioError, IndexError, TypeError) as e:
        logging.warning(f"Warning: Could not query device {device_id}: {e}. Using defaults.")
        return DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS


callback_lock = threading.Lock()

# In app.py

# Required imports:
import os
import gc
import threading
import traceback
import logging
import sounddevice as sd
import soundfile as sf
import numpy as np
import time
from collections import defaultdict
# Assumes these helpers/constants/globals are defined elsewhere in app.py:
from app import read_json, DATA_DIR, SETTINGS_FILE, SONGS_FILE, SETTINGS_CACHE_KEY, SONGS_CACHE_KEY, \
                DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS, DATA_TYPE, MAX_LOGICAL_CHANNELS, \
                AUDIO_UPLOAD_FOLDER, app, _get_device_details # Add other necessary imports/constants

# --- Need a dedicated callback lock ---
# This lock protects shared state accessed by audio callbacks and control methods
callback_lock = threading.Lock()

class AudioPlayer:
    """
    Manages audio playback using sounddevice callbacks for potentially
    better synchronization across multiple devices.
    """
    def __init__(self):
        self.audio_outputs = []
        self._current_global_volume = 1.0
        self.target_sample_rate = DEFAULT_SAMPLE_RATE

        self._preloaded_song_id = None
        self._preloaded_data_package = {} # Holds pre-mixed buffers etc.
        self._is_song_preloaded = False

        # --- State for Callback Playback ---
        self._playback_active = False
        self._current_frame = 0
        self._total_frames = 0
        self._active_streams = []  # List of active sd.OutputStream objects
        # Note: _stream_data_map is now populated within play_preloaded_song
        # It's not needed as persistent instance state across songs in this design.

        self.load_settings()

    def load_settings(self):
        """Loads audio output settings, volume, and sample rate from settings file."""
        filepath = os.path.join(DATA_DIR, SETTINGS_FILE)
        settings = read_json(filepath, SETTINGS_CACHE_KEY)
        loaded_outputs = settings.get('audio_outputs', [])
        loaded_volume = settings.get('volume', 1.0)
        loaded_sample_rate = settings.get('sample_rate', DEFAULT_SAMPLE_RATE)

        # Validate audio outputs
        if not isinstance(loaded_outputs, list):
            logging.warning("AudioPlayer: 'audio_outputs' in settings is not a list. Using empty.")
            self.audio_outputs = []
        else:
            valid_outputs = [
                out for out in loaded_outputs
                if isinstance(out, dict) and 'device_id' in out and 'channels' in out
            ]
            if len(valid_outputs) != len(loaded_outputs):
                logging.warning("AudioPlayer: Some invalid entries removed from 'audio_outputs'.")
            self.audio_outputs = valid_outputs

        # Validate volume
        new_volume = 1.0
        try: new_volume = max(0.0, min(1.0, float(loaded_volume)))
        except (ValueError, TypeError): logging.warning(f"AudioPlayer: Invalid 'volume' ({loaded_volume}). Using 1.0.")

        if hasattr(self, '_current_global_volume') and abs(self._current_global_volume - new_volume) > 1e-6:
            logging.info(f"AudioPlayer: Global volume changed ({self._current_global_volume:.2f} -> {new_volume:.2f}). Clearing preload.")
            self.clear_preload_state(acquire_lock=False) # Assume called when lock might not be needed or handled externally
        self._current_global_volume = new_volume

        # Validate sample rate
        new_sr = DEFAULT_SAMPLE_RATE
        try: sr = int(loaded_sample_rate); assert sr > 0; new_sr = sr;
        except (ValueError, TypeError, AssertionError): logging.warning(f"AudioPlayer: Invalid 'sample_rate' ({loaded_sample_rate}). Using {DEFAULT_SAMPLE_RATE} Hz.")

        if hasattr(self, 'target_sample_rate') and self.target_sample_rate != new_sr:
             logging.info(f"AudioPlayer: Target SR changed ({self.target_sample_rate} -> {new_sr} Hz). Clearing preload.")
             self.clear_preload_state(acquire_lock=False)
        self.target_sample_rate = new_sr

        logging.debug(f"AudioPlayer settings loaded: {len(self.audio_outputs)} outputs, Vol:{self._current_global_volume:.2f}, SR:{self.target_sample_rate} Hz")

    @property
    def global_volume(self):
        return self._current_global_volume

    def _build_logical_channel_map(self):
        """Builds map: logical_channel (int) -> (device_id (int), physical_channel_index (int))."""
        logical_map = {}
        sr = self.target_sample_rate
        logging.debug(f"AudioPlayer: Building channel map (Target SR: {sr} Hz)")
        for mapping in self.audio_outputs:
            dev_id = mapping.get('device_id')
            chans = mapping.get('channels', [])
            if dev_id is None or not isinstance(chans, list):
                logging.warning(f"AudioPlayer: Skipping invalid mapping: {mapping}")
                continue
            for phys_idx, log_ch in enumerate(chans):
                if isinstance(log_ch, int) and 1 <= log_ch <= MAX_LOGICAL_CHANNELS:
                    if log_ch in logical_map:
                        logging.warning(f"AudioPlayer: Logical ch {log_ch} mapped multiple times. Using Dev:{dev_id}/Phys:{phys_idx}.")
                    logical_map[log_ch] = (dev_id, phys_idx)
                else:
                    logging.warning(f"AudioPlayer: Invalid logical ch '{log_ch}' in mapping for Dev {dev_id}. Skipping.")
        return logical_map, sr

    # --- preload_song (Now with full track processing logic) ---
    def preload_song(self, song_id):
        """Loads, resamples, mixes audio tracks into device-specific buffers."""
        logging.info(f"\n--- AudioPlayer: Preload Request: Song ID {song_id} ---")
        self.load_settings()

        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)
        song = next((s for s in songs_data.get('songs', []) if isinstance(s, dict) and s.get('id') == song_id), None)

        if not song:
            logging.error(f"AudioPlayer: Song {song_id} not found."); self._is_song_preloaded=False; return False
        if not isinstance(song.get('audio_tracks'), list) or not song['audio_tracks']:
             logging.warning(f"AudioPlayer: Song {song_id} ('{song.get('name')}') has no tracks. Preloading silence.")
        if not self.audio_outputs:
             logging.error("AudioPlayer: No outputs configured."); self._is_song_preloaded=False; return False

        logging.info(f"Preloading '{song.get('name')}' (SR:{self.target_sample_rate}, Vol:{self.global_volume:.2f})")
        logical_channel_map, sample_rate_for_preload = self._build_logical_channel_map()

        tracks_to_process_for_devices = defaultdict(list)
        raw_audio_file_cache = {}
        max_length_samples = 0 # Renamed from max_frames for clarity

        # --- Step 1: Load, Resample, Assign Tracks (Filled In) ---
        for track_info_raw in song.get('audio_tracks',[]):
            if not isinstance(track_info_raw, dict) or not track_info_raw.get('file_path'): continue
            try:
                logical_channel_1 = int(track_info_raw.get('output_channel', 1))
                is_stereo_flag = bool(track_info_raw.get('is_stereo', False))
                track_specific_volume = max(0.0, min(2.0, float(track_info_raw.get('volume', 1.0))))
                file_path_rel = track_info_raw.get('file_path')
                file_path_abs = os.path.abspath(os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER, file_path_rel))

                if not os.path.exists(file_path_abs):
                    logging.warning(f"Audio file not found: '{file_path_rel}'. Skip track."); continue

                target_device_id, physical_channel_1 = logical_channel_map.get(logical_channel_1, (None, -1))
                if target_device_id is None:
                    logging.debug(f"Ch {logical_channel_1} for track '{file_path_rel}' not mapped. Skip."); continue

                physical_channel_2 = -1; is_effectively_stereo = False
                if is_stereo_flag:
                    logical_channel_2 = logical_channel_1 + 1
                    dev2, phys2_temp = logical_channel_map.get(logical_channel_2, (None, -1))
                    if dev2 == target_device_id and phys2_temp == physical_channel_1 + 1:
                        physical_channel_2 = phys2_temp; is_effectively_stereo = True
                    else: logging.warning(f"Track '{file_path_rel}' stereo invalid. Treat mono.")

                if file_path_abs not in raw_audio_file_cache:
                    logging.debug(f"  Loading: {file_path_rel}")
                    data, sr = sf.read(file_path_abs, dtype=DATA_TYPE, always_2d=True)
                    raw_audio_file_cache[file_path_abs] = (data, sr)
                else: logging.debug(f"  Using cache: {file_path_rel}"); data, sr = raw_audio_file_cache[file_path_abs]

                if sr != sample_rate_for_preload:
                    logging.debug(f"  Resampling '{file_path_rel}' from {sr}Hz to {sample_rate_for_preload}Hz...")
                    num_orig = len(data); num_new = int(num_orig * sample_rate_for_preload / sr)
                    resampled = np.zeros((num_new, data.shape[1]), dtype=DATA_TYPE)
                    x_old = np.linspace(0,1,num_orig,endpoint=False); x_new = np.linspace(0,1,num_new,endpoint=False)
                    for i_col in range(data.shape[1]): resampled[:, i_col] = np.interp(x_new, x_old, data[:, i_col])
                    data = resampled; logging.debug(f"    Resampled shape: {data.shape}"); del resampled; gc.collect()

                play_as_stereo = is_effectively_stereo and data.shape[1] >= 2
                if play_as_stereo: final_data = data[:, :2]; logging.debug("    Using stereo data.")
                else:
                    mono_data = data[:, 0] if data.shape[1] > 0 else np.array([],dtype=DATA_TYPE)
                    if data.shape[1] > 1: logging.debug(f"    Mixing {data.shape[1]}ch to mono."); mono_data = np.mean(data, axis=1) * 0.707 # Pan law
                    final_data = mono_data.reshape(-1, 1) if mono_data.size > 0 else np.array([[]], dtype=DATA_TYPE)

                current_len = len(final_data)
                if current_len > max_length_samples: logging.debug(f"    Updating max length: {max_length_samples} -> {current_len}"); max_length_samples = current_len

                tracks_to_process_for_devices[target_device_id].append({
                    'data': final_data, 'volume': track_specific_volume,
                    'physical_channel_1': physical_channel_1, 'physical_channel_2': physical_channel_2,
                    'play_as_stereo': play_as_stereo, 'file_path': file_path_rel
                })
            except sf.SoundFileError as e: logging.error(f"SoundFileError track '{track_info_raw.get('file_path')}': {e}. Skip.")
            except Exception as e: logging.error(f"ERROR processing track '{track_info_raw.get('file_path')}': {e}"); traceback.print_exc()

        del raw_audio_file_cache; gc.collect()
        if not tracks_to_process_for_devices and song.get('audio_tracks'):
             logging.error(f"No tracks processed/mapped for song {song_id}. Preload failed."); self._is_song_preloaded=False; return False
        elif not tracks_to_process_for_devices: logging.warning(f"Song {song_id} has no processable tracks.")

        # --- Step 2: Pre-mix Buffers (Filled In) ---
        final_device_buffers = {}
        logging.debug("Starting pre-mixing...")
        for device_id, device_tracks_list in tracks_to_process_for_devices.items():
            try:
                _, actual_max_ch = _get_device_details(device_id)
                if actual_max_ch <= 0: logging.warning(f"Skipping device {device_id}: {actual_max_ch} ch."); continue
                buffer_phys_ch = actual_max_ch
                mix_buffer = np.zeros((max_length_samples, buffer_phys_ch), dtype=np.float64)
                logging.debug(f"  Mix buffer Dev {device_id}: Shape=({max_length_samples}, {buffer_phys_ch})")

                for track in device_tracks_list:
                    data = track['data']; vol = track['volume']
                    p_ch1 = track['physical_channel_1']; p_ch2 = track['physical_channel_2']
                    is_stereo = track['play_as_stereo']
                    if data.size == 0: continue
                    copy_len = min(len(data), max_length_samples)

                    if p_ch1 < 0 or p_ch1 >= buffer_phys_ch: logging.warning(f"  Track '{track['file_path']}' invalid ch {p_ch1}. Skip mix."); continue
                    if is_stereo:
                        if p_ch2 < 0 or p_ch2 >= buffer_phys_ch or data.shape[1] < 2: logging.warning(f"  Track '{track['file_path']}' stereo mapping invalid. Mix mono."); is_stereo = False

                    if is_stereo:
                        mix_buffer[:copy_len, p_ch1] += data[:copy_len, 0] * vol
                        mix_buffer[:copy_len, p_ch2] += data[:copy_len, 1] * vol
                    elif data.shape[1] > 0: mix_buffer[:copy_len, p_ch1] += data[:copy_len, 0] * vol

                mix_buffer *= self.global_volume
                np.clip(mix_buffer, -1.0, 1.0, out=mix_buffer)
                logging.debug(f"  Applied volume & clipped Dev {device_id}")
                final_device_buffers[device_id] = mix_buffer.astype(DATA_TYPE)
                logging.debug(f"  Finished pre-mix Dev {device_id}. Shape: {final_device_buffers[device_id].shape}")

            except Exception as e_mix: logging.error(f"ERROR pre-mixing Dev {device_id}: {e_mix}"); traceback.print_exc()

        if not final_device_buffers and song.get('audio_tracks'):
             logging.error(f"No device buffers pre-mixed for song {song_id}."); self._is_song_preloaded=False; return False
        elif not final_device_buffers: logging.warning(f"Song {song_id} preloaded silent.")

        # --- Store results ---
        # Lock might not be needed if only accessed by one thread here
        self._preloaded_song_id = song_id
        self._preloaded_data_package = {
            'device_buffers': final_device_buffers,
            'max_length_samples': max_length_samples,
            'target_sample_rate_at_preload': sample_rate_for_preload,
            'global_volume_at_preload': self.global_volume
        }
        self._is_song_preloaded = True
        logging.info(f"--- AudioPlayer: Song ID {song_id} Preloaded Successfully ---")
        return True


    # --- Callback Playback Methods (Keep from previous callback version) ---
    def play_preloaded_song(self):
        """Plays the preloaded song using callbacks."""
        global callback_lock
        logging.debug("AudioPlayer: play_preloaded_song called (callback mode)")
        with callback_lock:
            if not self._is_song_preloaded or self._preloaded_song_id is None: logging.error("No song preloaded."); return False
            if self._playback_active: logging.warning("Already playing."); return True
            self._stop_internal_no_lock() # Stop previous

            data_package = self._preloaded_data_package
            stream_data_map = data_package.get('device_buffers', {}) # Local var for this playback instance
            sr = data_package.get('target_sample_rate_at_preload')
            self._total_frames = data_package.get('max_length_samples', 0)
            self._current_frame = 0

            if not stream_data_map or self._total_frames == 0:
                logging.warning(f"Preloaded data empty for song {self._preloaded_song_id}. Play silent."); self._playback_active = False; return True

            logging.info(f"Starting callback playback song ID {self._preloaded_song_id} at {sr} Hz...")
            self._active_streams = [] # Reset list

            default_extra = sd.default.extra_settings
            extra_settings_out = default_extra[1] if isinstance(default_extra, tuple) else default_extra
            streams_started = 0

            # Need to store references needed by callbacks that persist for stream lifetime
            # Store buffers temporarily accessible during stream creation loop
            self._temp_callback_buffers = stream_data_map.copy()

            for device_id, audio_buffer in stream_data_map.items():
                stream = None
                try:
                    if audio_buffer.size == 0: continue
                    channels = audio_buffer.shape[1]
                    if channels == 0: continue
                    logging.debug(f"  Dev {device_id}: Creating OutputStream (Rate:{sr}, Ch:{channels}, Callback)")

                    # --- Create unique callback closure ---
                    def create_callback(dev_id_for_callback, buffer_for_stream):
                        def stream_callback(outdata, frames, time, status):
                            if status: logging.warning(f"Callback status (Dev {dev_id_for_callback}): {status}")
                            with callback_lock:
                                if not self._playback_active: outdata.fill(0); return
                                start = self._current_frame; end = start + frames
                                available = self._total_frames - start
                                if available <= 0: outdata.fill(0)
                                else:
                                    chunk = min(frames, available)
                                    try: # Ensure buffer access is safe
                                        outdata[:chunk] = buffer_for_stream[start:start + chunk]
                                    except IndexError as ie:
                                        logging.error(f"Callback IndexError (Dev {dev_id_for_callback}): start={start}, chunk={chunk}, buffer_len={len(buffer_for_stream)} - {ie}")
                                        outdata[:chunk].fill(0) # Fill with silence on error
                                    if chunk < frames: outdata[chunk:].fill(0)
                                # --- Shared Frame Counter Update (Use first stream) ---
                                if self._active_streams and id(stream) == id(self._active_streams[0]): # Check object identity
                                     self._current_frame = min(end, self._total_frames)
                        return stream_callback

                    # Create the callback for this specific device's buffer
                    this_stream_callback = create_callback(device_id, audio_buffer)

                    stream = sd.OutputStream(
                        device=device_id if device_id >= 0 else None, samplerate=sr, channels=channels, dtype=DATA_TYPE,
                        latency='low', blocksize=None, extra_settings=extra_settings_out, callback=this_stream_callback )

                    self._active_streams.append(stream) # Add stream *before* starting thread
                    stream.start() # Start invoking the callback
                    streams_started += 1
                    logging.debug(f"    Dev {device_id}: Callback Stream started.")

                except sd.PortAudioError as pae: logging.error(f"PortAudioError Dev {device_id}: {pae}")
                except Exception as e: logging.error(f"ERROR Dev {device_id}: {e}"); traceback.print_exc()
                finally: # Clean up stream if it was created but failed to start/add
                    if stream and stream not in self._active_streams and not stream.closed:
                        try: stream.close(ignore_errors=True)
                        except Exception as ce: logging.error(f"Error closing failed stream {device_id}: {ce}")

            del self._temp_callback_buffers # Remove temp reference

            if streams_started > 0:
                self._playback_active = True
                logging.info(f"--- Playback INITIATED via callback for {streams_started} devices ---")
                monitor_thread = threading.Thread(target=self._playback_monitor, daemon=True); monitor_thread.start()
                return True
            else:
                logging.error("--- Playback FAILED: No streams started. ---"); self._playback_active = False; self._stop_internal_no_lock(); return False

    def _playback_monitor(self):
        """Monitors the playback frame count and stops when done."""
        global callback_lock
        logging.debug("Playback monitor thread started.")
        is_active = True
        while is_active:
            time.sleep(0.1) # Check periodically
            with callback_lock:
                # Check if playback finished OR was stopped externally
                if not self._playback_active or self._current_frame >= self._total_frames:
                    is_active = False # Exit loop
                    natural_finish = self._playback_active # Did it finish or was it stopped?
            # Lock released before potentially calling stop()
        if natural_finish:
             logging.info("Playback monitor detected end of song.")
             self.stop() # Call the main stop method (which acquires lock)
        logging.debug("Playback monitor thread finished.")

    def _stop_internal_no_lock(self):
        """Internal stop assuming lock is already held."""
        if not self._active_streams and not self._playback_active: return # Nothing to stop
        logging.info(f"  AudioPlayer: _stop_internal_no_lock: Stopping streams...")
        self._playback_active = False # Signal callbacks first
        # Give a very brief moment for callbacks to potentially see the flag
        # This is optional and might not be reliable. Consider removing if causing issues.
        # time.sleep(0.01)

        streams_to_stop = list(self._active_streams)
        self._active_streams = []
        for stream in streams_to_stop:
            try:
                if not stream.closed:
                    logging.debug(f"    Stopping/Closing stream dev {stream.device}.")
                    stream.stop(ignore_errors=True)
                    stream.close(ignore_errors=True)
            except Exception as e: logging.error(f"    Error stop/close stream {stream.device}: {e}")
        self._current_frame = 0; self._total_frames = 0; # Reset state
        gc.collect(); logging.debug("  AudioPlayer: _stop_internal_no_lock complete.")

    def stop(self):
        """Stops currently playing audio immediately."""
        global callback_lock
        logging.info("\n--- AudioPlayer: Stop Request ---")
        with callback_lock: self._stop_internal_no_lock()
        logging.info("--- AudioPlayer: Playback stopped ---")

    def is_playing(self):
        """Checks if playback is currently marked as active."""
        global callback_lock
        with callback_lock:
            # Check internal flag first
            if not self._playback_active: return False
            # Verify at least one stream is still considered active by sounddevice
            for stream in self._active_streams:
                try:
                    if not stream.closed and stream.active: return True
                except: pass
            # If flag is true but no stream is active, maybe it just ended - reset flag?
            # Let's rely primarily on the flag managed by play/stop/monitor for simplicity
            # but return False if no streams are technically active.
            # This might need refinement based on exact behaviour.
            return len(self._active_streams) > 0 and any(s.active for s in self._active_streams if not s.closed)


    def clear_preload_state(self, acquire_lock=True):
        """Clears any preloaded song data. Stops playback if necessary."""
        global callback_lock
        lock = callback_lock if acquire_lock else contextlib.nullcontext() # Dummy context if no lock needed
        with lock:
            if self._is_song_preloaded:
                logging.info(f"AudioPlayer: Clearing preloaded data ID: {self._preloaded_song_id}.")
                # If the currently playing song is the one being cleared, stop playback
                if self._playback_active and hasattr(self, '_preloaded_song_id') and self._preloaded_song_id == self._preloaded_song_id:
                     logging.info("Stopping playback because preloaded song is being cleared.")
                     self._stop_internal_no_lock() # Assumes lock is held if acquire_lock is True

                self._preloaded_song_id = None
                self._preloaded_data_package = {}
                self._is_song_preloaded = False
                gc.collect()
            else:
                logging.debug("AudioPlayer: No song data preloaded to clear.")

    def play_song_directly(self, song_id):
        """Plays a song by ID using callback method. Handles preloading."""
        global callback_lock
        needs_preload = True
        self.load_settings() # Ensure settings are current

        with callback_lock: # Check preload under lock
            if self._is_song_preloaded and self._preloaded_song_id == song_id:
                pre_sr = self._preloaded_data_package.get('target_sample_rate_at_preload')
                pre_vol = self._preloaded_data_package.get('global_volume_at_preload')
                vol_match = pre_vol is not None and abs(pre_vol - self.global_volume) < 1e-6
                sr_match = pre_sr is not None and pre_sr == self.target_sample_rate
                if sr_match and vol_match: needs_preload = False; logging.info(f"Preload valid for {song_id}.")
                else: logging.info(f"Preload invalid for {song_id}, re-preloading...")
        # Lock released

        if needs_preload:
            # Ensure playback is stopped before potentially long preload
            # self.stop() # Maybe too aggressive? Preload might clear playback anyway.
            logging.info(f"AudioPlayer: Preloading {song_id} (Callback Mode)...")
            # Clear previous potentially invalid preload BEFORE loading new one
            self.clear_preload_state() # Uses lock internally
            if not self.preload_song(song_id): # Preload uses its own logic
                logging.error(f"AudioPlayer: Preload failed for {song_id}."); return False

        return self.play_preloaded_song() # Call the callback-based play method


initialize_app()
audio_player = AudioPlayer()


# In app.py -> export_data function

@app.route('/api/export/<export_type>', methods=['GET'])
def export_data(export_type):
    filename = None
    if export_type == 'songs':
        filename = SONGS_FILE
    elif export_type == 'setlists':
        filename = SETLISTS_FILE

    if not filename:
        return jsonify(error="Invalid export type specified"), 400

    file_path = os.path.join(DATA_DIR, filename)

    if not os.path.exists(file_path):
        return jsonify(error=f"{filename} not found on server"), 404

    try:
        # Revert to this: Let send_file determine mimetype, rely on as_attachment
        return send_file(
            file_path,
            # mimetype='application/octet-stream', # REMOVE THIS LINE
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        logging.error(f"Error exporting {filename}: {e}")
        return jsonify(error=f"Could not export {filename}"), 500


@app.route('/api/import/<import_type>', methods=['POST'])
def import_data(import_type):
    target_filename = None
    cache_key_to_clear = None
    default_structure = None

    if import_type == 'songs':
        target_filename = SONGS_FILE
        cache_key_to_clear = SONGS_CACHE_KEY
        default_structure = {'songs': []}  # For basic validation
    elif import_type == 'setlists':
        target_filename = SETLISTS_FILE
        cache_key_to_clear = SETLISTS_CACHE_KEY
        default_structure = {'setlists': []}  # For basic validation
    # Add other types if desired later

    if not target_filename:
        return jsonify(error="Invalid import type specified"), 400

    if 'file' not in request.files:
        return jsonify(error="No file part in the request"), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify(error="No file selected for import"), 400

    if file and file.filename.endswith('.json'):
        try:
            # Validate JSON structure (basic)
            imported_data = json.load(file)  # This reads from the InMemoryUploadedFile stream

            # Basic validation: check if the root key matches expected (e.g., 'songs' or 'setlists')
            if import_type == 'songs' and 'songs' not in imported_data:
                return jsonify(error="Invalid songs.json format: missing 'songs' key."), 400
            if import_type == 'setlists' and 'setlists' not in imported_data:
                return jsonify(error="Invalid setlists.json format: missing 'setlists' key."), 400
            # Add more specific validation as needed (e.g., are items in 'songs' list dicts with 'id'?)

            file_path = os.path.join(DATA_DIR, target_filename)

            # Overwrite the existing file
            # Use the write_json function which handles cache invalidation
            if write_json(file_path, imported_data, cache_key_to_clear):
                logging.info(f"Successfully imported and overwrote {target_filename}")

                # --- Post-import actions ---
                # Clear the general cache as other dependent data might change
                cache.clear()  # Clears all cache keys
                logging.info(f"Cleared all cache after importing {target_filename}.")

                # If songs were imported, the audio player's preloaded song might be invalid
                if import_type == 'songs':
                    audio_player.clear_preload_state()
                    logging.info("Cleared audio player preload state after song import.")
                # Consider stopping playback if active, as setlists/songs might have changed drastically
                audio_player.stop()  # Stop any current playback
                logging.info("Stopped audio playback after import.")

                return jsonify(success=True,
                               message=f"{target_filename} imported successfully. Application cache cleared.")
            else:
                return jsonify(error=f"Failed to write imported data to {target_filename}"), 500

        except json.JSONDecodeError:
            return jsonify(error="Invalid JSON file. Could not decode."), 400
        except Exception as e:
            logging.error(f"Error importing {target_filename}: {e}")
            traceback.print_exc()
            return jsonify(error=f"An error occurred during import: {str(e)}"), 500
    else:
        return jsonify(error="Invalid file type. Please upload a .json file."), 400


@app.route('/api/audio/files', methods=['GET'])
def list_audio_files():
    audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
    try:
        if not os.path.exists(audio_folder_path):
            os.makedirs(audio_folder_path)  # Ensure directory exists
            return jsonify(files=[])

        # List files and filter by allowed extensions
        all_files_in_dir = os.listdir(audio_folder_path)
        audio_files = [
            f for f in all_files_in_dir
            if os.path.isfile(os.path.join(audio_folder_path, f)) and allowed_file(f)
        ]
        return jsonify(files=sorted(audio_files))
    except Exception as e:
        logging.error(f"Error listing audio files: {e}")
        return jsonify(error=str(e)), 500


# Add this new route in app.py

@app.route('/api/audio/upload', methods=['POST'])
def general_audio_upload():
    if 'files[]' not in request.files:
        return jsonify(error='No files part in the request'), 400
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '':
        return jsonify(error='No selected files'), 400

    audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
    os.makedirs(audio_folder_path, exist_ok=True)

    uploaded_filenames = []
    errors = []

    for file in files:
        if file and file.filename and allowed_file(file.filename):
            try:
                filename = secure_filename(file.filename)
                if not filename:
                    errors.append(f"Invalid filename derived from '{file.filename}'.")
                    continue

                # Check for existing file to prevent accidental overwrite (optional, or allow overwrite)
                # For now, we'll allow overwrite, as is common.
                # If you want to prevent overwrites and return an error:
                # if os.path.exists(os.path.join(audio_folder_path, filename)):
                #     errors.append(f"File '{filename}' already exists. Please rename or delete the existing file.")
                #     continue

                file.save(os.path.join(audio_folder_path, filename))
                uploaded_filenames.append(filename)
                logging.info(f"Globally uploaded audio file: {filename}")
            except Exception as e:
                errors.append(f"Error saving file {file.filename}: {e}")
                logging.error(f"Error saving file {file.filename} during global upload: {e}")
        elif file and file.filename:
            errors.append(f"File type not allowed: {file.filename}")

    if not uploaded_filenames and not errors:  # No files processed (e.g. all were empty filenames)
        return jsonify(error='No valid files processed.'), 400

    status_code = 200 if not errors else (207 if uploaded_filenames else 400)  # OK, Multi-Status, or Bad Request
    response_data = {'uploaded_files': uploaded_filenames}
    if errors:
        response_data['errors'] = errors
    return jsonify(response_data), status_code


@app.route('/api/settings/keyboard', methods=['GET', 'PUT'])
def keyboard_settings():
    settings_path = os.path.join(DATA_DIR, MIDI_SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error="Invalid request body"), 400
            current_settings = read_json(settings_path, MIDI_SETTINGS_CACHE_KEY)
            current_settings.setdefault('enabled', False)
            current_settings.setdefault('shortcuts', {})
            current_settings.setdefault('midi_mappings', {})
            current_settings.setdefault('midi_input_device', None)

            updated = False
            if 'enabled' in data:
                new_enabled = bool(data.get('enabled', False))
                if current_settings['enabled'] != new_enabled:
                    current_settings['enabled'] = new_enabled
                    updated = True
            if 'shortcuts' in data:
                if isinstance(data['shortcuts'], dict):
                    if current_settings['shortcuts'] != data['shortcuts']:
                        current_settings['shortcuts'] = data['shortcuts']
                        updated = True
                else:
                    return jsonify(error='Invalid shortcuts format, must be a dictionary'), 400

            if updated:
                if not write_json(settings_path, current_settings, MIDI_SETTINGS_CACHE_KEY):
                    return jsonify(error="Failed to write settings file"), 500
            return jsonify(success=True, settings={
                'enabled': current_settings.get('enabled'),
                'shortcuts': current_settings.get('shortcuts')
            })
        except Exception as e:
            logging.error(f"Error updating keyboard settings: {e}")
            return jsonify(error=str(e)), 500

    try:
        settings = read_json(settings_path, MIDI_SETTINGS_CACHE_KEY)
        keyboard_part = {
            'enabled': settings.get('enabled', False),
            'shortcuts': settings.get('shortcuts', {})
        }
        return jsonify(keyboard_part)
    except Exception as e:
        logging.error(f"Error reading keyboard settings: {e}")
        return jsonify(error=str(e)), 500


@app.route('/api/setlists', methods=['GET', 'POST'])
def handle_setlists():
    setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
    if request.method == 'POST':
        try:
            data = request.get_json()
            if not data or not data.get('name') or not isinstance(data.get('name', ''), str):
                return jsonify(error='Missing or invalid setlist name'), 400
            name = data['name'].strip()
            if not name:
                return jsonify(error='Setlist name cannot be empty'), 400
            song_ids = data.get('song_ids', [])
            if not isinstance(song_ids, list) or not all(isinstance(sid, int) for sid in song_ids):
                return jsonify(error='Invalid song_ids format, must be a list of integers'), 400

            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
                logging.warning(f"Setlists data file '{setlists_path}' corrupted or has wrong structure. Resetting.")
                setlists_data = {'setlists': []}
            new_setlist = {'id': get_next_id(setlists_data['setlists']), 'name': name, 'song_ids': song_ids}
            setlists_data['setlists'].append(new_setlist)

            if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                return jsonify(new_setlist), 201
            else:
                return jsonify(error="Failed to save setlist data"), 500
        except Exception as e:
            logging.error(f"Error creating setlist: {e}")
            return jsonify(error="Internal server error"), 500

    try:
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
            logging.warning(
                f"Setlists data file '{setlists_path}' has invalid structure during GET. Returning empty list.")
            return jsonify(setlists=[])
        return jsonify(setlists_data)
    except Exception as e:
        logging.error(f"Error reading setlists: {e}")
        return jsonify(error="Could not retrieve setlists"), 500


@app.route('/api/setlists/<int:setlist_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_setlist(setlist_id):
    setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
    setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
    if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
        logging.error(f"Setlists data file '{setlists_path}' corrupted or missing during access for ID {setlist_id}.")
        return jsonify(error='Setlist data file is corrupted or missing'), 500

    setlist_index = next(
        (i for i, s in enumerate(setlists_data['setlists']) if isinstance(s, dict) and s.get('id') == setlist_id), -1)
    if setlist_index == -1: return jsonify(error='Setlist not found'), 404
    setlist = setlists_data['setlists'][setlist_index]

    if request.method == 'GET':
        return jsonify(setlist)
    elif request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400
            updated = False
            if 'name' in data:
                name = str(data['name']).strip()
                if not name: return jsonify(error='Setlist name cannot be empty'), 400
                if setlist.get('name') != name:
                    setlist['name'] = name
                    updated = True
            if 'song_ids' in data:
                song_ids = data.get('song_ids')
                if not isinstance(song_ids, list) or not all(isinstance(sid, int) for sid in song_ids):
                    return jsonify(error='Invalid song_ids format, must be a list of integers'), 400
                if setlist.get('song_ids', []) != song_ids:
                    setlist['song_ids'] = song_ids
                    updated = True
            if updated:
                if not write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                    return jsonify(error="Failed to save updated setlist data"), 500
            return jsonify(setlist)
        except Exception as e:
            logging.error(f"Error updating setlist {setlist_id}: {e}")
            return jsonify(error="Internal server error"), 500
    elif request.method == 'DELETE':
        try:
            del setlists_data['setlists'][setlist_index]
            if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                return jsonify(success=True, message="Setlist deleted")
            else:
                return jsonify(error="Failed to save after deleting setlist"), 500
        except Exception as e:
            logging.error(f"Error deleting setlist {setlist_id}: {e}")
            return jsonify(error="Internal server error"), 500


@app.route('/api/songs', methods=['GET', 'POST', 'DELETE'])
def handle_songs():
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    if request.method == 'POST':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400
            name = str(data.get('name') or 'New Song').strip() or 'New Song'
            try:
                tempo = int(str(data.get('tempo', 120)))
                if not (40 <= tempo <= 300): raise ValueError("Tempo out of range")
            except ValueError:
                return jsonify(error='Invalid tempo value (must be integer 40-300)'), 400

            songs_data = read_json(songs_path, SONGS_CACHE_KEY)
            if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
                logging.warning(f"Songs data file '{songs_path}' corrupted or has wrong structure. Resetting.")
                songs_data = {'songs': []}
            new_song = {'id': get_next_id(songs_data['songs']), 'name': name, 'tempo': tempo, 'audio_tracks': []}
            songs_data['songs'].append(new_song)

            if write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                return jsonify(new_song), 201
            else:
                return jsonify(error="Failed to save new song"), 500
        except Exception as e:
            logging.error(f"Error creating song: {e}")
            return jsonify(error="Internal server error"), 500
    elif request.method == 'DELETE':
        try:
            logging.warning("Attempting to delete ALL songs and audio files...")
            audio_player.stop()
            if not write_json(songs_path, {'songs': []}, SONGS_CACHE_KEY):
                return jsonify(error="Failed to clear songs data file"), 500

            setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            updated_setlists = False
            if 'setlists' in setlists_data and isinstance(setlists_data.get('setlists'), list):
                for slist in setlists_data['setlists']:
                    if isinstance(slist, dict) and slist.get('song_ids'):
                        slist['song_ids'] = []
                        updated_setlists = True
                if updated_setlists:
                    if not write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                        logging.error("Failed to update setlists after deleting all songs.")

            deleted_files, errors = 0, []
            audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
            if os.path.exists(audio_folder_path):
                for filename in os.listdir(audio_folder_path):
                    file_path = os.path.join(audio_folder_path, filename)
                    try:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                            deleted_files += 1
                    except Exception as e:
                        errors.append(f"Failed to delete {filename}: {e}")
                        logging.error(f"Error deleting file {filename} during delete all: {e}")

            if errors: logging.error(f"Errors during audio file deletion: {errors}")
            message = f'All songs cleared.'
            if updated_setlists: message += ' All setlists emptied.'
            message += f' {deleted_files} audio files deleted.'
            if errors: message += f' Errors occurred: {len(errors)} file(s) could not be deleted.'
            return jsonify(success=True, message=message)
        except Exception as e:
            logging.error(f"Error deleting all songs: {e}")
            return jsonify(error="Internal server error during delete all"), 500

    try:
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)
        if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
            logging.warning(f"Songs data file '{songs_path}' has invalid structure during GET. Returning empty list.")
            return jsonify(songs=[])
        return jsonify(songs_data)
    except Exception as e:
        logging.error(f"Error reading songs: {e}")
        return jsonify(error="Could not retrieve songs"), 500


@app.route('/api/songs/<int:song_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_song(song_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
        logging.error(f"Songs data file '{songs_path}' corrupted or missing for ID {song_id}.")
        return jsonify(error='Songs data file is corrupted or missing'), 500

    song_index = next((i for i, s in enumerate(songs_data['songs']) if isinstance(s, dict) and s.get('id') == song_id),
                      -1)
    if song_index == -1: return jsonify(error='Song not found'), 404
    song = songs_data['songs'][song_index]

    if request.method == 'GET':
        return jsonify(song)
    elif request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400
            updated = False
            if 'name' in data:
                name = str(data['name'] or '').strip()
                if not name: return jsonify(error='Song name cannot be empty'), 400
                if song.get('name') != name: song['name'] = name; updated = True
            if 'tempo' in data:
                try:
                    tempo = int(data['tempo'])
                    if not (40 <= tempo <= 300): raise ValueError("Tempo out of range")
                except (ValueError, TypeError):
                    return jsonify(error='Invalid tempo value (must be integer 40-300)'), 400
                if song.get('tempo') != tempo: song['tempo'] = tempo; updated = True

            # ---- NEW: Handle audio_tracks update ----
            if 'audio_tracks' in data:
                new_tracks_data = data.get('audio_tracks')
                if not isinstance(new_tracks_data, list):
                    return jsonify(error='Invalid audio_tracks format, must be a list'), 400

                validated_tracks = []
                # Basic validation for each track - ensure file_path exists, etc.
                # More robust validation would check if the file_path actually exists in AUDIO_UPLOAD_FOLDER
                for track_data in new_tracks_data:
                    if not isinstance(track_data, dict) or 'file_path' not in track_data:
                        return jsonify(error='Invalid track data: missing file_path'), 400
                    # Ensure essential keys and types, provide defaults if necessary
                    validated_track = {
                        'id': track_data.get('id', get_next_id(validated_tracks + song.get('audio_tracks', []))),
                        # Ensure unique ID
                        'file_path': str(track_data['file_path']),
                        'output_channel': int(track_data.get('output_channel', 1)),
                        'volume': float(track_data.get('volume', 1.0)),
                        'is_stereo': bool(track_data.get('is_stereo', False))
                    }
                    # Add more validation if needed (e.g., channel range, volume range)
                    validated_tracks.append(validated_track)

                # Simple replacement of tracks. More complex logic (merge, preserve IDs) might be needed for advanced cases.
                if song.get('audio_tracks') != validated_tracks:  # Check if there's an actual change
                    song['audio_tracks'] = validated_tracks
                    updated = True
            # ---- END NEW ----

            if updated:
                # Invalidate player's preload if this song was preloaded
                if audio_player._preloaded_song_id == song_id:
                    audio_player.clear_preload_state()
                    logging.info(f"Cleared preloaded data for song {song_id} due to update.")

                if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                    return jsonify(error="Failed to save updated song data"), 500
            return jsonify(song)
        except Exception as e:
            logging.error(f"Error updating song {song_id}: {e}")
            return jsonify(error="Internal server error"), 500
    elif request.method == 'DELETE':
        try:
            logging.info(f"Attempting to delete song ID: {song_id}")
            files_to_maybe_delete = {t.get('file_path') for t in song.get('audio_tracks', []) if
                                     isinstance(t, dict) and t.get('file_path')}
            del songs_data['songs'][song_index]
            if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                return jsonify(error="Failed to save song data after deletion"), 500

            setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            updated_setlists = False
            if 'setlists' in setlists_data and isinstance(setlists_data.get('setlists'), list):
                for setlist_item in setlists_data['setlists']:
                    if isinstance(setlist_item, dict) and isinstance(setlist_item.get('song_ids'), list):
                        original_len = len(setlist_item['song_ids'])
                        setlist_item['song_ids'] = [sid for sid in setlist_item['song_ids'] if sid != song_id]
                        if len(setlist_item['song_ids']) != original_len:
                            updated_setlists = True
                if updated_setlists:
                    if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                        logging.info(f"Removed song ID {song_id} from setlists.")
                    else:
                        logging.error("Failed to save updated setlists after song deletion.")

            all_other_files = {
                track.get('file_path')
                for other_song in songs_data.get('songs', []) if
                isinstance(other_song, dict) and isinstance(other_song.get('audio_tracks'), list)
                for track in other_song['audio_tracks'] if isinstance(track, dict) and track.get('file_path')
            }
            deleted_files_count, delete_errors = 0, []
            audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
            for filename in files_to_maybe_delete:
                if filename and filename not in all_other_files:
                    try:
                        file_path = os.path.join(audio_folder_path, filename)
                        if os.path.exists(file_path) and (os.path.isfile(file_path) or os.path.islink(file_path)):
                            os.unlink(file_path)
                            deleted_files_count += 1
                            logging.info(f"  Deleted unused audio file: {filename}")
                    except Exception as e:
                        delete_errors.append(f"Error deleting {filename}: {e}")
                        logging.error(f"Error deleting file {filename} for song {song_id}: {e}")
                elif filename:
                    logging.debug(f"Skipping deletion of file '{filename}', used by other songs.")

            if delete_errors: logging.error(f"Errors deleting audio files for song {song_id}: {delete_errors}")
            message = f'Song deleted.'
            if deleted_files_count > 0: message += f' {deleted_files_count} unique audio file(s) deleted.'
            if delete_errors: message += f' Errors occurred: {len(delete_errors)} file(s) could not be deleted.'
            return jsonify(success=True, message=message)
        except Exception as e:
            logging.error(f"Error deleting song {song_id}: {e}");
            traceback.print_exc()
            return jsonify(error="Internal server error during deletion"), 500
    return None  # Should not be reached


@app.route('/api/songs/<int:song_id>/upload', methods=['POST'])
def upload_song_tracks(song_id):
    if 'files[]' not in request.files: return jsonify(error='No files part'), 400
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '': return jsonify(error='No selected files'), 400

    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
        logging.error(f"Songs data file problem during upload for song {song_id}.")
        return jsonify(error='Songs data file error'), 500
    song = next((s for s in songs_data['songs'] if isinstance(s, dict) and s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404
    if 'audio_tracks' not in song or not isinstance(song.get('audio_tracks'), list): song['audio_tracks'] = []

    results, errors = [], []
    existing_filenames_in_song = {t.get('file_path') for t in song['audio_tracks'] if
                                  isinstance(t, dict) and t.get('file_path')}
    audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
    os.makedirs(audio_folder_path, exist_ok=True)

    new_tracks_added = False
    for file in files:
        if file and file.filename and allowed_file(file.filename):
            try:
                filename = secure_filename(file.filename)
                if not filename: errors.append(f"Invalid filename from '{file.filename}'."); continue
                if filename in existing_filenames_in_song:
                    errors.append(f"Track '{filename}' already exists for this song.");
                    continue
                file.save(os.path.join(audio_folder_path, filename))
                new_track = {
                    'id': get_next_id(song['audio_tracks']), 'file_path': filename,
                    'output_channel': 1, 'volume': 1.0, 'is_stereo': False
                }
                song['audio_tracks'].append(new_track)
                results.append(new_track)
                existing_filenames_in_song.add(filename)
                new_tracks_added = True
                logging.info(f"Uploaded and added track: {filename} to song ID {song_id}")
            except Exception as e:
                errors.append(f"Error saving file {file.filename}: {e}")
                logging.error(f"Error saving file {file.filename} during upload: {e}")
        elif file and file.filename:
            errors.append(f"File type not allowed: {file.filename}")

    if new_tracks_added:
        if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
            return jsonify(error="Failed to save updated song data after upload"), 500
    status_code = 200 if not errors else (400 if not results else 207)
    response_data = {'success': len(errors) == 0 and len(results) > 0, 'tracks': results}
    if errors: response_data['errors'] = errors
    return jsonify(response_data), status_code


@app.route('/api/songs/<int:song_id>/tracks/<int:track_id>', methods=['PUT', 'DELETE'])
def update_or_delete_track(song_id, track_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
        logging.error(f"Songs data file problem during track update/delete for song {song_id}.")
        return jsonify(error='Songs data file error'), 500
    song = next((s for s in songs_data['songs'] if isinstance(s, dict) and s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404
    if 'audio_tracks' not in song or not isinstance(song.get('audio_tracks'), list): song['audio_tracks'] = []

    track_index = next(
        (i for i, t in enumerate(song['audio_tracks']) if isinstance(t, dict) and t.get('id') == track_id), -1)
    if track_index == -1: return jsonify(error='Track not found'), 404
    track = song['audio_tracks'][track_index]

    if request.method == 'PUT':
        try:
            data = request.json
            if not data: return jsonify(error='Invalid request body'), 400
            updated = False
            if 'output_channel' in data:
                try:
                    channel = int(str(data['output_channel']))
                    if not (1 <= channel <= MAX_LOGICAL_CHANNELS): raise ValueError("Channel out of range")
                except (ValueError, TypeError):
                    return jsonify(error=f'Invalid output channel (1-{MAX_LOGICAL_CHANNELS})'), 400
                if track.get('output_channel') != channel: track['output_channel'] = channel; updated = True
            if 'volume' in data:
                try:
                    volume = float(data['volume'])
                    clamped_vol = max(0.0, min(2.0, volume))
                except (ValueError, TypeError):
                    return jsonify(error='Invalid volume value'), 400
                if track.get('volume') != clamped_vol: track['volume'] = clamped_vol; updated = True
            if 'is_stereo' in data:
                is_stereo = bool(data['is_stereo'])
                if track.get('is_stereo') != is_stereo: track['is_stereo'] = is_stereo; updated = True
            if updated:
                if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                    return jsonify(error="Failed to save updated track data"), 500
            return jsonify(success=True, track=track)
        except Exception as e:
            logging.error(f"Error updating track {track_id} for song {song_id}: {e}")
            return jsonify(error="Internal server error"), 500
    elif request.method == 'DELETE':
        try:
            filename_to_delete = track.get('file_path')
            logging.info(f"Deleting track ID: {track_id} (File: {filename_to_delete}) from song ID: {song_id}")
            del song['audio_tracks'][track_index]
            if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                return jsonify(error="Failed to save song data after track removal"), 500

            file_deleted = False;
            delete_error = None
            if filename_to_delete:
                is_used_elsewhere = any(
                    t.get('file_path') == filename_to_delete
                    for s_item in songs_data.get('songs', []) if
                    isinstance(s_item, dict) and isinstance(s_item.get('audio_tracks'), list)
                    for t in s_item['audio_tracks'] if isinstance(t, dict)
                )
                if not is_used_elsewhere:
                    try:
                        audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
                        file_path = os.path.join(audio_folder_path, filename_to_delete)
                        if os.path.exists(file_path) and (os.path.isfile(file_path) or os.path.islink(file_path)):
                            os.unlink(file_path)
                            file_deleted = True
                            logging.info(f"  Deleted unused audio file: {filename_to_delete}")
                    except Exception as e:
                        delete_error = f"Error deleting file {filename_to_delete}: {e}"
                        logging.error(delete_error)
                else:
                    logging.debug(f"  Audio file '{filename_to_delete}' not deleted, used elsewhere.")
            message = 'Track removed.' + (' Associated file deleted.' if file_deleted else '')
            if delete_error: message += f' File deletion error: {delete_error}'
            return jsonify(success=True, message=message)
        except Exception as e:
            logging.error(f"Error deleting track {track_id} for song {song_id}: {e}");
            traceback.print_exc()
            return jsonify(error="Internal server error during track deletion"), 500


@app.route('/api/settings/audio_device', methods=['GET', 'PUT'])
def audio_device_settings():
    settings_path = os.path.join(DATA_DIR, SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400
            if not isinstance(data.get('audio_outputs'), list): return jsonify(
                error="Missing 'audio_outputs' list"), 400
            if 'volume' not in data: return jsonify(error="Missing 'volume'"), 400
            if 'sample_rate' not in data: return jsonify(error="Missing 'sample_rate'"), 400

            new_audio_outputs = data['audio_outputs']
            new_volume = data['volume']
            new_sample_rate = data['sample_rate']
            validated_outputs, all_logical_channels = [], set()

            for i, mapping in enumerate(new_audio_outputs):
                if not isinstance(mapping, dict) or 'device_id' not in mapping or 'channels' not in mapping:
                    return jsonify(error=f'Invalid format for mapping {i}'), 400
                device_id = mapping.get('device_id')
                channels = mapping.get('channels')
                if not isinstance(device_id, int): return jsonify(error=f'Invalid device_id in mapping {i}'), 400
                if not isinstance(channels, list): return jsonify(error=f'Invalid channels list in mapping {i}'), 400
                current_mapping_channels = set()
                for ch_idx, ch_val in enumerate(channels):
                    if not isinstance(ch_val, int) or not (1 <= ch_val <= MAX_LOGICAL_CHANNELS):
                        return jsonify(
                            error=f'Invalid logical channel {ch_val} (1-{MAX_LOGICAL_CHANNELS}) in mapping {i}'), 400
                    if ch_val in all_logical_channels: return jsonify(error=f'Duplicate logical channel {ch_val}'), 400
                    if ch_val in current_mapping_channels: return jsonify(
                        error=f'Logical channel {ch_val} duplicated in mapping for device {device_id}'), 400
                    try:
                        _, max_ch_dev = _get_device_details(device_id)
                        if ch_idx >= max_ch_dev:
                            logging.warning(
                                f"Logical channel {ch_val} mapped to physical index {ch_idx} might exceed device {device_id}'s max channels ({max_ch_dev})")
                    except Exception:
                        pass
                    current_mapping_channels.add(ch_val)
                all_logical_channels.update(current_mapping_channels)
                try:
                    sd.query_devices(device=device_id if device_id >= 0 else None, kind='output')
                except (ValueError, sd.PortAudioError, IndexError) as e:
                    return jsonify(error=f'Audio device ID {device_id} not found or invalid: {e}'), 400
                validated_outputs.append({'device_id': device_id, 'channels': channels})
            try:
                validated_volume = max(0.0, min(1.0, float(new_volume)))
            except (ValueError, TypeError):
                return jsonify(error='Invalid volume value (0.0-1.0)'), 400
            try:
                validated_sample_rate = int(new_sample_rate)
                if validated_sample_rate <= 0: raise ValueError("Sample rate must be positive")
            except (ValueError, TypeError):
                return jsonify(error=f'Invalid sample rate: {new_sample_rate}'), 400

            current_settings = read_json(settings_path, SETTINGS_CACHE_KEY)
            current_settings['audio_outputs'] = validated_outputs
            current_settings['volume'] = validated_volume
            current_settings['sample_rate'] = validated_sample_rate
            if write_json(settings_path, current_settings, SETTINGS_CACHE_KEY):
                audio_player.load_settings()
                logging.info(
                    f"Saved audio settings: {validated_outputs}, Vol: {validated_volume}, SR: {validated_sample_rate} Hz")
                return jsonify(success=True, saved_config=validated_outputs, saved_volume=validated_volume,
                               saved_sample_rate=validated_sample_rate)
            else:
                return jsonify(error="Failed to write settings file"), 500
        except Exception as e:
            logging.error(f"Error saving audio settings: {e}");
            traceback.print_exc()
            return jsonify(error=f'Internal server error: {str(e)}'), 500

    try:
        settings = read_json(settings_path, SETTINGS_CACHE_KEY)
        current_config = settings.get('audio_outputs', [])
        current_volume = settings.get('volume', 1.0)
        current_sample_rate = settings.get('sample_rate', DEFAULT_SAMPLE_RATE)
        available_devices = []
        try:
            devices = sd.query_devices()
            default_output_id = sd.default.device[1] if isinstance(sd.default.device, (list, tuple)) and len(
                sd.default.device) > 1 else -1
            for i, dev in enumerate(devices):
                if isinstance(dev, dict) and dev.get('max_output_channels', 0) > 0:
                    available_devices.append({
                        'id': i,
                        'name': f"{dev.get('name', f'Unnamed Device {i}')}{' (Default)' if i == default_output_id else ''}",
                        'max_output_channels': dev.get('max_output_channels', 0),
                        'default_samplerate': dev.get('default_samplerate', 'N/A')
                    })
        except Exception as e_query:
            logging.error(f"Could not query audio devices: {e_query}")
        return jsonify(
            available_devices=available_devices, current_config=current_config,
            volume=current_volume, current_sample_rate=current_sample_rate,
            supported_sample_rates=SUPPORTED_SAMPLE_RATES
        )
    except Exception as e:
        logging.error(f"Error getting audio settings: {e}")
        return jsonify(
            available_devices=[], current_config=[], volume=1.0,
            current_sample_rate=DEFAULT_SAMPLE_RATE, supported_sample_rates=SUPPORTED_SAMPLE_RATES,
            error=f'Could not load audio settings: {str(e)}'
        ), 500


@app.route('/api/settings/open_directory', methods=['POST'])
def open_directory():
    audio_dir = os.path.abspath(os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER))
    try:
        if not os.path.isdir(audio_dir):
            logging.error(f"Audio directory not found: {audio_dir}")
            return jsonify(success=False, error=f'Directory not found: {audio_dir}'), 404
        logging.info(f"Attempting to open directory: {audio_dir}")
        if sys.platform == 'win32':
            subprocess.run(['explorer', audio_dir], check=True)
        elif sys.platform == 'darwin':
            subprocess.run(['open', audio_dir], check=True)
        else:
            subprocess.run(['xdg-open', audio_dir], check=True)
        return jsonify(success=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        logging.error(f"Failed to open directory '{audio_dir}': {e}")
        return jsonify(success=False, error=f"Command failed to open directory: {e}"), 500
    except Exception as e:
        logging.error(f"Unexpected error opening directory '{audio_dir}': {e}")
        return jsonify(success=False, error=f"Failed to open directory: {str(e)}"), 500


@app.route('/api/clear_cache', methods=['POST'])
def clear_cache_route():
    try:
        cache.clear()
        logging.info("Server-side cache cleared via API.")
        return jsonify(success=True, message='Server-side cache cleared.')
    except Exception as e:
        logging.error(f"Error clearing cache: {e}")
        return jsonify(success=False, message=f'Error clearing cache: {e}'), 500


@app.route('/api/factory_reset', methods=['POST'])
def factory_reset():
    logging.warning("--- Initiating Factory Reset ---")
    success_status = True;
    error_messages = [];
    deleted_files = 0;
    deleted_files_errors = []
    try:
        audio_player.stop();
        logging.info("Audio playback stopped.")
        initialize_app();
        logging.info("Default settings files re-initialized.")

        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        if write_json(songs_path, {'songs': []}, SONGS_CACHE_KEY):
            logging.info(f"{SONGS_FILE} cleared.")
        else:
            logging.error(f"Failed to clear {SONGS_FILE}."); error_messages.append(
                f"Failed to clear {SONGS_FILE}"); success_status = False
        if write_json(setlists_path, {'setlists': []}, SETLISTS_CACHE_KEY):
            logging.info(f"{SETLISTS_FILE} cleared.")
        else:
            logging.error(f"Failed to clear {SETLISTS_FILE}."); error_messages.append(
                f"Failed to clear {SETLISTS_FILE}"); success_status = False

        cache.clear();
        logging.info("Explicit cache clear performed.")
        audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
        if os.path.exists(audio_folder_path):
            logging.info(f"Deleting files in {audio_folder_path}...")
            for filename in os.listdir(audio_folder_path):
                file_path = os.path.join(audio_folder_path, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path);
                        deleted_files += 1
                except Exception as e:
                    deleted_files_errors.append(f"Failed to delete {filename}: {e}")
                    logging.error(f"Error during factory reset file deletion: {e}")
            if deleted_files_errors:
                logging.error(f"Errors during factory reset file deletion: {deleted_files_errors}")
                error_messages.extend(deleted_files_errors);
                success_status = False
            logging.info(f"Deleted {deleted_files} audio files.")
        else:
            logging.info(f"Audio folder {audio_folder_path} not found, skipping deletion.")
        audio_player.load_settings();
        logging.info("Audio player settings reloaded.")

        message = 'Factory reset finished.'
        if success_status:
            message += f' Settings, Songs, Setlists reset. {deleted_files} audio files deleted.'
            logging.warning("--- Factory Reset Complete (Success) ---")
            return jsonify(success=True, message=message)
        else:
            message += f' Issues occurred. Errors: {"; ".join(error_messages)}'
            logging.warning(f"--- Factory Reset Complete (Partial Failure) --- Errors: {error_messages}")
            return jsonify(success=False, message=message, errors=error_messages), 500
    except Exception as e:
        logging.error(f"CRITICAL error during factory reset: {e}");
        traceback.print_exc()
        return jsonify(success=False, error=f"Critical error during factory reset: {str(e)}"), 500


@app.route('/api/setlists/<int:setlist_id>/control', methods=['POST'])
def control_setlist(setlist_id):
    try:
        data = request.json
        action = data.get('action')
        current_index = data.get('current_index', 0)
        if not isinstance(current_index, int): current_index = 0

        setlist, _ = _get_setlist_and_songs_data(setlist_id)  # Songs data not needed here

        if not setlist:
            return jsonify(error='Setlist not found'), 404

        song_ids = setlist.get('song_ids', [])
        if not isinstance(song_ids, list):
            logging.error(f"Invalid song_ids format in setlist {setlist_id}: {song_ids}")
            return jsonify(error='Setlist song data invalid'), 500
        num_songs = len(song_ids)

        if action == 'stop':
            audio_player.stop()
            return jsonify(success=True, action='stopped')
        elif action == 'next':
            if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400
            next_index = current_index + 1
            if next_index >= num_songs:
                audio_player.stop();
                logging.info(f"End of setlist {setlist_id} reached.")
                return jsonify(success=True, action='end_of_setlist_reached', current_song_index=current_index,
                               message='End of setlist.')
            else:
                return jsonify(success=True, action='next', current_song_index=next_index,
                               current_song_id=song_ids[next_index])
        elif action == 'previous':
            if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400
            prev_index = current_index - 1
            if prev_index < 0:
                return jsonify(success=False, error='Already at the first song'), 400
            else:
                return jsonify(success=True, action='previous', current_song_index=prev_index,
                               current_song_id=song_ids[prev_index])
        else:
            return jsonify(error=f'Invalid action: {action}'), 400
    except Exception as e:
        logging.error(f"Error in setlist control for {setlist_id}: {e}");
        traceback.print_exc()
        return jsonify(error="Internal server error"), 500


# Place this function somewhere before it's first used by the routes,
# for example, after your other helper functions like read_json or get_next_id.

def _get_setlist_and_songs_data(setlist_id, fetch_songs=False):
    setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
    setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
    setlist = next((s for s in setlists_data.get('setlists', []) if isinstance(s, dict) and s.get('id') == setlist_id),
                   None)

    if not setlist:
        return None, None

    songs_data_content = None
    if fetch_songs:
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        songs_data_content = read_json(songs_path, SONGS_CACHE_KEY)
        # It's good practice to ensure songs_data_content is a dict with 'songs' list
        if not isinstance(songs_data_content, dict) or 'songs' not in songs_data_content:
            logging.warning(f"Songs data file '{SONGS_FILE}' has invalid structure. Defaulting to empty.")
            songs_data_content = {'songs': []}

    return setlist, songs_data_content


@app.route('/api/setlists/<int:setlist_id>/play', methods=['POST'])
def play_setlist_song(setlist_id):
    data = request.get_json()
    try:
        current_song_index = data.get('current_song_index', 0)
        if not isinstance(current_song_index, int) or current_song_index < 0:
            return jsonify(error='Invalid song index'), 400

        setlist, songs_data = _get_setlist_and_songs_data(setlist_id, fetch_songs=True)

        if not setlist:
            return jsonify(error='Setlist not found'), 404
        # songs_data is now available and guaranteed to be a dict with a 'songs' list if fetch_songs=True

        song_ids = setlist.get('song_ids', [])
        if not isinstance(song_ids, list) or current_song_index >= len(song_ids):
            return jsonify(error='Invalid song index for this setlist'), 400

        song_id_to_play = song_ids[current_song_index]
        # Find the song details from the songs_data
        song_to_play = next(
            (s for s in songs_data.get('songs', []) if isinstance(s, dict) and s.get('id') == song_id_to_play), None)
        if not song_to_play:
            logging.error(f"Song ID {song_id_to_play} from setlist {setlist_id} not found in library.")
            return jsonify(error=f'Song ID {song_id_to_play} not found in library'), 404
        # ... (rest of the function remains the same)
        success = audio_player.play_song_directly(song_id_to_play)
        if success:
            song_duration_seconds = calculate_song_duration(song_to_play)
            return jsonify(success=True, current_song_index=current_song_index, current_song_id=song_id_to_play,
                           song_name=song_to_play.get('name', 'N/A'), song_tempo=song_to_play.get('tempo', 120),
                           duration=song_duration_seconds)
        else:
            logging.error(f"AudioPlayer failed to play song {song_id_to_play}.")
            return jsonify(success=False, error='Failed to start playback. Check logs.'), 500
    except Exception as e:
        logging.error(f"Error playing setlist {setlist_id} song index {data.get('current_song_index', 'N/A')}: {e}");
        traceback.print_exc()
        return jsonify(success=False, error='Internal server error during playback.'), 500


@app.route('/api/setlists/<int:setlist_id>/song/<int:song_id_to_preload>/preload', methods=['POST'])
def preload_setlist_song(setlist_id, song_id_to_preload):
    try:
        logging.info(f"Preload request for Setlist: {setlist_id}, Song: {song_id_to_preload}")
        audio_player.load_settings()
        success = audio_player.preload_song(song_id_to_preload)
        if success:
            songs_path = os.path.join(DATA_DIR, SONGS_FILE)
            songs_data = read_json(songs_path, SONGS_CACHE_KEY)
            song_details = next(
                (s for s in songs_data.get('songs', []) if isinstance(s, dict) and s.get('id') == song_id_to_preload),
                None)
            song_name = song_details.get('name', 'Unknown Song') if song_details else 'Unknown Song'
            logging.info(
                f"Successfully preloaded Song ID: {song_id_to_preload} ('{song_name}') for Setlist ID: {setlist_id}")
            return jsonify(success=True, message=f"Song '{song_name}' preloaded.", preloaded_song_id=song_id_to_preload)
        else:
            logging.error(f"Failed to preload Song ID: {song_id_to_preload} for Setlist ID: {setlist_id}.")
            return jsonify(success=False, error=f"Failed to preload song ID {song_id_to_preload}. See logs."), 500
    except Exception as e:
        logging.error(f"Error during explicit song preload for Setlist {setlist_id}, Song {song_id_to_preload}: {e}");
        traceback.print_exc()
        return jsonify(success=False, error="Internal server error during song preload."), 500


@app.route('/api/stop', methods=['POST'])
def stop_player():
    try:
        audio_player.stop()
        return jsonify(success=True, message='Playback stopped.')
    except Exception as e:
        logging.error(f"Error stopping player via API: {e}")
        return jsonify(success=False, error='Failed to stop playback'), 500


@app.route('/')
def index(): return render_template('index.html')


@app.route('/setlists')
def setlists_page():
    try:
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        return render_template('setlists.html', setlists=setlists_data.get('setlists', []))
    except Exception as e:
        logging.error(f"Error loading setlists page: {str(e)}")
        return render_template('error.html', message="Error loading setlists data."), 500


@app.route('/songs')
def songs_page():
    try:
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)
        return render_template('songs.html', songs=songs_data.get('songs', []))
    except Exception as e:
        logging.error(f"Error loading songs page: {str(e)}")
        return render_template('error.html', message="Error loading songs data."), 500


@app.route('/settings')
def settings_page():
    try:
        return render_template('settings.html')
    except Exception as e:
        logging.error(f"Error loading settings page template: {str(e)}")
        return render_template('error.html', message="Error loading settings page."), 500


@app.route('/setlists/<int:setlist_id>/play')  # This is a GET route for rendering the page
def play_setlist_page(setlist_id):
    try:
        setlist, songs_data = _get_setlist_and_songs_data(setlist_id, fetch_songs=True)

        if not setlist:
            abort(404)  # Setlist not found

        # songs_data is now available and guaranteed to be a dict with a 'songs' list if fetch_songs=True
        # Build map of songs for quick lookup
        song_map = {s['id']: s for s in songs_data.get('songs', []) if isinstance(s, dict) and 'id' in s}

        songs_in_setlist_with_details = []
        for song_id_in_setlist in setlist.get('song_ids', []):  # Corrected variable name here
            song_detail = song_map.get(song_id_in_setlist)  # Corrected variable name here
            if song_detail:
                duration_sec = calculate_song_duration(song_detail)
                songs_in_setlist_with_details.append({
                    'id': song_detail['id'],
                    'name': song_detail.get('name', 'Unnamed Song'),
                    'tempo': song_detail.get('tempo', 120),
                    'duration': duration_sec
                })
            else:
                logging.warning(
                    f"Warning: Song ID {song_id_in_setlist} in setlist {setlist_id} not found in library during page load.")
        return render_template('setlist_player.html', setlist=setlist, songs=songs_in_setlist_with_details)
    except Exception as e:
        logging.error(f"Error loading setlist player page {setlist_id}: {str(e)}")
        traceback.print_exc()
        return render_template('error.html', message="Error loading setlist player."), 500


@app.route('/static/audio/<path:filename>')
def serve_audio(filename):
    try:
        audio_folder_path = os.path.abspath(os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER))
        safe_path = os.path.abspath(os.path.join(audio_folder_path, filename))
        if not safe_path.startswith(audio_folder_path):
            logging.warning(f"Directory traversal attempt blocked for audio: {filename}");
            abort(404)
        return send_from_directory(audio_folder_path, filename, as_attachment=False)
    except FileNotFoundError:
        logging.warning(f"Audio file not found: {filename}"); abort(404)
    except Exception as e:
        logging.error(f"Error serving audio file {filename}: {e}"); abort(500)


@app.template_filter('format_duration')
def format_duration_filter(seconds):
    """Format seconds into MM:SS."""
    try:
        if seconds is None: return "0:00"
        seconds = int(float(seconds))
        if seconds < 0: seconds = 0
        minutes = seconds // 60
        seconds %= 60
        return f"{minutes}:{seconds:02d}"
    except (ValueError, TypeError):
        return "0:00"
