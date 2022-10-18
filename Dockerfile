FROM node:16-alpine3.16

# -------INSTALL OPENSSL
RUN apk add --update openssl && rm -rf /var/cache/apk/*

# -------FIX NPM ERRORS ON LOW MEM MACHINE
RUN npm config set unsafe-perm true

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/oi4-local-ui/build

# -------NOW LOCALUI
WORKDIR /usr/oi4-local-ui
# --- Install serve & http-server to host local build
RUN npm install http-server@14.1.0
COPY ./packages/oi4-local-ui/package.json ./
COPY ./packages/oi4-local-ui/build ./build/

# -------OI4-SERVICE
WORKDIR /usr/oi4-registry-service
COPY packages/oi4-registry-service/public ./public/
COPY packages/oi4-registry-service/package.json ./
# Temporarily copy over node_models when building the container
# This is due to currently not accounting for @oi4 scoped repos
# If this is fixed, the line npm install --production can be used again
COPY ./node_modules/@oi4 ./node_modules/@oi4
RUN npm install --production
COPY ./node_modules/@oi4 ./node_modules/@oi4

# COPY Source files
COPY packages/oi4-registry-service/dist ./src

# COPY logs directory
RUN mkdir -p logs

# COPY Scripts
COPY ./scripts ./scripts/

EXPOSE 5798 5799
RUN chmod +x "scripts/entrypoint.sh"
ENTRYPOINT ["scripts/entrypoint.sh"]
