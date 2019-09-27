#!/bin/sh -e
# script is necessary to catch all signals as PID 1 in a container

set -x
pid_oi4service=0

# SIGTERM-handler
term_handler() {

  # we undeploy first because this process might cease to exist while we wait for stoped server
  echo "undeploy ..."
  /usr/OI4-Service/bootstrapper/undeploy-config-ui.sh

  echo "terminating ..."
  if [ $pid_oi4service -ne 0 ]; then
    kill -SIGTERM "$pid_oi4service"
  fi
  wait "$pid_oi4service"
   exit 143; # 128 + 15 -- SIGTERM
}

# setup handlers
# on callback, kill the last background process, which is `tail -f /dev/null` and execute the specified handler
#      SIGINT SIGKILL SIGTERM SIGQUIT SIGTSTP SIGSTOP SIGHUP 2 9 15 3 20 19 1 
trap 'kill ${!}; term_handler' 2 9 15 3 20 19 1 

# run bootstrapper 
echo "run bootstrapper"
/usr/OI4-Service/bootstrapper/deploy-config-ui.sh

# run applications as services in the background now
echo "Starting OI4-Service and LocalUI"
node ./src/app.js & cd ../OI4-Local-UI && npx serve -s build


#get process ID of most recently executed background
pid_oi4service="$!"
echo pid_oi4service: $pid_oi4service

# wait forever not to exit the container
while true
do
  tail -f /dev/null & wait ${!}
done

exit 0