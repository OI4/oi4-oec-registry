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

# Run applications as services
echo "Starting OI4-Registry-Service"
exec node ./src/app.js &

# Get process ID of most recently executed process (http-server hopefully)
pid_registryui="$!"
echo pid_registryui: $pid_registryui

# Wait forever in order to not exit the container
while true
do
  tail -f /dev/null & wait ${!}
done

exit 0
