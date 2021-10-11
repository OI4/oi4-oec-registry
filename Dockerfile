FROM node:10-alpine

# -------INSTALL OPENSSL
RUN apk add --update openssl && rm -rf /var/cache/apk/*

# -------FIX NPM ERRORS ON LOW MEM MACHINE
RUN npm config set unsafe-perm true

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/oi4-local-ui/build

# -------NOW LOCALUI
WORKDIR /usr/oi4-local-ui
# --- Install serve & http-server to host local build
RUN npm install http-server
COPY ./packages/oi4-local-ui/package.json ./
COPY ./packages/oi4-local-ui/build ./build/

# -------OI4-SERVICE
WORKDIR /usr/oi4-registry-service
COPY packages/oi4-registry-service/package.json ./
# RUN npm install --production
COPY ./packages/oi4-registry-service/node_modules ./node_modules

# COPY Source files
COPY packages/oi4-registry-service/out ./

# COPY logs directory
RUN mkdir -p logs

# COPY Scripts
COPY ./scripts ./scripts/

EXPOSE 5798 5799
RUN chmod +x "scripts/entrypoint.sh"
ENTRYPOINT ["scripts/entrypoint.sh"]
