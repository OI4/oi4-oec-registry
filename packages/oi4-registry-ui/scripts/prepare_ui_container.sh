#!/bin/bash
cd ../../

rm -rf ./build/container/oi4-registry-ui

mkdir -p ./build/container/oi4-registry-ui/build
mkdir -p ./build/container/oi4-registry-ui/scripts

echo "*******************************"
echo "**  Install oi4-registry-ui  **"
echo "*******************************"
cp ./packages/oi4-registry-ui/scripts/deploy-config-ui.sh ./build/container/oi4-registry-ui/scripts/deploy-config-ui.sh
cp ./packages/oi4-registry-ui/scripts/entrypoint.sh ./build/container/oi4-registry-ui/scripts/entrypoint.sh
cp ./packages/oi4-registry-ui/package.json ./build/container/oi4-registry-ui/package.json
cp -r ./packages/oi4-registry-ui/build ./build/container/oi4-registry-ui/
cd ./build/container/oi4-registry-ui || exit
yarn install --production
