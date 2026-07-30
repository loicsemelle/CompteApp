FROM python:3.11-slim

# Install system dependencies required for woob, cryptography, lxml, gnupg, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libxml2-dev \
    libxslt-dev \
    libffi-dev \
    libssl-dev \
    git \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories for data and woob configuration
RUN mkdir -p /data/woob && mkdir -p /data/db

# Set environment variables so Woob uses the mounted volume for config and modules
ENV WOOB_WORKDIR=/data/woob
ENV WOOB_DATADIR=/data/woob

# Expose port 8000 for FastAPI
EXPOSE 8000

# Copy application source code
COPY app /app/app

# Command to run FastAPI server
CMD ["python", "-m", "app.main"]
