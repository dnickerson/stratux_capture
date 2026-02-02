# Stratux Serial Capture - Installation Guide

This bundle adds serial data capture functionality to Stratux, allowing you to capture data from `/dev/ttyUSB0` and save it to files on the Raspberry Pi.

## Contents

| File | Description |
|------|-------------|
| `install_capture.sh` | Automated installation script |
| `Raspberry_Capture.sh` | Main capture script with monitoring and auto-restart |
| `stop_capture.sh` | Helper script for stopping capture |
| `capture_status.sh` | Real-time status monitor with large ANSI display |
| `stratux_capture.service` | Systemd service for auto-start |

## Features

- Auto-starts capture when Stratux boots
- Monitors serial port and auto-restarts on failure
- Detects data stalls and recovers automatically
- Saves capture files to `/home/pi/stream_XXXX.txt`
- Works with Stratux overlay mode
- Real-time status monitor with large text display
- Counter only increments when capture actually starts (no wasted file numbers)

## Installation

### Step 1: Copy bundle to Raspberry Pi

From your computer:

```bash
scp capture_install_bundle.tar.gz pi@stratux.local:/tmp/
```

Or if copying the directory:

```bash
scp -r capture_install_bundle pi@stratux.local:/tmp/
```

### Step 2: SSH into the Pi

```bash
ssh pi@stratux.local
```

Default password: `raspberry`

### Step 3: Extract and run installer

```bash
cd /tmp
tar -xzvf capture_install_bundle.tar.gz
cd capture_install_bundle
sudo ./install_capture.sh
```

### Step 4: Follow the prompts

The installer will guide you through:

1. **Overlay check**: If overlay mode is enabled, it will be disabled and you'll need to reboot, then run the installer again.

2. **File installation**: Scripts are copied to `/opt/stratux/bin/`

3. **Service installation**: Systemd service is installed and enabled

4. **Start service**: Option to start the capture immediately

5. **Re-enable overlay**: Option to re-enable overlay mode (recommended)

## Usage

### Starting and Stopping Capture

```bash
# Start capture
sudo systemctl start stratux_capture

# Stop capture (closes the current file)
sudo systemctl stop stratux_capture

# Check status
sudo systemctl status stratux_capture

# View capture log
cat /home/pi/capture_monitor.log
```

### Status Monitor

The status monitor displays a large, easy-to-read status in the terminal:

```bash
/opt/stratux/bin/capture_status.sh
```

The monitor shows:

| Status | Color | Meaning |
|--------|-------|---------|
| RUNNING | Green | Capture active and receiving data |
| STALLED | Yellow | Process running but no data for 30+ seconds |
| CRASHED | Red | State file shows running but process is dead |
| STOPPED | Blue | Capture stopped normally |
| ERROR | Red | Capture encountered an error |

The monitor updates every 2 seconds and verifies:
- The capture process is actually running (not just trusting the state file)
- Data is flowing (file size is increasing)
- Time since last data received

Press `Ctrl+C` to exit the monitor.

### Downloading Capture Files

From your computer:

```bash
# Download all capture files
scp pi@stratux.local:/home/pi/stream_*.txt .

# Download a specific file
scp pi@stratux.local:/home/pi/stream_0001.txt .
```

### Capture File Location

All capture files are saved to `/home/pi/` with the naming convention:

```
/home/pi/stream_0001.txt
/home/pi/stream_0002.txt
/home/pi/stream_0003.txt
...
```

Each time the capture service starts, it creates a new numbered file.

## Configuration

The capture script uses these default settings:

| Setting | Value | Description |
|---------|-------|-------------|
| `SERIAL_PORT` | `/dev/ttyUSB0` | Serial port to capture from |
| `BAUD_RATE` | `115200` | Serial baud rate |
| `CAPTURE_DIR` | `/home/pi` | Directory for capture files |
| `MAX_RESTARTS` | `5` | Max restart attempts on failure |
| `STALL_TIMEOUT` | `60` | Seconds of no data before restart |

To modify these, edit `/opt/stratux/bin/Raspberry_Capture.sh` after disabling overlay mode.

## Troubleshooting

### Serial port not found

If you see "Serial port /dev/ttyUSB0 does not exist" in the log:

1. Check that the USB-serial adapter is connected
2. Verify the port with `ls /dev/ttyUSB*`
3. If using a different port, edit the script

### Permission denied on serial port

```bash
sudo chmod 666 /dev/ttyUSB0
```

Or add a udev rule for persistent permissions.

### Capture not starting on boot

```bash
# Check if service is enabled
sudo systemctl is-enabled stratux_capture

# Enable if needed
sudo systemctl enable stratux_capture
```

### View capture log for errors

```bash
cat /home/pi/capture_monitor.log
tail -f /home/pi/capture_monitor.log  # Follow live
```

## Overlay Mode Notes

Stratux uses an overlay filesystem to protect the SD card. When overlay is enabled:

- The root filesystem is read-only
- Changes are written to RAM and lost on reboot
- `/home/pi` persists because it's on a separate partition

To make permanent changes to system files:

```bash
sudo overlayctl disable
sudo reboot
# Make changes
sudo overlayctl enable
sudo reboot
```

## Uninstallation

To remove the capture functionality:

```bash
sudo overlayctl disable
sudo reboot

# After reboot:
sudo systemctl stop stratux_capture
sudo systemctl disable stratux_capture
sudo rm /lib/systemd/system/stratux_capture.service
sudo rm /opt/stratux/bin/Raspberry_Capture.sh
sudo rm /opt/stratux/bin/stop_capture.sh
sudo rm /opt/stratux/bin/capture_status.sh
sudo systemctl daemon-reload

sudo overlayctl enable
sudo reboot
```

## Support

For issues or questions, check the capture log at `/home/pi/capture_monitor.log` for diagnostic information.
