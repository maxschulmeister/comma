# comma on Bun, for a VPS or any container host. See DEPLOY.md.
FROM oven/bun:1.3
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build
RUN mkdir /data && chown bun:bun /data
USER bun
ENV COMMA_DB=/data/comma.sqlite PORT=4000
VOLUME /data
EXPOSE 4000
CMD ["bun", "run", "start"]
