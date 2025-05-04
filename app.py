import json
import sys
import subprocess
import os
import gc
import threading
import traceback
import logging # Import logging
from pathlib import Path
from collections import defaultdict
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_from_directory, render_template, abort
import sounddevice as sd
import soundfile as sf
import numpy as np
from flask_caching import Cache

app = Flask(__name__)

# --- Constants ---
AUDIO_UPLOAD_FOLDER = os.path.join(app.root_path, 'static/audio')
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'aiff'}
DATA_DIR = os.path.join(app.root_path, 'data')
SONGS_FILE = 'songs.json'
SETLISTS_FILE = 'setlists.json'
SETTINGS_FILE = 'settings.json'
MIDI_SETTINGS_FILE = 'midi_settings.json' # Also used for keyboard shortcuts
DATA_TYPE = 'float32'
DEFAULT_SAMPLE_RATE = 44100
DEFAULT_CHANNELS = 2
MAX_LOGICAL_CHANNELS = 16
SUPPORTED_SAMPLE_RATES = [44100, 48000, 88200, 96000] # Common sample rates

# Cache Keys
SONGS_CACHE_KEY = 'songs_data'
SETLISTS_CACHE_KEY = 'setlists_data'
SETTINGS_CACHE_KEY = 'settings_data'
MIDI_SETTINGS_CACHE_KEY = 'midi_settings_data'

# --- Global State ---
# Ensure thread safety for accessing these shared resources
playback_lock = threading.Lock()
active_streams = []
playback_threads = []

# --- Logging Setup ---
logging.basicConfig(level=logging.DEBUG) # Use DEBUG for more verbose cache messages

# --- Cache Configuration ---
config = {
    "DEBUG": True,
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 300 # Default 5 minutes
}
app.config.from_mapping(config)
cache = Cache(app) # Initialize cache instance


# --- Initialization ---
def initialize_app():
    print("Initializing application...")
    Path('data').mkdir(exist_ok=True)
    Path(AUDIO_UPLOAD_FOLDER).mkdir(exist_ok=True)
    # Use _init_settings_file which now uses write_json (clears cache)
    # Add default sample_rate to settings
    _init_settings_file(SETTINGS_FILE, {
        'audio_outputs': [],
        'volume': 1.0,
        'sample_rate': DEFAULT_SAMPLE_RATE # <-- Added default sample rate
    })
    _init_settings_file(MIDI_SETTINGS_FILE, {
        'enabled': False,
        'shortcuts': {
            'play_pause': 'Space', 'stop': 'Escape',
            'next': 'ArrowRight', 'previous': 'ArrowLeft'
        },
        'midi_mappings': {}, 'midi_input_device': None
    })
    # Optionally initialize songs and setlists if they might be missing
    _init_settings_file(SONGS_FILE, {'songs': []})
    _init_settings_file(SETLISTS_FILE, {'setlists': []})
    print("Initialization complete.")

# Updated to use write_json
def _init_settings_file(file_name, default_data):
    file_path = os.path.join(DATA_DIR, file_name)
    cache_key = None
    if file_name == SETTINGS_FILE: cache_key = SETTINGS_CACHE_KEY
    elif file_name == MIDI_SETTINGS_FILE: cache_key = MIDI_SETTINGS_CACHE_KEY
    elif file_name == SONGS_FILE: cache_key = SONGS_CACHE_KEY
    elif file_name == SETLISTS_FILE: cache_key = SETLISTS_CACHE_KEY

    if not os.path.exists(file_path):
        logging.info(f"File '{file_path}' not found. Creating default.")
        if cache_key:
            # Use write_json to create the file and clear potential stale cache
            if write_json(file_path, default_data, cache_key):
                logging.info(f"Default file {file_name} created and cache key '{cache_key}' handled.")
            else:
                logging.error(f"ERROR: Could not create settings file {file_path}")
                sys.exit(f"Failed to initialize critical file: {file_path}")
        else: # Fallback if no cache key defined (shouldn't happen with current setup)
             try:
                 os.makedirs(os.path.dirname(file_path), exist_ok=True)
                 with open(file_path, 'w', encoding='utf-8') as f:
                     json.dump(default_data, f, indent=2)
             except IOError as e:
                 logging.error(f"ERROR: Could not create settings file {file_path} (no cache key method): {e}")
                 sys.exit(f"Failed to initialize critical file: {file_path}")

# --- Helper Functions ---
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Updated read_json with Caching ---
def read_json(file_path, cache_key):
    """Safely read JSON data from a file, using cache, returning defaults on error."""
    # Try cache first
    cached_data = cache.get(cache_key)
    if cached_data is not None:
        logging.debug(f"Cache hit for key '{cache_key}'.")
        return cached_data
    logging.info(f"Cache miss for key '{cache_key}'. Reading from '{file_path}'.") # Use INFO for misses

    # Determine default based on file path
    if file_path.endswith(SONGS_FILE):
        default_value = {'songs': []}
    elif file_path.endswith(SETLISTS_FILE):
        default_value = {'setlists': []}
    elif file_path.endswith(SETTINGS_FILE):
        # Include default sample_rate here too
        default_value = {
            'audio_outputs': [],
            'volume': 1.0,
            'sample_rate': DEFAULT_SAMPLE_RATE # <-- Added default sample rate
        }
    elif file_path.endswith(MIDI_SETTINGS_FILE):
        default_value = {'enabled': False, 'shortcuts': {}, 'midi_mappings': {}, 'midi_input_device': None}
    else:
        default_value = {} # Generic default

    if not os.path.exists(file_path):
        logging.warning(f"File not found {file_path}. Returning default and caching default value for 60s.")
        cache.set(cache_key, default_value, timeout=60) # Cache default for 1 min
        return default_value

    try:
        with open(file_path, 'r', encoding='utf-8') as f: # Ensure UTF-8
            data = json.load(f)
        # Ensure required keys exist in loaded settings data, add defaults if missing
        if file_path.endswith(SETTINGS_FILE):
            data.setdefault('audio_outputs', default_value['audio_outputs'])
            data.setdefault('volume', default_value['volume'])
            data.setdefault('sample_rate', default_value['sample_rate'])
        elif file_path.endswith(MIDI_SETTINGS_FILE):
            data.setdefault('enabled', default_value['enabled'])
            data.setdefault('shortcuts', default_value['shortcuts'])
            data.setdefault('midi_mappings', default_value['midi_mappings'])
            data.setdefault('midi_input_device', default_value['midi_input_device'])

        cache.set(cache_key, data) # Cache successfully read data
        logging.debug(f"Data read from '{file_path}' and stored in cache key '{cache_key}'.")
        return data
    except json.JSONDecodeError:
        logging.error(f"Could not decode JSON from {file_path}. Returning default and caching default value for 60s.")
        cache.set(cache_key, default_value, timeout=60) # Cache default for 1 min
        return default_value
    except IOError as e:
        logging.error(f"Could not read file {file_path}: {e}. Returning default and caching default value for 60s.")
        cache.set(cache_key, default_value, timeout=60) # Cache default for 1 min
        return default_value

# --- Updated write_json with Cache Invalidation ---
def write_json(file_path, data, cache_key):
    """Writes JSON data and invalidates the cache."""
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f: # Ensure UTF-8
            json.dump(data, f, indent=2)
        logging.debug(f"Successfully wrote to '{file_path}'. Invalidating cache key '{cache_key}'.")
        cache.delete(cache_key) # <-- Cache invalidation
        return True
    except IOError as e:
        logging.error(f"ERROR: Could not write to file {file_path}: {e}")
        return False
    except TypeError as e:
        # This can happen if data is not JSON serializable (e.g., contains sets)
        logging.error(f"ERROR: Could not serialize data for writing to {file_path}: {e}")
        return False

def get_next_id(items):
    # Ensure items is a list of dictionaries with 'id' keys
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
            # Use sf.info to avoid reading the whole file just for duration
            info = sf.info(file_path_abs)
            duration = info.duration
            if duration > max_duration:
                max_duration = duration
        except FileNotFoundError:
            logging.warning(f"Audio file not found for duration calculation: {file_path_rel}")
            pass # Ignore missing files for duration calc
        except Exception as e:
            # Log other errors (like invalid file format)
            if not isinstance(e, FileNotFoundError):
                 logging.error(f"Error getting duration for {track.get('file_path', 'N/A')}: {e}")
            continue # Skip track if error
    return max_duration

# --- Audio Playback Thread Function ---
def _play_on_stream(stream: sd.OutputStream, audio_buffer: np.ndarray):
    # Target function for playback threads. Handles writing and cleanup.
    device_info = f"Device {stream.device}" if stream.device is not None else "Default Device"
    try:
        stream.write(audio_buffer)
        logging.debug(f"Stream {device_info} finished writing.")
    except sd.PortAudioError as pae:
        # Log specific PortAudio errors, often happens on stop/abort
        # Ignore "Internal PortAudio error" which is common on abort (-9986)
        if pae.args and pae.args[0] != -9986:
             logging.warning(f"PortAudioError during playback on {device_info}: {pae}")
        # else: pass # Ignore common abort error
    except Exception as e:
        logging.error(f"ERROR during playback on {device_info}: {e}")
        # traceback.print_exc() # Uncomment for detailed debugging
    finally:
        # Ensure stream is closed even if write fails or finishes early
        try:
            # Check if stream is still open before closing
            if not stream.closed:
                stream.close(ignore_errors=True)
                logging.debug(f"Stream {device_info} closed.")
        except Exception as e:
             logging.error(f"ERROR closing stream {device_info}: {e}")
        gc.collect()

# --- Audio Player Class ---
class AudioPlayer:
    # Handles loading, preparing, and playing audio tracks across multiple devices.
    def __init__(self):
        self.audio_outputs = []
        self.global_volume = 1.0
        self.target_sample_rate = DEFAULT_SAMPLE_RATE # Initialize target sample rate
        self.load_settings() # Initial load

    # Updated to use cached read_json and load sample rate
    def load_settings(self):
        """Loads audio output configuration and sample rate from settings file using cached read."""
        filepath = os.path.join(DATA_DIR, SETTINGS_FILE)
        settings = read_json(filepath, SETTINGS_CACHE_KEY) # Pass cache key

        loaded_outputs = settings.get('audio_outputs', [])
        loaded_volume = settings.get('volume', 1.0)
        loaded_sample_rate = settings.get('sample_rate', DEFAULT_SAMPLE_RATE) # Load sample rate

        # Validate loaded data
        if not isinstance(loaded_outputs, list):
            logging.warning("Warning: 'audio_outputs' in settings is not a list. Using empty config.")
            self.audio_outputs = []
        else:
            # Basic validation of structure
            self.audio_outputs = [
                out for out in loaded_outputs
                if isinstance(out, dict) and 'device_id' in out and 'channels' in out
            ]
            if len(self.audio_outputs) != len(loaded_outputs):
                 logging.warning("Warning: Some invalid entries removed from 'audio_outputs'.")

        try:
             # Clamp volume between 0.0 and 1.0 (or maybe 2.0 if allowing boost?)
             self.global_volume = max(0.0, min(1.0, float(loaded_volume)))
        except (ValueError, TypeError):
             logging.warning(f"Warning: Invalid 'volume' in settings: {loaded_volume}. Using 1.0.")
             self.global_volume = 1.0

        # Validate and set sample rate
        try:
             sr = int(loaded_sample_rate)
             # Optional: Check against a list of known good rates, though device support varies
             if sr <= 0: # Basic sanity check
                 raise ValueError("Sample rate must be positive")
             self.target_sample_rate = sr
        except (ValueError, TypeError):
             logging.warning(f"Warning: Invalid 'sample_rate' in settings: {loaded_sample_rate}. Using default {DEFAULT_SAMPLE_RATE} Hz.")
             self.target_sample_rate = DEFAULT_SAMPLE_RATE

        logging.debug(f"AudioPlayer settings loaded: {len(self.audio_outputs)} outputs, Volume: {self.global_volume}, Sample Rate: {self.target_sample_rate} Hz")


    def _get_device_details(self, device_id):
        # Safely get device samplerate and max channels, handling errors.
        # NOTE: This samplerate is the DEVICE's default, not necessarily the one we will use.
        try:
            if device_id is None or device_id < 0: # Use default device
                device_info = sd.query_devices(kind='output')
                if device_info and isinstance(device_info, dict): # query_devices returns dict for default
                    sr = int(device_info.get('default_samplerate', DEFAULT_SAMPLE_RATE))
                    ch = int(device_info.get('max_output_channels', DEFAULT_CHANNELS))
                    return sr, ch
                else:
                    logging.warning("Warning: No default output device found or invalid info.")
                    return DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS
            else: # Query specific device
                 device_info = sd.query_devices(device_id)
                 # Check if device_info is a dictionary (it should be)
                 if isinstance(device_info, dict):
                      sr = int(device_info.get('default_samplerate', DEFAULT_SAMPLE_RATE))
                      ch = int(device_info.get('max_output_channels', DEFAULT_CHANNELS))
                      return sr, ch
                 else:
                      logging.warning(f"Warning: Query for device {device_id} returned unexpected type: {type(device_info)}. Using defaults.")
                      return DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS
        except (ValueError, sd.PortAudioError, IndexError, TypeError) as e:
            logging.warning(f"Warning: Could not query device {device_id}: {e}. Using fallback defaults ({DEFAULT_SAMPLE_RATE} Hz, {DEFAULT_CHANNELS} Ch).")
            return DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS

    def _build_logical_channel_map(self):
        # Builds a map from logical channel numbers to (device_id, physical_idx).
        # Now uses the sample rate loaded from settings (self.target_sample_rate).
        logical_channel_map = {}
        # The target sample rate is now determined by load_settings()
        # target_sample_rate = self.target_sample_rate # Use the rate loaded from settings
        logging.debug(f"  Using target sample rate from settings: {self.target_sample_rate} Hz")

        for mapping in self.audio_outputs: # Use the loaded settings
            device_id = mapping.get('device_id')
            logical_channels = mapping.get('channels', [])
            # Basic validation
            if device_id is None or not isinstance(logical_channels, list):
                logging.warning(f"Skipping invalid mapping: {mapping}")
                continue

            # Removed logic determining sample rate from first device.

            # Map logical channels for this device
            for physical_idx, logical_channel in enumerate(logical_channels):
                 if isinstance(logical_channel, int) and logical_channel >= 1:
                      if logical_channel in logical_channel_map:
                           logging.warning(f"Warning: Logical channel {logical_channel} is mapped multiple times. Using last definition (Device: {device_id}, Physical Idx: {physical_idx}).")
                      logical_channel_map[logical_channel] = (device_id, physical_idx)
                 else:
                      logging.warning(f"Warning: Invalid logical channel '{logical_channel}' in mapping for device {device_id}. Skipping.")

        # Return the map and the sample rate loaded from settings
        return logical_channel_map, self.target_sample_rate

    # Updated play_song to use cached reads and loaded sample rate
    def play_song(self, song_id):
        # Loads, prepares, and starts playback for a given song ID.
        global active_streams, playback_threads, playback_lock
        logging.info(f"\n--- Play Request: Song ID {song_id} ---")

        with playback_lock:
            logging.debug("  Playback lock acquired.")
            # 1. Stop existing playback
            self._stop_internal()

            # 2. Load song data and settings (using cached reads)
            # Settings load happens first to get the correct target sample rate
            self.load_settings() # Reload in case changed (uses cache internally)
            songs_path = os.path.join(DATA_DIR, SONGS_FILE)
            songs_data = read_json(songs_path, SONGS_CACHE_KEY) # Use cache
            song = next((s for s in songs_data.get('songs', []) if isinstance(s, dict) and s.get('id') == song_id), None)

            if not song or not isinstance(song.get('audio_tracks'), list):
                logging.error(f"ERROR: Song {song_id} not found or has no valid tracks.")
                return False # Lock released by 'with'
            if not self.audio_outputs:
                logging.error("ERROR: No audio output devices configured.")
                return False # Lock released

            logging.info(f"  Starting playback for '{song.get('name', 'N/A')}'...")

            # 3. Build channel map and GET target sample rate (now from self.target_sample_rate)
            logical_channel_map, target_sample_rate = self._build_logical_channel_map()
            # target_sample_rate is now guaranteed to be set from load_settings

            logging.info(f"  Target Playback Sample Rate: {target_sample_rate} Hz") # Log the rate being used

            # 4. Process tracks (load, resample, group)
            tracks_to_play = defaultdict(list) # Group tracks by target device_id
            all_audio_data = {} # Local cache for audio file data within this playback {filepath: (data, sr)}
            max_length = 0 # Max length across all tracks in samples (after resampling)

            for track in song['audio_tracks']:
                # Check track validity
                if not isinstance(track, dict) or not track.get('file_path'):
                     logging.warning(f"Skipping invalid track entry in song {song_id}: {track}")
                     continue

                try:
                    # --- Extract and Validate Track Properties ---
                    logical_channel_1 = int(track.get('output_channel', 1))
                    is_stereo_flag = bool(track.get('is_stereo', False))
                    volume = float(track.get('volume', 1.0)) * self.global_volume
                    file_path_rel = track.get('file_path') # Already checked it exists
                    file_path_abs = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER, file_path_rel)

                    if not os.path.exists(file_path_abs):
                        logging.warning(f"Audio file not found for track: {file_path_rel}. Skipping.")
                        continue

                    # --- Map Logical Channel to Physical Device/Channel ---
                    target_device_id, physical_channel_1 = logical_channel_map.get(logical_channel_1, (None, -1))
                    if target_device_id is None:
                        logging.warning(f"Logical channel {logical_channel_1} for track '{file_path_rel}' is not mapped to any device. Skipping.")
                        continue

                    # --- Validate Stereo Mapping (if requested) ---
                    physical_channel_2 = -1 # Default to mono
                    is_effectively_stereo = False
                    if is_stereo_flag:
                        logical_channel_2 = logical_channel_1 + 1 # Stereo uses the next logical channel
                        dev2, phys2_temp = logical_channel_map.get(logical_channel_2, (None, -1))
                        # Check if L+1 maps to the SAME device and the NEXT physical channel
                        if dev2 == target_device_id and phys2_temp == physical_channel_1 + 1:
                             physical_channel_2 = phys2_temp
                             is_effectively_stereo = True
                        else:
                             logging.warning(f"Stereo requested for track '{file_path_rel}' on logical channel {logical_channel_1}, "
                                             f"but channel {logical_channel_2} is not mapped to the next physical channel on the same device ({target_device_id}). Playing as mono.")

                    # --- Load/Cache Audio Data ---
                    if file_path_abs not in all_audio_data:
                        logging.debug(f"    Loading audio file: {file_path_rel}")
                        data, sr = sf.read(file_path_abs, dtype=DATA_TYPE, always_2d=True) # Always 2D for easier handling
                        all_audio_data[file_path_abs] = (data, sr)
                    else:
                        logging.debug(f"    Using cached audio data for: {file_path_rel}")
                        data, sr = all_audio_data[file_path_abs]

                    # --- Resample if Necessary ---
                    if sr != target_sample_rate:
                        logging.debug(f"    Resampling {file_path_rel} from {sr} Hz to {target_sample_rate} Hz")
                        num_samples = int(len(data) * target_sample_rate / sr)
                        x_old = np.linspace(0, 1, len(data), endpoint=False) # endpoint=False is often better for interp
                        x_new = np.linspace(0, 1, num_samples, endpoint=False)
                        resampled = np.zeros((num_samples, data.shape[1]), dtype=DATA_TYPE)
                        for i in range(data.shape[1]):
                            resampled[:, i] = np.interp(x_new, x_old, data[:, i])
                        data = resampled
                        del resampled # Free memory
                        gc.collect()
                    # else: # Log if no resampling needed
                    #    logging.debug(f"    Sample rate matches target ({target_sample_rate} Hz) for {file_path_rel}. No resampling needed.")


                    # --- Select Mono/Stereo data based on effective mapping ---
                    play_as_stereo = is_effectively_stereo and data.shape[1] >= 2
                    if play_as_stereo:
                        final_data = data[:, :2] # Take first two channels if source has more
                    else:
                        # Mix down to mono if source is stereo but target is mono
                        if data.shape[1] > 1:
                            final_data = np.mean(data, axis=1, keepdims=True) * 0.707 # Mixdown (sqrt(0.5) scaling)
                        else:
                            final_data = data # Already mono

                    # --- Update Max Length and Store Prepared Track Data ---
                    current_length = len(final_data)
                    if current_length > max_length:
                        max_length = current_length

                    tracks_to_play[target_device_id].append({
                        'data': final_data,
                        'volume': volume,
                        'physical_channel_1': physical_channel_1,
                        'physical_channel_2': physical_channel_2, # Only relevant if play_as_stereo is True
                        'play_as_stereo': play_as_stereo,
                        'file_path': file_path_rel # For logging/debugging
                    })
                    logging.debug(f"    Prepared track '{file_path_rel}' for device {target_device_id} "
                                 f"(PhysCh: {physical_channel_1}{f', {physical_channel_2}' if play_as_stereo else ''}, "
                                 f"Stereo: {play_as_stereo}, Len: {current_length})")

                except Exception as e:
                    logging.error(f"ERROR processing track {track.get('file_path', 'N/A')}: {e}")
                    traceback.print_exc() # Print stack trace for debugging
                    continue # Skip faulty track

            # 5. Create Buffers and Start Streams
            if not tracks_to_play:
                logging.error("ERROR: No tracks could be prepared for playback (check mappings and file paths).")
                del all_audio_data; gc.collect()
                return False # Lock released

            logging.debug(f"  Mixing audio buffers. Max length: {max_length} samples.")
            temp_streams = []
            temp_threads = []

            for device_id, device_tracks in tracks_to_play.items():
                try:
                    # Determine required device channels based on highest mapped physical channel
                    max_phys_ch_used = -1
                    for t in device_tracks:
                        max_phys_ch_used = max(max_phys_ch_used, t['physical_channel_1'])
                        if t['play_as_stereo']:
                            max_phys_ch_used = max(max_phys_ch_used, t['physical_channel_2'])

                    # Get actual device channels - max_phys_ch_used might exceed this
                    _, actual_device_channels = self._get_device_details(device_id)

                    if actual_device_channels <= 0: # Check for 0 or negative channels
                        logging.warning(f"  Skipping device {device_id}: Reported {actual_device_channels} output channels.")
                        continue

                    # Use the actual number of channels the device has for the buffer/stream
                    buffer_channels = actual_device_channels
                    if max_phys_ch_used >= buffer_channels:
                         logging.warning(f"  Warning: Device {device_id} has {buffer_channels} channels, "
                                         f"but mapping requires channel index {max_phys_ch_used}. "
                                         f"Tracks mapped to higher channels will be ignored or cause errors.")
                         # Proceed, but higher channels won't be played correctly

                    # --- Create Buffer ---
                    # Use float64 for mixing to avoid clipping intermediate sums, then convert back
                    output_buffer_mix = np.zeros((max_length, buffer_channels), dtype=np.float64)

                    # --- Mix Tracks into Buffer ---
                    for track in device_tracks:
                        play_stereo = track['play_as_stereo']
                        ch1, ch2 = track['physical_channel_1'], track['physical_channel_2']
                        t_data, t_vol = track['data'], track['volume']
                        t_len = len(t_data)
                        len_to_copy = min(t_len, max_length) # Copy up to buffer length

                        # Check if target channels are within the device's actual channels
                        ch1_in_bounds = 0 <= ch1 < buffer_channels # Physical channel index is 0-based
                        ch2_in_bounds = play_stereo and (0 <= ch2 < buffer_channels)

                        if play_stereo and ch1_in_bounds and ch2_in_bounds:
                             # Add stereo track data to respective channels
                             output_buffer_mix[:len_to_copy, ch1] += t_data[:len_to_copy, 0] * t_vol
                             output_buffer_mix[:len_to_copy, ch2] += t_data[:len_to_copy, 1] * t_vol
                        elif ch1_in_bounds:
                             # Add mono track data (or left channel if stereo source played as mono)
                             mono_data = t_data[:, 0]
                             output_buffer_mix[:len_to_copy, ch1] += mono_data[:len_to_copy] * t_vol
                        else:
                             # Log if primary channel is out of bounds
                             if not ch1_in_bounds:
                                 logging.warning(f"  Track '{track['file_path']}' target physical channel {ch1} "
                                                 f"is out of bounds for device {device_id} "
                                                 f"({buffer_channels} channels). Skipping mixing for this track.")
                             # Log if stereo requested but second channel is out of bounds
                             elif play_stereo and not ch2_in_bounds:
                                 logging.warning(f"  Stereo track '{track['file_path']}' target physical channel {ch2} "
                                                 f"is out of bounds for device {device_id} "
                                                 f"({buffer_channels} channels). Playing channel {ch1} as mono.")
                                 # Fallback to playing only the first channel if it's in bounds
                                 mono_data = t_data[:, 0]
                                 output_buffer_mix[:len_to_copy, ch1] += mono_data[:len_to_copy] * t_vol


                    # --- Normalize and Convert Buffer ---
                    if output_buffer_mix.size == 0:
                        logging.warning(f"  Output buffer for device {device_id} is empty. Skipping stream creation.")
                        continue

                    peak = np.max(np.abs(output_buffer_mix))
                    if peak > 1.0:
                        logging.debug(f"  Normalizing buffer for device {device_id} (peak: {peak:.2f})")
                        output_buffer_mix /= peak
                    elif peak == 0:
                         logging.warning(f"  Output buffer for device {device_id} is silent.")
                         # Optionally skip creating stream for silent buffers
                         # continue

                    # Convert back to target data type for playback
                    output_buffer_final = output_buffer_mix.astype(DATA_TYPE)
                    del output_buffer_mix # Free memory
                    gc.collect()

                    # --- Start Stream ---
                    # Use the target_sample_rate derived from settings
                    logging.debug(f"  Creating OutputStream for device {device_id} (Samplerate: {target_sample_rate}, Channels: {buffer_channels})")
                    stream = sd.OutputStream(
                        device=device_id if device_id >= 0 else None, # Use None for default device
                        samplerate=target_sample_rate, # <-- Use the rate from settings
                        channels=buffer_channels,
                        dtype=DATA_TYPE,
                        blocksize=2048, # Keep blocksize, adjust if needed
                        latency='low' # Often more stable for long playback - Changed to 'low' as 'high' often gives errors
                    )
                    stream.start()
                    thread = threading.Thread(target=_play_on_stream, args=(stream, output_buffer_final), name=f"PlaybackThread-Dev{device_id}")
                    thread.daemon = True # Ensure threads exit when main app exits
                    thread.start()
                    temp_streams.append(stream)
                    temp_threads.append(thread)
                    logging.debug(f"  Stream started for device {device_id}.")

                except sd.PortAudioError as pae:
                    # Check if error is due to unsupported sample rate
                    if "Invalid sample rate" in str(pae):
                         logging.error(f"PortAudioError: Device {device_id} does not support sample rate {target_sample_rate} Hz. {pae}")
                    else:
                         logging.error(f"PortAudioError setting up playback for device {device_id} (Rate: {target_sample_rate} Hz): {pae}")
                    # Attempt to cleanup if stream object exists
                    if 'stream' in locals() and stream:
                        try: stream.abort(ignore_errors=True); stream.close(ignore_errors=True)
                        except: pass # Ignore cleanup errors
                    continue # Try next device
                except Exception as e:
                    logging.error(f"Unexpected ERROR setting up playback for device {device_id} (Rate: {target_sample_rate} Hz): {e}")
                    traceback.print_exc()
                    if 'stream' in locals() and stream:
                        try: stream.abort(ignore_errors=True); stream.close(ignore_errors=True)
                        except: pass
                    continue # Try next device

            # 6. Update global lists (still inside the lock)
            active_streams.extend(temp_streams)
            playback_threads.extend(temp_threads)

            # Cleanup
            del all_audio_data # Release audio data cache
            del tracks_to_play
            # output_buffer_final might still be referenced by threads, GC will handle it
            gc.collect()

            if not temp_streams:
                logging.warning("--- Playback initiation failed: No streams were successfully started. ---")
                return False # Indicate failure
            else:
                logging.info(f"--- Playback initiated for {len(temp_streams)} device(s) ---")
                return True # Indicate success

            # Lock released automatically by 'with' statement


    def _stop_internal(self):
        # Internal stop function, assumes lock is already held.
        global active_streams, playback_threads
        if not active_streams:
            logging.debug("  Stop request: No active streams found.")
            return

        logging.info(f"  Stopping {len(active_streams)} active streams...")
        streams_to_stop = list(active_streams) # Copy list to avoid modification issues during iteration
        threads_to_wait_for = list(playback_threads)

        active_streams.clear() # Clear global lists immediately
        playback_threads.clear()

        for stream in streams_to_stop:
            try:
                # Abort tells the stream to stop processing ASAP
                if not stream.closed:
                    stream.abort(ignore_errors=True)
                    logging.debug(f"  Aborted stream for device {stream.device}.")
                # Closing happens in the thread's finally block, ensuring write finishes/stops first.
            except Exception as e:
                device_info = f"Device {stream.device}" if stream.device is not None else "Default Device"
                logging.error(f"  Error aborting stream {device_info}: {e}")

        # Optional: Wait briefly for threads to finish cleanup (adjust timeout as needed)
        # join_timeout = 1.0 # seconds
        # for thread in threads_to_wait_for:
        #      try:
        #          thread.join(timeout=join_timeout)
        #          if thread.is_alive():
        #               logging.warning(f"  Playback thread {thread.name} did not finish within {join_timeout}s.")
        #      except Exception as e:
        #           logging.error(f"  Error joining thread {thread.name}: {e}")

        logging.debug("  Stream stop process complete.")
        gc.collect()

    def stop(self):
        # Stops all currently active audio streams (acquires lock).
        global playback_lock
        logging.info("\n--- Stop Request ---")
        with playback_lock:
             self._stop_internal()
        logging.info("--- Playback stopped ---")

    def is_playing(self):
        # Checks if any stream is currently active (acquires lock).
        global active_streams, playback_lock
        with playback_lock:
            # Check both the list and the stream status just in case
            if not active_streams: return False
            for stream in active_streams:
                 try:
                     # stream.active can be unreliable after stop/abort,
                     # better to rely on the active_streams list management?
                     # For now, keep the check but rely more on list emptiness
                     if not stream.closed and stream.active:
                          return True
                 except sd.PortAudioError: pass # Stream might already be invalid
                 except Exception as e: logging.error(f"Error checking stream activity: {e}")
            # If loops finishes, no active stream found OR active_streams might be populated
            # but streams failed. Relying on active_streams being cleared in stop should be robust.
            return len(active_streams) > 0


# --- Instantiate Player ---
initialize_app() # Ensure files/dirs exist before creating player
audio_player = AudioPlayer()

# --- Flask Routes ---

# --- Updated Routes to use Cache Keys ---

@app.route('/api/settings/keyboard', methods=['GET', 'PUT'])
def keyboard_settings():
    settings_path = os.path.join(DATA_DIR, MIDI_SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error="Invalid request body"), 400
            # Use cached read
            current_settings = read_json(settings_path, MIDI_SETTINGS_CACHE_KEY)

            # Ensure top-level keys exist if missing
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
                    # Simple update - replace whole dict
                    if current_settings['shortcuts'] != data['shortcuts']:
                         current_settings['shortcuts'] = data['shortcuts']
                         updated = True
                else:
                    return jsonify(error='Invalid shortcuts format, must be a dictionary'), 400

            if updated:
                # Use cached write
                if not write_json(settings_path, current_settings, MIDI_SETTINGS_CACHE_KEY):
                    return jsonify(error="Failed to write settings file"), 500

            # Return the current state after potential update
            return jsonify(success=True, settings={
                'enabled': current_settings.get('enabled'),
                'shortcuts': current_settings.get('shortcuts')
            })

        except Exception as e:
            logging.error(f"Error updating keyboard settings: {e}")
            return jsonify(error=str(e)), 500

    # GET method
    try:
        # Use cached read
        settings = read_json(settings_path, MIDI_SETTINGS_CACHE_KEY)
        # Return only the relevant parts for this endpoint
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

            # Use cached read
            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            # Ensure structure is valid
            if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
                 logging.warning(f"Setlists data file '{setlists_path}' corrupted or has wrong structure. Resetting.")
                 setlists_data = {'setlists': []}

            new_setlist = {'id': get_next_id(setlists_data['setlists']), 'name': name, 'song_ids': song_ids }
            setlists_data['setlists'].append(new_setlist)

            # Use cached write
            if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                return jsonify(new_setlist), 201
            else:
                return jsonify(error="Failed to save setlist data"), 500
        except Exception as e:
             logging.error(f"Error creating setlist: {e}")
             return jsonify(error="Internal server error"), 500

    # GET method
    try:
        # Use cached read
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        # Basic validation before returning
        if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
            logging.warning(f"Setlists data file '{setlists_path}' has invalid structure during GET. Returning empty list.")
            return jsonify(setlists=[])
        return jsonify(setlists_data) # Return the whole structure { "setlists": [...] }
    except Exception as e:
         logging.error(f"Error reading setlists: {e}")
         return jsonify(error="Could not retrieve setlists"), 500


@app.route('/api/setlists/<int:setlist_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_setlist(setlist_id):
    setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
    # Use cached read
    setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
    if 'setlists' not in setlists_data or not isinstance(setlists_data.get('setlists'), list):
        logging.error(f"Setlists data file '{setlists_path}' corrupted or missing during access for ID {setlist_id}.")
        return jsonify(error='Setlist data file is corrupted or missing'), 500

    setlist_index = -1
    for i, s in enumerate(setlists_data['setlists']):
         # Add type check for robustness
         if isinstance(s, dict) and s.get('id') == setlist_id:
              setlist_index = i
              break

    if setlist_index == -1:
        return jsonify(error='Setlist not found'), 404

    setlist = setlists_data['setlists'][setlist_index] # Get the specific setlist dict

    if request.method == 'GET':
        return jsonify(setlist) # Return only the specific setlist

    elif request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400

            updated = False
            if 'name' in data:
                 name = str(data['name']).strip() # Ensure string and strip
                 if not name: return jsonify(error='Setlist name cannot be empty'), 400
                 if setlist.get('name') != name:
                      setlist['name'] = name
                      updated = True

            if 'song_ids' in data:
                 song_ids = data.get('song_ids')
                 # Validate it's a list of integers
                 if not isinstance(song_ids, list) or not all(isinstance(sid, int) for sid in song_ids):
                      return jsonify(error='Invalid song_ids format, must be a list of integers'), 400
                 # Compare sets for order-independent check if needed, or lists for order-dependent
                 if setlist.get('song_ids', []) != song_ids: # Keep order check
                      setlist['song_ids'] = song_ids
                      updated = True

            if updated:
                # Use cached write
                if not write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                    return jsonify(error="Failed to save updated setlist data"), 500
            return jsonify(setlist) # Return potentially updated setlist
        except Exception as e:
             logging.error(f"Error updating setlist {setlist_id}: {e}")
             return jsonify(error="Internal server error"), 500

    elif request.method == 'DELETE':
        try:
            del setlists_data['setlists'][setlist_index]
            # Use cached write
            if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                return jsonify(success=True, message="Setlist deleted")
            else:
                # If write fails, the in-memory list was modified but file wasn't.
                # This is problematic. Maybe re-read data on failure?
                # For now, just report error.
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

            name = str(data.get('name') or 'New Song').strip() or 'New Song' # Ensure string
            tempo_str = str(data.get('tempo', 120)) # Ensure it's a string for isdigit check
            # More robust tempo check
            try:
                 tempo = int(tempo_str)
                 if not (40 <= tempo <= 300):
                      raise ValueError("Tempo out of range")
            except ValueError:
                 return jsonify(error='Invalid tempo value (must be integer 40-300)'), 400

            # Use cached read
            songs_data = read_json(songs_path, SONGS_CACHE_KEY)
            if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
                 logging.warning(f"Songs data file '{songs_path}' corrupted or has wrong structure. Resetting.")
                 songs_data = {'songs': []}

            new_song = {'id': get_next_id(songs_data['songs']), 'name': name, 'tempo': tempo, 'audio_tracks': []}
            songs_data['songs'].append(new_song)

            # Use cached write
            if write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                return jsonify(new_song), 201
            else:
                return jsonify(error="Failed to save new song"), 500
        except Exception as e:
             logging.error(f"Error creating song: {e}")
             return jsonify(error="Internal server error"), 500

    elif request.method == 'DELETE': # Delete ALL songs
        try:
            logging.warning("Attempting to delete ALL songs and audio files...")
            audio_player.stop()

            # Clear songs data file using cached write
            if not write_json(songs_path, {'songs': []}, SONGS_CACHE_KEY):
                 # Might fail if file permissions changed etc.
                 return jsonify(error="Failed to clear songs data file"), 500

            # Also need to clear setlists that might contain deleted song IDs
            setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            updated_setlists = False
            if 'setlists' in setlists_data and isinstance(setlists_data.get('setlists'), list):
                 for slist in setlists_data['setlists']:
                      if isinstance(slist, dict) and slist.get('song_ids'): # Check if song_ids exists and is not empty
                           slist['song_ids'] = [] # Clear song IDs from all setlists
                           updated_setlists = True
                 if updated_setlists:
                      if not write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                           logging.error("Failed to update setlists after deleting all songs (clearing song_ids).")
                           # Continue deletion, but log the error

            # Delete audio files (use with caution!)
            deleted_files, errors = 0, []
            audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
            if os.path.exists(audio_folder_path):
                for filename in os.listdir(audio_folder_path):
                    file_path = os.path.join(audio_folder_path, filename)
                    try:
                        # Make sure it's a file and not a directory (e.g., .gitkeep)
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                             os.unlink(file_path)
                             deleted_files += 1
                        # else: skip directories
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

    # GET method
    try:
        # Use cached read
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)
        if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
            logging.warning(f"Songs data file '{songs_path}' has invalid structure during GET. Returning empty list.")
            return jsonify(songs=[])
        return jsonify(songs_data) # Return {"songs": [...]}
    except Exception as e:
        logging.error(f"Error reading songs: {e}")
        return jsonify(error="Could not retrieve songs"), 500


@app.route('/api/songs/<int:song_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_song(song_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    # Use cached read
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
        logging.error(f"Songs data file '{songs_path}' corrupted or missing during access for ID {song_id}.")
        return jsonify(error='Songs data file is corrupted or missing'), 500

    song_index = next((i for i, s in enumerate(songs_data['songs']) if isinstance(s, dict) and s.get('id') == song_id), -1)
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
                name = str(data['name'] or '').strip() # Ensure string and strip
                if not name: return jsonify(error='Song name cannot be empty'), 400
                if song.get('name') != name: song['name'] = name; updated = True
            if 'tempo' in data:
                # Ensure tempo is valid integer 40-300
                try:
                     tempo = int(data['tempo'])
                     if not (40 <= tempo <= 300): raise ValueError("Tempo out of range")
                except (ValueError, TypeError):
                     return jsonify(error='Invalid tempo value (must be integer 40-300)'), 400
                if song.get('tempo') != tempo: song['tempo'] = tempo; updated = True

            if updated:
                # Use cached write
                if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                     return jsonify(error="Failed to save updated song data"), 500
            return jsonify(song)
        except Exception as e:
             logging.error(f"Error updating song {song_id}: {e}")
             return jsonify(error="Internal server error"), 500

    elif request.method == 'DELETE':
        try:
            logging.info(f"Attempting to delete song ID: {song_id}")
            # Keep track of files associated with this song BEFORE deleting it
            files_to_maybe_delete = {t.get('file_path') for t in song.get('audio_tracks', []) if isinstance(t, dict) and t.get('file_path')}

            # Remove song from data
            del songs_data['songs'][song_index]
            # Use cached write to save the updated song list
            if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                 # If saving fails, the song is gone from memory but not disk - problematic
                 # Maybe revert the deletion from songs_data? For now, report error.
                 return jsonify(error="Failed to save song data after deletion"), 500

            # Remove song ID from setlists
            setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
            # Re-read setlists using cache (might have changed)
            setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
            updated_setlists = False
            if 'setlists' in setlists_data and isinstance(setlists_data.get('setlists'), list):
                for setlist in setlists_data['setlists']:
                    # Check if setlist is a dict and has song_ids list
                    if isinstance(setlist, dict) and isinstance(setlist.get('song_ids'), list):
                        original_len = len(setlist['song_ids'])
                        # Filter out the deleted song ID
                        setlist['song_ids'] = [sid for sid in setlist['song_ids'] if sid != song_id]
                        if len(setlist['song_ids']) != original_len:
                             updated_setlists = True
                if updated_setlists:
                    # Save setlists using cached write
                    if write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY):
                         logging.info(f"Removed song ID {song_id} from setlists.")
                    else: # Log error but continue deletion process
                         logging.error("Failed to save updated setlists after song deletion.")

            # Delete associated audio files (Check if used by *remaining* songs first!)
            # songs_data is already updated (song deleted)
            all_other_files = set()
            for other_song in songs_data.get('songs', []): # Use the already modified list
                 if isinstance(other_song, dict) and isinstance(other_song.get('audio_tracks'), list):
                      for track in other_song['audio_tracks']:
                           if isinstance(track, dict) and track.get('file_path'):
                                all_other_files.add(track['file_path'])

            deleted_files_count, delete_errors = 0, []
            audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
            for filename in files_to_maybe_delete:
                 if filename and filename not in all_other_files: # Only delete if not used elsewhere
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
             logging.error(f"Error deleting song {song_id}: {e}")
             traceback.print_exc()
             return jsonify(error="Internal server error during deletion"), 500


@app.route('/api/songs/<int:song_id>/upload', methods=['POST'])
def upload_song_tracks(song_id):
    if 'files[]' not in request.files:
        return jsonify(error='No files part in the request'), 400
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '': # Check if first file has empty filename
         return jsonify(error='No selected files'), 400

    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    # Use cached read
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
         logging.error(f"Songs data file '{songs_path}' corrupted or missing during upload for song {song_id}.")
         return jsonify(error='Songs data file is corrupted or missing'), 500
    song = next((s for s in songs_data['songs'] if isinstance(s, dict) and s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404

    # Ensure audio_tracks list exists and is a list
    if 'audio_tracks' not in song or not isinstance(song.get('audio_tracks'), list):
         song['audio_tracks'] = []

    results, errors = [], []
    # Get filenames already in *this specific song* to avoid adding exact duplicates to it
    existing_filenames_in_song = {t.get('file_path') for t in song['audio_tracks'] if isinstance(t,dict) and t.get('file_path')}
    audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
    os.makedirs(audio_folder_path, exist_ok=True) # Ensure folder exists

    new_tracks_added = False
    for file in files:
        # Check file object and filename validity
        if file and file.filename and allowed_file(file.filename):
            try:
                # Sanitize filename
                filename = secure_filename(file.filename)
                if not filename: # secure_filename might return empty string
                     errors.append(f"Invalid filename derived from '{file.filename}'.")
                     continue

                # Check if this exact filename is already a track *in this song*
                if filename in existing_filenames_in_song:
                     errors.append(f"Track '{filename}' already exists for this song.")
                     continue # Skip adding duplicates for the same song

                # Proceed with saving
                file_path = os.path.join(audio_folder_path, filename)
                file.save(file_path) # Overwrites if file exists globally from another song

                # Create new track entry
                new_track = {
                    'id': get_next_id(song['audio_tracks']),
                    'file_path': filename,
                    'output_channel': 1, # Default output channel
                    'volume': 1.0,       # Default volume
                    'is_stereo': False   # Default mono
                 }
                song['audio_tracks'].append(new_track)
                results.append(new_track)
                existing_filenames_in_song.add(filename) # Add to set for subsequent checks in this request
                new_tracks_added = True
                logging.info(f"Uploaded and added track: {filename} to song ID {song_id}")
            except Exception as e:
                errors.append(f"Error saving file {file.filename}: {e}")
                logging.error(f"Error saving file {file.filename} during upload: {e}")
        elif file and file.filename:
            errors.append(f"File type not allowed: {file.filename}")

    if new_tracks_added: # Save only if new tracks were actually added
        # Use cached write
        if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
            # If save fails, the files are on disk but not in JSON - problematic
            return jsonify(error="Failed to save updated song data after upload"), 500

    status_code = 200 if not errors else (400 if not results else 207) # OK, Bad Request, or Multi-Status
    response_data = {'success': len(errors) == 0 and len(results) > 0, 'tracks': results} # Adjust success logic
    if errors: response_data['errors'] = errors
    return jsonify(response_data), status_code


@app.route('/api/songs/<int:song_id>/tracks/<int:track_id>', methods=['PUT', 'DELETE'])
def update_or_delete_track(song_id, track_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    # Use cached read
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    if 'songs' not in songs_data or not isinstance(songs_data.get('songs'), list):
         logging.error(f"Songs data file '{songs_path}' corrupted or missing during track update/delete for song {song_id}.")
         return jsonify(error='Songs data file is corrupted or missing'), 500
    song = next((s for s in songs_data['songs'] if isinstance(s, dict) and s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404
    if 'audio_tracks' not in song or not isinstance(song.get('audio_tracks'), list): song['audio_tracks'] = [] # Ensure list exists

    track_index = next((i for i, t in enumerate(song['audio_tracks']) if isinstance(t, dict) and t.get('id') == track_id), -1)
    if track_index == -1: return jsonify(error='Track not found'), 404
    track = song['audio_tracks'][track_index]

    if request.method == 'PUT':
        try:
            data = request.json
            if not data: return jsonify(error='Invalid request body'), 400
            updated = False
            if 'output_channel' in data:
                channel_str = str(data['output_channel'])
                try:
                     channel = int(channel_str)
                     # Use MAX_LOGICAL_CHANNELS+1 because channel numbers are 1-based
                     if not (1 <= channel <= MAX_LOGICAL_CHANNELS): raise ValueError("Channel out of range")
                except (ValueError, TypeError):
                     return jsonify(error=f'Invalid output channel (must be integer 1-{MAX_LOGICAL_CHANNELS})'), 400
                if track.get('output_channel') != channel: track['output_channel'] = channel; updated = True

            if 'volume' in data:
                try:
                    volume = float(data['volume'])
                    clamped_vol = max(0.0, min(2.0, volume)) # Allow up to 200% volume
                except (ValueError, TypeError): return jsonify(error='Invalid volume value, must be a number'), 400
                if track.get('volume') != clamped_vol: track['volume'] = clamped_vol; updated = True

            if 'is_stereo' in data:
                is_stereo = bool(data['is_stereo'])
                if track.get('is_stereo') != is_stereo: track['is_stereo'] = is_stereo; updated = True

            if updated:
                # Use cached write
                if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                    return jsonify(error="Failed to save updated track data"), 500
            return jsonify(success=True, track=track)
        except Exception as e:
             logging.error(f"Error updating track {track_id} for song {song_id}: {e}")
             return jsonify(error="Internal server error"), 500

    elif request.method == 'DELETE':
        try:
            filename_to_delete = track.get('file_path') # Get filename before deleting track entry
            logging.info(f"Attempting to delete track ID: {track_id} (File: {filename_to_delete}) from song ID: {song_id}")

            # Remove track from song data first
            del song['audio_tracks'][track_index]
            # Use cached write to save the change
            if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
                 # If save fails, track is gone from memory, not disk JSON
                 return jsonify(error="Failed to save song data after track removal"), 500

            # Delete the associated file *only if* no other track in *any* song uses it
            file_deleted = False
            delete_error = None
            if filename_to_delete:
                 is_used_elsewhere = False
                 # songs_data is already updated in memory
                 for s in songs_data.get('songs', []):
                      if isinstance(s, dict) and isinstance(s.get('audio_tracks'), list):
                           for t in s['audio_tracks']:
                                if isinstance(t, dict) and t.get('file_path') == filename_to_delete:
                                     is_used_elsewhere = True; break
                      if is_used_elsewhere: break

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
                      logging.debug(f"  Audio file '{filename_to_delete}' not deleted as it's used by other tracks/songs.")

            if delete_error: logging.error(delete_error)
            message = 'Track removed from song.' + (' Associated unused audio file deleted.' if file_deleted else '')
            if delete_error: message += f' Error during file deletion: {delete_error}'
            return jsonify(success=True, message=message)

        except Exception as e:
             logging.error(f"Error deleting track {track_id} for song {song_id}: {e}")
             traceback.print_exc()
             return jsonify(error="Internal server error during track deletion"), 500


# --- Updated /api/settings/audio_device Route ---
@app.route('/api/settings/audio_device', methods=['GET', 'PUT'])
def audio_device_settings():
    settings_path = os.path.join(DATA_DIR, SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if not data: return jsonify(error='Invalid request body'), 400
            # Basic structure validation
            if not isinstance(data.get('audio_outputs'), list): return jsonify(error="Missing or invalid 'audio_outputs' list"), 400
            if 'volume' not in data: return jsonify(error="Missing 'volume'"), 400
            if 'sample_rate' not in data: return jsonify(error="Missing 'sample_rate'"), 400 # <-- Check for sample_rate

            new_audio_outputs = data['audio_outputs']
            new_volume = data['volume']
            new_sample_rate = data['sample_rate']

            validated_outputs, all_logical_channels = [], set()

            # Validate each mapping
            for i, mapping in enumerate(new_audio_outputs):
                # Check structure
                if not isinstance(mapping, dict) or 'device_id' not in mapping or 'channels' not in mapping:
                    return jsonify(error=f'Invalid format for mapping at index {i} (missing keys)'), 400

                device_id = mapping.get('device_id')
                channels = mapping.get('channels')

                # Validate types and values
                if not isinstance(device_id, int): return jsonify(error=f'Invalid device_id (must be integer) in mapping {i}'), 400
                if not isinstance(channels, list): return jsonify(error=f'Invalid channels (must be list) in mapping {i}'), 400
                # Validate channel numbers (1-based logical channels)
                current_mapping_channels = set()
                for ch_idx, ch in enumerate(channels):
                    # Physical channel index (0-based) corresponds to ch_idx
                    # Logical channel number (1-based) is the value 'ch'
                    if not isinstance(ch, int) or not (1 <= ch <= MAX_LOGICAL_CHANNELS):
                        return jsonify(error=f'Invalid logical channel number {ch} (must be integer 1-{MAX_LOGICAL_CHANNELS}) in mapping {i}'), 400
                    # Check for duplicate logical channels *across all mappings in this request*
                    if ch in all_logical_channels: return jsonify(error=f'Duplicate logical channel {ch} assigned across different devices/mappings'), 400
                    # Check for duplicate logical channels *within the same mapping*
                    if ch in current_mapping_channels: return jsonify(error=f'Logical channel {ch} duplicated within mapping for device {device_id}'), 400

                    # Check physical channel index vs device capability (optional but good)
                    try:
                        _, max_ch_dev = audio_player._get_device_details(device_id)
                        # ch_idx is the 0-based physical channel index for this logical channel 'ch'
                        if ch_idx >= max_ch_dev:
                             logging.warning(f"Logical channel {ch} mapped to physical index {ch_idx} which might exceed device {device_id}'s max channels ({max_ch_dev})")
                             # Allow it for now, PortAudio might handle it or error later
                    except Exception:
                        pass # Ignore if device query fails here

                    current_mapping_channels.add(ch)

                all_logical_channels.update(current_mapping_channels)

                # Check device validity using sounddevice
                try:
                    # Use None for default device ID if < 0, otherwise use the ID
                    sd.query_devices(device=device_id if device_id >= 0 else None, kind='output')
                except (ValueError, sd.PortAudioError, IndexError) as e:
                    return jsonify(error=f'Audio device ID {device_id} not found or invalid: {e}'), 400

                # Add validated mapping (keep logical channels as provided by user, sorting happens in player if needed)
                validated_outputs.append({'device_id': device_id, 'channels': channels}) # Store user-provided order

            # Validate volume
            try:
                 validated_volume = max(0.0, min(1.0, float(new_volume))) # Clamp 0.0-1.0
            except (ValueError, TypeError): return jsonify(error='Invalid volume value, must be a number between 0.0 and 1.0'), 400

            # Validate sample rate <-- Added validation
            try:
                 validated_sample_rate = int(new_sample_rate)
                 # Optional: check if it's in a list of known good rates?
                 # if validated_sample_rate not in SUPPORTED_SAMPLE_RATES:
                 #     logging.warning(f"Sample rate {validated_sample_rate} is not in the common list, but allowing.")
                 if validated_sample_rate <= 0: raise ValueError("Sample rate must be positive")
            except (ValueError, TypeError): return jsonify(error=f'Invalid sample rate value: {new_sample_rate}. Must be a positive integer.'), 400

            # Save validated settings using cached write
            # Read existing settings first to preserve other potential keys
            current_settings = read_json(settings_path, SETTINGS_CACHE_KEY)
            current_settings['audio_outputs'] = validated_outputs
            current_settings['volume'] = validated_volume
            current_settings['sample_rate'] = validated_sample_rate # <-- Save validated sample rate

            if write_json(settings_path, current_settings, SETTINGS_CACHE_KEY):
                audio_player.load_settings() # Reload player settings after successful save
                logging.info(f"Saved audio settings: {validated_outputs}, Volume: {validated_volume}, Sample Rate: {validated_sample_rate} Hz")
                # Return the saved data for confirmation
                return jsonify(
                    success=True,
                    saved_config=validated_outputs,
                    saved_volume=validated_volume,
                    saved_sample_rate=validated_sample_rate # <-- Return saved sample rate
                )
            else:
                return jsonify(error="Failed to write settings file"), 500
        except Exception as e:
            logging.error(f"Error saving audio settings: {e}")
            traceback.print_exc()
            return jsonify(error=f'Internal server error: {str(e)}'), 500

    # GET Method
    try:
        # Use cached read
        settings = read_json(settings_path, SETTINGS_CACHE_KEY)
        current_config = settings.get('audio_outputs', [])
        current_volume = settings.get('volume', 1.0)
        current_sample_rate = settings.get('sample_rate', DEFAULT_SAMPLE_RATE) # <-- Get current sample rate

        available_devices = []
        try:
            devices = sd.query_devices()
            # Attempt to get default output device index
            default_output_id = -1
            try:
                 default_indices = sd.default.device # Returns tuple (input, output)
                 if isinstance(default_indices, (list, tuple)) and len(default_indices) > 1:
                      default_output_id = default_indices[1]
            except Exception as e_def:
                 logging.warning(f"Could not determine default output device: {e_def}")

            # Iterate through all devices
            for i, dev in enumerate(devices):
                 # Use -1 to represent the system default output explicitly if desired
                 # though sd.query_devices() itself doesn't have a dedicated "default" device entry
                 # We mark the default based on sd.default.device index comparison
                 if isinstance(dev, dict) and dev.get('max_output_channels', 0) > 0: # Check it's a dict and has output channels
                     is_default = (i == default_output_id)
                     # Ensure essential keys are present
                     dev_name = dev.get('name', f'Unnamed Device {i}')
                     max_ch = dev.get('max_output_channels', 0)
                     # Include default sample rate info for the device
                     default_sr = dev.get('default_samplerate', 'N/A')
                     available_devices.append({
                         'id': i,
                         'name': f"{dev_name}{' (Default)' if is_default else ''}",
                         'max_output_channels': max_ch,
                         'default_samplerate': default_sr
                         # 'is_default': is_default # Redundant with name suffix
                     })
            # Optionally add an entry for the absolute default (-1) if needed by frontend logic
            # This might be simpler than relying on the (Default) suffix parsing.
            # Add default device explicitly with ID -1 if not already listed via index matching
            # default_device_info = sd.query_devices(kind='output')
            # if default_device_info:
            #      available_devices.insert(0, {
            #         'id': -1, # Special ID for default
            #         'name': f"{default_device_info.get('name', 'Default Output')} (Default)",
            #         'max_output_channels': default_device_info.get('max_output_channels', 0),
            #         'default_samplerate': default_device_info.get('default_samplerate', 'N/A')
            #      })


        except Exception as e_query:
             logging.error(f"Could not query audio devices: {e_query}")
             # Return empty list but don't fail the whole request if possible

        return jsonify(
            available_devices=available_devices,
            current_config=current_config,
            volume=current_volume,
            current_sample_rate=current_sample_rate, # <-- Return current sample rate
            supported_sample_rates=SUPPORTED_SAMPLE_RATES # <-- Return list of common rates for dropdown
        )
    except Exception as e:
        logging.error(f"Error getting audio settings: {e}")
        # Provide default structure on error
        return jsonify(
            available_devices=[],
            current_config=[],
            volume=1.0,
            current_sample_rate=DEFAULT_SAMPLE_RATE, # Default
            supported_sample_rates=SUPPORTED_SAMPLE_RATES, # Default
            error=f'Could not load audio settings: {str(e)}'
        ), 500


@app.route('/api/settings/open_directory', methods=['POST'])
def open_directory():
    # Use absolute path based on app root
    audio_dir = os.path.abspath(os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER))
    try:
        if not os.path.isdir(audio_dir): # Check if it's actually a directory
             logging.error(f"Audio directory not found at: {audio_dir}")
             return jsonify(success=False, error=f'Directory not found: {audio_dir}'), 404

        logging.info(f"Attempting to open directory: {audio_dir}")
        if sys.platform == 'win32':
            # Using 'explorer' might be slightly more robust than startfile for dirs
            subprocess.run(['explorer', audio_dir], check=True)
            # os.startfile(audio_dir) # Alternative
        elif sys.platform == 'darwin': # macOS
            subprocess.run(['open', audio_dir], check=True)
        else: # Linux and other POSIX-like
            subprocess.run(['xdg-open', audio_dir], check=True)
        return jsonify(success=True)
    except FileNotFoundError: # Specific error if open/xdg-open/explorer not found
        logging.error(f"Failed to open directory: Command not found (e.g., xdg-open, open, explorer).")
        return jsonify(success=False, error=f"Command not found to open directory."), 500
    except subprocess.CalledProcessError as e: # Error from the called command
         logging.error(f"Failed to open directory '{audio_dir}' using system command: {e}")
         return jsonify(success=False, error=f"System command failed to open directory: {e}"), 500
    except Exception as e: # Catch other potential errors
        logging.error(f"Unexpected error opening directory '{audio_dir}': {e}")
        return jsonify(success=False, error=f"Failed to open directory: {str(e)}"), 500

# --- Updated clear_cache route ---
@app.route('/api/clear_cache', methods=['POST'])
def clear_cache_route(): # Renamed function slightly
    try:
        cache.clear()
        logging.info("Server-side cache cleared successfully via API.")
        return jsonify(success=True, message='Server-side cache cleared.')
    except Exception as e:
        logging.error(f"Error clearing cache: {e}")
        return jsonify(success=False, message=f'Error clearing cache: {e}'), 500

# --- Updated factory_reset to clear songs and setlists ---
@app.route('/api/factory_reset', methods=['POST'])
def factory_reset():
    logging.warning("--- Initiating Factory Reset ---")
    success_status = True
    error_messages = []
    deleted_files = 0
    deleted_files_errors = []

    try:
        audio_player.stop() # Stop any playback
        logging.info("Audio playback stopped.")

        # Reset settings files (using initialize_app which uses write_json/clears cache)
        # This resets settings.json, midi_settings.json to defaults
        # It only *creates* songs/setlists if missing, so we overwrite them next.
        initialize_app()
        logging.info("Default settings files re-initialized (settings, midi).")

        # --- Explicitly clear Songs and Setlists data ---
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        default_songs_data = {'songs': []}
        default_setlists_data = {'setlists': []}

        logging.info(f"Clearing {SONGS_FILE}...")
        if write_json(songs_path, default_songs_data, SONGS_CACHE_KEY):
            logging.info(f"{SONGS_FILE} cleared and cache invalidated.")
        else:
            logging.error(f"ERROR: Failed to clear {SONGS_FILE}.")
            error_messages.append(f"Failed to clear {SONGS_FILE}")
            success_status = False # Mark as partial failure

        logging.info(f"Clearing {SETLISTS_FILE}...")
        if write_json(setlists_path, default_setlists_data, SETLISTS_CACHE_KEY):
            logging.info(f"{SETLISTS_FILE} cleared and cache invalidated.")
        else:
            logging.error(f"ERROR: Failed to clear {SETLISTS_FILE}.")
            error_messages.append(f"Failed to clear {SETLISTS_FILE}")
            success_status = False # Mark as partial failure

        # Clear cache explicitly (redundant but safe)
        cache.clear()
        logging.info("Explicit cache clear performed.")

        # Delete audio files
        audio_folder_path = os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER)
        if os.path.exists(audio_folder_path):
             logging.info(f"Deleting files in {audio_folder_path}...")
             for filename in os.listdir(audio_folder_path):
                 file_path = os.path.join(audio_folder_path, filename)
                 try:
                     if os.path.isfile(file_path) or os.path.islink(file_path):
                         os.unlink(file_path)
                         deleted_files += 1
                 except Exception as e:
                     deleted_files_errors.append(f"Failed to delete {filename}: {e}")
                     logging.error(f"Error during factory reset file deletion: {e}")
             if deleted_files_errors:
                 logging.error(f"Errors during factory reset file deletion: {deleted_files_errors}")
                 error_messages.extend(deleted_files_errors) # Add file deletion errors to main list
                 success_status = False # Mark as partial failure if file deletion had issues
             logging.info(f"Deleted {deleted_files} audio files.")
        else:
             logging.info(f"Audio folder {audio_folder_path} not found, skipping deletion.")

        # Reload fresh default settings into player (uses cache, which should be clear)
        audio_player.load_settings()
        logging.info("Audio player settings reloaded.")

        # Construct final message
        message = 'Factory reset process finished.'
        if success_status:
            message += f' Settings, Songs, Setlists reset. {deleted_files} audio files deleted.'
            logging.warning("--- Factory Reset Complete (Success) ---")
            return jsonify(success=True, message=message)
        else:
            message += f' Issues occurred. Settings/MIDI reset. Songs/Setlists clear status: {"Done" if f"Failed to clear {SONGS_FILE}" not in error_messages and f"Failed to clear {SETLISTS_FILE}" not in error_messages else "Failed"}.'
            message += f' Deleted {deleted_files} audio files.'
            if deleted_files_errors: message += f' Encountered {len(deleted_files_errors)} error(s) deleting files.'
            if error_messages: message += f' Other errors: {"; ".join(error_messages)}'
            logging.warning(f"--- Factory Reset Complete (Partial Failure) --- Errors: {error_messages}")
            # Return 207 Multi-Status if partially successful, 500 if major failure?
            # Let's stick to success=False for simplicity on the frontend for now.
            return jsonify(success=False, message=message, errors=error_messages), 500

    except Exception as e:
        logging.error(f"CRITICAL error during factory reset: {e}")
        traceback.print_exc()
        return jsonify(success=False, error=f"Critical error during factory reset: {str(e)}"), 500

# --- Routes using cached reads for playback/control ---

@app.route('/api/setlists/<int:setlist_id>/control', methods=['POST'])
def control_setlist(setlist_id):
    try:
        data = request.json
        action = data.get('action')
        current_index = data.get('current_index', 0)
        if not isinstance(current_index, int): current_index = 0

        # Use cached read
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        setlist = next((s for s in setlists_data.get('setlists', []) if isinstance(s,dict) and s.get('id') == setlist_id), None)

        if not setlist: return jsonify(error='Setlist not found'), 404
        # Ensure song_ids is a list
        song_ids = setlist.get('song_ids', [])
        if not isinstance(song_ids, list):
             logging.error(f"Invalid song_ids format in setlist {setlist_id}: {song_ids}")
             return jsonify(error='Setlist song data invalid'), 500
        num_songs = len(song_ids)

        if action == 'stop':
            audio_player.stop()
            return jsonify(success=True, action='stopped')

        elif action == 'next':
            if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400 # Indicate failure
            next_index = current_index + 1
            if next_index >= num_songs:
                # Reached the end or trying to go past it
                audio_player.stop() # Stop at end
                logging.info(f"End of setlist {setlist_id} reached.")
                # Return current index to indicate position hasn't changed past end
                return jsonify(success=True, action='end_of_setlist_reached', current_song_index=current_index, message='End of setlist reached.')
            else:
                # Valid next song
                return jsonify(success=True, action='next', current_song_index=next_index, current_song_id=song_ids[next_index])

        elif action == 'previous':
            if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400
            prev_index = current_index - 1
            if prev_index < 0:
                 # Already at the first song or trying to go before it
                 return jsonify(success=False, error='Already at the first song'), 400 # Use 400 Bad Request
            else:
                # Valid previous song
                return jsonify(success=True, action='previous', current_song_index=prev_index, current_song_id=song_ids[prev_index])

        else:
            return jsonify(error=f'Invalid action: {action}'), 400
    except Exception as e:
         logging.error(f"Error handling setlist control for {setlist_id}: {e}")
         traceback.print_exc()
         return jsonify(error="Internal server error"), 500


@app.route('/api/setlists/<int:setlist_id>/play', methods=['POST'])
def play_setlist_song(setlist_id):
    data = request.get_json()
    try:
        current_song_index = data.get('current_song_index', 0)
        if not isinstance(current_song_index, int) or current_song_index < 0:
            return jsonify(error='Invalid song index'), 400

        # Use cached reads for both setlists and songs
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)

        setlist = next((s for s in setlists_data.get('setlists',[]) if isinstance(s,dict) and s.get('id') == setlist_id), None)
        if not setlist: return jsonify(error='Setlist not found'), 404

        song_ids = setlist.get('song_ids', [])
        if not isinstance(song_ids, list) or current_song_index >= len(song_ids):
            return jsonify(error='Invalid song index for this setlist'), 400

        song_id_to_play = song_ids[current_song_index]
        # Find the song details from the cached songs data
        song_to_play = next((s for s in songs_data.get('songs',[]) if isinstance(s,dict) and s.get('id') == song_id_to_play), None)
        if not song_to_play:
             logging.error(f"Song ID {song_id_to_play} from setlist {setlist_id} not found in library.")
             return jsonify(error=f'Song ID {song_id_to_play} not found in library'), 404

        # Call the player (which now handles locking internally)
        # Player will use the sample rate from settings during this call
        success = audio_player.play_song(song_id_to_play)

        if success:
            # Calculate duration after confirming playback started
            song_duration_seconds = calculate_song_duration(song_to_play)
            return jsonify(success=True, current_song_index=current_song_index, current_song_id=song_id_to_play,
                           song_name=song_to_play.get('name', 'N/A'), song_tempo=song_to_play.get('tempo', 120),
                           duration=song_duration_seconds)
        else:
            logging.error(f"AudioPlayer failed to start playback for song {song_id_to_play}. Check logs and audio config.")
            # Check if the error might be sample rate related (logged during play_song)
            return jsonify(success=False, error='Failed to start playback. Check logs, audio configuration, and selected sample rate compatibility.'), 500

    except Exception as e:
        logging.error(f"Critical error playing setlist {setlist_id} song index {data.get('current_song_index', 'N/A')}: {e}")
        traceback.print_exc()
        return jsonify(success=False, error='Internal server error during playback initiation.'), 500


@app.route('/api/stop', methods=['POST'])
def stop_player():
    try:
        audio_player.stop()
        return jsonify(success=True, message='Playback stopped.')
    except Exception as e:
        logging.error(f"Error stopping player via API: {e}")
        return jsonify(success=False, error='Failed to stop playback'), 500


# --- Frontend Routes (use cached reads where applicable) ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/setlists')
def setlists_page():
    try:
        # Use cached read
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        # Pass the list directly to the template
        return render_template('setlists.html', setlists=setlists_data.get('setlists', []))
    except Exception as e:
        logging.error(f"Error loading setlists page: {str(e)}")
        # Provide a user-friendly error message
        return render_template('error.html', message="Error loading setlists data. Please check server logs."), 500

@app.route('/songs')
def songs_page():
    try:
        # Use cached read
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)
        # Pass the list directly to the template
        return render_template('songs.html', songs=songs_data.get('songs', []))
    except Exception as e:
        logging.error(f"Error loading songs page: {str(e)}")
        return render_template('error.html', message="Error loading songs data. Please check server logs."), 500

@app.route('/settings')
def settings_page():
    try:
        # Settings data is loaded via JS API call usually, but render template
        return render_template('settings.html')
    except Exception as e:
         logging.error(f"Error loading settings page template: {str(e)}")
         return render_template('error.html', message="Error loading settings page."), 500

@app.route('/setlists/<int:setlist_id>/play')
def play_setlist_page(setlist_id):
    try:
        # Use cached reads
        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        songs_path = os.path.join(DATA_DIR, SONGS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        songs_data = read_json(songs_path, SONGS_CACHE_KEY)

        setlist = next((s for s in setlists_data.get('setlists', []) if isinstance(s, dict) and s.get('id') == setlist_id), None)
        if not setlist: abort(404) # Setlist not found

        # Build map of songs for quick lookup
        song_map = {s['id']: s for s in songs_data.get('songs', []) if isinstance(s, dict) and 'id' in s}

        songs_in_setlist_with_details = []
        for song_id in setlist.get('song_ids', []):
            song = song_map.get(song_id)
            if song:
                # Calculate duration here to pass to template
                duration_sec = calculate_song_duration(song)
                songs_in_setlist_with_details.append({
                    'id': song['id'],
                    'name': song.get('name', 'Unnamed Song'),
                    'tempo': song.get('tempo', 120),
                    'duration': duration_sec # Pass duration in seconds
                    # 'formatted_duration': format_duration_filter(duration_sec) # Or format here if filter not used in JS
                })
            else:
                logging.warning(f"Warning: Song ID {song_id} in setlist {setlist_id} not found in library during page load.")
                # Optionally add a placeholder?
                # songs_in_setlist.append({'id': song_id, 'name': f'Missing Song ID: {song_id}', 'tempo': 'N/A', 'duration': 0})


        # Pass the specific setlist dict and the list of song details
        return render_template('setlist_player.html', setlist=setlist, songs=songs_in_setlist_with_details)
    except Exception as e:
         logging.error(f"Error loading setlist player page {setlist_id}: {str(e)}")
         traceback.print_exc()
         return render_template('error.html', message="Error loading setlist player."), 500 # Simple error page


# Serve static audio files (No change needed here for caching)
@app.route('/static/audio/<path:filename>')
def serve_audio(filename):
    try:
        audio_folder_path = os.path.abspath(os.path.join(app.root_path, AUDIO_UPLOAD_FOLDER))
        # Prevent directory traversal: ensure the resolved path starts with the audio folder path
        safe_path = os.path.abspath(os.path.join(audio_folder_path, filename))
        if not safe_path.startswith(audio_folder_path):
             logging.warning(f"Directory traversal attempt blocked for audio file: {filename}")
             abort(404)

        return send_from_directory(audio_folder_path, filename, as_attachment=False)
    except FileNotFoundError:
        logging.warning(f"Audio file not found: {filename}")
        abort(404)
    except Exception as e:
         logging.error(f"Error serving audio file {filename}: {e}")
         abort(500)


# --- Template Filters ---
@app.template_filter('format_duration')
def format_duration_filter(seconds):
    """Format seconds into MM:SS."""
    try:
        # Handle potential None or non-numeric types gracefully
        if seconds is None: return "0:00"
        seconds = int(float(seconds)) # Allow float input but convert to int
        if seconds < 0: seconds = 0
        minutes = seconds // 60
        seconds %= 60
        return f"{minutes}:{seconds:02d}"
    except (ValueError, TypeError):
         # Log the error if needed: logging.warning(f"Invalid input to format_duration: {seconds}")
         return "0:00" # Default format for invalid input


# --- Main Execution ---
if __name__ == '__main__':
    # Ensure Waitress is installed or use Flask's dev server for debugging
    try:
        from waitress import serve
        use_waitress = True
    except ImportError:
        use_waitress = False
        logging.warning("Waitress not found. Falling back to Flask development server (not recommended for production).")

    # Print device info on startup
    try:
        logging.info("\n--- Available Audio Devices ---")
        logging.info(sd.query_devices())
        default_out_idx = -1
        default_dev_name = "N/A"
        try:
            default_indices = sd.default.device
            if isinstance(default_indices, (list, tuple)) and len(default_indices) > 1:
                default_out_idx = default_indices[1]
                if default_out_idx != -1:
                    try: default_dev_name = sd.query_devices(default_out_idx)['name']
                    except Exception as e_qn: logging.warning(f"Could not query default device name: {e_qn}")
            else: logging.warning("sd.default.device did not return expected output device index.")
        except Exception as e_def: logging.warning(f"Could not determine default output device index: {e_def}")

        logging.info(f"Default Output Device: ID {default_out_idx} -> Name: {default_dev_name}\n")
    except Exception as e:
        logging.error(f"Could not query audio devices on startup: {e}\n")

    # Run Server
    host = '0.0.0.0'
    port = 5001
    if use_waitress:
        logging.info(f"Starting Waitress server on http://{host}:{port}")
        serve(app, host=host, port=port, threads=8) # Adjust threads as needed
    else:
        logging.info(f"Starting Flask development server on http://{host}:{port}")
        # Note: Flask dev server is not suitable for production.
        # Use debug=True only for development, it can be a security risk.
        app.run(host=host, port=port, debug=True) # Set debug=False for production testing without waitress