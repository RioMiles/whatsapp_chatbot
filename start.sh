#!/bin/bash

# Kill any existing gunicorn processes
if [ -f gunicorn.pid ]; then
    echo "Stopping existing gunicorn process..."
    kill $(cat gunicorn.pid) 2>/dev/null || true
    rm gunicorn.pid 2>/dev/null || true
fi
pkill gunicorn 2>/dev/null || true

# Update system and install basic requirements
echo "Updating system and installing basic requirements..."
sudo yum update -y
sudo yum install git -y

# Install required system dependencies for AWS EC2
echo "Installing system dependencies..."
sudo yum install -y \
    atk \
    atk-devel \
    at-spi2-atk \
    cups-libs \
    dbus-glib \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    pango-devel \
    alsa-lib \
    xorg-x11-fonts-Type1 \
    xorg-x11-utils \
    libxkbcommon \
    libdrm \
    gtk3 \
    libgbm

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
fi

# Install Python and pip if not already installed
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3 and pip..."
    sudo yum install -y python3 python3-pip
fi

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
npm install
pip3 install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "======================================"
echo "Server will be accessible at:"
echo "http://$PUBLIC_IP:8080"
echo "======================================"

# Wait a moment to ensure the port is free
sleep 2

# Start the Flask application with Gunicorn
./venv/bin/gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid
