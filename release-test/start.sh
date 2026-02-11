#!/bin/bash

# Move to the script's directory so paths are chill
cd "$(dirname "$0")"

echo "🧹 Cleaning up old container vibes..."
docker-compose down --volumes --remove-orphans

echo "🚀 Launching pristine tester environment..."
# Removed --build for speed. If you change the Dockerfile, 
# run 'docker-compose build' manually, bestie.
docker-compose up -d

echo "📥 Entering the matrix (bash terminal)..."
docker-compose exec tester bash

# When the user exits the bash session, we keep the container running?
# The user asked for a "start" script that opens a terminal. 
# Usually, people want to clean up after. Let's ask or just leave it.
# Actually, the user said "reset to pristine every time I start it".
# So a cleanup before start is correct.
