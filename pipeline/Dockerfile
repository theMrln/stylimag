FROM node:22-slim

WORKDIR /app

# System deps: Chromium + fonts for Paged.js, Pandoc for MD → HTML.
# Pandoc from the Debian repo is too old; pull the official .deb.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    poppler-utils \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG PANDOC_VERSION=3.6.4
RUN ARCH=$(dpkg --print-architecture) \
    && wget -qO pandoc.deb https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-${ARCH}.deb \
    && dpkg -i pandoc.deb \
    && rm pandoc.deb

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY lib/ ./lib/
COPY templates/ ./templates/
COPY lua/ ./lua/
COPY css_files/ ./css_files/
COPY static/ ./static/

ENV PORT=3070
EXPOSE 3070

CMD ["node", "server.js"]
