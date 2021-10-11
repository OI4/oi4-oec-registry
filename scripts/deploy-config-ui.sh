set -x

echo "Deploying Service Endpoint"

echo "var serviceEndpoint = { \
  \"port\": \"5799\", \
  \"platform\": \"fetch\" \
}; " > "$UI_SRC_PATH/../../oi4-local-ui/build/service-endpoint.js"
