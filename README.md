# Quick Start!
## Prerequisite
Windows: Make sure that mingw32-make.exe is installed and in your PATH.\
Linux: Make sure that make is installed and in your PATH.

## Let's go!
Checkout the project root (you should see 3 Folders with an OI4-Prefix and this README).\
In your commandline, switch to this folder and run
* ```npm run installAll```
* ```npm run buildAll<OS>``` (either ```npm run buildAllWindows``` or ```npm run buildAllLinux```)
* ```docker build -t <yourTagName> -f <architecture>.Dockerfile .```

Proceed to the Docker-section of the README in order to learn how to start the resulting container image.

# OI4-Service (Alpha)

### Folder structure:
* src
    * Application: Here are the applications (like Base, Conformity Validator, Registry)
    * Config: Most files can be ignored, but masterAssetModel.json needs to be adjusted to suit your application
    * Service: This is the main component and provides OI4-compatibility, most importantly the OI4-compatible proxies
        * Container: Here, most of the "Resource" functionality of OI4 is stored (like health, licenses etc.)
        * Enums: 
        * Models:
        * Proxy: Here, both OI4-Proxies are located. Most of the message bus communication is handled here, as well as the (non-OI4-conform) REST API
        * Utilities: Here, some Utilities are located. Most importantly "OPCUABuilder", which can be used to build an OI4-conform OPCUA Data/Metadata message
* app.ts: This is the entrypoint of the OI4-Service. The following lines MUST come first in order to instantiate the proxies with the containerState (MessageBus + REST API)

```
const contState = new ContainerState();
const busProxy = new OI4MessageBusProxy(contState);
const webProxy = new OI4WebProxy(contState);
```

After that, the proxies can be used to interact with an application.
4 Application Examples can be found, as well as their implementation in app.ts.

In order to make the MessageBus work inside a container, the following Environment Variables need to be set:
> OI4_ADDR=\<IP of Broker\>\
> OI4_PORT=\<Port of Broker\>\
> LOCAL_ADDR=\<IP of Docker HOST(!)\>(optional, if UI-component is used in conjunction with OI4-Service)
> CONTAINERNAME=\<Name of docker container\> (used for SerialNumber in MasterAssetSet, must be unique)

alternatively, a .env file can be placed inside the **out** folder containing these environment variables.

### MasterAssetModel
The MasterAssetSet can be found in ```src/config/masterAssetModel.json``` and should be adjusted for your container.

### Installation / Launch:
checkout the project and run ```npm install --production```
change the port in ```src/Proxy/Web/index.ts``` to fit your needs. (optional)\
set the environment variables as stated above or create a .env file in ```out/.env``` in order to connect to your local broker\
run ```npm run tsc``` in order to build the project to the **out** folder\
running the project manually, run ```node out/app.js``` or, inside vscode, just run the project like you normally would.\
VSCode debug configurations are provided and strongly recommended for a manual launch...

# OI4-Local-UI
The UI utilizes the Web-API of the OI4-Service, as well as the Registry application.

### Installation / Launch:
checkout the project and run ```npm install --production```\
the local-ui will take address and port of ```service-endpoint.js``` from its **build** folder as a reference to which webAPI it's going to to call.\
add / change the file to fit your OI4-Service Endpoint. The bootstrapper in *OI4-Service* will do this for you when you create the container.\
run either ```npm start``` or ```npm run build & npx serve build/``` respectively to either start
* the development environment: https://localhost:3000
* the production environment: https://localhost:5000

# OI4-Cockpit-UI
The cockpit UI uses the same codebase as the local UI, but needs a different REST-API (the one cockpit provides) in order to allow mixed-content.\

### Installation / Launch:
the local-ui will take address and port of ```service-endpoint.js``` from its **dist** folder as a reference to which webAPI it's going to to call.\
add / change the file to fit your OI4-Service Endpoint. The bootstrapper in *OI4-Service* will do this for you when you create the container.\
run ```make``` if you are on linux, or an alternative on windows, e.g ```mingw32-make.exe```.\
Place or Symlink the **dist** folder to your cockpit installation. The bootstrapper provided in *OI4-Service* will do this for you, if used on a netIOT Edge Gateway.\



# Docker-Container:
make sure that you've installed / built all Components (OI4-Local-UI, OI4-Container-UI and OI4-Service) as per instructions above.\
a simplified build instruction can used by going into the project root and executing npm run buildAll. This will take a while...\
run ```docker build -t <yourTagName> -f <architecture>.Dockerfile .```\
with the image, create a container, which will have the following options:\
Environment variables:
> OI4_ADDR=\<IP of Broker\>\
> OI4_PORT=\<Port of Broker\>\
> LOCAL_ADDR=\<IP of docker HOST(!)\>(used for UI-REST API calls)\
> CONTAINERNAME=\<Name of docker container\> (used for SerialNumber in MasterAssetSet, must be unique)

Next, the ports for ```4567:4567``` and ```5000:5000``` need to be forwarded in order to work. (TCP)

As a last step, if you are using the Cockpit-Plugin, the following path needs to be bound and existing (writable): ```usr/local/share/cockpit```.
If you don't want to use the Cockpit-Plugin, just remove the mount path in your docker run command, the registry will then only be accessible at your specified port.

A run command can be found here(without cockpit mount): ```docker run --name RegistryContainer -p 4567:4567 -p 5000:5000 -e OI4_ADDR=10.11.4.232 -e OI4_PORT=1883 -e LOCAL_ADDR=10.11.4.232 -e CONTAINERNAME=RegistryContainer --mount type=bind,source=/usr/local/share/cockpit,target=/usr/local/share/cockpit registrycheckout:latest```\
(with cockpit mount) ```docker run --name RegistryContainer -p 4567:4567 -p 5000:5000 -e OI4_ADDR=10.11.4.232 -e OI4_PORT=1883 -e LOCAL_ADDR=10.11.4.232 -e CONTAINERNAME=RegistryContainer registrycheckout:latest```

## Dockerfiles:
some people might remove the Cockpit-UI as they don't support cockpit on their device.\
Just comment out the 3 lines below **# -------COCKPIT UI**. This will stop the Cockpit UI from being copied.


***The entire project is in a development stage until the final specification of TC-T6 is finished. Use at own discretion.***\
***Take a look at the code examples, especially the ```src/Service/Proxy/Messagebus/index.ts``` *processMqttMessage* function and its calls. It is responsible for handling the OI4-Messagebus API.***\
***Also, take a look at ```src/Service/Utilities/OPCUABuilder/index.ts``` in order to understand how the OPCUA Json Payloads are built.***\
***The models are available in their respective folders.***