set -x

echo "Create service-endpoint.js"

IP=$(printenv LOCAL_ADDR)

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

echo "copying UI to host fs"
mkdir -p /usr/local/share/cockpit/OI4-Registry
cp -r $COCKPIT_UI_SRC_PATH/* /usr/local/share/cockpit/OI4-Registry/
 
echo "... done copying UI to host fs"