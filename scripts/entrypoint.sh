#!/bin/sh -e

# We use a script as we want to pass signal from Docker to all child processes
# in this file (PID 1)

set -x
# Set initial oi4service pid
pid_registryui=0

# Default behaviour is with USE_HTTPS true
if [ "$USE_HTTPS" != "false" ]
then
 export USE_HTTPS="true"
fi

# SIGTERM-handler
term_handler() {
  echo "Terminating..."
  if [ $pid_registryui -ne 0 ]; then
    kill -SIGTERM "$pid_registryui"
  fi
  wait "$pid_registryui"
   exit 143; # 128 + 15 -- SIGTERM
}

# On callback, kill the last background process, which is `tail -f /dev/null` and execute the specified handler
echo "Setup SIGTERM trap"
trap 'kill ${!}; term_handler' SIGHUP SIGINT SIGTERM

# Prepare settings for deploy script
if [[ -z "${OI4_EDGE_APPLICATION_PORT}" ]]; then
  export OI4_EDGE_APPLICATION_PORT=5799
fi

# Run deploy script
echo "Run deploy script"
chmod +x "/usr/oi4-registry-service/scripts/deploy-config-ui.sh"
/usr/oi4-registry-service/scripts/deploy-config-ui.sh

# Run applications as services in the background now
echo "Starting OI4-Registry-Service and LocalUI"
exec node ./src/app.js & cd ../oi4-local-ui

# Conditional entry: Unsecure Frontend / Secure frontend
if [ "$USE_HTTPS" = "true" ];
then
  echo "USE_HTTPS true detected..."
  FILE=/run/secrets/mqtt_private_key.pem
	if [ -f "$FILE" ];
    then
		echo "$FILE exists, serving https without creating own certificate"
	else
		echo "$FILE does not exist! creating own certificate..."
		mkdir -p /etc/oi4/certs
		mkdir -p /run/secrets/
		openssl req -newkey rsa:2048 -new -nodes -x509 -days 300 -keyout /run/secrets/mqtt_private_key.pem -out /etc/oi4/certs/$HOSTNAME.pem -subj "/C=CH/C=DE/ST=BL/O=Oi4MembersTest/OU=Org/CN=localhost"
	fi
	exec npx http-server -S -C /etc/oi4/certs/$HOSTNAME.pem -K /run/secrets/mqtt_private_key.pem --cors -p 5798 build &
else
   echo "USE_HTTPS other than true detected...serving without https"
   exec npx http-server --cors -p 5798 build &
fi

# Get process ID of most recently executed process (http-server hopefully)
pid_registryui="$!"
echo pid_registryui: $pid_registryui

# Wait forever in order to not exit the container
while true
do
  tail -f /dev/null & wait ${!}
done

exit 0
