set -x

echo "Deploying Service Endpoint"

echo "var serviceEndpoint = { \
  \"address\": \"${SERVICE_ENDPOINT_ADDRESS}\", \
  \"port\": ${SERVICE_ENDPOINT_PORT}, \
  \"platform\": \"fetch\" \
}; " > "$UI_SRC_PATH/../../oi4-local-ui/build/service-endpoint.js"
