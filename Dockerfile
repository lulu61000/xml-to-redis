FROM python:3.12-slim

WORKDIR /app

# Install the Redis client library first, so this layer is cached
# and not reinstalled every time the script changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY export.py .

# Arguments given to "docker compose run app ..." are appended to this command.
ENTRYPOINT ["python", "export.py"]
