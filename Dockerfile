ARG BUILD_ENV=base

FROM node:16-alpine3.15 as build_base

ARG PACKAGES_AUTH_TOKEN=NOT_SET

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
COPY ./.npmrc ./

RUN npm install --omit=dev


FROM build_base as build_snapshot

ONBUILD RUN rm -rf ./node_modules/@oi4
ONBUILD COPY ./node_modules/@oi4 ./node_modules/@oi4

FROM build_${BUILD_ENV}

# COPY Source files
COPY packages/oi4-registry-service/dist ./src

# COPY logs directory
RUN mkdir -p logs

# COPY Scripts
COPY ./scripts ./scripts/

EXPOSE 5798 5799
RUN chmod +x "scripts/entrypoint.sh"
ENTRYPOINT ["scripts/entrypoint.sh"]
