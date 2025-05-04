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
    git clone backingtrackplayer https://github.com/johannmkammiste/backingtrackplayer
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

You might want the Backing Track Player server to start automatically when your Linux machine boots up. Here are a couple of common methods:

### Method 1: Using `systemd` (Recommended)

This is the standard and most robust method for managing services on modern Linux distributions (like Ubuntu, Debian, Fedora, CentOS 7+, Arch Linux, etc.).

1.  **Prerequisites:** Ensure you have already followed the **Setup Instructions (Running from Source)** section, so the code is cloned, the virtual environment (`venv`) is created, and dependencies (`requirements.txt`) are installed.**

2.  **Create a `systemd` Service File:**
    You'll need root privileges to create a service file. Open a text editor with `sudo`, for example:
    ```bash
    sudo nano /etc/systemd/system/backingtrackplayer.service
    ```

3.  **Paste and Edit the Service Configuration:**
    Copy the following template into the editor. **Crucially, you MUST replace** `/path/to/your/backingtrackplayer` with the **absolute path** to your project's root directory (where `run.py` and `venv` are located) and `your_user` with the **actual Linux username** that owns the files and should run the application (running services as `root` is discouraged).

    ```ini
    [Unit]
    Description=Backing Track Player Flask Application
    After=network.target

    [Service]
    User=your_user
    Group=your_user # Often the same as the user
    WorkingDirectory=/path/to/your/backingtrackplayer
    # Option 1: Using the Flask development server (NOT recommended for production/autostart)
    # ExecStart=/path/to/your/backingtrackplayer/venv/bin/python /path/to/your/backingtrackplayer/run.py

    # Option 2: Using Gunicorn (RECOMMENDED for production/autostart)
    # First, install Gunicorn: /path/to/your/backingtrackplayer/venv/bin/pip install gunicorn
    ExecStart=/path/to/your/backingtrackplayer/venv/bin/gunicorn --workers 3 --bind 0.0.0.0:5000 app:app

    Restart=on-failure
    # Optional: Redirect stdout/stderr to syslog (useful for logging)
    # StandardOutput=syslog
    # StandardError=syslog
    # SyslogIdentifier=backingtrackplayer

    [Install]
    WantedBy=multi-user.target
    ```

    **Explanation & Choices:**
    * `WorkingDirectory`: Essential for the app to find its files (`data`, `static`, `templates`). Use the *absolute path*.
    * `User`/`Group`: Specify the non-root user who will run the process.
    * `ExecStart`: This is the command to start the app.
        * **Choose only ONE `ExecStart` line.** Uncomment the one you want to use and keep the other commented out (lines starting with `#`).
        * **Gunicorn (Recommended):** The line using `gunicorn` is strongly recommended for stability and performance when running automatically. It uses the `app` instance directly from your `app.py` file (`app:app`).
            * Make sure you install `gunicorn` first: `/path/to/your/backingtrackplayer/venv/bin/pip install gunicorn`
            * `--workers 3`: Adjust the number of worker processes based on your server's CPU cores (a common starting point is `2 * num_cores + 1`).
            * `--bind 0.0.0.0:5000`: Makes the app accessible from other devices on your network. Change to `127.0.0.1:5000` to only allow access from the machine itself. Change `5000` if you need a different port.
        * **Flask Dev Server:** The line using `python run.py` uses Flask's built-in server. It's simpler but **not designed for production or unattended use** (less efficient, less secure, potentially less stable). Only use this if you understand the limitations.
    * `Restart=on-failure`: Restarts the service if it exits with an error code.

4.  **Save and Close:** Save the file and exit the editor (e.g., `Ctrl+X`, then `Y`, then `Enter` in `nano`).

5.  **Reload `systemd`, Enable and Start the Service:**
    ```bash
    # Reload systemd to recognize the new service file
    sudo systemctl daemon-reload

    # Enable the service to start automatically on boot
    sudo systemctl enable backingtrackplayer.service

    # Start the service immediately (optional)
    sudo systemctl start backingtrackplayer.service
    ```

6.  **Check Status and Logs:**
    ```bash
    # Check if the service is running and see recent logs
    sudo systemctl status backingtrackplayer.service

    # View detailed logs (follow with -f to stream live logs)
    sudo journalctl -u backingtrackplayer.service
    # (Press 'q' to exit journalctl)
    ```

### Method 2: Using `cron @reboot` (Simpler Alternative)

This method is less flexible than `systemd` but can be easier for simple use cases. It runs a command once after the system boots.

1.  **Prerequisites:** Same as for `systemd` - ensure the project is set up and dependencies installed.

2.  **Edit Crontab:**
    Open the crontab editor for your user:
    ```bash
    crontab -e
    ```
    (If prompted, choose an editor like `nano`).

3.  **Add the `@reboot` Command:**
    Add the following line at the end of the file. **Again, replace** `/path/to/your/backingtrackplayer` with the **absolute path** to your project directory.

    ```bash
    @reboot cd /path/to/your/backingtrackplayer && /path/to/your/backingtrackplayer/venv/bin/python /path/to/your/backingtrackplayer/run.py >> /path/to/your/backingtrackplayer/cron.log 2>&1
    ```

    **Explanation:**
    * `@reboot`: Specifies the job runs once at startup.
    * `cd /path/to/your/backingtrackplayer`: Changes to the correct working directory *before* running the script. This is important.
    * `/path/to/.../venv/bin/python .../run.py`: Executes the script using the Python from the virtual environment. Use *absolute paths*.
    * `>> /path/to/your/backingtrackplayer/cron.log 2>&1`: **Crucial for debugging.** This redirects all output (standard output and standard error) to a log file named `cron.log` within   your project directory. Without this, you won't see any errors or output from the script when run via cron. Make sure the directory `/path/to/your/backingtrackplayer/` is writable by the user whose crontab you are editing.

4.  **Save and Close:** Save the file and exit the editor. Cron will automatically apply the changes.

**Limitations of `cron @reboot`:**
* No automatic restart if the application crashes.
* Less sophisticated logging and status checking compared to `systemd`.
* May run before all necessary services (like networking) are fully up, though `systemd` handles this better with `After=network.target`.

Choose the method that best suits your needs and technical comfort level. For unattended servers, `systemd` is generally the superior choice.

   
