#!/bin/bash

# Check for required tools and install if needed
if ! command -v git &> /dev/null; then
    echo "Installing Git..."
    sudo apt-get install -y git
fi

if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    sudo apt-get install -y nodejs
    sudo apt-get install -y npm
fi

if ! command -v python3 &> /dev/null; then
    echo "Installing Python..."
    sudo apt-get install -y python3 python3-pip
fi

# Install Python packages and Node modules
echo "Installing Node modules..."
npm install

echo "Installing Python packages..."
pip3 install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Start the Flask application with waitress
echo "Starting Flask application..."
python3 -c "from waitress import serve; from dashboard import app; serve(app, host='0.0.0.0', port=8080)"
