from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
from functools import wraps
import json
import os
import logging
import subprocess
import signal
import shutil
import time
from datetime import datetime, timedelta

app = Flask(__name__)
# Replace with a strong secret key
app.secret_key = 'hgfdsdfghjhgfdrty5434567uyt56uhgfrt6y78765432ertyj'
logging.basicConfig(level=logging.DEBUG)

# Add these global variables at the top level
bot_process = None
bot_connected = False
APPOINTMENTS_FILE = 'appointments.json'

def load_appointments():
    if os.path.exists(APPOINTMENTS_FILE):
        try:
            with open(APPOINTMENTS_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_appointment(appointment):
    try:
        appointments = load_appointments()
        appointments.append(appointment)
        with open(APPOINTMENTS_FILE, 'w') as f:
            json.dump(appointments, f, indent=2)
        print(f"✅ Appointment saved successfully: {appointment.get('invitee_name')} - {appointment.get('start_time')}")
    except Exception as e:
        print(f"❌ Error saving appointment: {str(e)}")

@app.route('/save_appointment', methods=['POST'])
def save_new_appointment():
    try:
        data = request.json
        print(f"📅 Received new appointment data: {data}")
        save_appointment(data)
        return jsonify({"success": True, "message": "Appointment saved successfully"})
    except Exception as e:
        print(f"❌ Error in save_new_appointment: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


@app.route('/get_appointments')
@login_required
def get_appointments():
    appointments = load_appointments()

    # Get filter parameters
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    status = request.args.get('status')
    search = request.args.get('search', '').lower()

    # Apply filters
    if start_date:
        start_date = datetime.strptime(start_date, '%Y-%m-%d')
        appointments = [a for a in appointments if datetime.strptime(
            a['start_time'].split('T')[0], '%Y-%m-%d') >= start_date]

    if end_date:
        end_date = datetime.strptime(end_date, '%Y-%m-%d')
        appointments = [a for a in appointments if datetime.strptime(
            a['start_time'].split('T')[0], '%Y-%m-%d') <= end_date]

    if status:
        appointments = [a for a in appointments if a.get(
            'status', '').lower() == status.lower()]

    if search:
        appointments = [a for a in appointments if
                        search in a.get('invitee_name', '').lower() or
                        search in a.get('invitee_email', '').lower()]

    return jsonify(appointments)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username == 'ai' and password == 'WH102938jp..@' :
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))


@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/get_qr_code')
@login_required
def get_qr_code():
    qr_code_file = 'qr_code.png'
    if os.path.exists(qr_code_file):
        return send_file(qr_code_file, mimetype='image/png')
    return jsonify({"message": "QR code not available"})


@app.route('/bot_status')
@login_required
def bot_status():
    global bot_connected
    return jsonify({"connected": bot_connected})


@app.route('/is_bot_ready')
@login_required
def is_bot_ready():
    global bot_connected
    return jsonify({"ready": bot_connected})


@app.route('/qr_code_exists')
@login_required
def qr_code_exists():
    return jsonify({"exists": os.path.exists('qr_code.png')})


@app.route('/set_bot_connected', methods=['POST'])
def set_bot_connected():
    global bot_connected
    bot_connected = True
    if os.path.exists('qr_code.png'):
        os.remove('qr_code.png')
    return jsonify({"message": "Bot connection status updated", "ready": True})


@app.route('/reset_bot')
@login_required
def reset_bot():
    global bot_process, bot_connected
    
    # Stop the bot if it's running
    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None
    
    # Clear the auth directory
    cache_dir = '.wwebjs_auth'
    if os.path.exists(cache_dir):
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                shutil.rmtree(cache_dir)
                break
            except PermissionError:
                if attempt < max_attempts - 1:
                    time.sleep(1)
                else:
                    return jsonify({"message": "Failed to remove cache. Please try again.", "connected": False})
    
    # Remove old QR code if it exists
    if os.path.exists('qr_code.png'):
        try:
            os.remove('qr_code.png')
        except PermissionError:
            pass
    
    # Start the bot
    bot_process = subprocess.Popen(['node', 'index.js'])
    bot_connected = False
    
    return jsonify({"message": "Bot reset successfully. Please scan the new QR code.", "connected": False})


@app.route('/set_bot_disconnected', methods=['POST'])
def set_bot_disconnected():
    global bot_connected
    bot_connected = False
    return jsonify({'message': 'Bot disconnected status updated'})


@app.route('/start_bot')
@login_required
def start_bot():
    global bot_process, bot_connected
    
    # If bot is already running, return success
    if bot_process is not None and bot_process.poll() is None:
        return jsonify({"message": "Bot is already running", "connected": bot_connected})
    
    # Start the bot
    bot_process = subprocess.Popen(['node', 'index.js'])
    
    return jsonify({"message": "Bot started successfully", "connected": False})


@app.route('/debug/appointments', methods=['GET'])
@login_required
def debug_appointments():
    try:
        appointments = load_appointments()
        return jsonify({
            "total_appointments": len(appointments),
            "appointments": appointments,
            "file_exists": os.path.exists(APPOINTMENTS_FILE),
            "file_size": os.path.getsize(APPOINTMENTS_FILE) if os.path.exists(APPOINTMENTS_FILE) else 0
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/delete_appointment/<int:index>', methods=['DELETE'])
@login_required
def delete_appointment(index):
    try:
        appointments = load_appointments()
        if 0 <= index < len(appointments):
            deleted_appointment = appointments.pop(index)
            with open(APPOINTMENTS_FILE, 'w') as f:
                json.dump(appointments, f, indent=2)
            return jsonify({
                "success": True, 
                "message": f"Appointment for {deleted_appointment.get('invitee_name')} deleted successfully"
            })
        return jsonify({"success": False, "error": "Appointment not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/download_appointment/<int:index>')
@login_required
def download_appointment(index):
    try:
        appointments = load_appointments()
        if 0 <= index < len(appointments):
            appointment = appointments[index]
            filename = f"appointment_{appointment['invitee_name']}_{appointment['start_time'].split('T')[0]}.json"
            # Create a temporary file
            temp_path = os.path.join(os.path.dirname(APPOINTMENTS_FILE), filename)
            with open(temp_path, 'w') as f:
                json.dump(appointment, f, indent=2)
            
            # Send file and then delete it
            response = send_file(
                temp_path,
                as_attachment=True,
                download_name=filename,
                mimetype='application/json'
            )
            
            # Delete temp file after sending
            @response.call_on_close
            def cleanup():
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                    
            return response
        return jsonify({"error": "Appointment not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/download_all_appointments')
@login_required
def download_all_appointments():
    try:
        appointments = load_appointments()
        if not appointments:
            return jsonify({"error": "No appointments found"}), 404
            
        filename = f"all_appointments_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        temp_path = os.path.join(os.path.dirname(APPOINTMENTS_FILE), filename)
        
        with open(temp_path, 'w') as f:
            json.dump(appointments, f, indent=2)
        
        response = send_file(
            temp_path,
            as_attachment=True,
            download_name=filename,
            mimetype='application/json'
        )
        
        @response.call_on_close
        def cleanup():
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")
    app.run(debug=True, host='0.0.0.0', port=8080)
