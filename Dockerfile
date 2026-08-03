FROM node:24-slim
WORKDIR /app
COPY bomdb/package.json bomdb/package-lock.json bomdb/
RUN cd bomdb && npm ci --omit=dev
COPY bomdb-remote/package.json bomdb-remote/package-lock.json bomdb-remote/
RUN cd bomdb-remote && npm ci --omit=dev
COPY bomdb/src bomdb/src
COPY bomdb-remote/src bomdb-remote/src
ENV NODE_ENV=production
CMD ["node", "bomdb-remote/src/server.ts"]
