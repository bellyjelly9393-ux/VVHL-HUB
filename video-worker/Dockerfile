FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr chromium && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir streamlink && python -m pip install --no-cache-dir -U --pre "yt-dlp[default,curl-cffi]"
WORKDIR /app
COPY . /app/
RUN useradd --create-home worker && mkdir -p /data && chown worker:worker /data
USER worker
ENV DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["python", "bootstrap.py"]
