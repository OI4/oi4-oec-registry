FROM balenalib/generic-armv7ahf-alpine-node:latest

# -------INSTALL ARM-specific dependencies
RUN apk add --no-cache python2 && apk add --no-cache make && apk add --no-cache g++ && apk add --no-cache openssl && rm -rf /var/cache/apk/*

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/OI4-Local-UI/build
ENV COCKPIT_UI_SRC_PATH=/usr/OI4-Service/uiplugin

# -------NOW LOCALUI
WORKDIR /usr/OI4-Local-UI
# --- Install serve & http-server to host local build
RUN npm install serve && npm install http-server
COPY ./OI4-Local-UI/package.json ./
COPY ./OI4-Local-UI/build ./build/

# -------COCKPIT UI
WORKDIR /usr/OI4-Service/uiplugin
COPY ./OI4-Cockpit-UI/package.json ./
COPY ./OI4-Cockpit-UI/dist ./

# -------OI4-SERVICE
WORKDIR /usr/OI4-Service
COPY ./OI4-Service/package.json ./
RUN npm install --production

# COPY Source files
COPY ./OI4-Service/out ./

# Create logs directory
RUN mkdir -p logs

# COPY Bootstrapper
COPY ./OI4-Service/bootstrapper ./bootstrapper/
COPY ./OI4-Service/scripts ./scripts/

EXPOSE 5798 5799
ENTRYPOINT ["scripts/entrypoint.sh"]