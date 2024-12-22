# # #!/bin/bash

# # # Kill any existing Gunicorn processes
# # if [ -f gunicorn.pid ]; then
# #     echo "Stopping existing Gunicorn process..."
# #     kill $(cat gunicorn.pid) 2>/dev/null || true
# #     rm gunicorn.pid 2>/dev/null || true
# # fi
# # pkill gunicorn 2>/dev/null || true

# # # Update system and install basic requirements
# # echo "Updating system and installing basic requirements..."
# # sudo apt update -y
# # sudo apt upgrade -y
# # sudo apt install -y git curl

# # # Install required system dependencies
# # echo "Installing system dependencies..."
# # sudo apt install -y \
# #     libatk1.0-0 \
# #     libatk-bridge2.0-0 \
# #     libcups2 \
# #     dbus-x11 \
# #     libxcomposite1 \
# #     libxcursor1 \
# #     libxdamage1 \
# #     libxext6 \
# #     libxi6 \
# #     libxrandr2 \
# #     libxss1 \
# #     libxtst6 \
# #     libpango-1.0-0 \
# #     libpangoft2-1.0-0 \
# #     libpangocairo-1.0-0 \
# #     alsa-utils \
# #     xfonts-base \
# #     libxkbcommon0 \
# #     libdrm2 \
# #     libgbm1 \
# #     gtk3

# # # Install Node.js 18.x if not already installed
# # if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
# #     echo "Installing Node.js 18.x..."
# #     curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
# #     sudo apt install -y nodejs
# # fi

# # # Install Python 3 and pip if not already installed
# # if ! command -v python3 &> /dev/null; then
# #     echo "Installing Python3 and pip..."
# #     sudo apt install -y python3 python3-pip
# # fi

# # # Install `python3-venv` if not installed
# # if ! dpkg -s python3-venv &> /dev/null; then
# #     echo "Installing python3-venv..."
# #     sudo apt install -y python3-venv
# # fi

# # # Create and activate virtual environment
# # if [ ! -d venv ]; then
# #     echo "Creating virtual environment..."
# #     python3 -m venv venv
# # fi

# # echo "Activating virtual environment..."
# # source venv/bin/activate

# # # Install dependencies
# # echo "Installing dependencies..."
# # npm install
# # pip install --upgrade pip
# # pip install -r requirements.txt

# # # Set environment variables
# # export FLASK_ENV=production
# # export FLASK_APP=dashboard.py

# # # Get public IP
# # PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")
# # echo "======================================"
# # echo "Server will be accessible at:"
# # echo "http://$PUBLIC_IP:8080"
# # echo "======================================"

# # # Wait a moment to ensure the port is free
# # sleep 2

# # # Start the Flask application with Gunicorn
# # echo "Starting Flask application with Gunicorn..."
# # ./venv/bin/gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid



# # --------------------------------------------------------------

# #!/bin/bash
# is_port_in_use() {
#     local PORT=$1
#     lsof -i:"$PORT" > /dev/null 2>&1
# }

# is_gunicorn_running_on_port() {
#     local PORT=$1
#     lsof -i:"$PORT" | grep -q gunicorn
# }

# PORT=8080

# if is_port_in_use $PORT; then
#     if is_gunicorn_running_on_port $PORT; then
#         echo "Gunicorn is already running on port $PORT. Exiting gracefully."
#     else
#         echo "Port $PORT is in use by another process. Exiting gracefully."
#     fi
#     exit 1
# fi

# if [ -f gunicorn.pid ]; then
#     echo "Stopping existing Gunicorn process using PID file..."
#     kill $(cat gunicorn.pid) 2>/dev/null || true
#     rm gunicorn.pid 2>/dev/null || true
# fi

# echo "Updating system and installing basic requirements..."
# sudo apt update -y
# sudo apt upgrade -y
# sudo apt install -y git curl

# echo "Installing system dependencies..."
# sudo apt install -y \
#     libatk1.0-0 \
#     libatk-bridge2.0-0 \
#     libcups2 \
#     dbus-x11 \
#     libxcomposite1 \
#     libxcursor1 \
#     libxdamage1 \
#     libxext6 \
#     libxi6 \
#     libxrandr2 \
#     libxss1 \
#     libxtst6 \
#     libpango-1.0-0 \
#     libpangoft2-1.0-0 \
#     libpangocairo-1.0-0 \
#     alsa-utils \
#     xfonts-base \
#     libxkbcommon0 \
#     libdrm2 \
#     libgbm1 \
#     gtk3

# if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
#     echo "Installing Node.js 18.x..."
#     curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
#     sudo apt install -y nodejs
# fi

# if ! command -v python3 &> /dev/null; then
#     echo "Installing Python3 and pip..."
#     sudo apt install -y python3 python3-pip
# fi

# if ! dpkg -s python3-venv &> /dev/null; then
#     echo "Installing python3-venv..."
#     sudo apt install -y python3-venv
# fi

# if [ ! -d venv ]; then
#     echo "Creating virtual environment..."
#     python3 -m venv venv
# fi

# echo "Activating virtual environment..."
# source venv/bin/activate

# # Install dependencies
# echo "Installing dependencies..."
# npm install
# pip install --upgrade pip
# pip install -r requirements.txt

# export FLASK_ENV=production
# export FLASK_APP=dashboard.py

# PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")
# echo "======================================"
# echo "Server will be accessible at:"
# echo "http://$PUBLIC_IP:$PORT"
# echo "======================================"

# echo "Starting Flask application with Gunicorn..."
# ./venv/bin/gunicorn --bind 0.0.0.0:$PORT dashboard:app --pid gunicorn.pid



#=================================================================================
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
