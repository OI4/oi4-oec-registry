FROM node:16-alpine3.15 as build_base

# -------INSTALL OPENSSL
RUN apk add --update openssl && rm -rf /var/cache/apk/*

# -------FIX NPM ERRORS ON LOW MEM MACHINE
RUN npm config set unsafe-perm true

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/packages/oi4-local-ui/build

# -------COPY resources
WORKDIR /usr
COPY ./build/container ./

WORKDIR /usr/packages/oi4-registry-service

# COPY logs directory
RUN mkdir -p logs

LABEL org.opencontainers.image.source=https://github.com/OI4/oi4-registry

EXPOSE 5798 5799
RUN chmod +x "scripts/entrypoint.sh"
ENTRYPOINT ["scripts/entrypoint.sh"]
