FROM node:12-alpine

# -------INSTALL OPENSSL
RUN apk add --update openssl && rm -rf /var/cache/apk/*

# -------FIX NPM ERRORS ON LOW MEM MACHINE
RUN npm config set unsafe-perm true

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/OI4-Local-UI/build

# -------NOW LOCALUI
WORKDIR /usr/OI4-Local-UI
# --- Install serve & http-server to host local build
RUN npm install http-server
COPY ./OI4-Local-UI/package.json ./
COPY ./OI4-Local-UI/build ./build/

# -------OI4-SERVICE
WORKDIR /usr/OI4-Service
COPY ./OI4-Service/package.json ./
RUN npm install --production

# COPY Source files
COPY ./OI4-Service/out ./

# COPY logs directory
RUN mkdir -p logs

# COPY Scripts
COPY ./scripts ./scripts/

EXPOSE 5798 5799
RUN chmod +x "scripts/entrypoint.sh"
ENTRYPOINT ["scripts/entrypoint.sh"]
