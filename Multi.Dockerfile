FROM node:10-alpine

# -------INSTALL OPENSSL
RUN apk add --update openssl && rm -rf /var/cache/apk/*

# -------FIX NPM ERRORS ON LOW MEM MACHINE
RUN npm config set unsafe-perm true

# -------ADD ENVIRONMENT PATHS
ENV UI_SRC_PATH=/usr/OI4-Local-UI/build
ENV COCKPIT_UI_SRC_PATH=/usr/OI4-Service/uiplugin

# -------NOW LOCALUI
WORKDIR /usr/OI4-Local-UI
# --- Install serve & http-server to host local build
RUN npm install http-server
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

# COPY logs directory
RUN mkdir -p logs

# COPY Bootstrapper
COPY ./OI4-Service/bootstrapper ./bootstrapper/
COPY ./OI4-Service/scripts ./scripts/

EXPOSE 5798 5799
ENTRYPOINT ["scripts/entrypoint.sh"]