#!/bin/bash
rm -rf ./build

mkdir -p ./build/container/oi4-registry-service
mkdir -p ./build/container/oi4-registry-service/scripts
mkdir -p ./build/etc/oi4/config
mkdir -p ./build/etc/oi4/app

echo "************************************"
echo "**  Install oi4-registry-service  **"
echo "************************************"
cp ./scripts/entrypoint.sh ./build/container/oi4-registry-service/scripts/entrypoint.sh
cd ./build/container || exit
cp ./package.json ./build/container/oi4-registry-service/package.json
cp -r ./dist/ ./build/container/oi4-registry-service/src
cp -r ./public/ ./build/container/oi4-registry-service/public
cd ./build/container/oi4-registry-service || exit
yarn install --production
echo "Prepared oi4-registry-service for container creation"
cd ../../../..
