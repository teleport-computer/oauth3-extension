FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --no-fund --no-audit
COPY playwright.config.ts e2e.spec.ts ./

# Wait for the oauth3-server to answer, then run the spec against the injected extension.
CMD ["sh", "-c", "until curl -sf http://localhost:3100/api/health >/dev/null; do echo 'waiting for server...'; sleep 1; done && npx playwright test"]
