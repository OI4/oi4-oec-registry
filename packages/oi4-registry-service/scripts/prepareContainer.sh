#!/bin/bash

container=./build/container

rm -rf $container
mkdir -p $container

#npm init -y

cp -r ./public $container/public
cp ./package.json $container
cp ./.npmrc $container/

# npm install --omit=dev
yarn run clean
yarn install --production=true

