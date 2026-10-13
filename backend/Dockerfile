FROM python:3.11-slim

# Create a non-root user with UID 1000 as required by Hugging Face Spaces
RUN useradd -m -u 1000 user

WORKDIR /app

# Copy requirements first for Docker layer caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend.py .

# Switch to the non-root user
USER user

# Hugging Face Spaces uses port 7860 by default
EXPOSE 7860

# Start the FastAPI application
CMD ["uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "7860"]