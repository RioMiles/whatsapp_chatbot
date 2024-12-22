#!/bin/bash

if [ -f gunicorn.pid ]; then
    echo "Stopping gunicorn process..."
    kill $(cat gunicorn.pid)
    rm gunicorn.pid
else
    echo "No gunicorn.pid found, trying pkill..."
    pkill gunicorn
fi

# Stop Node.js app
if [ -f node.pid ]; then
    kill $(cat node.pid)
    rm node.pid
fi

echo "Application stopped"