#!/bin/bash
# Stratux Serial Capture - Installation Script
# Run this script on the Raspberry Pi to install the capture functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Stratux Serial Capture Installer${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Check if required files exist
REQUIRED_FILES=(
    "Raspberry_Capture.sh"
    "stop_capture.sh"
    "capture_status.sh"
    "stratux_capture.service"
)

echo "Checking for required files..."
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        echo -e "${RED}Missing required file: $file${NC}"
        echo "Please ensure all files are in the same directory as this script:"
        echo "  - Raspberry_Capture.sh"
        echo "  - stop_capture.sh"
        echo "  - capture_status.sh"
        echo "  - stratux_capture.service"
        exit 1
    fi
done
echo -e "${GREEN}All required files found.${NC}"
echo ""

# Check overlay status
echo "Checking overlay filesystem status..."
if [ -f /sbin/overlayctl ]; then
    OVERLAY_STATUS=$(/sbin/overlayctl status 2>/dev/null || echo "unknown")
    echo "Overlay status: $OVERLAY_STATUS"

    if [[ "$OVERLAY_STATUS" == *"enabled"* ]]; then
        echo -e "${YELLOW}Overlay mode is enabled. Disabling for installation...${NC}"
        /sbin/overlayctl disable
        echo ""
        echo -e "${YELLOW}================================================${NC}"
        echo -e "${YELLOW}REBOOT REQUIRED${NC}"
        echo -e "${YELLOW}================================================${NC}"
        echo ""
        echo "Overlay mode has been disabled but requires a reboot."
        echo "Please reboot and run this script again:"
        echo ""
        echo "  sudo reboot"
        echo "  # After reboot:"
        echo "  cd $SCRIPT_DIR && sudo ./install_capture.sh"
        echo ""
        exit 0
    fi
else
    echo "overlayctl not found - assuming writable filesystem"
fi
echo ""

# Install files
echo "Installing capture scripts..."

# Copy scripts to /opt/stratux/bin/
cp -v "$SCRIPT_DIR/Raspberry_Capture.sh" /opt/stratux/bin/
cp -v "$SCRIPT_DIR/stop_capture.sh" /opt/stratux/bin/
cp -v "$SCRIPT_DIR/capture_status.sh" /opt/stratux/bin/

# Set permissions
chmod 755 /opt/stratux/bin/Raspberry_Capture.sh
chmod 755 /opt/stratux/bin/stop_capture.sh
chmod 755 /opt/stratux/bin/capture_status.sh

echo -e "${GREEN}Scripts installed to /opt/stratux/bin/${NC}"
echo ""

# Install systemd service
echo "Installing systemd service..."
cp -v "$SCRIPT_DIR/stratux_capture.service" /lib/systemd/system/
chmod 644 /lib/systemd/system/stratux_capture.service

# Reload systemd
systemctl daemon-reload

echo -e "${GREEN}Systemd service installed.${NC}"
echo ""

# Create capture directory
echo "Creating capture directory..."
mkdir -p /home/pi
chown pi:pi /home/pi 2>/dev/null || true
echo -e "${GREEN}Capture directory created at /home/pi${NC}"
echo ""

# Enable service
echo "Enabling stratux_capture service..."
systemctl enable stratux_capture
echo -e "${GREEN}Service enabled for auto-start.${NC}"
echo ""

# Ask about starting now
echo -e "${YELLOW}Would you like to start the capture service now? (y/n)${NC}"
read -r START_NOW

if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo "Starting stratux_capture service..."
    systemctl start stratux_capture
    sleep 2
    systemctl status stratux_capture --no-pager || true
    echo ""
fi

# Ask about re-enabling overlay
echo ""
echo -e "${YELLOW}Would you like to re-enable overlay mode? (y/n)${NC}"
echo "(Recommended to protect SD card from corruption)"
read -r ENABLE_OVERLAY

if [[ "$ENABLE_OVERLAY" =~ ^[Yy]$ ]]; then
    if [ -f /sbin/overlayctl ]; then
        echo "Re-enabling overlay mode..."
        /sbin/overlayctl enable
        echo ""
        echo -e "${GREEN}Overlay mode will be re-enabled after reboot.${NC}"
        echo -e "${YELLOW}Please reboot to complete the installation.${NC}"
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Usage:"
echo "  Start capture:  sudo systemctl start stratux_capture"
echo "  Stop capture:   sudo systemctl stop stratux_capture"
echo "  Check status:   sudo systemctl status stratux_capture"
echo "  Status monitor: /opt/stratux/bin/capture_status.sh"
echo "  View log:       cat /home/pi/capture_monitor.log"
echo ""
echo "Capture files are saved to: /home/pi/stream_XXXX.txt"
echo ""
echo "To download capture files from another computer:"
echo "  scp pi@stratux.local:/home/pi/stream_*.txt ."
echo ""
