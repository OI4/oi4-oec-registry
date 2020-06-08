set -x

echo "Deploy config ui"

#IP=$(printenv LOCAL_ADDR)

<<COMMENT1
echo "Create service-endpoint.js"

echo "var serviceEndpoint = { \
  \"address\": \"$IP\", \
  \"port\": \"4567\", \
  \"platform\": \"cockpit\" \
}; " > "$COCKPIT_UI_SRC_PATH/service-endpoint.js"

echo "var serviceEndpoint = { \
  \"address\": \"$IP\", \
  \"port\": \"4567\", \
  \"platform\": \"fetch\" \
}; " > "$UI_SRC_PATH/../../OI4-Local-UI/build/service-endpoint.js"
COMMENT1

echo "Create service-endpoint.js without IP entry"

echo "var serviceEndpoint = { \
  \"port\": \"4567\", \
  \"platform\": \"cockpit\" \
}; " > "$COCKPIT_UI_SRC_PATH/service-endpoint.js"

echo "var serviceEndpoint = { \
  \"port\": \"4567\", \
  \"platform\": \"fetch\" \
}; " > "$UI_SRC_PATH/../../OI4-Local-UI/build/service-endpoint.js"

echo "copying UI to host fs"
mkdir -p /usr/local/share/cockpit/OI4-Registry
cp -r $COCKPIT_UI_SRC_PATH/* /usr/local/share/cockpit/OI4-Registry/
 
echo "... done copying UI to host fs"