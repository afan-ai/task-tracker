FROM oven/bun:alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data
EXPOSE 6967
CMD ["bun", "run", "start"]
