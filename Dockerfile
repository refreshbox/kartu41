# Dockerfile for kartu41 Python project
# Use official Python image as base
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements if available and install
COPY requirements.txt ./
RUN pip install --upgrade pip && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

# Copy project files
COPY . .

# Expose port (adjust if your app uses a different port)
EXPOSE 4000

# Default command with threaded worker + simple-websocket support
CMD ["gunicorn", "-w", "1", "--threads", "100", "--timeout", "120", "--bind", "0.0.0.0:4000", "app:app"]
