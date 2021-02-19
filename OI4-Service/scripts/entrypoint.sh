#!/bin/sh -e

# We use a script as we want to pass signal from Docker to all child processes
# in this file (PID 1)

set -x
# Set initial oi4service pid
pid_registryui=0

# SIGTERM-handler
term_handler() {
  # We undeploy first because this process might cease to exist while we wait for stoped server
  echo "Undeploy..."
  /usr/OI4-Service/bootstrapper/undeploy-config-ui.sh

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

# Run deploy script
echo "Run deploy script"
/usr/OI4-Service/bootstrapper/deploy-config-ui.sh

# Run applications as services in the background now
echo "Starting OI4-Service and LocalUI"
exec node ./src/app.js & cd ../OI4-Local-UI

# Conditional entry: Unsecure Frontend / Secure frontend
if [ "$USE_HTTPS" = "true" ];
then
  echo "USE_HTTPS true detected..."
  FILE=/usr/local/share/oi4registry/cert/cert.pem
	if [ -f "$FILE" ];
    then
		echo "$FILE exists, serving https without creating own certificate"
	else
		echo "$FILE does not exist! creating own certificate..."
    mkdir -p /usr/local/share/oi4registry/cert
		openssl req -newkey rsa:2048 -new -nodes -x509 -days 300 -keyout /usr/local/share/oi4registry/cert/key.pem -out /usr/local/share/oi4registry/cert/cert.pem -subj "/C=DE/C=DE/ST=Hesse/O=HilscherTest/OU=Org/CN=localhost"
	fi
	exec npx http-server -S -C /usr/local/share/oi4registry/cert/cert.pem -K /usr/local/share/oi4registry/cert/key.pem --cors -p 5000 build &
else
   echo "USE_HTTPS other than true detected...serving without https"
   exec npx http-server --cors -p 5000 build &
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