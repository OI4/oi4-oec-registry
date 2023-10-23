#!/bin/bash
echo pwd
rm -rf ./build/container/packages/oi4-registry-ui

mkdir -p ./build/container/packages/oi4-registry-ui/build
mkdir -p ./build/container/packages/oi4-registry-ui/scripts

echo "*******************************"
echo "**  Install oi4-registry-ui  **"
echo "*******************************"
cp ../../scripts/deploy-config-ui.sh ./build/container/packages/oi4-registry-ui/scripts/deploy-config-ui.sh
cp ../../scripts/entrypoint.sh ./build/container/packages/oi4-registry-ui/scripts/entrypoint.sh
cp ../../packages/oi4-registry-service/package.json ./build/container/packages/oi4-registry-service/package.json
cp ../../packages/oi4-registry-ui/package.json ./build/container/packages/oi4-registry-ui/package.json
cd ../../build/container/oi4-registry-ui || exit
yarn install --production

