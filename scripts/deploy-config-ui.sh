set -x

echo "Deploying Service Endpoint"

echo "var serviceEndpoint = { \
  \"port\": \"5799\", \
  \"platform\": \"fetch\" \
}; " > "$UI_SRC_PATH/../../OI4-Local-UI/build/service-endpoint.js"