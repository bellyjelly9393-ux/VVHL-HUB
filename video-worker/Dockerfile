FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker.py /app/worker.py
RUN useradd --create-home worker && mkdir /data && chown worker:worker /data
USER worker
ENV DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["python", "worker.py"]
