FROM python:3.11-slim

WORKDIR /app

# Combine installation of dependencies and python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose port
EXPOSE 5000

# Use gunicorn to run the app
CMD ["gunicorn", "--workers", "3", "--bind", "0.0.0.0:5000", "app:app"]
