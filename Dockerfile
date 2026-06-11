# Co-Scientist — full web stack (React UI + FastAPI + agent engine)
FROM node:20-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md LICENSE ./
COPY co_scientist/ co_scientist/
COPY config/ config/
COPY webapp/ webapp/
COPY scripts/ scripts/
COPY --from=frontend-build /build/frontend/dist frontend/dist

RUN pip install --no-cache-dir -e .

ENV CORS_ORIGINS=https://duckyquang.github.io,http://localhost:5173
EXPOSE 8080

CMD ["uvicorn", "co_scientist.web.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
