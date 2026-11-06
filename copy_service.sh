#!/bin/bash
rm -rf ./node_modules/@oi4/oi4-oec-dnp-encoding
rm -rf ./node_modules/@oi4/oi4-oec-json-schemas
rm -rf ./node_modules/@oi4/oi4-oec-service-conformity-validator
rm -rf ./node_modules/@oi4/oi4-oec-service-logger
rm -rf ./node_modules/@oi4/oi4-oec-service-model
rm -rf ./node_modules/@oi4/oi4-oec-service-node

cp -r $oec_service_root/node_modules/@oi4/oi4-oec-dnp-encoding ./node_modules/@oi4/oi4-oec-dnp-encoding
cp -r $oec_service_root/node_modules/@oi4/oi4-oec-json-schemas ./node_modules/@oi4/oi4-oec-json-schemas
cp -r $oec_service_root/node_modules/@oi4/oi4-oec-service-conformity-validator ./node_modules/@oi4/oi4-oec-service-conformity-validator
cp -r $oec_service_root/node_modules/@oi4/oi4-oec-service-logger ./node_modules/@oi4/oi4-oec-service-logger
cp -r $oec_service_root/node_modules/@oi4/oi4-oec-service-model ./node_modules/@oi4/oi4-oec-service-model
cp -r $oec_service_root/node_modules/@oi4/oi4-oec-service-node ./node_modules/@oi4/oi4-oec-service-node
