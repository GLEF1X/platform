# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.2
WORKDIR /usr/src/app

# install with --production (exclude devDependencies)
COPY package.json ./
COPY bun.lock ./
RUN bun install --frozen-lockfile --production --omit dev
RUN bun install snappy
COPY build/index.js ./

# run the app
USER bun
EXPOSE 6767/tcp
ENTRYPOINT [ "bun", "run", "index.js" ]