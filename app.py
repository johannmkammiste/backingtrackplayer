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
from flask_caching import Cache
import time
from flask import send_file
import atexit

from modpybass.pybass import BASS_INFO, BASS_GetInfo, BASS_DEVICEINFO, BASS_GetDeviceInfo, BASS_DEVICE_ENABLED, \
    BASS_ErrorGetCode
from audioplayer_module import AudioPlayer, \
    BASS_DEVICE_LOOPBACK  # Assuming BASS_DEVICE_LOOPBACK is correctly defined or handled

app = Flask(__name__)

# --- Constants and Configuration ---
DEFAULT_AUDIO_UPLOAD_FOLDER_NAME = 'static/audio'  # Default relative path
# AUDIO_UPLOAD_FOLDER is now dynamic, see get_current_audio_upload_folder_abs()
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'aiff', 'flac', 'aac', 'm4a'}
DATA_DIR = os.path.join(app.root_path, 'data')
SONGS_FILE = 'songs.json'
SETLISTS_FILE = 'setlists.json'
SETTINGS_FILE = 'settings.json'  # Stores audio_outputs, volume, sample_rate, audio_directory_path
MIDI_SETTINGS_FILE = 'midi_settings.json'

DEFAULT_SAMPLE_RATE = 48000
MAX_LOGICAL_CHANNELS = 64
SUPPORTED_SAMPLE_RATES = [44100, 48000, 88200, 96000]

SONGS_CACHE_KEY = 'songs_data'
SETLISTS_CACHE_KEY = 'setlists_data'
SETTINGS_CACHE_KEY = 'settings_data'
MIDI_SETTINGS_CACHE_KEY = 'midi_settings_data'

logging.basicConfig(level=logging.DEBUG)  # Ensure logging is enabled
config = {"DEBUG": True, "CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 300}
app.config.from_mapping(config)
cache = Cache(app)


# --- Utility Functions ---
def get_current_audio_upload_folder_path_setting():
    """Reads the configured audio directory path from settings.json."""
    settings_data = read_json(os.path.join(DATA_DIR, SETTINGS_FILE), SETTINGS_CACHE_KEY)
    return settings_data.get('audio_directory_path', DEFAULT_AUDIO_UPLOAD_FOLDER_NAME)


def get_current_audio_upload_folder_abs():
    """Gets the absolute path to the currently configured audio upload folder."""
    configured_path = get_current_audio_upload_folder_path_setting()
    if os.path.isabs(configured_path):
        abs_path = configured_path
    else:
        abs_path = os.path.join(app.root_path, configured_path)

    # Ensure the directory exists
    try:
        Path(abs_path).mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logging.error(f"Failed to create or access audio directory {abs_path}: {e}. Falling back to default.")
        # Fallback to default if custom path is problematic after trying to create it
        default_abs_path = os.path.join(app.root_path, DEFAULT_AUDIO_UPLOAD_FOLDER_NAME)
        Path(default_abs_path).mkdir(parents=True, exist_ok=True)  # Ensure default exists
        return default_abs_path
    return os.path.normpath(abs_path)


def initialize_app_files():
    Path(DATA_DIR).mkdir(exist_ok=True)
    # Ensure default audio directory (relative to app root) exists initially
    Path(os.path.join(app.root_path, DEFAULT_AUDIO_UPLOAD_FOLDER_NAME)).mkdir(parents=True, exist_ok=True)

    # Initialize settings files with defaults if they don't exist
    _init_settings_file(SETTINGS_FILE, {
        'audio_outputs': [],
        'volume': 1.0,
        'sample_rate': DEFAULT_SAMPLE_RATE,
        'audio_directory_path': DEFAULT_AUDIO_UPLOAD_FOLDER_NAME  # Add default audio path
    })
    _init_settings_file(MIDI_SETTINGS_FILE, {
        'enabled': True,
        'shortcuts': {'play_pause': 'Space', 'stop': 'Escape', 'next': 'ArrowRight', 'previous': 'ArrowLeft'},
        'midi_mappings': {},
        'midi_input_device': None
    })
    _init_settings_file(SONGS_FILE, {'songs': []})
    _init_settings_file(SETLISTS_FILE, {'setlists': []})


def _init_settings_file(file_name, default_data):
    file_path = os.path.join(DATA_DIR, file_name)
    cache_key_map = {
        SETTINGS_FILE: SETTINGS_CACHE_KEY,
        MIDI_SETTINGS_FILE: MIDI_SETTINGS_CACHE_KEY,
        SONGS_FILE: SONGS_CACHE_KEY,
        SETLISTS_FILE: SETLISTS_CACHE_KEY
    }
    cache_key = cache_key_map.get(file_name)

    if not os.path.exists(file_path):
        logging.info(f"Initializing settings file: {file_path} with defaults.")
        if not write_json(file_path, default_data, cache_key if cache_key else f"temp_{file_name}"):
            logging.error(f"CRITICAL: Failed to initialize critical file: {file_path}")
            sys.exit(f"Failed to initialize critical file: {file_path}")
    else:  # File exists, ensure all default keys are present
        try:
            with open(file_path, 'r+', encoding='utf-8') as f:
                current_data = json.load(f)
                updated = False
                for key, value in default_data.items():
                    if key not in current_data:
                        current_data[key] = value
                        updated = True
                if updated:
                    logging.info(f"Updating existing settings file {file_path} with missing default keys.")
                    f.seek(0)
                    json.dump(current_data, f, indent=2)
                    f.truncate()
                    if cache_key: cache.delete(cache_key)  # Invalidate cache if updated
        except (json.JSONDecodeError, IOError) as e:
            logging.error(f"Error reading/updating existing settings file {file_path}: {e}. Re-initializing.")
            # If file is corrupt or unreadable, overwrite with defaults
            if not write_json(file_path, default_data, cache_key if cache_key else f"temp_{file_name}"):
                logging.error(f"CRITICAL: Failed to re-initialize corrupted file: {file_path}")
                sys.exit(f"Failed to re-initialize corrupted file: {file_path}")


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def read_json(file_path, cache_key):
    cached_data = cache.get(cache_key)
    if cached_data is not None:
        # logging.debug(f"Cache hit for {cache_key}")
        return cached_data

    # Define default structures for each settings file
    default_map = {
        os.path.basename(SONGS_FILE): {'songs': []},
        os.path.basename(SETLISTS_FILE): {'setlists': []},
        os.path.basename(SETTINGS_FILE): {
            'audio_outputs': [],
            'volume': 1.0,
            'sample_rate': DEFAULT_SAMPLE_RATE,
            'audio_directory_path': DEFAULT_AUDIO_UPLOAD_FOLDER_NAME
        },
        os.path.basename(MIDI_SETTINGS_FILE): {
            'enabled': False,
            'shortcuts': {},
            'midi_mappings': {},
            'midi_input_device': None
        }
    }
    default_value = default_map.get(os.path.basename(file_path), {})

    if not os.path.exists(file_path):
        logging.warning(f"File not found: {file_path}. Returning default structure and caching.")
        cache.set(cache_key, default_value, timeout=60)  # Cache default for a short time
        return default_value
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        # Ensure all default keys are present in the loaded data
        for key, val_default in default_value.items():
            data.setdefault(key, val_default)
        cache.set(cache_key, data)
        # logging.debug(f"Cache miss for {cache_key}, loaded from file.")
        return data
    except (json.JSONDecodeError, IOError) as e:
        logging.error(f"Error reading {file_path}: {e}. Returning default structure and caching.")
        cache.set(cache_key, default_value, timeout=60)
        return default_value


def write_json(file_path, data, cache_key):
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        if cache_key:
            cache.delete(cache_key)  # Invalidate cache on write
            logging.debug(f"Cache invalidated for {cache_key} after writing to {file_path}")
        return True
    except (IOError, TypeError) as e:
        logging.error(f"Error writing to {file_path}: {e}")
        return False


def get_next_id(items):
    if not isinstance(items, list): return 1
    return max([item.get('id', 0) for item in items if isinstance(item, dict)], default=0) + 1


initialize_app_files()  # Ensure files and default audio directory exist


# --- Audio Player Initialization ---
def get_songs_data_for_player():
    return read_json(os.path.join(DATA_DIR, SONGS_FILE), SONGS_CACHE_KEY)


def get_settings_data_for_player():
    return read_json(os.path.join(DATA_DIR, SETTINGS_FILE), SETTINGS_CACHE_KEY)


audio_player = AudioPlayer(
    root_path=app.root_path,  # Used for resolving relative paths
    initial_audio_upload_folder_config=get_current_audio_upload_folder_path_setting(),  # Pass the configured path
    songs_data_provider_func=get_songs_data_for_player,
    settings_data_provider_func=get_settings_data_for_player,
    max_logical_channels_const=MAX_LOGICAL_CHANNELS,
    default_sample_rate_const=DEFAULT_SAMPLE_RATE
)
try:
    audio_player.initialize_bass()
except RuntimeError as e:
    logging.error(f"Failed to initialize AudioPlayer and BASS: {e}")
    sys.exit(str(e))

atexit.register(audio_player.shutdown)


# --- API Endpoints ---

@app.route('/api/settings/audio_directory', methods=['GET', 'PUT'])
def audio_directory_setting():
    settings_path = os.path.join(DATA_DIR, SETTINGS_FILE)
    current_settings = read_json(settings_path, SETTINGS_CACHE_KEY)

    if request.method == 'PUT':
        data = request.get_json()
        new_path_config = data.get('audio_directory_path')

        if not new_path_config or not isinstance(new_path_config, str):
            return jsonify(error="Invalid or missing 'audio_directory_path' in request."), 400

        new_path_config = new_path_config.strip()
        if not new_path_config:
            return jsonify(error="'audio_directory_path' cannot be empty."), 400

        # Try to resolve and create the directory to validate it
        prospective_abs_path = os.path.normpath(
            os.path.join(app.root_path, new_path_config) if not os.path.isabs(new_path_config) else new_path_config)

        try:
            Path(prospective_abs_path).mkdir(parents=True, exist_ok=True)
            logging.info(f"Audio directory path validated and ensured: {prospective_abs_path}")
        except Exception as e:
            logging.error(f"Failed to create or access prospective audio directory '{prospective_abs_path}': {e}")
            return jsonify(
                error=f"Failed to access or create directory: {prospective_abs_path}. Check permissions and path validity. Error: {str(e)}"), 400

        current_settings['audio_directory_path'] = new_path_config  # Store the user-provided path (relative or abs)

        if write_json(settings_path, current_settings, SETTINGS_CACHE_KEY):
            audio_player.update_audio_upload_folder_config(new_path_config)  # Inform AudioPlayer
            return jsonify(success=True, message=f"Audio directory path set to '{new_path_config}'.",
                           audio_directory_path=new_path_config)
        else:
            return jsonify(error="Failed to write audio directory setting."), 500

    # GET request
    return jsonify(audio_directory_path=current_settings.get('audio_directory_path', DEFAULT_AUDIO_UPLOAD_FOLDER_NAME))


@app.route('/api/export/<export_type>', methods=['GET'])
def export_data(export_type):
    filename_map = {'songs': SONGS_FILE, 'setlists': SETLISTS_FILE}
    filename = filename_map.get(export_type)
    if not filename: return jsonify(error="Invalid export type"), 400
    file_path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(file_path): return jsonify(error=f"{filename} not found"), 404
    return send_file(file_path, as_attachment=True, download_name=filename)


@app.route('/api/import/<import_type>', methods=['POST'])
def import_data(import_type):
    target_info = {'songs': (SONGS_FILE, SONGS_CACHE_KEY), 'setlists': (SETLISTS_FILE, SETLISTS_CACHE_KEY)}
    if import_type not in target_info: return jsonify(error="Invalid import type"), 400
    target_filename, cache_key_to_clear = target_info[import_type]
    if 'file' not in request.files: return jsonify(error="No file part"), 400
    file = request.files['file']
    if file.filename == '' or not file.filename.endswith('.json'): return jsonify(error="No file or invalid type"), 400
    try:
        imported_data = json.load(file)
        if (import_type == 'songs' and 'songs' not in imported_data) or \
                (import_type == 'setlists' and 'setlists' not in imported_data):
            return jsonify(error=f"Invalid {import_type}.json format"), 400

        file_path = os.path.join(DATA_DIR, target_filename)
        if write_json(file_path, imported_data, cache_key_to_clear):
            cache.clear()  # Clear all cache for good measure after import
            audio_player.stop()
            audio_player.clear_preload_state()
            audio_player.update_settings()  # Re-read all settings including potentially new audio path
            return jsonify(success=True, message=f"{target_filename} imported. Cache and audio state reset.")
        return jsonify(error=f"Failed to write imported data to {target_filename}"), 500
    except json.JSONDecodeError:
        return jsonify(error="Invalid JSON file."), 400
    except Exception as e:
        logging.error(f"Error importing {target_filename}: {e}");
        traceback.print_exc()
        return jsonify(error=f"Import error: {str(e)}"), 500


@app.route('/api/audio/files', methods=['GET'])
def list_audio_files():
    current_audio_folder = get_current_audio_upload_folder_abs()
    try:
        # The get_current_audio_upload_folder_abs ensures the folder exists
        audio_files = sorted([f for f in os.listdir(current_audio_folder) if
                              os.path.isfile(os.path.join(current_audio_folder, f)) and allowed_file(f)])
        return jsonify(files=audio_files)
    except Exception as e:
        logging.error(f"Error listing audio files from {current_audio_folder}: {e}")
        return jsonify(error=str(e)), 500


@app.route('/api/audio/upload', methods=['POST'])
def general_audio_upload():
    if 'files[]' not in request.files: return jsonify(error='No files part'), 400
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '': return jsonify(error='No selected files'), 400

    current_audio_folder = get_current_audio_upload_folder_abs()  # Ensures directory exists

    uploaded, errors = [], []
    for file_obj in files:
        if file_obj and file_obj.filename and allowed_file(file_obj.filename):
            try:
                filename = secure_filename(file_obj.filename)
                if not filename: errors.append(f"Invalid filename: '{file_obj.filename}'."); continue
                file_obj.save(os.path.join(current_audio_folder, filename))
                uploaded.append(filename)
            except Exception as e:
                errors.append(f"Error saving {file_obj.filename}: {e}")
        elif file_obj and file_obj.filename:
            errors.append(f"File type not allowed: {file_obj.filename}")
    status = 200 if not errors else (207 if uploaded else 400)
    return jsonify({'uploaded_files': uploaded, 'errors': errors} if errors else {'uploaded_files': uploaded}), status


@app.route('/api/settings/keyboard', methods=['GET', 'PUT'])
def keyboard_settings():
    path = os.path.join(DATA_DIR, MIDI_SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            current = read_json(path, MIDI_SETTINGS_CACHE_KEY)
            updated = False
            if 'enabled' in data and current.get('enabled') != bool(data['enabled']): current['enabled'] = bool(
                data['enabled']); updated = True
            if 'shortcuts' in data and isinstance(data['shortcuts'], dict) and current.get('shortcuts') != data[
                'shortcuts']: current['shortcuts'] = data['shortcuts']; updated = True
            if updated and not write_json(path, current, MIDI_SETTINGS_CACHE_KEY): return jsonify(
                error="Failed to write keyboard settings"), 500
            return jsonify(success=True,
                           settings={'enabled': current.get('enabled'), 'shortcuts': current.get('shortcuts')})
        except Exception as e:
            logging.error(f"Error saving keyboard settings: {e}")
            return jsonify(error="Keyboard settings update failed"), 500
    return jsonify(read_json(path, MIDI_SETTINGS_CACHE_KEY))


@app.route('/api/settings/audio_device', methods=['GET', 'PUT'])
def audio_device_settings():
    settings_path = os.path.join(DATA_DIR, SETTINGS_FILE)
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if not (data and isinstance(data.get('audio_outputs'),
                                        list) and 'volume' in data and 'sample_rate' in data):
                return jsonify(error='Invalid request body format for audio device settings'), 400

            validated_outputs, used_log_chans = [], set()
            for i, m in enumerate(data['audio_outputs']):
                if not (isinstance(m, dict) and 'device_id' in m and 'channels' in m and isinstance(m['device_id'],
                                                                                                    int) and isinstance(
                        m['channels'], list)):
                    return jsonify(error=f'Invalid mapping entry {i}'), 400
                dev_info_check = BASS_DEVICEINFO()
                if m['device_id'] >= 0 and not BASS_GetDeviceInfo(m['device_id'],
                                                                  dev_info_check):  # Check if device exists
                    return jsonify(error=f"BASS Device index {m['device_id']} not found or invalid."), 400

                current_map_log_chans = set()
                for ch_val in m['channels']:
                    if not (isinstance(ch_val, int) and 1 <= ch_val <= MAX_LOGICAL_CHANNELS): return jsonify(
                        error=f'Invalid logical channel {ch_val} in mapping entry {i}'), 400
                    if ch_val in used_log_chans: return jsonify(
                        error=f'Duplicate logical channel {ch_val} across mappings'), 400
                    if ch_val in current_map_log_chans: return jsonify(
                        error=f'Logical channel {ch_val} duplicated for device {m["device_id"]}'), 400
                    current_map_log_chans.add(ch_val)
                used_log_chans.update(current_map_log_chans)
                validated_outputs.append(m)

            vol = max(0.0, min(1.0, float(data['volume'])))
            sr = int(data['sample_rate'])
            if sr not in SUPPORTED_SAMPLE_RATES: return jsonify(error=f'Unsupported sample rate: {sr}'), 400

            current_settings_data = read_json(settings_path, SETTINGS_CACHE_KEY)
            # Preserve audio_directory_path, only update audio_outputs, volume, sample_rate
            current_settings_data.update({'audio_outputs': validated_outputs, 'volume': vol, 'sample_rate': sr})

            if write_json(settings_path, current_settings_data, SETTINGS_CACHE_KEY):
                audio_player.update_settings()  # This will make AudioPlayer re-read from settings_data
                return jsonify(success=True, saved_config=validated_outputs, saved_volume=vol, saved_sample_rate=sr)
            return jsonify(error="Failed to write audio device settings"), 500
        except Exception as e:
            logging.error(f"Error saving audio device settings: {e}");
            traceback.print_exc();
            return jsonify(error=f'Internal server error: {str(e)}'), 500

    settings_data = read_json(settings_path, SETTINGS_CACHE_KEY)
    available_devices, idx = [], 0
    dev_info = BASS_DEVICEINFO()
    current_bass_context_info = BASS_INFO()
    if not BASS_GetInfo(current_bass_context_info):
        logging.error(f"BASS_GetInfo failed. Error: {BASS_ErrorGetCode()}")
        context_default_freq = DEFAULT_SAMPLE_RATE
    else:
        context_default_freq = current_bass_context_info.freq

    while BASS_GetDeviceInfo(idx, dev_info):
        if dev_info.flags & BASS_DEVICE_ENABLED and not (dev_info.flags & BASS_DEVICE_LOOPBACK):
            try:
                name_str = dev_info.name.decode('utf-8', 'replace')
            except:
                name_str = f"Device {idx}"
            available_devices.append({'id': idx, 'name': name_str, 'max_output_channels': 2,
                                      'default_samplerate': context_default_freq})  # Assuming max 2 ch for simplicity here
        idx += 1
        if idx > 50: break  # Safety break
    return jsonify(available_devices=available_devices,
                   current_config=settings_data.get('audio_outputs', []),
                   volume=settings_data.get('volume', 1.0),
                   current_sample_rate=settings_data.get('sample_rate', DEFAULT_SAMPLE_RATE),
                   supported_sample_rates=SUPPORTED_SAMPLE_RATES)


@app.route('/api/songs', methods=['GET', 'POST', 'DELETE'])
def handle_songs():
    path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(path, SONGS_CACHE_KEY)
    if request.method == 'POST':
        data = request.get_json()
        new_song = {'id': get_next_id(songs_data.get('songs', [])), 'name': data.get('name', 'New Song'),
                    'tempo': int(data.get('tempo', 120)), 'audio_tracks': []}
        songs_data.setdefault('songs', []).append(new_song)
        if write_json(path, songs_data, SONGS_CACHE_KEY): return jsonify(new_song), 201
        return jsonify(error="Failed to save new song"), 500
    elif request.method == 'DELETE':  # Delete ALL songs and their files
        audio_player.stop();
        audio_player.clear_preload_state()

        current_audio_folder = get_current_audio_upload_folder_abs()
        deleted_files_count = 0
        if os.path.exists(current_audio_folder):
            for track_file in os.listdir(current_audio_folder):
                try:
                    full_file_path = os.path.join(current_audio_folder, track_file)
                    if os.path.isfile(full_file_path):
                        os.unlink(full_file_path)
                        deleted_files_count += 1
                except Exception as e:
                    logging.error(f"Error deleting file {track_file} during all songs deletion: {e}")

        if not write_json(path, {'songs': []}, SONGS_CACHE_KEY):
            return jsonify(error="Failed to clear songs data file"), 500

        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        for slist in setlists_data.get('setlists', []): slist['song_ids'] = []
        write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY)

        return jsonify(success=True,
                       message=f'All songs, setlist items, and {deleted_files_count} audio files from "{current_audio_folder}" deleted.')
    return jsonify(songs_data)


@app.route('/api/songs/<int:song_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_song(song_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    song_list = songs_data.setdefault('songs', [])
    song_idx = next((i for i, s in enumerate(song_list) if s.get('id') == song_id), -1)
    if song_idx == -1: return jsonify(error='Song not found'), 404
    current_song_obj = song_list[song_idx]

    if request.method == 'PUT':
        data = request.get_json()
        current_song_obj['name'] = data.get('name', current_song_obj['name'])
        current_song_obj['tempo'] = int(data.get('tempo', current_song_obj['tempo']))
        if 'audio_tracks' in data: current_song_obj['audio_tracks'] = data['audio_tracks']
        if audio_player._preloaded_song_id == song_id: audio_player.clear_preload_state()
        if write_json(songs_path, songs_data, SONGS_CACHE_KEY): return jsonify(current_song_obj)
        return jsonify(error="Failed to save updated song"), 500
    elif request.method == 'DELETE':
        if audio_player._preloaded_song_id == song_id: audio_player.clear_preload_state()
        files_from_deleted_song = {t.get('file_path') for t in current_song_obj.get('audio_tracks', []) if
                                   t.get('file_path')}
        del song_list[song_idx]

        setlists_path = os.path.join(DATA_DIR, SETLISTS_FILE)
        setlists_data = read_json(setlists_path, SETLISTS_CACHE_KEY)
        for slist in setlists_data.get('setlists', []):
            slist['song_ids'] = [sid for sid in slist.get('song_ids', []) if sid != song_id]
        write_json(setlists_path, setlists_data, SETLISTS_CACHE_KEY)

        all_remaining_files = {t_iter.get('file_path') for s_iter in song_list for t_iter in
                               s_iter.get('audio_tracks', []) if t_iter.get('file_path')}
        deleted_file_count = 0
        current_audio_folder = get_current_audio_upload_folder_abs()
        for file_to_check in files_from_deleted_song:
            if file_to_check not in all_remaining_files:
                try:
                    os.unlink(os.path.join(current_audio_folder, file_to_check))
                    deleted_file_count += 1
                except OSError as e:
                    logging.error(f"Error deleting file {file_to_check} from {current_audio_folder}: {e}")

        if write_json(songs_path, songs_data, SONGS_CACHE_KEY):
            return jsonify(success=True, message=f"Song deleted. {deleted_file_count} unused audio file(s) removed.")
        return jsonify(error="Failed to save song data after deletion"), 500
    return jsonify(current_song_obj)


@app.route('/api/songs/<int:song_id>/upload', methods=['POST'])
def upload_song_tracks(song_id):
    if 'files[]' not in request.files: return jsonify(error='No files part in request'), 400
    files = request.files.getlist('files[]')
    if not files or files[0].filename == '': return jsonify(error='No selected files'), 400

    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    song = next((s for s in songs_data.get('songs', []) if s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404

    song_tracks = song.setdefault('audio_tracks', [])
    current_audio_folder = get_current_audio_upload_folder_abs()  # Ensures directory exists

    newly_added_tracks_info, errors_info = [], []
    for file_obj in files:
        if file_obj and file_obj.filename and allowed_file(file_obj.filename):
            try:
                filename = secure_filename(file_obj.filename)
                if not filename: errors_info.append(f"Invalid filename from '{file_obj.filename}'."); continue
                if any(t.get('file_path') == filename for t in song_tracks):
                    errors_info.append(f"Track '{filename}' already exists in this song.");
                    continue
                file_obj.save(os.path.join(current_audio_folder, filename))
                new_track = {'id': get_next_id(song_tracks), 'file_path': filename, 'output_channel': 1, 'volume': 1.0,
                             'is_stereo': False}
                song_tracks.append(new_track)
                newly_added_tracks_info.append(new_track)
            except Exception as e:
                errors_info.append(f"Error saving file {file_obj.filename}: {str(e)}")
        elif file_obj and file_obj.filename:
            errors_info.append(f"File type not allowed: {file_obj.filename}")

    if newly_added_tracks_info:
        if not write_json(songs_path, songs_data, SONGS_CACHE_KEY):
            return jsonify(error="Failed to save song data after track upload"), 500
        if audio_player._preloaded_song_id == song_id: audio_player.clear_preload_state()

    status_code = 200 if not errors_info else (207 if newly_added_tracks_info else 400)
    return jsonify(tracks=newly_added_tracks_info, errors=errors_info), status_code


@app.route('/api/songs/<int:song_id>/tracks/<int:track_id>', methods=['PUT', 'DELETE'])
def update_or_delete_track(song_id, track_id):
    songs_path = os.path.join(DATA_DIR, SONGS_FILE)
    songs_data = read_json(songs_path, SONGS_CACHE_KEY)
    song = next((s for s in songs_data.get('songs', []) if s.get('id') == song_id), None)
    if not song: return jsonify(error='Song not found'), 404
    tracks_list = song.setdefault('audio_tracks', [])
    track_index = next((i for i, t in enumerate(tracks_list) if t.get('id') == track_id), -1)
    if track_index == -1: return jsonify(error='Track not found'), 404

    if request.method == 'PUT':
        data = request.json
        track_obj = tracks_list[track_index]
        updated_flag = False
        for key, new_val_type, default_val in [('output_channel', int, 1), ('volume', float, 1.0),
                                               ('is_stereo', bool, False)]:
            if key in data:
                new_val = data[key]
                try:
                    typed_val = new_val_type(new_val)
                except ValueError:
                    return jsonify(error=f"Invalid type for {key}"), 400
                if track_obj.get(key, default_val) != typed_val: track_obj[key] = typed_val; updated_flag = True
        if updated_flag:
            if not write_json(songs_path, songs_data, SONGS_CACHE_KEY): return jsonify(
                error="Failed to save track changes"), 500
            if audio_player._preloaded_song_id == song_id: audio_player.clear_preload_state()
        return jsonify(success=True, track=track_obj)
    elif request.method == 'DELETE':
        file_path_of_deleted_track = tracks_list[track_index].get('file_path')
        del tracks_list[track_index]
        is_file_still_used = False
        if file_path_of_deleted_track:
            for s_iter in songs_data.get('songs', []):
                for t_iter in s_iter.get('audio_tracks', []):
                    if t_iter.get('file_path') == file_path_of_deleted_track: is_file_still_used = True; break
                if is_file_still_used: break

        if not write_json(songs_path, songs_data, SONGS_CACHE_KEY): return jsonify(
            error="Failed to save song data after track removal"), 500

        if file_path_of_deleted_track and not is_file_still_used:
            current_audio_folder = get_current_audio_upload_folder_abs()
            try:
                os.unlink(os.path.join(current_audio_folder, file_path_of_deleted_track))
            except OSError as e:
                logging.error(f"Error deleting file {file_path_of_deleted_track} from {current_audio_folder}: {e}")

        if audio_player._preloaded_song_id == song_id: audio_player.clear_preload_state()
        return jsonify(success=True, message="Track removed successfully.")
    return jsonify(error="Invalid HTTP method"), 405


# ... (Keep setlist, player control, and UI routes as they were, they don't directly depend on audio folder path for their primary logic)
@app.route('/api/setlists', methods=['GET', 'POST'])
def handle_setlists():
    path = os.path.join(DATA_DIR, SETLISTS_FILE)
    setlists_data = read_json(path, SETLISTS_CACHE_KEY)
    if request.method == 'POST':
        data = request.get_json()
        new_setlist = {'id': get_next_id(setlists_data.get('setlists', [])), 'name': data.get('name', 'New Setlist'),
                       'song_ids': data.get('song_ids', [])}
        setlists_data.setdefault('setlists', []).append(new_setlist)
        if write_json(path, setlists_data, SETLISTS_CACHE_KEY): return jsonify(new_setlist), 201
        return jsonify(error="Failed to save setlist"), 500
    return jsonify(setlists_data)


@app.route('/api/setlists/<int:setlist_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_setlist(setlist_id):
    path = os.path.join(DATA_DIR, SETLISTS_FILE);
    setlists_data = read_json(path, SETLISTS_CACHE_KEY)
    s_list = setlists_data.setdefault('setlists', []);
    idx = next((i for i, s in enumerate(s_list) if s.get('id') == setlist_id), -1)
    if idx == -1: return jsonify(error='Setlist not found'), 404
    current_setlist_obj = s_list[idx]
    if request.method == 'PUT':
        data = request.get_json()
        current_setlist_obj['name'] = data.get('name', current_setlist_obj['name'])
        if 'song_ids' in data: current_setlist_obj['song_ids'] = data['song_ids']
        if write_json(path, setlists_data, SETLISTS_CACHE_KEY): return jsonify(current_setlist_obj)
        return jsonify(error="Failed to save setlist"), 500
    elif request.method == 'DELETE':
        del s_list[idx]
        if write_json(path, setlists_data, SETLISTS_CACHE_KEY): return jsonify(success=True)
        return jsonify(error="Failed to delete setlist"), 500
    return jsonify(current_setlist_obj)


@app.route('/api/setlists/<int:setlist_id>/control', methods=['POST'])
def control_setlist(setlist_id):
    data = request.json;
    action = data.get('action');
    current_index = data.get('current_index', 0)
    setlist_obj, _ = _get_setlist_and_songs_data(setlist_id, fetch_songs=False)  # song details not needed here
    if not setlist_obj: return jsonify(error='Setlist not found'), 404
    song_ids_in_setlist = setlist_obj.get('song_ids', []);
    num_songs = len(song_ids_in_setlist)
    if action == 'stop':
        audio_player.stop();
        return jsonify(success=True, action='stopped')
    elif action == 'next':
        if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400
        next_song_index = current_index + 1
        if next_song_index >= num_songs:
            audio_player.stop();
            return jsonify(success=True, action='end_of_setlist_reached', current_song_index=current_index)
        return jsonify(success=True, action='next', current_song_index=next_song_index,
                       current_song_id=song_ids_in_setlist[next_song_index])
    elif action == 'previous':
        if num_songs == 0: return jsonify(error='Setlist is empty', success=False), 400
        prev_song_index = current_index - 1
        if prev_song_index < 0: return jsonify(success=False, error='Already at the first song'), 400
        return jsonify(success=True, action='previous', current_song_index=prev_song_index,
                       current_song_id=song_ids_in_setlist[prev_song_index])
    return jsonify(error=f'Invalid action: {action}'), 400


@app.route('/api/setlists/<int:setlist_id>/play', methods=['POST'])
def play_setlist_song(setlist_id):
    data = request.get_json();
    current_song_idx = data.get('current_song_index', 0)
    setlist_obj, songs_data_dict = _get_setlist_and_songs_data(setlist_id, fetch_songs=True)
    if not setlist_obj: return jsonify(error='Setlist not found'), 404
    song_ids_list = setlist_obj.get('song_ids', [])
    if not isinstance(song_ids_list, list) or current_song_idx >= len(song_ids_list): return jsonify(
        error='Invalid song index for this setlist'), 400
    song_id_to_play = song_ids_list[current_song_idx]
    song_to_play_details = next((s for s in songs_data_dict.get('songs', []) if s.get('id') == song_id_to_play), None)
    if not song_to_play_details: return jsonify(error=f'Song ID {song_id_to_play} not found in library'), 404

    if audio_player.play_song_directly(song_id_to_play):
        duration = audio_player.calculate_song_duration(song_to_play_details)
        return jsonify(success=True, current_song_index=current_song_idx, current_song_id=song_id_to_play,
                       song_name=song_to_play_details.get('name'), song_tempo=song_to_play_details.get('tempo'),
                       duration=duration)
    return jsonify(success=False, error='Failed to start BASS playback for song'), 500


@app.route('/api/setlists/<int:setlist_id>/song/<int:song_id_to_preload>/preload', methods=['POST'])
def preload_setlist_song(setlist_id, song_id_to_preload):
    # setlist_id is not strictly needed here if we only preload by song_id, but good for context
    if audio_player.preload_song(song_id_to_preload):
        return jsonify(success=True, message=f"Song ID {song_id_to_preload} preloaded.",
                       preloaded_song_id=song_id_to_preload)
    return jsonify(success=False, error=f"Failed to preload song ID {song_id_to_preload}."), 500


@app.route('/api/stop', methods=['POST'])
def stop_player(): audio_player.stop(); return jsonify(success=True, message='Playback stopped.')


def _get_setlist_and_songs_data(setlist_id, fetch_songs=False):
    setlist_data_file = os.path.join(DATA_DIR, SETLISTS_FILE)
    setlists_data = read_json(setlist_data_file, SETLISTS_CACHE_KEY)
    setlist = next((s for s in setlists_data.get('setlists', []) if isinstance(s, dict) and s.get('id') == setlist_id),
                   None)
    if not setlist: return None, None
    songs_data_content = None
    if fetch_songs:
        songs_data_file = os.path.join(DATA_DIR, SONGS_FILE)
        songs_data_content = read_json(songs_data_file, SONGS_CACHE_KEY)
        if not isinstance(songs_data_content, dict) or 'songs' not in songs_data_content: songs_data_content = {
            'songs': []}
    return setlist, songs_data_content


# --- UI Routes ---
@app.route('/')
def index(): return render_template('index.html')


@app.route('/setlists')
def setlists_page():
    setlists_data_val = read_json(os.path.join(DATA_DIR, SETLISTS_FILE), SETLISTS_CACHE_KEY)
    return render_template('setlists.html', setlists=setlists_data_val.get('setlists', []))


@app.route('/songs')
def songs_page():
    songs_data_val = read_json(os.path.join(DATA_DIR, SONGS_FILE), SONGS_CACHE_KEY)
    return render_template('songs.html', songs=songs_data_val.get('songs', []))


@app.route('/settings')
def settings_page(): return render_template('settings.html')


@app.route('/setlists/<int:setlist_id>/play')
def play_setlist_page(setlist_id):
    setlist_obj, songs_data_dict = _get_setlist_and_songs_data(setlist_id, fetch_songs=True)
    if not setlist_obj: abort(404)
    song_map = {s['id']: s for s in songs_data_dict.get('songs', []) if isinstance(s, dict) and 'id' in s}
    songs_in_setlist_details = []
    for s_id_in_list in setlist_obj.get('song_ids', []):
        song_detail_item = song_map.get(s_id_in_list)
        if song_detail_item:
            songs_in_setlist_details.append({
                'id': s_id_in_list,
                'name': song_detail_item.get('name'),
                'tempo': song_detail_item.get('tempo'),
                'duration': audio_player.calculate_song_duration(song_detail_item)
            })
    return render_template('setlist_player.html', setlist=setlist_obj, songs=songs_in_setlist_details)


# This route is problematic if audio_directory_path is outside 'static'
# For now, it will only work for files under the original AUDIO_UPLOAD_FOLDER_NAME if it's 'static/audio'
# A proper solution for serving files from arbitrary paths requires a dedicated download route.
@app.route('/static/audio/<path:filename>')
def serve_audio(filename):
    # This will serve from app.root_path + DEFAULT_AUDIO_UPLOAD_FOLDER_NAME
    # If the custom path is different and not under static, this won't work for those files.
    default_static_audio_path = os.path.join(app.root_path, DEFAULT_AUDIO_UPLOAD_FOLDER_NAME)
    # Check if the current audio folder is the default static one
    current_audio_folder = get_current_audio_upload_folder_abs()
    if os.path.normpath(current_audio_folder) == os.path.normpath(default_static_audio_path):
        return send_from_directory(default_static_audio_path, filename)
    else:
        # If custom path is used and it's not the default static one, we might not be able to serve directly.
        # For security and simplicity, only allow serving if it's the default static path.
        # A more robust solution would be a new endpoint that safely serves files from the custom path.
        logging.warning(
            f"Attempt to serve audio '{filename}' directly, but current audio path is custom: {current_audio_folder}. This direct static route might not work.")
        # Try to serve from custom path if it's within app.root_path for safety, otherwise abort.
        # This is a simplified check. Production systems need careful path validation.
        if current_audio_folder.startswith(app.root_path):
            try:
                return send_from_directory(current_audio_folder, filename)
            except Exception as e:
                logging.error(f"Failed to serve {filename} from {current_audio_folder}: {e}")
                abort(404)  # Or some other error
        else:
            logging.error(f"Cannot serve {filename}: Custom audio path {current_audio_folder} is outside app root.")
            abort(404)


@app.template_filter('format_duration')
def format_duration_filter(seconds):
    try:
        s_val = int(float(seconds)); return f"{s_val // 60}:{s_val % 60:02d}" if s_val >= 0 else "0:00"
    except:
        return "0:00"


@app.route('/api/settings/open_directory', methods=['POST'])
def open_directory():
    current_audio_folder_to_open = get_current_audio_upload_folder_abs()
    try:
        if not os.path.isdir(current_audio_folder_to_open):
            return jsonify(success=False, error=f'Directory not found: {current_audio_folder_to_open}'), 404

        # Ensure the directory exists before trying to open it
        Path(current_audio_folder_to_open).mkdir(parents=True, exist_ok=True)

        if sys.platform == 'win32':
            subprocess.run(['explorer', current_audio_folder_to_open], check=True)
        elif sys.platform == 'darwin':
            subprocess.run(['open', current_audio_folder_to_open], check=True)
        else:
            subprocess.run(['xdg-open', current_audio_folder_to_open], check=True)
        return jsonify(success=True, message=f"Attempted to open: {current_audio_folder_to_open}")
    except Exception as e:
        logging.error(f"Failed to open directory {current_audio_folder_to_open}: {e}")
        return jsonify(success=False, error=f"Failed to open directory: {str(e)}"), 500


@app.route('/api/clear_cache', methods=['POST'])
def clear_cache_route():
    cache.clear();
    return jsonify(success=True, message='Server cache cleared.')


@app.route('/api/factory_reset', methods=['POST'])
def factory_reset():
    logging.warning("--- Initiating Factory Reset ---")
    try:
        audio_player.stop();
        audio_player.clear_preload_state()

        # Get current audio folder BEFORE resetting settings
        current_audio_folder_before_reset = get_current_audio_upload_folder_abs()

        # Reset settings files to their initial default state (this will reset audio_directory_path)
        initialize_app_files()  # This re-initializes settings files with defaults
        cache.clear()  # Clear all cache

        # Delete files from the audio folder that was active BEFORE reset
        deleted_files_count, errors_list = 0, []
        if os.path.exists(current_audio_folder_before_reset):
            logging.info(f"Factory Reset: Deleting files from {current_audio_folder_before_reset}")
            for filename in os.listdir(current_audio_folder_before_reset):
                file_path_to_delete = os.path.join(current_audio_folder_before_reset, filename)
                try:
                    if os.path.isfile(file_path_to_delete) or os.path.islink(file_path_to_delete):
                        os.unlink(file_path_to_delete);
                        deleted_files_count += 1
                except Exception as e_del:
                    errors_list.append(f"Failed to delete {filename}: {e_del}")

        # AudioPlayer needs to be updated with the new (default) settings
        audio_player.update_audio_upload_folder_config(DEFAULT_AUDIO_UPLOAD_FOLDER_NAME)  # Set to default
        audio_player.update_settings()  # Reload all other settings (volume, sample rate, etc.)

        message = f'Factory reset complete. {deleted_files_count} audio files deleted from "{current_audio_folder_before_reset}". Audio directory reset to default.'
        if errors_list: message += f" Errors during file deletion: {', '.join(errors_list)}"
        logging.info(message)
        return jsonify(success=True, message=message)
    except Exception as e_fr:
        logging.error(f"CRITICAL error during factory reset: {e_fr}");
        traceback.print_exc()
        return jsonify(success=False, error=f"Critical factory reset error: {str(e_fr)}"), 500

