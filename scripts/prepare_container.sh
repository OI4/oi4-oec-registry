#!/bin/bash
rm -rf ./build

mkdir -p ./build/container/packages/oi4-local-ui
mkdir -p ./build/container/packages/oi4-registry-service
mkdir -p ./build/container/packages/oi4-registry-service/scripts

echo "***************************"
echo "**  Init parent package  **"
echo "***************************"
cp ./resources/package.json ./build/container/package.json
cd ./build/container || exit
yarn install --production
cd ../..

echo "************************************"
echo "**  Install oi4-registry-service  **"
echo "************************************"

cp ./scripts/deploy-config-ui.sh ./build/container/packages/oi4-registry-service/scripts/deploy-config-ui.sh
cp ./scripts/entrypoint.sh ./build/container/packages/oi4-registry-service/scripts/entrypoint.sh
cp ./packages/oi4-registry-service/package.json ./build/container/packages/oi4-registry-service/package.json
cp ./packages/oi4-registry-service/.npmrc ./build/container/packages/oi4-registry-service/.npmrc
cp -r ./packages/oi4-registry-service/dist/ ./build/container/packages/oi4-registry-service/src
cp -r ./packages/oi4-registry-service/public/ ./build/container/packages/oi4-registry-service/public
cd ./build/container/packages/oi4-registry-service || exit
yarn install --production
echo "Prepared oi4-registry-service for container creation"
cd ../../../..

# To avoid loadig all the dependencies of the ui, execute this as last
echo "****************************"
echo "**  Install oi4-local-ui  **"
echo "****************************"
cp ./packages/oi4-local-ui/package.json ./build/container/packages/oi4-local-ui/package.json
cp -r ./packages/oi4-local-ui/build ./build/container/packages/oi4-local-ui/
echo "Prepared oi4-local-ui for container creation"
