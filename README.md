# Backing Track Player

A backing track player built using Python and Flask that is light-weight and supports multiple OS-s! You can configure setlists and choose different outputs for all audio files in a song.
A bachelor's thesis project in the University of Tartu, Estonia. 2025.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

* **Python:** Version 3.7 or higher is recommended. You can download it from [python.org](https://www.python.org/).
* **pip:** Python's package installer (usually comes with Python).
* **Git:** To clone the repository. You can download it from [git-scm.com](https://git-scm.com/).

## Setup Instructions (Running from Source)

Follow these steps to get the application running directly from the source code on your local machine:

1.  **Clone the Repository:**
    Open your terminal or command prompt and run:
    ```bash
    git clone https://github.com/johannmkammiste/backingtrackplayer backingtrackplayer
    cd backingtrackplayer
    ```

2.  **Create and Activate a Virtual Environment (Recommended):**
    It's best practice to use a virtual environment to manage project dependencies separately.
    ```bash
    # Create the virtual environment (use python3 if python maps to Python 2)
    python -m venv venv

    # Activate the virtual environment:
    # On Windows:
    venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate
    ```
    You should see `(venv)` at the beginning of your terminal prompt.

3.  **Install Dependencies:**
    Install all the required Python packages listed in `requirements.txt`:
    ```bash
    pip install -r requirements.txt
    ```

4. **Running the Application (from Source)**

    Once the setup is complete, you can run the Flask development server:
    
    ```bash
    python run.py
    ```

## Creating an OS specific app

You can also create an excecutable using pyinstaller.

1. **Install pyinstall**
    ```bash
    pip install pyinstaller
    ```
2. **Run pyinstaller with the following command:**
   ```bash
   pyinstaller --name BackingTrackPlayer --onefile --add-data "templates:templates" --add-data "static:static" --add-data "data:data" run.py
   ```

## Running on Startup (Linux)

This project was mostly designed with a Raspberry Pi in mind, so here are the instructions on how to run this on startup and turn your Rasperry into a kiosk:

1. **Install Raspberry Pi OS with the Desktop and do the initial setup**
   
   The author used a Raspberrry Pi 3 A+ with Raspberry Pi OS 32-bit Bookworm.
2. **Update your Raspberry Pi and install required programs**
   
   First update and install the browser and PortAudio.
    ```bash
    sudo apt update && sudo apt upgrade -y
    sudo apt install --no-install-recommends chromium-browser
    sudo apt-get install portaudio19-dev
    sudo apt-get install libopenblas-dev

    ```
   Then install the program.
   ```bash
   git clone https://github.com/johannmkammiste/backingtrackplayer backingtrackplayer
   cd backingtrackplayer
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. **Change raspi-config settings**
   ```bash
   sudo raspi-config
   ```
   Choose 1 System Options -> S5 Boot -> B4 Desktop Desktop GUI with Auto-Login
   Also make sure you are using the Wayland backend.
4. 



