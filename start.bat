@echo off
call npm install
call pip install -r requirements.txt
set FLASK_ENV=production
set FLASK_APP=dashboard.py
python -m flask run --host=0.0.0.0 --port=8080